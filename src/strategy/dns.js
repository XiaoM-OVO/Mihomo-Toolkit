/**
 * Mihomo DNS 策略与防泄漏配置生成器
 *
 * 生成 DNS 覆写配置（Fake-IP、DoH、分流策略、防泄漏），支持 secure / merge / passthrough 三种合并模式。
 */

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

function extractPolicyDNS(policy) {
  if (!policy || typeof policy !== 'object') return [];
  return [...new Set(Object.values(policy).flat().filter(s => typeof s === 'string'))];
}

/**
 * 注入或覆写 Mihomo DNS 配置
 * @param {object} config 待修改的 Mihomo 配置对象
 * @param {object} userConfig 用户配置参数
 */
function applyDnsOverlay(config, userConfig) {
  const mergeMode = (userConfig.dnsMergeMode || 'secure').toLowerCase();
  if (mergeMode === 'passthrough') return;

  const isReturn = userConfig.enableDomesticGroup && !userConfig.proxyFirst;
  const directDNS = isReturn ? userConfig.dnsProxy : userConfig.dnsDirect;
  const proxyDNS  = isReturn ? userConfig.dnsDirect : userConfig.dnsProxy;
  const serverDNS = userConfig.dnsServer;

  const sub = config.dns || {};
  const pick = (k, d) => (sub[k] !== undefined && sub[k] !== null && (!Array.isArray(sub[k]) || sub[k].length > 0)) ? sub[k] : d;

  const userL = splitHostPort(userConfig.dnsListen);
  const subL  = splitHostPort(sub.listen);
  const finalHost = userL.host || subL.host || '127.0.0.1';
  const finalPort = userL.port || subL.port || '1053';
  const finalListen = `${finalHost}:${finalPort}`;

  const scriptFilter = [
    '*.lan', '*.local', '*.arpa', 'time.*.com', 'ntp.*.com',
    'localhost.ptlogin2.qq.com', '*.msftncsi.com', 'www.msftconnecttest.com',
    'ipv6.msftncsi.com', '*.ipv6-literal.net', 'google.cn',
    '*.music.163.com', '*.music.126.net', '+.stun.*.*',
    '+.nintendo.net', '+.playstation.net', '+.xboxlive.com'
  ];
  const subMode = (sub['fake-ip-filter-mode'] || 'blacklist').toLowerCase();
  const finalMode = mergeMode === 'secure' ? 'blacklist' : subMode;
  const subList = Array.isArray(sub['fake-ip-filter']) ? sub['fake-ip-filter'] : [];
  const finalList = finalMode === 'blacklist'
    ? dedupe([...scriptFilter, ...subList])
    : (mergeMode === 'secure' ? scriptFilter : (subList.length ? subList : scriptFilter));

  const subProxyServer = sub['proxy-server-nameserver']
    || (extractPolicyDNS(sub['nameserver-policy']).length ? extractPolicyDNS(sub['nameserver-policy']) : undefined)
    || serverDNS;

  const ns = mergeMode === 'secure'
    ? {
        'default-nameserver': userConfig.dnsDefault,
        'direct-nameserver': directDNS,
        'direct-nameserver-follow-policy': true,
        'proxy-server-nameserver': serverDNS,
        'nameserver': proxyDNS
      }
    : {
        'default-nameserver': pick('default-nameserver', userConfig.dnsDefault),
        'direct-nameserver': pick('direct-nameserver', directDNS),
        'direct-nameserver-follow-policy': pick('direct-nameserver-follow-policy', true),
        'proxy-server-nameserver': subProxyServer,
        'nameserver': pick('nameserver', proxyDNS)
      };

  const scriptPolicy = { 'rule-set:cn-domain': directDNS, 'rule-set:non-cn': proxyDNS };
  const mergedPolicy = mergeMode === 'secure' ? scriptPolicy : { ...scriptPolicy, ...(sub['nameserver-policy'] || {}) };

  config.dns = {
    enable: true,
    listen: finalListen,
    ipv6: userConfig.enableIPv6,
    'enhanced-mode': 'fake-ip',
    'fake-ip-range': '198.18.0.1/16',
    'fake-ip-filter-mode': finalMode,
    'fake-ip-filter': finalList,
    'respect-rules': true,
    'use-hosts': mergeMode === 'secure' ? true : pick('use-hosts', true),
    'use-system-hosts': mergeMode === 'secure' ? false : pick('use-system-hosts', false),
    ...ns,
    'nameserver-policy': mergedPolicy
  };
}

module.exports = {
  applyDnsOverlay
};
