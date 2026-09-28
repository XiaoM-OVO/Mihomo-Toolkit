/**
 * 域名节点多 IP 裂变增殖算法
 *
 * 将域名节点并发解析为多个具体 IP 节点（支持 A/AAAA 记录），实现同一域名的多链路物理测速与负载分流。
 */

let dns;
try { dns = require('dns').promises; } catch { dns = null; }

const { isPrivateIp, isPrivateIPv6 } = require('../io/ssrf');

function looksLikeDomain(server) {
  if (!server || typeof server !== 'string') return false;
  const s = server.trim().replace(/^\[|\]$/g, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return false;
  if (s.includes(':')) return false;
  return s.includes('.') && /[a-zA-Z]/.test(s);
}

async function queryDoh(domain, type) {
  const urls = [
    `https://dns.alidns.com/resolve?name=${encodeURIComponent(domain)}&type=${type}`,
    `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
      const data = await resp.json();
      const records = (data?.Answer || [])
        .filter(r => r.type === (type === 'A' ? 1 : 28))
        .map(r => r.data);
      if (records.length > 0) return records;
    } catch {}
  }
  return [];
}

/**
 * 解析域名对应的所有公共 IP
 * @param {string} domain
 * @param {string} [stack="all"] "all" | "v4" | "v6"
 * @returns {Promise<string[]>}
 */
async function resolveDomainIps(domain, stack = 'all') {
  if (!looksLikeDomain(domain)) return [];
  const results = [];

  try {
    const promises = [];
    if (dns) {
      if (stack === 'all' || stack === 'v4') {
        promises.push(dns.resolve4(domain).catch(() => []));
      }
      if (stack === 'all' || stack === 'v6') {
        promises.push(dns.resolve6(domain).catch(() => []));
      }
    }
    const resolved = await Promise.all(promises);
    resolved.flat().forEach(ip => {
      if (ip.includes(':')) {
        if (!isPrivateIPv6(ip)) results.push(ip);
      } else {
        if (!isPrivateIp(ip)) results.push(ip);
      }
    });

    // 若系统 DNS 解析无结果，使用 DoH 兜底解析
    if (results.length === 0) {
      const dohPromises = [];
      if (stack === 'all' || stack === 'v4') {
        dohPromises.push(queryDoh(domain, 'A'));
      }
      if (stack === 'all' || stack === 'v6') {
        dohPromises.push(queryDoh(domain, 'AAAA'));
      }
      const dohResolved = await Promise.all(dohPromises);
      dohResolved.flat().forEach(ip => {
        if (ip.includes(':')) {
          if (!isPrivateIPv6(ip)) results.push(ip);
        } else {
          if (!isPrivateIp(ip)) results.push(ip);
        }
      });
    }
  } catch {
    return [];
  }

  return [...new Set(results)];
}

/**
 * 执行节点裂变处理
 * @param {Array<object>} proxies
 * @param {object} [options={}]
 * @param {boolean} [options.enableFission=false]
 * @param {number} [options.fissionMaxNodes=5]
 * @param {string} [options.fissionStack="all"]
 * @param {Array<string>} [options.fissionExcludeKeywords=[]]
 * @returns {Promise<Array<object>>}
 */
async function expandDomainFission(proxies = [], options = {}) {
  if (!Array.isArray(proxies) || !options.enableFission) {
    return proxies;
  }

  const maxNodes = options.fissionMaxNodes || 5;
  const stack = options.fissionStack || 'all';
  const excludeKeywords = options.fissionExcludeKeywords || [];

  const domainMap = new Map();
  proxies.forEach(p => {
    if (looksLikeDomain(p.server)) {
      domainMap.set(p.server, true);
    }
  });

  // 并发解析所有域名
  const domainIpsMap = new Map();
  await Promise.all(
    Array.from(domainMap.keys()).map(async domain => {
      const ips = await resolveDomainIps(domain, stack);
      domainIpsMap.set(domain, ips);
    })
  );

  const output = [];

  for (const proxy of proxies) {
    const server = proxy.server;
    const name = proxy.name || '';

    // 黑名单检查
    const isExcluded = excludeKeywords.some(kw => kw && name.includes(kw));
    const ips = domainIpsMap.get(server) || [];

    if (isExcluded || ips.length <= 1) {
      output.push(proxy);
      continue;
    }

    const availableIps = ips.slice(0, maxNodes);

    // 第一个 IP 原地修改原节点
    const firstIp = availableIps[0];
    const originalProxy = { ...proxy };
    originalProxy.server = firstIp.includes(':') && !firstIp.startsWith('[') ? `[${firstIp}]` : firstIp;
    if (proxy.tls || ['ws', 'grpc', 'h2', 'http'].includes(proxy.network)) {
      if (!originalProxy.sni && !originalProxy.servername) originalProxy.servername = server;
    }
    if (originalProxy.network === 'ws' && !originalProxy['ws-opts']?.headers?.Host) {
      originalProxy['ws-opts'] = { ...(originalProxy['ws-opts'] || {}), headers: { ...(originalProxy['ws-opts']?.headers || {}), Host: server } };
    }
    output.push(originalProxy);

    // 其余 IP 裂变为克隆节点
    for (let i = 1; i < availableIps.length; i++) {
      const cloneIp = availableIps[i];
      const cloned = JSON.parse(JSON.stringify(proxy));
      cloned.server = cloneIp.includes(':') && !cloneIp.startsWith('[') ? `[${cloneIp}]` : cloneIp;
      if (proxy.tls || ['ws', 'grpc', 'h2', 'http'].includes(proxy.network)) {
        if (!cloned.sni && !cloned.servername) cloned.servername = server;
      }
      if (cloned.network === 'ws' && !cloned['ws-opts']?.headers?.Host) {
        cloned['ws-opts'] = { ...(cloned['ws-opts'] || {}), headers: { ...(cloned['ws-opts']?.headers || {}), Host: server } };
      }
      output.push(cloned);
    }
  }

  return output;
}

module.exports = {
  looksLikeDomain,
  resolveDomainIps,
  expandDomainFission
};
