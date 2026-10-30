/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: DNS 策略与防泄漏配置生成器 (DNS Strategy Overlay)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 生成高可用 Fake-IP DNS 拓扑，抵御 DNS 泄漏与投毒
 * 2. 破除「鸡生蛋」Bootstrap 死锁：强制 default-nameserver 与 proxy-server-nameserver 纯 IP 化
 * 3. 动态将节点资产域名注入 fake-ip-filter，杜绝 Fake-IP 自环
 * 4. 自动挂载节点专属 Hosts（CDN 优选）与 Nameserver-Policy（私有 DoH）
 * 5. 落地核心内核不变式（与 core/security/resolver-plan.js 的 INV 定义保持一致）：
 *      INV-1/INV-3  引导层与节点解析层必须为纯 IP 字面量（防解析死锁）
 *      INV-2        解析器地址不得落在 fake-ip 网段（防虚拟自环）
 *      INV-4        respect-rules=true 时 proxy-server-nameserver 不得为空（v1.19.13 硬校验）
 *      INV-8        dns.listen 必须绑定回环，否则将对外提供开放 DNS 解析
 *      另：直连/主解析链与 nameserver-policy 同样过净化沙箱，剥离 #skip-cert-verify 等危险修饰符
 *
 * 6. legacy 映射模式的 compatibility 层：订阅私有 DoH 映射要求留空 proxy-server-nameserver，
 *    而 v1.19.13 内核禁止该组合与 respect-rules=true 共存。因此映射模式关闭总开关，
 *    并对原本隐式继承 RULES 的条目显式补齐出口标记（详见 KERNEL_RULES_PROXY）。
 *    若出现无法安全标记的 system / dhcp:// 条目，则整体退出映射模式，回退非映射 DNS 配置。
 *
 * 说明：本函数是生产路径的 DNS 装配实现，复用 dns-sanitizer 的纯函数沙箱。
 */

'use strict';

const {
  ROLES,
  parseDnsServer,
  sanitizeDnsServerList,
  sanitizeNameserverPolicy,
  sanitizeHosts
} = require('../core/security/dns-sanitizer');
const { deriveFakeIpFilterAdditions } = require('../core/security/resolver-plan');
const { isIPv4, isIPv6, normalizeSubDomains } = require('../infra/ip');
const { FAKEIP_FILTER_BASELINE, effectiveProtectedDomains, DEFAULT_PROXY_SERVER_DNS } = require('../data');
const { createRepeatGate } = require('../core/logger');

// DNS 沙箱审计去重：按「覆盖输入来源 + findings 签名」隔离计数；拦截/修正行为本身不变。
const dnsAuditGate = createRepeatGate(100);
// 映射模式因特殊解析器条目整体回退的告警去重：首次 warn，重复降级 debug。
const dnsMappingFallbackGate = createRepeatGate(100);

function dedupe(arr) {
  return [...new Set(arr)];
}

function splitHostPort(s) {
  if (!s) return { host: null, port: null };
  const v6Match = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6Match) return { host: `[${v6Match[1]}]`, port: v6Match[2] || null };
  const idx = s.lastIndexOf(':');
  if (idx === -1) return { host: s, port: null };
  return { host: s.slice(0, idx), port: s.slice(idx + 1) };
}

