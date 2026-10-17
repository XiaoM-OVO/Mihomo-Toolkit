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

// 本地回环代理分发器（与订阅抓取共用同一套回环校验与实例缓存）；环境缺失时为 null
let resolveLocalProxyDispatcher = null;
try { ({ resolveLocalProxyDispatcher } = require('./fetch-proxy')); } catch {}

/** 域名批量解析的并发上限：防止大订阅裂变瞬间数百并发查询耗尽套接字 / 触发 DNS 限流 */
const DNS_QUERY_CONCURRENCY = 16;

function withTimeout(promise, ms = 3000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('DNS query timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * 以固定并发上限批量执行异步映射（信号量模式，零外部依赖）。
 * 与 `Promise.all` 语义一致地收集全部结果，但任一时刻在途任务数不超过 `limit`。
 * @template T,R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  const cap = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  const runners = new Array(cap).fill(null).map(async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

function looksLikeDomain(server) {
  if (!server || typeof server !== 'string') return false;
  const s = server.trim().replace(/^\[|\]$/g, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return false;
  if (s.includes(':')) return false;
  return s.includes('.') && /[a-zA-Z]/.test(s);
}

/**
 * 发起 DoH 查询 (Alidns 与 Google DNS 双路**并发竞速**)。
 *
 * 竞速语义：两路上游同时发起，**首个返回非空记录者胜出**；先返回空结果/失败的一路
 * 不会阻塞另一路。全部失败或全空则返回 []。相比旧实现的「先 AliDNS 再串行 Google」，
 * 消除了被墙上游把整个查询拖满两轮超时的串行卡顿。
 *
 * 代理语义：传入 proxyUrl 时经本地回环代理转发，令 DoH 结果反映代理侧网络视图
 * （与代理模式下的订阅抓取保持一致）。代理不可用时该路归一为空结果，由竞速逻辑统一容错。
 * @param {string} domain
 * @param {string} type "A" | "AAAA"
 * @param {number} [timeoutMs=3000]
 * @param {string} [proxyUrl=''] 本地回环代理地址，空串表示直连
 * @returns {Promise<string[]>}
 */
function queryDoh(domain, type, timeoutMs = 3000, proxyUrl = '') {
  const urls = [
    `https://dns.alidns.com/resolve?name=${encodeURIComponent(domain)}&type=${type}`,
    `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`
  ];
  const targetTypeNum = type === 'A' ? 1 : 28;

  // 代理分发器仅构造一次（复用回环校验与实例缓存）；构造失败一律降级直连
  let dispatcher = null;
  if (proxyUrl && typeof resolveLocalProxyDispatcher === 'function') {
    try { dispatcher = resolveLocalProxyDispatcher(proxyUrl); } catch { dispatcher = null; }
  }

  const queryOne = async (url) => {
    const opts = { signal: AbortSignal.timeout(timeoutMs) };
    if (dispatcher) opts.dispatcher = dispatcher;
    const resp = await fetch(url, opts);
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data?.Answer || [])
      .filter(r => r.type === targetTypeNum && typeof r.data === 'string')
      .map(r => r.data.trim());
  };

  // 失败/被拦一律归一为空结果，交给竞速逻辑统一判定
  const attempts = urls.map((url) => queryOne(url).catch(() => []));

  return new Promise((resolve) => {
    let pending = attempts.length;
    let settled = false;
    const finish = (records) => {
      if (settled) return;
      settled = true;
      resolve(records);
    };
    const onSettled = (records) => {
      pending--;
      if (records.length > 0) finish(records);
      else if (pending === 0) finish([]);
    };
    attempts.forEach((p) => { p.then(onSettled); });
  });
}

/**
 * 解析域名对应的所有公共可用 IP (优先系统 DNS，无结果则 DoH 兜底)
 * @param {string} domain
 * @param {string} [stack="all"] "all" | "v4" | "v6"
 * @param {string} [proxyUrl=''] DoH 兜底所用本地回环代理地址，空串表示直连
 * @returns {Promise<string[]>}
 */
async function resolveDomainIps(domain, stack = 'all', proxyUrl = '') {
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
        dohPromises.push(queryDoh(domain, 'A', 3000, proxyUrl));
      }
      if (stack === 'all' || stack === 'v6') {
        dohPromises.push(queryDoh(domain, 'AAAA', 3000, proxyUrl));
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
 * @param {string} [options.fissionStack] 协议栈偏好 all | v4 | v6
 * @param {string} [options.dohProxyUrl] DoH 兜底所用本地回环代理地址（空串/缺省即直连）
 * @returns {Promise<Map<string, string[]>>} domain -> ipList
 */
async function resolveProxiesDomains(proxies = [], options = {}) {
  const domainMap = new Map();
  if (!Array.isArray(proxies)) return domainMap;

  const stack = options.fissionStack || 'all';
  const dohProxyUrl = options.dohProxyUrl || '';

  proxies.forEach(p => {
    if (p && looksLikeDomain(p.server)) {
      domainMap.set(p.server, true);
    }
  });

  const domainIpsMap = new Map();
  const domains = Array.from(domainMap.keys());

  // 并发上限排队：每个域名会扇出系统 DNS(A/AAAA) 与 DoH 兜底，全量并发会瞬间打爆套接字。
  await mapWithConcurrency(domains, DNS_QUERY_CONCURRENCY, async (domain) => {
    const ips = await resolveDomainIps(domain, stack, dohProxyUrl);
    domainIpsMap.set(domain, ips);
  });

  return domainIpsMap;
}

module.exports = {
  looksLikeDomain,
  resolveProxiesDomains,
  DNS_QUERY_CONCURRENCY
};
