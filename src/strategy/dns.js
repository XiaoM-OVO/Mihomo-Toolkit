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
 *      INV-8        dns.listen 必须绑定回环，否则将对外提供开放 DNS 解析
 *      另：直连/主解析链与 nameserver-policy 同样过净化沙箱，剥离 #skip-cert-verify 等危险修饰符
 *
 * 说明：本函数是生产路径的 DNS 装配实现；resolver-plan.js 的 planResolverChain 为
 * 具备环境画像能力的备用规划器（当前主流程未调用），两者共用 dns-sanitizer 的纯函数沙箱。
 */

'use strict';

const {
  ROLES,
  sanitizeDnsServerList,
  sanitizeNameserverPolicy,
  sanitizeHosts
} = require('../core/security/dns-sanitizer');
const { deriveFakeIpFilterAdditions } = require('../core/security/resolver-plan');

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

const DEFAULT_SCRIPT_FILTERS = [
  '*.lan', '*.local', '*.arpa', 'time.*.com', 'ntp.*.com',
  'localhost.ptlogin2.qq.com', '*.msftncsi.com', '*.msftconnecttest.com', 'www.msftconnecttest.com',
  'ipv6.msftncsi.com', 'ipv6.msftconnecttest.com', '*.ipv6-literal.net', 'google.cn',
  '*.music.163.com', '*.music.126.net', '+.stun.*.*',
  '+.nintendo.net', '+.playstation.net', '+.xboxlive.com'
];

/**
 * 注入或覆写 Mihomo DNS 配置
 * @param {object} config 待修改的 Mihomo 配置对象
 * @param {object} userConfig 用户配置参数
 * @param {object} [options={}] 运行期依赖注入
 * @param {object} [options.logger] 日志器（用于输出净化告警）
 * @returns {{ findings: Array<object>, listen: string }} 安全审计发现与最终监听地址
 */
function applyDnsOverlay(config, userConfig = {}, options = {}) {
  const logger = options.logger;
  const findings = [];
  const isReturn = userConfig.enableDomesticGroup && !userConfig.proxyFirst;
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
  const assetFilters = (fakeIpFilterMode !== 'off' && fakeIpFilterMode !== false && Array.isArray(config._assetFakeIpFilters))
    ? config._assetFakeIpFilters
    : [];
  const userFilters = Array.isArray(userConfig.fakeIpFilter) ? userConfig.fakeIpFilter : [];
  const finalList = dedupe([...DEFAULT_SCRIPT_FILTERS, ...nodeFilters, ...assetFilters, ...userFilters]);

  // 3. 破除死锁：引导 DNS 与节点解析器严格纯 IP 化 (INV-1 / INV-2 / INV-3)
  const safeDefaultNs = sanitizeDnsServerList(
    userConfig.dnsDefault || ['223.5.5.5', '1.1.1.1'],
    { role: ROLES.DEFAULT }
  ).servers;

  const safeProxyServerNs = sanitizeDnsServerList(
    serverDNS || ['223.5.5.5', '119.29.29.29'],
    { role: ROLES.PROXY_SERVER }
  ).servers;

  // 3.1 直连链与主解析链同样过净化沙箱：
  //     剥离 #skip-cert-verify / #proxy 等危险修饰符，拦截私网与 fake-ip 自环地址
  const sanitizeResolverList = (list, fallback) => {
    const r = sanitizeDnsServerList(list, { role: ROLES.NAMESERVER, ...privateOpts });
    if (r.findings && r.findings.length > 0) findings.push(...r.findings);
    return r.servers.length > 0 ? r.servers : fallback;
  };
  const safeDirectNs = sanitizeResolverList(directDNS, ['https://223.5.5.5/dns-query', '223.5.5.5']);
  const safeMainNs = sanitizeResolverList(proxyDNS, ['https://8.8.8.8/dns-query', 'https://1.1.1.1/dns-query']);

  // 4. 解析器拓扑装配
  const ns = {
    'default-nameserver': safeDefaultNs.length ? safeDefaultNs : ['223.5.5.5', '1.1.1.1'],
    'direct-nameserver': safeDirectNs,
    'direct-nameserver-follow-policy': false, // Mihomo 官方推荐 false，防止直连域名 DNS 被代理规则劫持
    'proxy-server-nameserver': safeProxyServerNs.length ? safeProxyServerNs : ['223.5.5.5', '119.29.29.29'],
    'nameserver': safeMainNs
  };

  // 5. Policy 安全分流：基础规则 + 节点专属私有 DoH 依赖 + 用户自定义 Policy
  //    用户 Policy 同样过净化沙箱：保留键 (rule-set:cn-domain / rule-set:non-cn) 不可被覆盖，
  //    危险修饰符被剥离，私网解析器默认拒绝。
  const scriptPolicy = { 'rule-set:cn-domain': safeDirectNs, 'rule-set:non-cn': safeMainNs };
  const assetPolicy = config._assetPolicies || {};
  const { policy: safeUserPolicy, findings: userPolicyFindings } = sanitizeNameserverPolicy(
    userConfig.nameserverPolicy || {},
    { isMaster: true, ...privateOpts }
  );
  if (userPolicyFindings.length > 0) findings.push(...userPolicyFindings);
  const mergedPolicy = { ...scriptPolicy, ...assetPolicy, ...safeUserPolicy };

  // 6. Hosts 安全挂载：节点专属优选 IP + 用户自定义 Hosts
  //    用户 Hosts 同样过消毒沙箱：受保护域名（github/paypal/银行等）与内网重定向默认拒绝，
  //    确需豁免可用 trustedHostDomains 显式声明（治「远程配置写 hosts 劫持任意域名」）。
  const assetHosts = config._assetHosts || {};
  const userHosts = userConfig.hosts || {};
  const { hosts: safeUserHosts, findings: userHostFindings } = sanitizeHosts(userHosts, {
    allowInternal: userConfig.allowInternalHosts === true,
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
    'nameserver-policy': mergedPolicy
  };

  // 8. 擦除中间层私有属性
  delete config._assetHosts;
  delete config._assetPolicies;
  delete config._assetFakeIpFilters;

  // 9. 安全审计输出
  if (findings.length > 0 && logger && typeof logger.warn === 'function') {
    const lines = ['🛡️ DNS 净化沙箱: 已拦截或修正以下不安全解析配置:'];
    findings.forEach((f, idx) => {
      const isLast = idx === findings.length - 1;
      lines.push(`${isLast ? '└──' : '├──'} [${f.id}] ${f.note || f.reason || ''}`);
    });
    logger.warn(lines.join('\n'));
  }

  return { findings, listen: finalListen };
}

module.exports = {
  applyDnsOverlay,
  isLoopbackListenHost,
  normalizeLoopbackHost
};
