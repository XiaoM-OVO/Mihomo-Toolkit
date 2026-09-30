/**
 * -----------------------------------------------------------------------------
 * Core Layer: 解析链规划器 (Resolver Chain Planner)
 * -----------------------------------------------------------------------------
 * 纯函数。把「环境能力」+「净化后的用户声明」编译为一份确定性的 Mihomo DNS 块，
 * 并显式满足以下内核不变式：
 *
 *   INV-1  default-nameserver ⊆ IP 字面量（否则解析 DNS 服务器域名时死锁）
 *   INV-2  proxy-server-nameserver ∩ fake-ip-range = ∅（否则虚拟自环）
 *   INV-3  proxy-server-nameserver ⊆ IP 字面量（否则节点解析依赖自身，鸡蛋问题）
 *   INV-4  respect-rules = true ⇒ proxy-server-nameserver ≠ ∅
 *   INV-5  fallback ≠ ∅ ⇒ fallback-filter 必须显式声明（否则内核默认 geoip-code=CN 生效）
 *   INV-6  direct-nameserver-follow-policy = true ⇒ direct-nameserver ≠ ∅
 *   INV-7  enhanced-mode = fake-ip ⇒ 节点域名必须进入 fake-ip-filter（防环路）
 *   INV-8  dns.listen 必须绑定回环（否则成为开放解析器）
 *   INV-9  prefer-h3 与 respect-rules 不得同时为 true
 */

'use strict';

const {
  ROLES, sanitizeDnsServerList, sanitizeNameserverPolicy, sanitizeHosts,
  parseDnsServer, ipv4InCidrs, parseV4CidrToRange, ipv4ToInt
} = require('./dns-sanitizer');

// ─────────────────────────────────────────────────────────────────────────────
// 1. 公共解析器池（按能力标注，而非按品牌硬编码）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * family: 支持的地址族
 * scope:  domestic(境内) | global(境外)
 * caps:   bootstrap(能否作为 default-nameserver) / node(能否解析节点域名)
 * egress: direct(可直连) — 池内全部要求直连可达，不依赖代理
 */
const PUBLIC_RESOLVER_POOL = [
  { id: 'alidns', v4: '223.5.5.5', v6: '2400:3200::1', family: ['v4', 'v6'], scope: 'domestic', doh: 'https://223.5.5.5/dns-query', dot: 'tls://223.5.5.5', caps: { bootstrap: true, node: true } },
  { id: 'dnspod', v4: '119.29.29.29', v6: '2402:4e00::', family: ['v4', 'v6'], scope: 'domestic', doh: 'https://119.29.29.29/dns-query', dot: 'tls://119.29.29.29', caps: { bootstrap: true, node: true } },
  { id: 'cn-114', v4: '114.114.114.114', v6: null, family: ['v4'], scope: 'domestic', doh: null, dot: null, caps: { bootstrap: true, node: true } },
  { id: 'cloudflare', v4: '1.1.1.1', v6: '2606:4700:4700::1111', family: ['v4', 'v6'], scope: 'global', doh: 'https://1.1.1.1/dns-query', dot: 'tls://1.1.1.1', caps: { bootstrap: true, node: true } },
  { id: 'google', v4: '8.8.8.8', v6: '2001:4860:4860::8888', family: ['v4', 'v6'], scope: 'global', doh: 'https://8.8.8.8/dns-query', dot: 'tls://8.8.8.8', caps: { bootstrap: true, node: true } },
  { id: 'quad9', v4: '9.9.9.9', v6: '2620:fe::fe', family: ['v4', 'v6'], scope: 'global', doh: 'https://9.9.9.9/dns-query', dot: 'tls://9.9.9.9', caps: { bootstrap: true, node: true } }
];

const PREFERRED_PROTOCOL_ORDER = ['doh', 'dot', 'udp'];

/** 按地址族筛选池条目：v6 请求不得返回纯 v4 地址，否则单栈环境会引导失败 */
function entriesForScope(scope, family) {
  return PUBLIC_RESOLVER_POOL.filter(r => {
    if (r.scope !== scope || !r.family.includes(family)) return false;
    if (family === 'v6') return !!r.v6;
    return !!r.v4;
  });
}

