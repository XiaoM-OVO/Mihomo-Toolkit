/**
 * -----------------------------------------------------------------------------
 * Core Layer: 节点域名解析器归属决议 (Node DNS Policy Resolver)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 汇总各订阅上报的「节点域名 → 私有解析器」候选
 * 2. 按域名做全局冲突决议，输出确定性的映射表
 * 3. 同源且同后缀的多个节点域名折叠为一条 `.suffix` 通配键，压缩产物长度
 * 4. 冲突域名整体退出映射，交由调用方回退默认 DNS
 *
 * 设计约束：
 * - 订阅身份由调用方提供（URL 的 SHA256 短哈希），不使用显示 tag；
 * - 同一域名、同一解析器集合（忽略顺序）视为无冲突，可去重合并；
 * - 同一域名只要出现不同解析器集合，整个域名判定为冲突，不做 union、
 *   也不按遍历顺序择一保留；
 * - 折叠仅在同一来源、同一解析器集合、且后缀下无冲突域名时进行；
 *   否则保留逐域名精确键；
 * - 折叠键统一使用 `.suffix`（覆盖任意层级子域，不含裸域），不使用 `+.` / `*.`；
 * - 输出按域名排序，保证多订阅顺序变化不改变最终配置。
 */

'use strict';

/** 规范化域名：小写、去首尾空白、去掉末尾根点 */
function normalizeDomain(domain) {
  if (typeof domain !== 'string') return '';
  return domain.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * 规范化单个解析器地址：
 * - 可解析为 URL 的（DoH / DoT 等）：scheme / host 统一小写、去掉路径末尾斜杠，
 *   使「同一解析器的大小写 / 尾斜杠差异」不会被误判为不同集合（从而误判域名冲突）；
 * - 非 URL 形态（纯主机名、IP 字面量等）：仅去首尾空白。
 * 输出保持为可直接写入 nameserver-policy 的规范形式。
 * @param {string} resolver
 * @returns {string}
 */
function normalizeResolver(resolver) {
  const raw = resolver.trim();
  try {
    const u = new URL(raw);
    const pathname = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host}${pathname}${u.search}${u.hash}`;
  } catch {
    return raw;
  }
}

/** 规范化解析器集合：去重并排序，用于集合比较与确定性输出 */
function normalizeResolvers(resolvers) {
  const list = Array.isArray(resolvers) ? resolvers : [resolvers];
  const normalized = list
    .filter(v => typeof v === 'string' && v.trim())
    .map(normalizeResolver)
    .filter(v => v);
  return [...new Set(normalized)].sort();
}

/**
 * 生成可折叠的父级后缀。
 * 至少保留两段（如 `a.example.com` → `example.com`），避免把单段顶级域交给某一订阅。
 */
function suffixCandidates(domain) {
  const labels = domain.split('.');
  const out = [];
  for (let i = 1; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'));
  return out;
}

/**
 * 决议节点域名解析器映射。
 *
 * @param {Array<{ domain: string, resolvers: string[], sourceId: string }>} [candidates=[]]
 * @param {object} [options]
 * @param {boolean} [options.fold=true] 是否把同源同后缀的多个域名折叠为 `.suffix` 通配键
 * @returns {{ policies: object, conflicts: Array<{ domain: string, subscriptions: number, distinctResolvers: number }> }}
 *   policies  — 可安全写入 nameserver-policy 的映射（精确键或 `.suffix` 折叠键，仅唯一归属）
 *   conflicts — 被整体排除的冲突域名（调用方负责脱敏告警）
 */
function resolveNodeDnsPolicies(candidates = [], options = {}) {
  const fold = options.fold !== false;
  const byDomain = new Map();

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const domain = normalizeDomain(candidate.domain);
    const sourceId = typeof candidate.sourceId === 'string' ? candidate.sourceId.trim() : '';
    const resolvers = normalizeResolvers(candidate.resolvers || []);
    if (!domain || !sourceId || resolvers.length === 0) continue;

    if (!byDomain.has(domain)) byDomain.set(domain, new Map());
    byDomain.get(domain).set(sourceId, resolvers);
  }

  const assignable = new Map();
  const conflicts = [];
  const conflictDomains = [];

  // 排序域名，消除订阅遍历顺序对产物键顺序的影响
  for (const domain of [...byDomain.keys()].sort()) {
    const perSub = byDomain.get(domain);
    const distinct = new Map();
    for (const resolvers of perSub.values()) {
      distinct.set(resolvers.join('\u0000'), resolvers);
    }

    if (distinct.size === 1) {
      const resolvers = [...distinct.values()][0];
      assignable.set(domain, {
        resolvers,
        resolverKey: resolvers.join('\u0000'),
        sourceIds: [...perSub.keys()].sort()
      });
    } else {
      conflicts.push({
        domain,
        subscriptions: perSub.size,
        distinctResolvers: distinct.size
      });
      conflictDomains.push(domain);
    }
  }

  const policies = {};
  const folded = new Set();

  // 1. 折叠：同源、同解析器集合、覆盖 ≥2 个域名的后缀才值得通配（可用 fold:false 完全关闭）
  const groups = new Map();
  for (const [domain, info] of (fold ? assignable : [])) {
    for (const suffix of suffixCandidates(domain)) {
      if (!groups.has(suffix)) {
        groups.set(suffix, { domains: [], sourceIds: new Set(), resolverKeys: new Set() });
      }
      const group = groups.get(suffix);
      group.domains.push(domain);
      for (const id of info.sourceIds) group.sourceIds.add(id);
      group.resolverKeys.add(info.resolverKey);
    }
  }

  // 由长到短排序：优先用最贴近域名的最具体后缀，避免通配范围被无谓放大
  const suffixes = [...groups.keys()].sort(
    (a, b) => b.split('.').length - a.split('.').length || a.localeCompare(b)
  );
  for (const suffix of suffixes) {
    const group = groups.get(suffix);
    if (group.sourceIds.size !== 1 || group.resolverKeys.size !== 1 || group.domains.length < 2) continue;
    if (group.domains.some(domain => folded.has(domain))) continue;
    // 后缀下若有冲突域名，折叠会把该域名交给本订阅解析器，违反「冲突回退默认 DNS」。
    if (conflictDomains.some(domain => domain.endsWith(`.${suffix}`))) continue;

    policies[`.${suffix}`] = assignable.get(group.domains[0]).resolvers;
    for (const domain of group.domains) folded.add(domain);
  }

  // 2. 未能折叠（或只有一个域名）的条目保留精确键
  for (const domain of [...assignable.keys()].sort()) {
    if (!folded.has(domain)) policies[domain] = assignable.get(domain).resolvers;
  }

  const sortedPolicies = {};
  for (const key of Object.keys(policies).sort()) sortedPolicies[key] = policies[key];

  return { policies: sortedPolicies, conflicts };
}

module.exports = {
  resolveNodeDnsPolicies,
  normalizeDomain,
  normalizeResolvers,
  suffixCandidates
};
