/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: DNS 策略与防泄漏配置生成器 (DNS Strategy Overlay)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 生成高可用 Fake-IP DNS 拓扑，抵御 DNS 泄漏与投毒
 * 2. 破除「鸡生蛋」Bootstrap 死锁：强制 default-nameserver 与 proxy-server-nameserver 纯 IP 化
 * 3. 动态将节点资产域名注入 fake-ip-filter，杜绝 Fake-IP 自环
 * 4. 自动挂载节点专属 Hosts（CDN 优选）与 Nameserver-Policy（专属解析器）
 * 5. 落地核心内核不变式（与 core/security/resolver-plan.js 的 INV 定义保持一致）：
 *      INV-1/INV-3  引导层与节点解析层必须为纯 IP 字面量（防解析死锁）
 *      INV-2        解析器地址不得落在 fake-ip 网段（防虚拟自环）
 *      INV-4        respect-rules=true 时 proxy-server-nameserver 不得为空（v1.19.13 起硬校验；本项目要求 ≥ v1.19.21）
 *      INV-8        dns.listen 必须绑定回环，否则将对外提供开放 DNS 解析
 *      另：直连/主解析链与 nameserver-policy 同样过净化沙箱，剥离 #skip-cert-verify 等危险修饰符
 *
 * 6. 订阅专属加密解析器采用内核原生 dns.proxy-server-nameserver-policy（v1.19.21 起）：
 *    节点域名专属解析器写入该字段，通用 proxy-server-nameserver 保持纯 IP 出厂默认，
 *    既满足 respect-rules 的非空校验，也避免跨订阅解析器互相解析对方节点域名。
 *    节点域名解析由内核直连完成，不依赖代理规则，无需任何出口标记兼容层。
 *
 * 说明：本函数是生产路径的 DNS 装配实现，复用 dns-sanitizer 的纯函数沙箱。
 */

'use strict';

