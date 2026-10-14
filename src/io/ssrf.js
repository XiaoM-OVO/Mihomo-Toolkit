/**
 * SSRF 安全防护与私网拦截
 *
 * 校验并拦截 IPv4/IPv6 私网、回环、CGNAT 及云元数据地址，防范服务端请求伪造。
 *
 * 两道防线：
 *   - `isAllowedUrl`：同步字面量校验（协议 / 回环字面量 / 字面量 IP），零 I/O，供高频预筛；
 *   - `isAllowedUrlAsync` / `validateUrlSsrf`：在其之上补做 DNS 解析，
 *     拦截「域名本身合法、但解析结果指向内网」的绕过。凡是放行后要真实发起请求的
 *     外部可控入口（server 参数化入口、fetcher 建连前）都必须过后者。
 */

const { isPrivateIp, isPrivateIPv6 } = require('../infra/ip');

let dns;
try { dns = require('dns').promises; } catch { dns = null; }

const dnsCache = new Map();
const DNS_CACHE_TTL_MS = 30000;
const DNS_CACHE_MAX = 1000;

function isAllowedUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
    if (/^(localhost|0\.0\.0\.0|::1)$/.test(host)) return false;
    if (isPrivateIp(host)) return false;
    if (isPrivateIPv6(host)) return false;
    return true;
  } catch {
    return false;
  }
}

async function dnsResolveWithTimeout(host, family) {
  if (!dns) return [];
  const now = Date.now();
  const cached = dnsCache.get(host);
  if (cached && cached.expireAt > now) {
    return family === 4 ? cached.v4 : cached.v6;
  }

  const dnsPromise = (async () => {
    try {
      const [v4Result, v6Result] = await Promise.allSettled([
        dns.resolve4(host),
        dns.resolve6(host)
      ]);
      const v4 = v4Result.status === 'fulfilled' ? v4Result.value : [];
      const v6 = v6Result.status === 'fulfilled' ? v6Result.value : [];
      if (dnsCache.size >= DNS_CACHE_MAX) dnsCache.delete(dnsCache.keys().next().value);
      dnsCache.set(host, { v4, v6, expireAt: Date.now() + DNS_CACHE_TTL_MS });
      return family === 4 ? v4 : v6;
    } catch {
      return [];
    }
  })();

  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('DNS timeout')), 5000);
  });
  try {
    return await Promise.race([dnsPromise, timeout]);
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function validateUrlSsrf(urlStr) {
  const parsedUrl = new URL(urlStr);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`SSRF blocked: illegal protocol ${parsedUrl.protocol}`);
  }
  let host = parsedUrl.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (/^(localhost|0\.0\.0\.0|::1)$/i.test(host)) {
    throw new Error(`SSRF blocked: illegal host ${host}`);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIp(host)) throw new Error(`SSRF blocked: private IP ${host}`);
  } else if (host.includes(':')) {
    if (isPrivateIPv6(host)) throw new Error(`SSRF blocked: private IPv6 ${host}`);
  } else if (dns) {
    const v4 = await dnsResolveWithTimeout(host, 4);
    for (const ip of v4) {
      if (isPrivateIp(ip)) throw new Error(`SSRF blocked: ${host} resolved to private IP ${ip}`);
    }
    const v6 = await dnsResolveWithTimeout(host, 6);
    for (const ip of v6) {
      if (isPrivateIPv6(ip)) {
        throw new Error(`SSRF blocked: ${host} resolved to private IPv6 ${ip}`);
      }
    }
  }
  return true;
}

/**
 * 异步 SSRF 预检：在 `isAllowedUrl` 的字面量校验之上补做 DNS 解析。
 *
 * `isAllowedUrl` 只看 URL 字面量，面对「域名合法但解析到 127.0.0.1 / 私网 / 云元数据」
 * 完全放行；凡放行后会真实发起请求的外部可控入口，必须改用它。
 * DNS 解析失败 / 超时按「无法证明其恶意」放行，与 fetcher 建连前的 gate 保持一致。
 *
 * @param {string} urlStr
 * @returns {Promise<boolean>}
 */
async function isAllowedUrlAsync(urlStr) {
  if (!isAllowedUrl(urlStr)) return false;
  try {
    await validateUrlSsrf(urlStr);
    return true;
  } catch {
    return false;
  }
}

function redactUrl(url, showFull = false) {
  if (showFull) return url;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}/***`;
  } catch {}
  return url;
}

module.exports = {
  isPrivateIp,
  isPrivateIPv6,
  isAllowedUrl,
  isAllowedUrlAsync,
  validateUrlSsrf,
  redactUrl
};
