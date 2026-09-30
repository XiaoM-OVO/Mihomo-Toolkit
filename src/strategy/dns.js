/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: DNS 策略与防泄漏配置生成器 (DNS Strategy Overlay)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 生成高可用 Fake-IP DNS 拓扑，抵御 DNS 泄漏与投毒
 * 2. 破除「鸡生蛋」Bootstrap 死锁：强制 default-nameserver 与 proxy-server-nameserver 纯 IP 化
 * 3. 动态将节点资产域名注入 fake-ip-filter，杜绝 Fake-IP 自环
 * 4. 自动挂载节点专属 Hosts（CDN 优选）与 Nameserver-Policy（私有 DoH）
 */

'use strict';

const { ROLES, sanitizeDnsServerList } = require('../core/security/dns-sanitizer');
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
 */
function applyDnsOverlay(config, userConfig = {}) {
  const isReturn = userConfig.enableDomesticGroup && !userConfig.proxyFirst;
  const directDNS = isReturn ? userConfig.dnsProxy : userConfig.dnsDirect;
  const proxyDNS  = isReturn ? userConfig.dnsDirect : userConfig.dnsProxy;
  const serverDNS = userConfig.dnsServer;

  // 1. 监听地址收敛：强制回环保护，避免成为局域网/公网开放解析器
  const userL = splitHostPort(userConfig.dnsListen);
  const finalHost = userL.host && !/^(0\.0\.0\.0|::)$/.test(userL.host) ? userL.host : '127.0.0.1';
  const finalPort = userL.port || '1053';
  const finalListen = `${finalHost}:${finalPort}`;

  // 2. 节点域名自动避环：动态推导节点资产域名注入 fake-ip-filter (支持 smart 聚合泛化 / exact 精确 / off 关闭)
  const fakeIpFilterMode = userConfig.fakeIpFilterNodes !== undefined ? userConfig.fakeIpFilterNodes : 'smart';
  const nodeFilters = deriveFakeIpFilterAdditions(config.proxies || [], { mode: fakeIpFilterMode });
  const assetFilters = (fakeIpFilterMode !== 'off' && fakeIpFilterMode !== false && Array.isArray(config._assetFakeIpFilters))
    ? config._assetFakeIpFilters
    : [];
  const userFilters = Array.isArray(userConfig.fakeIpFilter) ? userConfig.fakeIpFilter : [];
  const finalList = dedupe([...DEFAULT_SCRIPT_FILTERS, ...nodeFilters, ...assetFilters, ...userFilters]);

  // 3. 破除死锁：引导 DNS 与节点解析器严格纯 IP 化
  const safeDefaultNs = sanitizeDnsServerList(
    userConfig.dnsDefault || ['223.5.5.5', '1.1.1.1'],
    { role: ROLES.DEFAULT }
  ).servers;

  const safeProxyServerNs = sanitizeDnsServerList(
    serverDNS || ['223.5.5.5', '119.29.29.29'],
    { role: ROLES.PROXY_SERVER }
  ).servers;

  // 4. 解析器拓扑装配
  const ns = {
    'default-nameserver': safeDefaultNs.length ? safeDefaultNs : ['223.5.5.5', '1.1.1.1'],
    'direct-nameserver': directDNS,
    'direct-nameserver-follow-policy': false, // Mihomo 官方推荐 false，防止直连域名 DNS 被代理规则劫持
    'proxy-server-nameserver': safeProxyServerNs.length ? safeProxyServerNs : ['223.5.5.5', '119.29.29.29'],
    'nameserver': proxyDNS
  };

  // 5. Policy 安全分流：基础规则 + 节点专属私有 DoH 依赖 + 用户自定义 Policy
  const scriptPolicy = { 'rule-set:cn-domain': directDNS, 'rule-set:non-cn': proxyDNS };
  const assetPolicy = config._assetPolicies || {};
  const userPolicy = userConfig.nameserverPolicy || {};
  const mergedPolicy = { ...scriptPolicy, ...assetPolicy, ...userPolicy };

  // 6. Hosts 安全挂载：节点专属优选 IP + 用户自定义 Hosts
  const assetHosts = config._assetHosts || {};
  const userHosts = userConfig.hosts || {};
  const finalHosts = { ...assetHosts, ...userHosts };
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
}

module.exports = {
  applyDnsOverlay
};
