/**
 * -----------------------------------------------------------------------------
 * Core Layer: DNS 净化沙箱 (DNS Sanitizer)
 * -----------------------------------------------------------------------------
 * 严格遵循洋葱模型 Core 层规范：纯函数、无副作用、无 I/O。
 *
 * 设计目标：
 *   1. 破除「鸡生蛋」死锁：default-nameserver 必须为纯 IP
 *   2. 破除 Fake-IP 自环：任何解析器地址不得落在 fake-ip-range 内
 *   3. 阻断私网/回环/基准网段进入 bootstrap 与节点解析链
 *   4. 剥离 DoH URL 中的 #proxy / #interface / #skip-cert-verify 等危险修饰符
 *   5. 分层信任：私网 DNS 仅在用户本地显式声明且语义等价时被保留
 */

'use strict';

const ipaddr = require('ipaddr.js');
const { isPrivateIp, isPrivateIPv6 } = require('../shared/ip');
const { PROTECTED_DOMAINS, normalizeDomainList } = require('../../data');

// ─────────────────────────────────────────────────────────────────────────────
// 1. 基础地址工具
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fake-IP 自环守卫网段。
 * 注意必须覆盖整个 198.18.0.0/15（含 198.19.0.0/16），
 * 因为常见配置会使用 198.18.0.1/16 之外的 198.19.x.x 作为 fake-ip 池，
 * 仅按 /16 判定会漏判 198.19.0.0/16 造成虚拟自环。
 */
const DEFAULT_FAKEIP_GUARD_RANGES = ['198.18.0.0/15'];

/**
 * 默认受保护域名。
 *
 * 词表本体已迁至只读数据层 `src/data/security-baselines.js`（`PROTECTED_DOMAINS`），
 * 此处仅保留一个 Set 视图供默认参数使用；用户可通过 `protectedDomains` 配置项
 * **追加**（只能加不能减），合并逻辑见 `src/config/index.js::applyAdditiveFields`。
 */
const DEFAULT_PROTECTED_DOMAINS = new Set(PROTECTED_DOMAINS);

/** 判断 IPv4 是否落在给定 CIDR 列表内 */
function ipv4InCidrs(ip, cidrs = []) {
  if (!ip || !Array.isArray(cidrs) || cidrs.length === 0) return false;
  try {
    const trimmed = String(ip).trim();
    if (!ipaddr.isValid(trimmed)) return false;
    const addr = ipaddr.parse(trimmed);
    if (addr.kind() !== 'ipv4') return false;
    for (const cidr of cidrs) {
      try {
        if (addr.match(ipaddr.parseCIDR(cidr))) return true;
      } catch (e) {}
    }
    return false;
  } catch {
    return false;
  }
}

function ipv6InCidrs(ip, cidrs = []) {
  if (!ip || !Array.isArray(cidrs) || cidrs.length === 0) return false;
  try {
    const clean = String(ip).trim().replace(/^\[|\]$/g, '');
    if (!ipaddr.isValid(clean)) return false;
    const addr = ipaddr.parse(clean);
    if (addr.kind() !== 'ipv6') return false;
    for (const cidr of cidrs) {
      try {
        if (addr.match(ipaddr.parseCIDR(cidr))) return true;
      } catch (e) {}
    }
    return false;
  } catch {
    return false;
  }
}

/** 是否为「被保留/不可路由」的 IPv4（含私网、回环、CGNAT、基准测试、组播） */
function isReservedV4(ip) {
  if (!ip) return false;
  try {
    const trimmed = String(ip).trim();
    if (!ipaddr.isValid(trimmed)) return false;
    const addr = ipaddr.parse(trimmed);
    if (addr.kind() !== 'ipv4') return false;
    return addr.range() !== 'unicast';
  } catch {
    return false;
  }
}

/**
 * 解析 DNS 服务器条目。
 * 支持形态：
 *   - 纯 IPv4          223.5.5.5
 *   - 纯 IPv4 + 端口   223.5.5.5:53
 *   - 纯 IPv6          [2400:3200::1] / [2400:3200::1]:53
 *   - URL 形式         https://223.5.5.5/dns-query#proxy&skip-cert-verify=true
 *   - 特殊关键字       system / dhcp://en0
 */
