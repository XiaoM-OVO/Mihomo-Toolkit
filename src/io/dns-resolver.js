/**
 * -----------------------------------------------------------------------------
 * I/O Layer: DNS 解析与 DoH 查询器 (DNS Resolver)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 负责系统级 DNS (resolve4 / resolve6) 与 DoH (Alidns / Google) 网络查询
 * 2. 拦截私网与非法 IP (SSRF 防御)
 * 3. 严格将网络副作用隔离在 I/O 层，供上层流水线编排调用
 */

let dns;
try {
  dns = require('dns').promises;
} catch {
  dns = null;
}

const { isPrivateIp, isPrivateIPv6 } = require('./ssrf');

function withTimeout(promise, ms = 3000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('DNS query timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function looksLikeDomain(server) {
  if (!server || typeof server !== 'string') return false;
  const s = server.trim().replace(/^\[|\]$/g, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return false;
  if (s.includes(':')) return false;
  return s.includes('.') && /[a-zA-Z]/.test(s);
}

/**
 * 发起 DoH 查询 (Alidns 与 Google DNS 双路并发/竞速兜底)
 * @param {string} domain
 * @param {string} type "A" | "AAAA"
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<string[]>}
 */
async function queryDoh(domain, type, timeoutMs = 3000) {
  const urls = [
    `https://dns.alidns.com/resolve?name=${encodeURIComponent(domain)}&type=${type}`,
    `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`
  ];

  for (const url of urls) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!resp.ok) continue;
      const data = await resp.json();
      const targetTypeNum = type === 'A' ? 1 : 28;
      const records = (data?.Answer || [])
        .filter(r => r.type === targetTypeNum && typeof r.data === 'string')
        .map(r => r.data.trim());
      if (records.length > 0) return records;
    } catch {}
  }
  return [];
}

/**
 * 解析域名对应的所有公共可用 IP (优先系统 DNS，无结果则 DoH 兜底)
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
        promises.push(withTimeout(dns.resolve4(domain), 3000).catch(() => []));
      }
      if (stack === 'all' || stack === 'v6') {
        promises.push(withTimeout(dns.resolve6(domain), 3000).catch(() => []));
      }
    }
    const resolved = await Promise.all(promises);
    resolved.flat().forEach(ip => {
      if (typeof ip !== 'string') return;
      if (ip.includes(':')) {
        if (!isPrivateIPv6(ip)) results.push(ip);
      } else {
        if (!isPrivateIp(ip)) results.push(ip);
      }
    });

    // 若系统 DNS 解析无公共 IP，尝试使用 DoH 兜底
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
        if (typeof ip !== 'string') return;
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
 * 批量并发解析节点列表中的所有域名
 * @param {Array<object>} proxies
 * @param {object} [options={}]
 * @returns {Promise<Map<string, string[]>>} domain -> ipList
 */
async function resolveProxiesDomains(proxies = [], options = {}) {
  const domainMap = new Map();
  if (!Array.isArray(proxies)) return domainMap;

  const stack = options.fissionStack || 'all';

  proxies.forEach(p => {
    if (p && looksLikeDomain(p.server)) {
      domainMap.set(p.server, true);
    }
  });

  const domainIpsMap = new Map();
  const domains = Array.from(domainMap.keys());

  await Promise.all(
    domains.map(async domain => {
      const ips = await resolveDomainIps(domain, stack);
      domainIpsMap.set(domain, ips);
    })
  );

  return domainIpsMap;
}

module.exports = {
  looksLikeDomain,
  queryDoh,
  resolveDomainIps,
  resolveProxiesDomains
};