const {
  ROLES,
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

/**
 * fake-ip-filter 保底名单（只读基线，见 `src/data/security-baselines.js`）。
 * 用户追加走 `fakeIpFilter` 配置项，基线本身不可被配置删除。
 */
const DEFAULT_SCRIPT_FILTERS = [...FAKEIP_FILTER_BASELINE];

/**
 * 收集订阅服务域名的 fake-ip-filter 条目（纯函数，仅域名/通配，不含 IP 字面量）
 *
 * 与路由直连规则共用同一份 Host 来源：构建期静态 subDomain 与交付期请求 Host 叠加。
 *
 * @param {string|string[]} subDomains
 * @returns {string[]}
 */
function buildSubDomainFakeIpFilters(subDomains) {
  return normalizeSubDomains(subDomains).filter(d => !isIPv4(d) && !isIPv6(d));
}

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
  const subDomainFilters = buildSubDomainFakeIpFilters(userConfig.subDomain);
  const finalList = dedupe([...DEFAULT_SCRIPT_FILTERS, ...nodeFilters, ...assetFilters, ...userFilters, ...subDomainFilters]);

  // 3. 破除死锁：引导 DNS 与节点解析器严格纯 IP 化 (INV-1 / INV-2 / INV-3)
  const safeDefaultNs = sanitizeDnsServerList(
    userConfig.dnsDefault || ['223.5.5.5', '1.1.1.1'],
    { role: ROLES.DEFAULT }
  ).servers;

  // 节点解析器优先级：用户显式覆盖 > 订阅专属「域名 → 加密解析器」映射 > 出厂默认。
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
    // 节点域名专属映射改走内核原生 proxy-server-nameserver-policy；
    // 通用 proxy-server-nameserver 保留出厂纯 IP 默认值（INV-4 要求其非空），
    // 从而不同订阅的解析器互不共享，不会互相解析对方的节点域名。
    proxyNsSource = 'asset-policy';
    proxyNsInput = DEFAULT_PROXY_SERVER_DNS;
  } else if (hasResolverCandidates) {
    // 存在订阅解析器候选但全部因域名冲突被排除：绝不回退到跨订阅 union 列表，
    // 统一回退出厂默认纯 IP 节点解析器。
    proxyNsSource = 'default';
    proxyNsInput = DEFAULT_PROXY_SERVER_DNS;
  } else if (assetProxyResolvers.length > 0) {
    proxyNsSource = 'asset';
    proxyNsInput = assetProxyResolvers;
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

  // 3.2 用户 Policy 与订阅 Policy 先过沙箱：保留键 (rule-set:cn-domain / rule-set:non-cn)
  //     不可被覆盖，危险修饰符被剥离，私网解析器默认拒绝。
  const { policy: safeUserPolicy, findings: userPolicyFindings } = sanitizeNameserverPolicy(
    userConfig.nameserverPolicy || {},
    { trustedSource: true, ...privateOpts }
  );
  if (userPolicyFindings.length > 0) findings.push(...userPolicyFindings);
  const assetPolicy = options.dnsAssets?.policies || {};

  // 3.3 订阅专属解析器映射走内核原生 proxy-server-nameserver-policy（v1.19.21 起）：
  //     respect-rules 保持开启，节点域名由内核直连解析，无需在 nameserver 链上追加出口标记。
  const resolverPolicy = (proxyNsSource === 'asset-policy') ? assetResolverPolicies : {};

  const safeProxyServerNs = sanitizeDnsServerList(
    proxyNsInput,
    { role: ROLES.PROXY_SERVER, allowDomainProxyServer: true }
  ).servers;

  if (proxyNsSource === 'asset-policy' && logger && typeof logger.info === 'function') {
    // 折叠后键可能是 `.suffix` 通配键：按映射条数（精确/通配）表述，避免把键数说成域名数；
    // 用「注入」点明这是继承项汇总后真正写入 dns 段的结果，与 [IO] 段的继承计数属于不同阶段。
    const policyKeys = Object.keys(assetResolverPolicies);
    const wildcard = policyKeys.filter(k => k.startsWith('.')).length;
    const shape = wildcard > 0
      ? `（精确 ${policyKeys.length - wildcard} · 通配 ${wildcard}）`
      : '';
    // 只输出映射条数与解析器数量，绝不展示含 token 的解析器 URL。
    // 解析器数量按映射实际引用去重统计：assetProxyResolvers 是「合并并集 + 上限 4」，直接取长度会低报。
    const referencedResolvers = new Set(
      [].concat(...Object.values(assetResolverPolicies)).map(String)
    ).size;
    logger.info(
      `🛡️ 资产闭包：注入节点 DNS 映射 ${policyKeys.length} 条${shape}，` +
      `指向 ${referencedResolvers} 项加密解析器（proxy-server-nameserver-policy）`
    );
  } else if (proxyNsSource === 'asset' && safeProxyServerNs.length > 0 && logger && typeof logger.info === 'function') {
    logger.info(`🛡️ 资产闭包：注入节点解析器 ${safeProxyServerNs.length} 项（仅用于节点域名解析）`);
  }

  // 4. 解析器拓扑装配
  //    proxy-server-nameserver 始终非空（INV-4）；节点域名专属映射写入独立字段（INV-3 校验其加密与引导）。
  const ns = {
    'default-nameserver': safeDefaultNs.length ? safeDefaultNs : ['223.5.5.5', '1.1.1.1'],
    'direct-nameserver': safeDirectNs,
    'direct-nameserver-follow-policy': false, // Mihomo 官方推荐 false，防止直连域名 DNS 被代理规则劫持
    'proxy-server-nameserver': safeProxyServerNs.length ? safeProxyServerNs : DEFAULT_PROXY_SERVER_DNS,
    ...(Object.keys(resolverPolicy).length > 0
      ? { 'proxy-server-nameserver-policy': resolverPolicy }
      : {}),
    'nameserver': safeMainNs
  };

  // 5. Policy 安全分流：基础规则 + 订阅普通 Policy + 用户自定义 Policy
  //    rule-set 策略键必须与实际产出的 rule-providers 对齐：无节点分流模式下
  //    规则被级联剪枝，此时仍注入悬空 rule-set 引用会让内核因「规则集不存在」拒绝整份配置。
  //    产物尚未声明 rule-providers 时视为沿用既有契约（独立调用 applyDnsOverlay 的场景）。
  const providers = config['rule-providers'];
  const providerExists = name =>
    !providers || typeof providers !== 'object' || Object.prototype.hasOwnProperty.call(providers, name);
  const scriptPolicy = {};
  if (providerExists('cn-domain')) scriptPolicy['rule-set:cn-domain'] = safeDirectNs;
  if (providerExists('non-cn')) scriptPolicy['rule-set:non-cn'] = safeMainNs;
  const mergedPolicy = { ...scriptPolicy, ...assetPolicy, ...safeUserPolicy };

  // 订阅既用 proxy-server-nameserver 生成映射、又在自身 nameserver-policy 里声明同一域名时，
  // 节点解析阶段会优先采用 proxy-server-nameserver-policy。两者同源、不构成越权，但属自相矛盾输入，
  // debug 级透明化被覆盖的键（只输出键名，绝不输出解析器地址或 token）。
  if (logger && typeof logger.debug === 'function') {
    const shadowed = Object.keys(resolverPolicy).filter(key => key in assetPolicy);
    if (shadowed.length > 0) {
      logger.debug(
        `🛡️ 资产闭包：订阅自身声明的 ${shadowed.length} 条策略被节点解析器映射覆盖（${shadowed.join(', ')}）`
      );
    }
  }

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
    'respect-rules': true,
    'use-hosts': true,
    'use-system-hosts': false,
    ...ns,
    ...(Object.keys(mergedPolicy).length > 0 ? { 'nameserver-policy': mergedPolicy } : {})
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
  isLoopbackListenHost,
  buildSubDomainFakeIpFilters
};