/** INV-8：回环监听地址判定（仅回环地址可视为安全解析面） */
function isLoopbackListenHost(host) {
  if (!host || typeof host !== 'string') return false;
  const h = host.trim().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (/^localhost$/i.test(h)) return true;
  if (/^(::1|0:0:0:0:0:0:0:1)$/i.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  if (!m.slice(1).every(o => Number(o) <= 255)) return false;
  return Number(m[1]) === 127;
}

/** 规范化回环监听地址：IPv6 回环必须以方括号形式写入内核配置 */
function normalizeLoopbackHost(host) {
  const bare = String(host).trim().replace(/^\[|\]$/g, '');
  if (/^(::1|0:0:0:0:0:0:0:1)$/i.test(bare)) return '[::1]';
  if (/^localhost$/i.test(bare)) return 'localhost';
  return bare;
}

// ─────────────────────────────────────────────────────────────────────────────
// legacy 映射模式：RULES 出口标记兼容层
// ─────────────────────────────────────────────────────────────────────────────
// v1.19.13 的 `respect-rules: true` 是解析期开关：内核会给 nameserver 与
// nameserver-policy 的每个条目隐式注入 proxyName="RULES"（tunnel/dns_dialer.go 的
// `DnsRespectRules = "RULES"`）。而 legacy 映射模式必须留空 proxy-server-nameserver，
// 内核对该组合直接拒绝启动（config/config.go: "respect-rules" cannot be empty）。
// 因此映射模式关闭总开关，并对原本隐式继承 RULES 的条目显式补齐同一标记。
// ⚠️ "RULES" 是内核实现细节而非公开接口：升级内核必须重跑 test/kernel 契约测试。
const KERNEL_RULES_PROXY = 'RULES';

/**
 * 明确的出口标记白名单（大小写不敏感）。
 * 内核用 `&` 拆分片段后，任何无等号片段都会成为 proxyName；但只有这些写法的语义是「显式出口」，
 * 其余无等号片段（如误写 #h3、拼写错误的代理名）不能未经判断就当作出口声明。
 */
const EXPLICIT_EGRESS_MARKERS = new Set(['RULES', 'DIRECT', 'PROXY', 'INTERFACE']);

function hasExplicitEgress(modifiers = []) {
  return modifiers.some(m => EXPLICIT_EGRESS_MARKERS.has(String(m).trim().toUpperCase()));
}

/**
 * 为单个 DNS 条目追加内核 RULES 出口标记。
 * - 纯 IP / 裸域名统一改写为显式协议形式（udp://...），保证最终产物可被沙箱再次解析；
 * - 仅白名单内的显式出口标记（#RULES / #DIRECT / #proxy / #interface）保持原样；
 *   其余无等号片段不会被当作出口声明，仍追加 RULES；
 * - system / dhcp:// 无法安全追加，返回 ok:false，由调用方整体回退映射模式。
 * @returns {{ ok: boolean, value: string, reason?: string }}
 */
function withRespectRules(entry) {
  const raw = String(entry).trim();
  if (!raw) return { ok: false, value: raw, reason: 'empty' };
  const parsed = parseDnsServer(raw);
  if (parsed.kind === 'special') return { ok: false, value: raw, reason: 'special' };
  if (parsed.kind === 'invalid') return { ok: false, value: raw, reason: 'invalid' };

  if (parsed.kind === 'ip' || !parsed.scheme || parsed.scheme === 'plain') {
    // 纯 IP（含 IP:port / IPv6）与裸域名在内核里等价于 udp://，显式写协议才能携带片段。
    const host = parsed.isIpv6 ? `[${parsed.host}]` : parsed.host;
    const port = parsed.port ? `:${parsed.port}` : '';
    return { ok: true, value: `udp://${host}${port}#${KERNEL_RULES_PROXY}` };
  }

  const normalized = raw.replace(/#+$/, '');
  const hashIdx = normalized.indexOf('#');
  if (hashIdx === -1) return { ok: true, value: `${normalized}#${KERNEL_RULES_PROXY}` };
  const modifiers = normalized.slice(hashIdx + 1).split('&').filter(Boolean);
  if (hasExplicitEgress(modifiers)) {
    // 仅认可明确的出口标记（#RULES / #DIRECT / #proxy / #interface）：保持原样，避免重复追加。
    return { ok: true, value: normalized };
  }
  // 其余无等号片段（例如误写成 #h3 而非 #h3=true）在内核里会被当作代理名，
  // 不能未经判断就视为已声明出口；统一追加 RULES，避免映射模式丢失规则出口语义。
  return { ok: true, value: `${normalized}&${KERNEL_RULES_PROXY}` };
}

/** 对一组已净化条目追加 RULES 标记，并用同一沙箱复核最终形态是否仍可解析。 */
function markRulesList(list, privateOpts) {
  const values = [];
  for (const entry of (Array.isArray(list) ? list : [])) {
    const r = withRespectRules(entry);
    if (!r.ok) return { ok: false, reason: r.reason, entry, values: [] };
    values.push(r.value);
  }
  const checked = sanitizeDnsServerList(values, { role: ROLES.NAMESERVER, ...privateOpts });
  if (checked.rejected.length > 0) return { ok: false, reason: 'post-mark-validation', values: [] };
  return { ok: true, values: checked.servers };
}

/** 对 nameserver-policy 的每个值追加 RULES 标记。 */
function markRulesPolicy(policy, privateOpts) {
  const out = {};
  for (const [key, value] of Object.entries(policy || {})) {
    const r = markRulesList(Array.isArray(value) ? value : [value], privateOpts);
    if (!r.ok) return { ok: false, reason: r.reason, entry: r.entry, policy: {} };
    if (r.values.length > 0) out[key] = r.values.length === 1 ? r.values[0] : r.values;
  }
  return { ok: true, policy: out };
}

/**
 * fake-ip-filter 保底名单（只读基线，见 `src/data/security-baselines.js`）。
 * 用户追加走 `fakeIpFilter` 配置项，基线本身不可被配置删除。
 */
const DEFAULT_SCRIPT_FILTERS = [...FAKEIP_FILTER_BASELINE];

/**
 * 注入或覆写 Mihomo DNS 配置
 * @param {object} config 待修改的 Mihomo 配置对象
 * @param {object} userConfig 用户配置参数
 * @param {object} [options={}] 运行期依赖注入
 * @param {object} [options.logger] 日志器（用于输出净化告警）
 * @param {object} [options.dnsAssets] 订阅携带的节点专属 DNS 资产闭包 { hosts, policies, fakeIpFilters, proxyResolvers }
 * @returns {{ findings: Array<object>, listen: string }} 安全审计发现与最终监听地址
 */
function applyDnsOverlay(config, userConfig = {}, options = {}) {
  const logger = options.logger;
  const findings = [];
  const isReturn = userConfig.trafficDirection === 'return';
  const directDNS = isReturn ? userConfig.dnsProxy : userConfig.dnsDirect;
  const proxyDNS  = isReturn ? userConfig.dnsDirect : userConfig.dnsProxy;
  const serverDNS = userConfig.dnsServer;

  const privateOpts = {
    allowPrivateLiteral: userConfig.allowPrivateDns === true,
    trustedPrivateCidrs: Array.isArray(userConfig.trustedPrivateCidrs) ? userConfig.trustedPrivateCidrs : [],
    // 用户本地显式声明属于可信来源：仅剥离致命修饰符（如 skip-cert-verify），
    // #proxy / #h3 / #interface 等出口与协议选择保留并审计上报。
    modifierSeverityFloor: 'critical'
  };

  // 1. 监听地址收敛 (INV-8)：默认强制回环，避免成为局域网/公网开放解析器。
  //    软路由等确需对外提供 DNS 的场景，需显式开启 dnsAllowNonLoopback。
  const userL = splitHostPort(userConfig.dnsListen);
  const requestedHost = (userL.host || '').trim();
  let finalHost = '127.0.0.1';
  if (!requestedHost) {
    finalHost = '127.0.0.1';
  } else if (isLoopbackListenHost(requestedHost)) {
    finalHost = normalizeLoopbackHost(requestedHost);
  } else if (userConfig.dnsAllowNonLoopback === true) {
    finalHost = requestedHost.replace(/\s+/g, '');
  } else {
    findings.push({
      id: 'DNS-OPEN-RESOLVER',
      severity: 'critical',
      note: `拒绝非回环 dns.listen (${userConfig.dnsListen})，已回退 127.0.0.1；如确需对外提供 DNS 服务请显式设置 dnsAllowNonLoopback: true`
    });
  }

  const requestedPort = String(userL.port || '').trim();
  const finalPort = (/^\d{1,5}$/.test(requestedPort) && Number(requestedPort) >= 1 && Number(requestedPort) <= 65535)
    ? requestedPort
    : '1053';
  const finalListen = `${finalHost}:${finalPort}`;

  // 2. 节点域名自动避环：动态推导节点资产域名注入 fake-ip-filter (支持 smart 聚合泛化 / exact 精确 / off 关闭)
  const fakeIpFilterMode = userConfig.fakeIpFilterNodes !== undefined ? userConfig.fakeIpFilterNodes : 'smart';
  const nodeFilters = deriveFakeIpFilterAdditions(config.proxies || [], { mode: fakeIpFilterMode });
  const assetFakeIpFilters = options.dnsAssets?.fakeIpFilters;
  const assetFilters = (fakeIpFilterMode !== 'off' && fakeIpFilterMode !== false && Array.isArray(assetFakeIpFilters))
    ? assetFakeIpFilters
    : [];
  const userFilters = Array.isArray(userConfig.fakeIpFilter) ? userConfig.fakeIpFilter : [];
  const subDomainFilters = normalizeSubDomains(userConfig.subDomain).filter(d => !isIPv4(d) && !isIPv6(d));
  const finalList = dedupe([...DEFAULT_SCRIPT_FILTERS, ...nodeFilters, ...assetFilters, ...userFilters, ...subDomainFilters]);

  // 3. 破除死锁：引导 DNS 与节点解析器严格纯 IP 化 (INV-1 / INV-2 / INV-3)
  const safeDefaultNs = sanitizeDnsServerList(
    userConfig.dnsDefault || ['223.5.5.5', '1.1.1.1'],
    { role: ROLES.DEFAULT }
  ).servers;

  // 节点解析器优先级：用户显式覆盖 > 订阅私有的「域名 → DoH」映射 > 出厂默认。
  // 订阅映射只在用户未改动默认 dnsServer 时生效，避免静默夺取用户的显式配置。
  const requestedProxyNs = serverDNS == null ? [] : (Array.isArray(serverDNS) ? serverDNS : [serverDNS]);
  const userConfiguredProxyNs = requestedProxyNs.length > 0 && (
    requestedProxyNs.length !== DEFAULT_PROXY_SERVER_DNS.length ||
    !requestedProxyNs.every((v, i) => String(v) === DEFAULT_PROXY_SERVER_DNS[i])
  );
  const assetResolverPolicies = (options.dnsAssets && typeof options.dnsAssets.resolverPolicies === 'object')
    ? options.dnsAssets.resolverPolicies
    : {};
  const hasResolverCandidates = options.dnsAssets?.hasResolverCandidates === true;
  const useAssetResolverPolicy = !userConfiguredProxyNs && Object.keys(assetResolverPolicies).length > 0;
  const assetProxyResolvers = Array.isArray(options.dnsAssets?.proxyResolvers)
    ? options.dnsAssets.proxyResolvers
    : [];
  let proxyNsSource = 'default';
  let proxyNsInput = DEFAULT_PROXY_SERVER_DNS;
  if (userConfiguredProxyNs) {
    proxyNsSource = 'user';
    proxyNsInput = requestedProxyNs;
  } else if (useAssetResolverPolicy) {
    // 留空 proxy-server-nameserver，让内核按 nameserver-policy 对节点域名应用订阅私有 DoH；
    // 这样不同订阅的解析器互不共享，不会互相解析对方的节点域名。
    proxyNsSource = 'asset-policy';
    proxyNsInput = [];
  } else if (hasResolverCandidates) {
    // 存在订阅解析器候选但全部因域名冲突被排除：绝不回退到跨订阅 union 列表，
    // 统一回退出厂默认纯 IP 节点解析器。
    proxyNsSource = 'default';
    proxyNsInput = DEFAULT_PROXY_SERVER_DNS;
  } else if (assetProxyResolvers.length > 0) {
    proxyNsSource = 'asset';
    proxyNsInput = assetProxyResolvers;
  } else if (requestedProxyNs.length > 0) {
    proxyNsInput = requestedProxyNs;
  }

  // 3.1 直连链与主解析链同样过净化沙箱：
  //     剥离 #skip-cert-verify / #proxy 等危险修饰符，拦截私网与 fake-ip 自环地址
  const sanitizeResolverList = (list, fallback) => {
    const r = sanitizeDnsServerList(list, { role: ROLES.NAMESERVER, ...privateOpts });
    if (r.findings && r.findings.length > 0) findings.push(...r.findings);
    return r.servers.length > 0 ? r.servers : fallback;
  };
  const safeDirectNs = sanitizeResolverList(directDNS, ['https://223.5.5.5/dns-query', '223.5.5.5']);
  const safeMainNs = sanitizeResolverList(proxyDNS, ['https://8.8.8.8/dns-query', 'https://1.1.1.1/dns-query']);

  // 3.2 用户 Policy 与订阅 Policy 先过沙箱：映射模式需要确认其值能否安全注入 #RULES。
  //     保留键 (rule-set:cn-domain / rule-set:non-cn) 不可被覆盖，危险修饰符被剥离，私网解析器默认拒绝。
  const { policy: safeUserPolicy, findings: userPolicyFindings } = sanitizeNameserverPolicy(
    userConfig.nameserverPolicy || {},
    { trustedSource: true, ...privateOpts }
  );
  if (userPolicyFindings.length > 0) findings.push(...userPolicyFindings);
  const assetPolicy = options.dnsAssets?.policies || {};

  // 3.3 legacy 映射模式的 respect-rules 兼容决议：
  //     v1.19.13 禁止「respect-rules=true + proxy-server-nameserver 为空」，而映射模式必须留空，
  //     因此关闭总开关，并把原本隐式继承 RULES 的条目显式标记。任一需要标记的条目为
  //     system / dhcp:// 等无法安全追加的形式时，整体退出映射模式。
  let respectRules = true;
  let mappingFallbackReason = null;
  let finalMainNs = safeMainNs;
  let finalDirectPolicyNs = safeDirectNs;
  let finalAssetPolicy = assetPolicy;
  let finalUserPolicy = safeUserPolicy;
  let resolverPolicy = {};
  if (proxyNsSource === 'asset-policy') {
    const markedMain = markRulesList(safeMainNs, privateOpts);
    const markedDirect = markRulesList(safeDirectNs, privateOpts);
    const markedAsset = markRulesPolicy(assetPolicy, privateOpts);
    const markedUser = markRulesPolicy(safeUserPolicy, privateOpts);
    if (markedMain.ok && markedDirect.ok && markedAsset.ok && markedUser.ok) {
      respectRules = false;
      finalMainNs = markedMain.values;
      finalDirectPolicyNs = markedDirect.values;
      finalAssetPolicy = markedAsset.policy;
      finalUserPolicy = markedUser.policy;
      resolverPolicy = assetResolverPolicies;
    } else {
      // 整体退出映射模式：恢复非空节点解析器与 respect-rules=true，且不写入任何订阅域名专属映射。
      const failed = [markedMain, markedDirect, markedAsset, markedUser].find(m => !m.ok);
      const failedEntry = String(failed?.entry || '');
      // 仅用于日志去重分类，不含任何地址或凭据
      const specialKind = /^dhcp:\/\//i.test(failedEntry) ? 'dhcp' : (/^system$/i.test(failedEntry) ? 'system' : 'other');
      mappingFallbackReason = `${failed?.reason || 'special'}|${specialKind}`;
      proxyNsSource = assetProxyResolvers.length > 0 ? 'asset' : 'default';
      proxyNsInput = assetProxyResolvers.length > 0 ? assetProxyResolvers : DEFAULT_PROXY_SERVER_DNS;
    }
  }

  const safeProxyServerNs = sanitizeDnsServerList(
    proxyNsInput,
    { role: ROLES.PROXY_SERVER, allowDomainProxyServer: true }
  ).servers;

  if (proxyNsSource === 'asset-policy' && logger && typeof logger.info === 'function') {
    // 只输出域名数量与解析器数量，绝不展示含 token 的解析器 URL
    logger.info(
      `🛡️ 节点解析器：继承订阅私有 DNS（${Object.keys(assetResolverPolicies).length} 个节点域名 → ` +
      `${assetProxyResolvers.length} 项 DoH，仅用于对应订阅的节点解析；` +
      '兼容 v1.19.13：respect-rules 关闭并显式标记 #RULES）'
    );
  } else if (proxyNsSource === 'asset' && safeProxyServerNs.length > 0 && logger && typeof logger.info === 'function') {
    logger.info(`🛡️ 节点解析器：继承订阅私有 DNS ${safeProxyServerNs.length} 项（仅用于节点域名解析）`);
  }
  if (mappingFallbackReason && logger && typeof logger.warn === 'function') {
    // 脱敏告警：只说明类别与回退结果，不展示订阅 URL、DoH 地址或 token。
    const base = '🛡️ 节点解析器：映射模式已禁用（检测到 system / dhcp:// 等无法安全注入 #RULES 的特殊 DNS 条目），' +
      '本次回退非映射配置：respect-rules 保持开启、使用非空节点解析器，且不写入订阅域名专属映射';
    const seenTimes = dnsMappingFallbackGate(`dns-mapping-fallback|${mappingFallbackReason}`);
    if (seenTimes > 1) {
      logger.debug(`${base}（第 ${seenTimes} 次 · 本次仍未写入映射）`);
    } else {
      logger.warn(base);
    }
  }

  // 4. 解析器拓扑装配
  //    订阅按域名映射时故意留空 proxy-server-nameserver：内核在留空时才会对节点域名应用
  //    nameserver-policy，从而实现「订阅 A 的 DoH 只解析 A 的节点域名」。
  const ns = {
    'default-nameserver': safeDefaultNs.length ? safeDefaultNs : ['223.5.5.5', '1.1.1.1'],
    'direct-nameserver': safeDirectNs,
    'direct-nameserver-follow-policy': false, // Mihomo 官方推荐 false，防止直连域名 DNS 被代理规则劫持
    ...(proxyNsSource === 'asset-policy'
      ? {}
      : { 'proxy-server-nameserver': safeProxyServerNs.length ? safeProxyServerNs : ['223.5.5.5', '119.29.29.29'] }),
    'nameserver': finalMainNs
  };

  // 5. Policy 安全分流：基础规则 + 节点专属私有 DoH 依赖 + 用户自定义 Policy
  const scriptPolicy = { 'rule-set:cn-domain': finalDirectPolicyNs, 'rule-set:non-cn': finalMainNs };
  const mergedPolicy = { ...scriptPolicy, ...finalAssetPolicy, ...resolverPolicy, ...finalUserPolicy };

  // 6. Hosts 安全挂载：节点专属优选 IP + 用户自定义 Hosts
  //    用户 Hosts 同样过消毒沙箱：受保护域名（github/paypal/银行等）与内网重定向默认拒绝，
  //    确需豁免可用 trustedHostDomains 显式声明（治「远程配置写 hosts 劫持任意域名」）。
  const assetHosts = options.dnsAssets?.hosts || {};
  const userHosts = userConfig.hosts || {};
  const { hosts: safeUserHosts, findings: userHostFindings } = sanitizeHosts(userHosts, {
    allowInternal: userConfig.allowInternalHosts === true,
    // 受保护域名 = 只读安全基线 ∪ 用户通过 protectedDomains 追加的条目。
    // 在判定点再次合并是刻意的：即便调用方漏做配置合并，也绝不会退化成「无受保护域名」。
    protectedDomains: effectiveProtectedDomains(userConfig.protectedDomains),
    userTrustedDomains: Array.isArray(userConfig.trustedHostDomains) ? userConfig.trustedHostDomains : []
  });
  if (userHostFindings.length > 0) findings.push(...userHostFindings);
  const finalHosts = { ...assetHosts, ...safeUserHosts };
  if (Object.keys(finalHosts).length > 0) {
    config.hosts = finalHosts;
  }

  // 7. 生成最终标准 DNS 配置
  config.dns = {
    enable: true,
    listen: finalListen,
    ipv6: !!userConfig.enableIPv6,
    'enhanced-mode': 'fake-ip',
    'fake-ip-range': '198.18.0.1/16',
    'fake-ip-filter-mode': 'blacklist',
    'fake-ip-filter': finalList,
    'respect-rules': respectRules,
    'use-hosts': true,
    'use-system-hosts': false,
    ...ns,
    'nameserver-policy': mergedPolicy
  };

  // 8. 安全审计输出
  //    同一份 DNS 覆盖输入在缓存复用场景会被重复审计：首次 warn，之后降为 debug 并记录重复次数。
  //    findings 签名包含具体条目（id + note），因此不同来源/不同审计结果不会共享同一条目。
  if (findings.length > 0 && logger && typeof logger.warn === 'function') {
    const signature = findings.map(f => `${f.id}:${f.note || f.reason || ''}`).join('|');
    const seenTimes = dnsAuditGate(`dns-overlay|${signature}`);
    if (seenTimes > 1) {
      logger.debug(`🛡️ DNS 净化沙箱：重复检测（第 ${seenTimes} 次 · 相同 ${findings.length} 项，本次仍已拦截或修正）`);
    } else {
      const lines = [`🛡️ DNS 净化沙箱：首次发现并已拦截或修正 ${findings.length} 项不安全解析配置：`];
      findings.forEach((f, idx) => {
        const isLast = idx === findings.length - 1;
        lines.push(`${isLast ? '└──' : '├──'} [${f.id}] ${f.note || f.reason || ''}`);
      });
      logger.warn(lines.join('\n'));
    }
  }

  return { findings, listen: finalListen };
}

module.exports = {
  applyDnsOverlay,
  isLoopbackListenHost
};
