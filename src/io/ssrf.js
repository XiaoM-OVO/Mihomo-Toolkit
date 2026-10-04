/**
 * SSRF 安全防护与私网拦截
 *
 * 校验并拦截 IPv4/IPv6 私网、回环、CGNAT 及云元数据地址，防范服务端请求伪造。
 */

const ipaddr = require('ipaddr.js');
// 私网判定下沉到 Core 层纯工具（满足「core/strategy 不得反向依赖 io」的架构红线），
// 此处 re-export 保持既有调用方路径不变。
const { isPrivateIp, isPrivateIPv6 } = require('../core/shared/ip');

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

function redactUrl(url, showFull = false) {
  if (showFull) return url;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}/***`;
  } catch (e) {}
  return url;
}

module.exports = {
  isPrivateIp,
  isPrivateIPv6,
  isAllowedUrl,
  validateUrlSsrf,
  redactUrl
};
