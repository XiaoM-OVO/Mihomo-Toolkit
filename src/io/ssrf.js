/**
 * SSRF 安全防护与私网拦截
 *
 * 校验并拦截 IPv4/IPv6 私网、回环、CGNAT 及云元数据地址，防范服务端请求伪造。
 */

const ipaddr = require('ipaddr.js');

let dns;
try { dns = require('dns').promises; } catch { dns = null; }

const dnsCache = new Map();
const DNS_CACHE_TTL_MS = 30000;
const DNS_CACHE_MAX = 1000;

function isPrivateIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  try {
    const trimmed = ip.trim();
    if (!ipaddr.isValid(trimmed)) return false;
    const addr = ipaddr.parse(trimmed);
    if (addr.kind() !== 'ipv4') return false;
    return addr.range() !== 'unicast';
  } catch {
    return false;
  }
}

function isPrivateIPv6(ip) {
  if (!ip || typeof ip !== 'string') return false;
  try {
    let clean = ip.trim().toLowerCase();
    if (clean.startsWith('[') && clean.endsWith(']')) clean = clean.slice(1, -1);
    if (!ipaddr.isValid(clean)) return false;
    const addr = ipaddr.parse(clean);
    if (addr.kind() !== 'ipv6') return false;

    // IPv4 映射 IPv6 (如 ::ffff:127.0.0.1)
    if (addr.isIPv4MappedAddress()) {
      return addr.toIPv4Address().range() !== 'unicast';
    }

    // 6to4 (2002::/16)
    if (addr.range() === '6to4') {
      try {
        const v4 = addr.toIPv4Address();
        if (v4 && v4.range() !== 'unicast') return true;
      } catch (e) {}
    }

    // NAT64 (64:ff9b::/96)
    if (clean.startsWith('64:ff9b::')) {
      const rest = clean.slice(9);
      if (ipaddr.isValid(rest)) {
        const parsedRest = ipaddr.parse(rest);
        if (parsedRest.kind() === 'ipv4') return parsedRest.range() !== 'unicast';
      }
    }

    return addr.range() !== 'unicast';
  } catch {
    return false;
  }
}

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

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('DNS timeout')), 5000)
  );
  try {
    return await Promise.race([dnsPromise, timeout]);
  } catch {
    return [];
  }
}

async function validateUrlSsrf(urlStr) {
  const parsedUrl = new URL(urlStr);
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
  dnsResolveWithTimeout,
  redactUrl
};