function parseDnsServer(entry) {
  const raw = String(entry == null ? '' : entry).trim();
  const result = {
    raw,
    kind: 'unknown',   // ip | url | special | invalid
    scheme: null,
    host: null,        // 已去除方括号
    port: null,
    path: null,
    modifiers: [],
    isIpLiteral: false,
    isIpv6: false
  };

  if (!raw) {
    result.kind = 'invalid';
    return result;
  }

  if (/^(system|dhcp:\/\/[^\s#]+)$/i.test(raw)) {
    result.kind = 'special';
    return result;
  }

  // 纯 IP:端口 (IPv6 带括号: [2400:3200::1]:53 或 [2400:3200::1])
  const v6Bracket = raw.match(/^\[([0-9a-fA-F:.]+)\](?::(\d+))?$/);
  if (v6Bracket && ipaddr.isValid(v6Bracket[1]) && ipaddr.parse(v6Bracket[1]).kind() === 'ipv6') {
    result.kind = 'ip';
    result.host = v6Bracket[1];
    result.port = v6Bracket[2] || null;
    result.isIpLiteral = true;
    result.isIpv6 = true;
    return result;
  }

  // 纯 IPv6 无括号（如 2400:3200::1）
  if (raw.includes(':') && !raw.includes('/') && !raw.includes('#')) {
    if (ipaddr.isValid(raw) && ipaddr.parse(raw).kind() === 'ipv6') {
      result.kind = 'ip';
      result.host = raw;
      result.isIpLiteral = true;
      result.isIpv6 = true;
      return result;
    }
  }

  const v4Port = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?$/);
  if (v4Port && ipaddr.isValid(v4Port[1]) && ipaddr.parse(v4Port[1]).kind() === 'ipv4') {
    result.kind = 'ip';
    result.host = v4Port[1];
    result.port = v4Port[2] || null;
    result.isIpLiteral = true;
    return result;
  }

  // URL 形式（含修饰符）
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const hashIdx = raw.indexOf('#');
    const base = hashIdx === -1 ? raw : raw.slice(0, hashIdx);
    const modifierStr = hashIdx === -1 ? '' : raw.slice(hashIdx + 1);
    result.kind = 'url';
    result.modifiers = modifierStr ? modifierStr.split('&').filter(Boolean) : [];
    try {
      const u = new URL(base);
      result.scheme = u.protocol.replace(':', '');
      result.host = u.hostname.replace(/^\[|\]$/g, '');
      result.port = u.port || null;
      result.path = u.pathname;
      result.isIpLiteral = ipaddr.isValid(result.host);
      result.isIpv6 = result.isIpLiteral && ipaddr.parse(result.host).kind() === 'ipv6';
    } catch {
      result.kind = 'invalid';
    }
    return result;
  }

  // 裸域名（带或不带端口，例如 dns.example.com 或 dns.example.com:53）
  const bareMatch = raw.match(/^([a-zA-Z0-9.-]+)(?::(\d+))?$/);
  if (bareMatch) {
    result.kind = 'url';
    result.scheme = 'plain';
    result.host = bareMatch[1];
    result.port = bareMatch[2] || null;
    return result;
  }

  result.kind = 'invalid';
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 危险修饰符规则
// ─────────────────────────────────────────────────────────────────────────────

const DANGEROUS_DNS_MODIFIERS = [
  { re: /^skip-cert-verify/i, id: 'DNS-TLS-BYPASS', severity: 'critical', note: '订阅试图关闭 DoH/DoT 证书校验（中间人可解密全部 DNS）' },
  { re: /^h3$/i, id: 'DNS-H3', severity: 'low', note: '强制 HTTP/3，与 respect-rules 组合存在可用性风险' },
  { re: /^ecs-override/i, id: 'DNS-ECS-OVERRIDE', severity: 'medium', note: '强制覆盖 ECS，可被用于定向污染解析结果' },
  { re: /^proxy$|^#?(direct|interface)/i, id: 'DNS-EGRESS', severity: 'high', note: '订阅试图指定 DNS 出口（可能制造解析死锁或流量绕行）' }
];

/** 修饰符严重度排序，用于按来源信任级决定剥离范围 */
const MODIFIER_SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * 判断某个修饰符在给定严重度阈值下是否必须剥离。
 * 阈值语义：rank(修饰符) >= rank(阈值) 即剥离。
 *   - 默认 'low'：剥离全部危险修饰符（用于不可信订阅来源）
 *   - 'critical'：仅剥离 TLS 校验绕过等致命修饰符（用于用户本地显式声明）
 */
function shouldStripModifier(modifier, floor = 'low') {
  const hit = DANGEROUS_DNS_MODIFIERS.find(d => d.re.test(modifier));
  if (!hit) return false;
  const hitRank = MODIFIER_SEVERITY_RANK[hit.severity] ?? 0;
  const floorRank = MODIFIER_SEVERITY_RANK[floor] ?? 0;
  return hitRank >= floorRank;
}

function analyzeModifiers(modifiers = []) {
  const findings = [];
  for (const m of modifiers) {
    const hit = DANGEROUS_DNS_MODIFIERS.find(d => d.re.test(m));
    if (hit) findings.push({ modifier: m, id: hit.id, severity: hit.severity, note: hit.note });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 角色化校验
// ─────────────────────────────────────────────────────────────────────────────

const ROLES = {
  DEFAULT: 'default',   // default-nameserver：仅纯 IP
  BOOTSTRAP: 'bootstrap', // 同 default 语义（别名）
  PROXY_SERVER: 'proxy-server', // 节点解析：允许加密 DNS，但必须 IP 字面量或受信域名
  DIRECT: 'direct',     // 直连解析：允许域名 DoH
  NAMESERVER: 'nameserver' // 主解析：允许域名 DoH
};

/**
 * 校验并净化单个 DNS 服务器条目。
 * @param {string} entry
 * @param {object} options
 * @param {string} options.role ROLES 之一
 * @param {string[]} [options.fakeIpRanges] 需排除的网段（防自环）
 * @param {string[]} [options.trustedPrivateCidrs] 用户显式声明的受信私网 DNS 网段
 * @param {boolean} [options.allowPrivateLiteral=false] 是否允许纯 IP 私网（仅用户本地声明时开启）
 * @returns {{ ok: boolean, value: string|null, entry: object, findings: Array<object>, reason?: string }}
 */
function sanitizeDnsServer(entry, options = {}) {
  const opts = typeof options === 'string' ? { role: options } : (options || {});
  const {
    role = ROLES.NAMESERVER,
    fakeIpRanges = DEFAULT_FAKEIP_GUARD_RANGES,
    trustedPrivateCidrs = [],
    allowPrivateLiteral = false,
    modifierSeverityFloor = 'low'
  } = opts;

  const parsed = parseDnsServer(entry);
  const findings = [];

  /** 按严重度阈值过滤危险修饰符后重组后缀 */
  const rebuildModifiers = () => {
    const kept = parsed.modifiers.filter(m => !shouldStripModifier(m, modifierSeverityFloor));
    return kept.length ? `#${kept.join('&')}` : '';
  };

  if (parsed.kind === 'invalid') {
    return { ok: false, value: null, entry: parsed, findings, reason: 'unparsable' };
  }

  if (parsed.kind === 'special') {
    // system / dhcp:// 不可用于 default-nameserver（会与「纯 IP」约束冲突）
    if (role === ROLES.DEFAULT || role === ROLES.BOOTSTRAP) {
      return { ok: false, value: null, entry: parsed, findings, reason: 'special-not-allowed-in-bootstrap' };
    }
    return { ok: true, value: parsed.raw, entry: parsed, findings };
  }

  // default-nameserver (bootstrap) 必须是纯 IP，绝对禁止加密 URL 或域名格式（防内核死锁）
  if (role === ROLES.DEFAULT || role === ROLES.BOOTSTRAP) {
    if (parsed.kind !== 'ip' || (parsed.scheme && parsed.scheme !== 'plain')) {
      findings.push({
        id: 'DNS-BOOTSTRAP-NOT-IP', severity: 'critical',
        note: `default-nameserver 必须为纯 IP 格式 (ip 或 ip:port)，禁止使用加密 DNS 或域名: ${parsed.raw}`
      });
      return { ok: false, value: null, entry: parsed, findings, reason: 'bootstrap-must-be-ip' };
    }
  }

  // 修饰符审计：标注每一项是「已剥离」还是「按信任级保留」
  for (const f of analyzeModifiers(parsed.modifiers)) {
    findings.push({ ...f, stripped: shouldStripModifier(f.modifier, modifierSeverityFloor) });
  }

  // ── 纯 IP 字面量的网段校验 ─────────────────────────────────────────────
  if (parsed.isIpLiteral) {
    const v4 = !parsed.isIpv6 && /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.host);
    const isPrivate = v4 ? isReservedV4(parsed.host) : isPrivateIPv6(parsed.host);
    const inFakeIp = v4 && ipv4InCidrs(parsed.host, fakeIpRanges);

    // Fake-IP 自环优先判定：198.18.0.0/15 同时属于保留网段，
    // 但只有「自环」才是致命语义，必须优先于通用私网判定上报。
    if (inFakeIp) {
      findings.push({
        id: 'DNS-FAKEIP-SELFLOOP', severity: 'critical',
        note: `解析器地址 ${parsed.host} 落在 fake-ip 网段内，会造成虚拟自环`
      });
      return { ok: false, value: null, entry: parsed, findings, reason: 'fakeip-selfloop' };
    }

    if (isPrivate && !allowPrivateLiteral) {
      findings.push({
        id: 'DNS-PRIVATE-RESOLVER', severity: 'high',
        note: `解析器地址 ${parsed.host} 属于私网/保留网段`
      });
      return { ok: false, value: null, entry: parsed, findings, reason: 'private-resolver' };
    }

    if (isPrivate && allowPrivateLiteral) {
      const trusted = v4 ? ipv4InCidrs(parsed.host, trustedPrivateCidrs) : ipv6InCidrs(parsed.host, trustedPrivateCidrs);
      if (!trusted) {
        findings.push({
          id: 'DNS-PRIVATE-UNTRUSTED', severity: 'high',
          note: `私网 DNS ${parsed.host} 未被用户 trust 列表覆盖`
        });
        return { ok: false, value: null, entry: parsed, findings, reason: 'private-not-trusted' };
      }
    }

    // 剥离危险修饰符后重组
    const scheme = parsed.scheme && parsed.scheme !== 'plain' ? `${parsed.scheme}://` : '';
    const host = parsed.isIpv6 ? `[${parsed.host}]` : parsed.host;
    const port = parsed.port ? `:${parsed.port}` : '';
    const isHttpDns = /^(https?|h3)$/i.test(parsed.scheme || '');
    const path = isHttpDns
      ? (parsed.path && parsed.path !== '/' ? parsed.path : '/dns-query')
      : '';
    const suffix = rebuildModifiers();
    return { ok: true, value: `${scheme}${host}${port}${path}${suffix}`, entry: parsed, findings };
  }

  // ── 域名形式的 DoH/DoT ────────────────────────────────────────────────
  if (role === ROLES.DEFAULT) {
    findings.push({
      id: 'DNS-BOOTSTRAP-DOMAIN', severity: 'critical',
      note: `default-nameserver 出现域名形式 ${parsed.host}，将产生解析死锁`
    });
    return { ok: false, value: null, entry: parsed, findings, reason: 'bootstrap-must-be-ip' };
  }

  if (role === ROLES.PROXY_SERVER) {
    findings.push({
      id: 'DNS-NODE-DOMAIN-RESOLVER', severity: 'high',
      note: `节点解析器使用了域名 ${parsed.host}，其自身解析依赖 default-nameserver，存在死锁面`
    });
    return { ok: false, value: null, entry: parsed, findings, reason: 'proxy-server-must-be-ip-or-trusted' };
  }

  const scheme = parsed.scheme && parsed.scheme !== 'plain' ? `${parsed.scheme}://` : '';
  const port = parsed.port ? `:${parsed.port}` : '';
  const isHttpDnsDomain = /^(https?|h3)$/i.test(parsed.scheme || '');
  const path = isHttpDnsDomain
    ? (parsed.path && parsed.path !== '/' ? parsed.path : '/dns-query')
    : '';
  const suffix = rebuildModifiers();
  return { ok: true, value: `${scheme}${parsed.host}${port}${path}${suffix}`, entry: parsed, findings };
}

/**
 * 批量净化一组 DNS 服务器。
 * @returns {{ servers: string[], findings: Array<object>, rejected: Array<object> }}
 */
function sanitizeDnsServerList(list, options = {}) {
  const opts = typeof options === 'string' ? { role: options } : (options || {});
  const servers = [];
  const findings = [];
  const rejected = [];
  const input = Array.isArray(list) ? list : (list == null ? [] : [list]);

  for (const entry of input) {
    const r = sanitizeDnsServer(entry, opts);
    for (const f of r.findings) findings.push({ ...f, entry: String(entry) });
    if (r.ok) {
      if (!servers.includes(r.value)) servers.push(r.value);
    } else {
      rejected.push({ entry: String(entry), reason: r.reason });
    }
  }

  return { servers, findings, rejected };
}

/**
 * hosts 表消毒。
 *
 * 主要威胁：
 *   - 高危公网域名被指向攻击者 IP（配合作者自签/泛域名证书可 MitM）
 *   - 关键域名被指向内网 IP（借助 TUN 全量路由探测内网服务）
 *   - 多订阅对同域名给出互斥 IP（裁决必须确定性）
 *
 * @param {object} hostsMap 形如 { 'github.com': ['1.1.1.1'], '+.example.com': '1.2.3.4' }
 * @param {object} options
 * @param {Set<string>|string[]} [options.protectedDomains] 禁止被 hosts 覆盖的高危域名后缀。
 *        本函数是纯原语：**传什么就用什么**（默认取只读基线），不与基线做并集；
 *        「基线 ∪ 用户追加」的合并属于编排层职责，见 `effectiveProtectedDomains()`。
 * @param {string[]} [options.internalCidrs] 视为内网的网段
 * @param {boolean} [options.allowInternal=false] 是否允许内网映射（仅用户本地声明）
 * @returns {{ hosts: object, findings: Array<object>, dropped: Array<object> }}
 */
function sanitizeHosts(hostsMap, options = {}) {
  const {
    protectedDomains = DEFAULT_PROTECTED_DOMAINS,
    internalCidrs = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16', '100.64.0.0/10'],
    allowInternal = false,
    allowNonRoutable = false,
    userTrustedDomains = []
  } = options;

  const hosts = {};
  const findings = [];
  const dropped = [];

  if (!hostsMap || typeof hostsMap !== 'object') return { hosts, findings, dropped };
  const trustedSet = new Set((Array.isArray(userTrustedDomains) ? userTrustedDomains : []).map(d => String(d).toLowerCase().trim()));
  // 规范化受保护域名：既支持只读基线的 Set，也支持配置侧传来的原始数组（含 `+.`、大小写、尾随点等写法）
  const protectedSet = new Set(
    normalizeDomainList(Array.isArray(protectedDomains) ? protectedDomains : [...(protectedDomains || [])])
  );

  for (const [rawKey, rawValue] of Object.entries(hostsMap)) {
    const key = String(rawKey).trim().toLowerCase();
    const bare = key.replace(/^\+\./, '').replace(/^\*\./, '').replace(/\.+$/, '');
    const values = (Array.isArray(rawValue) ? rawValue : [rawValue]).map(v => String(v).trim()).filter(Boolean);

    if (values.length === 0) continue;

    // 受保护域名检测（支持用户显式白名单 userTrustedDomains 豁免）
    const isExempt = trustedSet.has(bare) || [...trustedSet].some(t => bare.endsWith('.' + t));
    const suffixHit = !isExempt && [...protectedSet].find(p => bare === p || bare.endsWith(`.${p}`));
    if (suffixHit) {
      findings.push({
        id: 'HOSTS-PROTECTED-DOMAIN', severity: 'critical',
        note: `订阅试图改写受保护域名 ${key} -> ${values.join(', ')}`
      });
      dropped.push({ key, values, reason: 'protected-domain' });
      continue;
    }

    const safeValues = [];
    for (const v of values) {
      // 仅接受合法 IP 字面量；CNAME 形式或非法 IP 一律拒绝（可构造指向受保护域名的解析链）
      if (!ipaddr.isValid(v)) {
        findings.push({
          id: 'HOSTS-CNAME-REJECTED', severity: 'high',
          note: `hosts 值 ${v} 非合法 IP 字面量（疑似 CNAME 链或格式错误），已拒绝`
        });
        dropped.push({ key, values: [v], reason: 'non-literal-value' });
        continue;
      }
      const addr = ipaddr.parse(v);
      const isV4 = addr.kind() === 'ipv4';
      const isV6 = addr.kind() === 'ipv6';

      // 非路由保留段（TEST-NET / 文档示例段）优先归类：这些地址不可能指向真实主机，
      // 语义上比「内网重定向」更精确，也避免误报为内网探测。
      if (isV4 && !allowNonRoutable &&
          ipv4InCidrs(v, ['192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24', '192.88.99.0/24'])) {
        findings.push({
          id: 'HOSTS-NONROUTABLE', severity: 'medium',
          note: `hosts 值 ${v} 属于文档/保留测试网段（${key}），已剥离`
        });
        dropped.push({ key, values: [v], reason: 'non-routable' });
        continue;
      }

      const internal = isV4
        ? (isReservedV4(v) || ipv4InCidrs(v, internalCidrs))
        : isPrivateIPv6(v);

      if (internal && !allowInternal) {
        findings.push({
          id: 'HOSTS-INTERNAL-REDIRECT', severity: 'critical',
          note: `订阅试图将 ${key} 指向内网/保留地址 ${v}（TUN 场景下可用于内网探测）`
        });
        dropped.push({ key, values: [v], reason: 'internal-redirect' });
        continue;
      }

      safeValues.push(v);
    }

    if (safeValues.length > 0) {
      hosts[key] = safeValues.length === 1 ? safeValues[0] : safeValues;
    }
  }

  return { hosts, findings, dropped };
}

/** 默认受保护域名列表见文件顶部常量定义 */

// ─────────────────────────────────────────────────────────────────────────────
// 4. nameserver-policy 净化
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 净化 nameserver-policy。
 *
 * 威胁：
 *   - 订阅为任意域名（如 paypal.com）指定自家解析器，实现定向劫持
 *   - 覆盖脚本自身的 rule-set:cn-domain / rule-set:non-cn 策略键
 *   - 值为 DoH URL 且带 skip-cert-verify 修饰符
 *
 * @param {object} policy
 * @param {object} options
 * @param {Set<string>} [options.reservedKeys] 禁止被订阅覆盖的策略键
 * @param {boolean} [options.isMaster=false] master 订阅或用户本地声明
 * @returns {{ policy: object, findings: Array<object>, dropped: Array<object> }}
 */
function sanitizeNameserverPolicy(policy, options = {}) {
  const { reservedKeys = new Set(['rule-set:cn-domain', 'rule-set:non-cn']), isMaster = false, ...rest } = options;
  const out = {};
  const findings = [];
  const dropped = [];

  if (!policy || typeof policy !== 'object') return { policy: out, findings, dropped };

  for (const [rawKey, value] of Object.entries(policy)) {
    const key = String(rawKey).trim();

    if (reservedKeys.has(key.toLowerCase())) {
      findings.push({
        id: 'NSPOLICY-RESERVED-KEY', severity: 'high',
        note: `订阅试图覆盖脚本保留的策略键 ${key}`
      });
      dropped.push({ key, reason: 'reserved-key' });
      continue;
    }

    // 通配/正则形式的键无法可靠审计，仅允许 master/用户声明
    if (!isMaster) {
      findings.push({
        id: 'NSPOLICY-UNTRUSTED-KEY', severity: 'high',
        note: `非 master 订阅试图为 ${key} 指定专属解析器（定向劫持面）`
      });
      dropped.push({ key, reason: 'untrusted-source' });
      continue;
    }

    const { servers, findings: f2, rejected } = sanitizeDnsServerList(value, {
      role: ROLES.NAMESERVER,
      fakeIpRanges: rest.fakeIpRanges || DEFAULT_FAKEIP_GUARD_RANGES,
      trustedPrivateCidrs: rest.trustedPrivateCidrs || [],
      allowPrivateLiteral: !!rest.allowPrivateLiteral,
      modifierSeverityFloor: rest.modifierSeverityFloor || 'low'
    });
    findings.push(...f2);
    if (rejected.length) dropped.push({ key, reason: 'all-servers-rejected', rejected });
    if (servers.length > 0) {
      out[key] = servers.length === 1 ? servers[0] : servers;
    }
  }

  return { policy: out, findings, dropped };
}

module.exports = {
  ROLES,
  DEFAULT_FAKEIP_GUARD_RANGES,
  DEFAULT_PROTECTED_DOMAINS,
  DANGEROUS_DNS_MODIFIERS,
  MODIFIER_SEVERITY_RANK,
  shouldStripModifier,
  ipv4InCidrs,
  isReservedV4,
  parseDnsServer,
  analyzeModifiers,
  sanitizeDnsServer,
  sanitizeDnsServerList,
  sanitizeHosts,
  sanitizeNameserverPolicy
};
