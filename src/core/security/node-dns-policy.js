/**
 * -----------------------------------------------------------------------------
 * Core Layer: 节点域名解析器归属决议 (Node DNS Policy Resolver)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 汇总各订阅上报的「节点域名 → 私有解析器」候选
 * 2. 按域名做全局冲突决议，输出确定性的映射表
 * 3. 冲突域名整体退出映射，交由调用方回退默认 DNS
 *
 * 设计约束：
 * - 订阅身份由调用方提供（URL 的 SHA256 短哈希），不使用显示 tag；
 * - 同一域名、同一解析器集合（忽略顺序）视为无冲突，可去重合并；
 * - 同一域名只要出现不同解析器集合，整个域名判定为冲突，不做 union、
 *   也不按遍历顺序择一保留；
 * - 输出按域名排序，保证多订阅顺序变化不改变最终配置。
 */

'use strict';

/** 规范化域名：小写、去首尾空白、去掉末尾根点 */
function normalizeDomain(domain) {
  if (typeof domain !== 'string') return '';
  return domain.trim().toLowerCase().replace(/\.$/, '');
}

/** 规范化解析器集合：去重并排序，用于集合比较与确定性输出 */
function normalizeResolvers(resolvers) {
  const list = Array.isArray(resolvers) ? resolvers : [resolvers];
  return [...new Set(list.filter(v => typeof v === 'string' && v).map(v => v.trim()))].sort();
}

/**
 * 决议节点域名解析器映射。
 *
 * @param {Array<{ domain: string, resolvers: string[], sourceId: string }>} [candidates=[]]
 * @returns {{ policies: object, conflicts: Array<{ domain: string, subscriptions: number, distinctResolvers: number }> }}
 *   policies  — 可安全写入 nameserver-policy 的「域名 → 解析器」映射（仅唯一归属）
 *   conflicts — 被整体排除的冲突域名（调用方负责脱敏告警）
 */
function resolveNodeDnsPolicies(candidates = []) {
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

  const policies = {};
  const conflicts = [];

  // 排序域名，消除订阅遍历顺序对产物键顺序的影响
  for (const domain of [...byDomain.keys()].sort()) {
    const perSub = byDomain.get(domain);
    const distinct = new Map();
    for (const resolvers of perSub.values()) {
      distinct.set(resolvers.join('\u0000'), resolvers);
    }

    if (distinct.size === 1) {
      policies[domain] = [...distinct.values()][0];
    } else {
      conflicts.push({
        domain,
        subscriptions: perSub.size,
        distinctResolvers: distinct.size
      });
    }
  }

  return { policies, conflicts };
}

module.exports = {
  resolveNodeDnsPolicies,
  normalizeDomain,
  normalizeResolvers
};