function pickAddress(entry, family, protocol) {
  // v6 的加密 DNS 端点需要由 v6 地址派生，池中的 doh/dot 字段是 v4 端点
  if (family === 'v6') {
    if (!entry.v6) return null;
    const host = `[${entry.v6}]`;
    if (protocol === 'doh') return entry.doh ? `https://${host}/dns-query` : null;
    if (protocol === 'dot') return entry.dot ? `tls://${host}` : null;
    return host;
  }
  if (protocol === 'doh' && entry.doh) return entry.doh;
  if (protocol === 'dot' && entry.dot) return entry.dot;
  return entry.v4 || null;
}

function buildFromPool(scope, family, count, protocol) {
  const out = [];
  for (const proto of PREFERRED_PROTOCOL_ORDER) {
    if (protocol && proto !== protocol) continue;
    for (const entry of entriesForScope(scope, family)) {
      const addr = pickAddress(entry, family, proto);
      if (addr && !out.includes(addr)) out.push(addr);
      if (out.length >= count) return out;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 环境画像
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} EnvProfile
 * @property {boolean} ipv4 是否具备 IPv4 出口
 * @property {boolean} ipv6 是否具备 IPv6 出口
 * @property {boolean} [dnsEgressAllowed=true] 是否允许直接向公网 53/443 发起 DNS
 * @property {'direct'|'proxy-only'} [egress='direct'] 出网方式；proxy-only 表示流量必须先经代理
 * @property {string[]} [localResolvers] 环境强制的本地解析器（企业内网/运营商网关）
 * @property {string[]} [trustedPrivateCidrs] 用户显式信任的私网 DNS 网段
 * @property {string[]} [privateZones] 仅内网可解析的域后缀（split-horizon），如 '.corp'
 * @property {'home'|'enterprise'|'ipv6-only'|'captive'} [kind='home'] 环境类型
 */

function normalizeEnvProfile(env = {}) {
  const kind = env.kind || 'home';
  const defaultsByKind = {
    home: { ipv4: true, ipv6: false, dnsEgressAllowed: true, egress: 'direct' },
    enterprise: { ipv4: true, ipv6: false, dnsEgressAllowed: false, egress: 'direct' },
    'ipv6-only': { ipv4: false, ipv6: true, dnsEgressAllowed: true, egress: 'direct' },
    captive: { ipv4: true, ipv6: false, dnsEgressAllowed: false, egress: 'direct' }
  };
  const base = defaultsByKind[kind] || defaultsByKind.home;
  return {
    kind,
    ipv4: env.ipv4 !== undefined ? !!env.ipv4 : base.ipv4,
    ipv6: env.ipv6 !== undefined ? !!env.ipv6 : base.ipv6,
    dnsEgressAllowed: env.dnsEgressAllowed !== undefined ? !!env.dnsEgressAllowed : base.dnsEgressAllowed,
    egress: env.egress || base.egress,
    localResolvers: Array.isArray(env.localResolvers) ? env.localResolvers : [],
    trustedPrivateCidrs: Array.isArray(env.trustedPrivateCidrs) ? env.trustedPrivateCidrs : [],
    privateZones: (Array.isArray(env.privateZones) ? env.privateZones : []).map(z => String(z).toLowerCase())
  };
}

/** 在给定网段列表中查出条目所属的网段下标 */
function matchCidr(ip, cidrs) {
  const value = ipv4ToInt(ip);
  if (value === null) return -1;
  return cidrs.findIndex(c => {
    const r = parseV4CidrToRange(c);
    return r && value >= r.start && value <= r.end;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 主规划器
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 规划 DNS 解析链。
 *
 * @param {object} input
 * @param {EnvProfile} input.env 环境画像
 * @param {object} [input.userDns={}] 用户本地声明的 DNS（最高信任级）
 * @param {object|null} [input.masterDns=null] master 订阅的 DNS 块（中等信任级）
 * @param {object} [input.options={}]
 * @returns {{ dns: object, findings: Array<object>, warnings: string[], capabilities: object }}
 */
function planResolverChain(input = {}) {
  const env = normalizeEnvProfile(input.env || {});
  const userDns = input.userDns || {};
  const masterDns = input.masterDns || null;
  const opts = input.options || {};

  const findings = [];
  const warnings = [];
  const notes = (arr, tag) => arr.forEach(f => findings.push({ ...f, source: tag }));

  const family = env.ipv6 && !env.ipv4 ? 'v6' : (env.ipv4 ? 'v4' : null);
  if (!family) {
    throw new Error('[ResolverPlan] 环境画像缺少可用地址族（ipv4/ipv6 均为 false），无法规划解析链');
  }

  const fakeIpRange = opts.fakeIpRange || '198.18.0.1/16';
  const fakeIpRange6 = opts.fakeIpRange6 || 'fdfe:dcba:9876::1/64';
  const guardRanges = [fakeIpRange, '198.18.0.0/15'];

  // ── 3.1 引导层：default-nameserver 必须为纯 IP 且必须真实可达 ──────────────
  const bootstrapCandidates = [];
  const userBootstrap = userDns['default-nameserver'];
  if (userBootstrap) {
    const r = sanitizeDnsServerList(userBootstrap, {
      role: ROLES.DEFAULT,
      fakeIpRanges: guardRanges,
      trustedPrivateCidrs: env.trustedPrivateCidrs,
      allowPrivateLiteral: env.localResolvers.length > 0
    });
    notes(r.findings, 'user:default-nameserver');
    bootstrapCandidates.push(...r.servers);
  }

  if (env.localResolvers.length > 0) {
    // 企业内网/captive：本地解析器是唯一可达的引导源，但必须落在用户 trust 网段内
    const cidrSource = env.trustedPrivateCidrs;
    const trusted = env.localResolvers.filter(ip => matchCidr(ip, cidrSource) !== -1);
    if (trusted.length !== env.localResolvers.length) {
      warnings.push(
        `检测到 localResolvers (${env.localResolvers.join(', ')}) 中存在未被 trustedPrivateCidrs 覆盖的条目，` +
        `为保证安全已忽略；如确为内网 DNS 请显式声明信任网段。`
      );
    }
    for (const ip of trusted) if (!bootstrapCandidates.includes(ip)) bootstrapCandidates.push(ip);
  }

  if (env.dnsEgressAllowed && bootstrapCandidates.length < 2) {
    for (const addr of buildFromPool('domestic', family, 2, null)) {
      if (!bootstrapCandidates.includes(addr)) bootstrapCandidates.push(addr);
    }
  }

  if (bootstrapCandidates.length === 0) {
    // Fail-safe：允许回落到 system 但必须显式告警，且不得用于 proxy-server-nameserver
    warnings.push('无任何可达的纯 IP 引导解析器，已回落 default-nameserver: [system]。这依赖系统 DNS，存在被本地劫持的风险，请尽快指定可达的纯 IP 解析器。');
    bootstrapCandidates.push('system');
  }

  const defaultNameserver = [...new Set(bootstrapCandidates)].slice(0, 4);

  // ── 3.2 节点解析层：proxy-server-nameserver 必须纯 IP 且可直连 ─────────────
  const nodeResolvers = [];
  const userNodeResolvers = userDns['proxy-server-nameserver'] || userDns['proxy-server-nameserver-local'];
  if (userNodeResolvers) {
    const r = sanitizeDnsServerList(userNodeResolvers, {
      role: ROLES.PROXY_SERVER,
      fakeIpRanges: guardRanges,
      trustedPrivateCidrs: env.trustedPrivateCidrs,
      allowPrivateLiteral: env.localResolvers.length > 0
    });
    notes(r.findings, 'user:proxy-server-nameserver');
    nodeResolvers.push(...r.servers);
  }

  if (env.localResolvers.length > 0) {
    for (const ip of env.localResolvers) {
      if (!nodeResolvers.includes(ip) && matchCidr(ip, env.trustedPrivateCidrs) !== -1) {
        nodeResolvers.push(ip);
      }
    }
  }

  if (nodeResolvers.length === 0) {
    // 节点解析走「境内直连 + 境外直连」双路，保证境外机场域名不被 DNS 污染
    const domestic = buildFromPool('domestic', family, 2, env.dnsEgressAllowed ? 'doh' : 'udp');
    const global = buildFromPool('global', family, 2, env.dnsEgressAllowed ? 'doh' : 'udp');
    nodeResolvers.push(...domestic, ...global);
  }

  const proxyServerNameserver = [...new Set(nodeResolvers)].slice(0, 4);
  if (proxyServerNameserver.length === 0 || proxyServerNameserver[0] === 'system') {
    warnings.push('proxy-server-nameserver 为空或不安全，节点域名解析可能依赖系统 DNS 或产生自环；已强制注入公共纯 IP 解析器。');
  }
  const finalProxyServerNs = proxyServerNameserver.filter(s => s !== 'system');
  if (finalProxyServerNs.length === 0) {
    finalProxyServerNs.push(...buildFromPool('domestic', family, 2, 'udp'), ...buildFromPool('global', family, 2, 'udp'));
  }

  // ── 3.3 直连解析层 ───────────────────────────────────────────────────────
  const directCandidates = [];
  if (env.localResolvers.length > 0) directCandidates.push(...env.localResolvers);
  directCandidates.push(...buildFromPool('domestic', family, 2, env.dnsEgressAllowed ? 'doh' : 'udp'));
  const directNameserver = [...new Set(directCandidates)].slice(0, 3);

  // ── 3.4 主解析层：境内走直连 DoH，境外走代理侧 DoH ─────────────────────────
  const mainCandidates = buildFromPool('global', family, 2, env.dnsEgressAllowed ? 'doh' : 'udp');
  const nameserver = [...new Set(mainCandidates)].slice(0, 2);

  // ── 3.5 fallback + fallback-filter（污染交叉验证） ────────────────────────
  const fallback = [...new Set(buildFromPool('global', family, 2, 'dot'))]
    .filter(s => !nameserver.includes(s))
    .slice(0, 2);

  const fallbackFilter = {
    geoip: true,
    'geoip-code': 'CN',
    ipcidr: [
      '240.0.0.0/4',
      '0.0.0.0/8',
      '127.0.0.0/8',
      '100.64.0.0/10',
      '169.254.0.0/16',
      '192.0.0.0/24',
      '198.18.0.0/15',
      fakeIpRange
    ],
    domain: [],
    'fallback-lazy-query': true
  };

  // ── 3.6 策略层 ──────────────────────────────────────────────────────────
  const policy = {
    'rule-set:cn-domain': directNameserver,
    'rule-set:non-cn': nameserver
  };

  // 内网私有域后缀：必须由内网解析器解析，且**不得**进入 fallback 污染判定
  for (const zone of env.privateZones) {
    const target = env.localResolvers.length ? env.localResolvers : directNameserver;
    policy[`+${zone.startsWith('.') ? zone : `.${zone}`}`] = target;
  }
  // 节点私有域统一走内网解析器
  if (env.privateZones.length && env.localResolvers.length) {
    for (const zone of env.privateZones) {
      policy[`+.${zone.replace(/^\./, '')}`] = env.localResolvers;
    }
  }

  // master 订阅策略：仅在受信且非保留键时合并
  if (masterDns && masterDns['nameserver-policy']) {
    const { policy: mp, findings: f3 } = sanitizeNameserverPolicy(masterDns['nameserver-policy'], {
      isMaster: true,
      fakeIpRanges: guardRanges,
      trustedPrivateCidrs: env.trustedPrivateCidrs,
      allowPrivateLiteral: env.localResolvers.length > 0
    });
    notes(f3, 'master:nameserver-policy');
    for (const [k, v] of Object.entries(mp)) {
      if (!policy[k]) policy[k] = v;
    }
  }

  // ── 3.7 hosts 消毒 ───────────────────────────────────────────────────────
  const hostsResult = sanitizeHosts(userDns.hosts || (masterDns && masterDns.hosts) || {}, {
    allowInternal: !!opts.allowInternalHosts
  });
  notes(hostsResult.findings, 'hosts');

  // ── 3.8 组装 ────────────────────────────────────────────────────────────
  const listenHost = opts.listenHost && /^(127\.0\.0\.1|\[?::1\]?)$/.test(opts.listenHost)
    ? opts.listenHost
    : '127.0.0.1';
  if (opts.listenHost && listenHost !== opts.listenHost) {
    findings.push({ id: 'DNS-OPEN-RESOLVER', severity: 'critical', note: `拒绝非回环 dns.listen (${opts.listenHost})，已回退 127.0.0.1` });
  }

  const dns = {
    enable: true,
    listen: `${listenHost}:${opts.listenPort || 1053}`,
    ipv6: env.ipv6,
    'prefer-h3': false,
    'cache-algorithm': 'arc',
    'enhanced-mode': 'fake-ip',
    'fake-ip-range': fakeIpRange,
    ...(env.ipv6 ? { 'fake-ip-range6': fakeIpRange6 } : {}),
    'fake-ip-filter-mode': 'blacklist',
    'fake-ip-filter': [],
    'use-hosts': true,
    'use-system-hosts': false,
    'respect-rules': true,
    'default-nameserver': defaultNameserver,
    'proxy-server-nameserver': finalProxyServerNs,
    'direct-nameserver': directNameserver,
    'direct-nameserver-follow-policy': true,
    nameserver,
    fallback,
    'fallback-filter': fallbackFilter,
    'nameserver-policy': policy
  };

  if (opts.fakeIpFilterExtras) {
    dns['fake-ip-filter'] = [...new Set(opts.fakeIpFilterExtras)];
  }

  // ── 3.9 不变式自检 ──────────────────────────────────────────────────────
  const violations = checkInvariants(dns);

  const capabilities = {
    family,
    bootstrapProtocol: env.dnsEgressAllowed ? 'encrypted-capable' : 'plain-only',
    nodeResolution: finalProxyServerNs.some(s => /^https?:|^tls:/.test(s)) ? 'encrypted' : 'plain',
    splitHorizon: env.privateZones.length > 0,
    degraded: warnings.length > 0
  };

  return { dns, findings, warnings, violations, capabilities, hosts: hostsResult.hosts };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 不变式校验器（可独立用于回归测试）
// ─────────────────────────────────────────────────────────────────────────────

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function checkInvariants(dns = {}) {
  const v = [];
  const fakeRanges = [dns['fake-ip-range'] || '198.18.0.1/16'];

  // INV-1 引导层纯 IP
  for (const s of asArray(dns['default-nameserver'])) {
    const p = parseDnsServer(s);
    if (p.kind === 'url' && !p.isIpLiteral) {
      v.push({ id: 'INV-1', detail: `default-nameserver 含域名形式: ${s}` });
    }
  }

  // INV-2 / INV-3 节点解析层
  for (const s of asArray(dns['proxy-server-nameserver'])) {
    const p = parseDnsServer(s);
    if (p.isIpLiteral && p.host.includes('.')) {
      if (ipv4InCidrs(p.host, fakeRanges) || ipv4InCidrs(p.host, ['198.18.0.0/15'])) {
        v.push({ id: 'INV-2', detail: `proxy-server-nameserver 落在 fake-ip 网段: ${s}` });
      }
    }
    if (p.kind === 'url' && !p.isIpLiteral) {
      v.push({ id: 'INV-3', detail: `proxy-server-nameserver 含域名形式: ${s}` });
    }
  }

  // INV-4 respect-rules 依赖
  if (dns['respect-rules'] === true && asArray(dns['proxy-server-nameserver']).length === 0) {
    v.push({ id: 'INV-4', detail: 'respect-rules=true 但 proxy-server-nameserver 为空' });
  }

  // INV-5 fallback 必须显式声明 filter
  if (asArray(dns.fallback).length > 0 && !dns['fallback-filter']) {
    v.push({ id: 'INV-5', detail: '声明了 fallback 但缺少 fallback-filter，将使用内核默认 geoip-code=CN' });
  }

  // INV-6 direct-nameserver-follow-policy 依赖
  if (dns['direct-nameserver-follow-policy'] === true && asArray(dns['direct-nameserver']).length === 0) {
    v.push({ id: 'INV-6', detail: 'direct-nameserver-follow-policy=true 但 direct-nameserver 为空' });
  }

  // INV-8 监听面
  const listen = String(dns.listen || '');
  if (listen && !/^(127\.0\.0\.1|\[::1\]|localhost):/.test(listen)) {
    v.push({ id: 'INV-8', detail: `dns.listen 未绑定回环，可能成为开放解析器: ${listen}` });
  }

  // INV-9 prefer-h3 与 respect-rules 冲突
  if (dns['prefer-h3'] === true && dns['respect-rules'] === true) {
    v.push({ id: 'INV-9', detail: 'prefer-h3 与 respect-rules 同时为 true（官方明确不建议）' });
  }

  return v;
}

/**
 * 从节点列表推导必须进入 fake-ip-filter 的域名（INV-7）。
 * 节点域名若被分配 fake-ip，内核在建立出站连接时会拿到虚拟地址，形成环路。
 */
function deriveFakeIpFilterAdditions(proxies = []) {
  const out = new Set();
  for (const p of proxies) {
    if (!p || typeof p !== 'object') continue;
    const server = p.server;
    if (typeof server !== 'string' || !server) continue;
    const bare = server.replace(/^\[|\]$/g, '');
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(bare) || bare.includes(':');
    if (!isIp && bare.includes('.')) out.add(bare);
    for (const key of ['sni', 'servername']) {
      if (typeof p[key] === 'string' && p[key] && !/^\d/.test(p[key]) && p[key].includes('.')) out.add(p[key]);
    }
  }
  return [...out];
}

module.exports = {
  PUBLIC_RESOLVER_POOL,
  normalizeEnvProfile,
  matchCidr,
  planResolverChain,
  checkInvariants,
  deriveFakeIpFilterAdditions
};
