/**
 * SSRF 安全防护与私网拦截
 *
 * 校验并拦截 IPv4/IPv6 私网、回环、CGNAT 及云元数据地址，防范服务端请求伪造。
 */

let dns;
try { dns = require('dns').promises; } catch { dns = null; }

const dnsCache = new Map();
const DNS_CACHE_TTL_MS = 30000;
const DNS_CACHE_MAX = 1000;

function isPrivateIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const trimmed = ip.trim();
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmed)) return false;
  const parts = trimmed.split('.').map(Number);
  if (parts.some(n => isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 本地网络
  if (a === 10) return true; // 10.0.0.0/8 私网
  if (a === 127) return true; // 127.0.0.0/8 回环
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 链路本地 / 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 私网
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 私网
  if (a === 192 && b === 0 && parts[2] === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 基准测试
  if (a === 198 && b === 51 && parts[2] === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 组播与保留
  return false;
}

function isPrivateIPv6(ip) {
  if (!ip || typeof ip !== 'string') return false;
  let v6 = ip.trim().toLowerCase();
  if (v6.startsWith('[') && v6.endsWith(']')) v6 = v6.slice(1, -1);
  if (!v6.includes(':')) return false;

  if (v6 === '::1' || v6 === '::') return true;
  // 完整未压缩格式 ::1
  if (/^(0+:){7}0*1$/.test(v6) || /^(0+:){7}0*0$/.test(v6)) return true;
  // 链路本地 (fe80::/10 -> fe80: ~ febf:)
  if (/^fe[89ab][0-9a-f]{0,2}:/i.test(v6) || v6.startsWith('fe80:')) return true;
  // 唯一本地地址 (fc00::/7 -> fc00: ~ fdff:)
  if (/^f[cd][0-9a-f]{0,2}:/i.test(v6) || v6.startsWith('fc') || v6.startsWith('fd')) return true;

  // IPv4 映射 IPv6 (点分十进制形式: ::ffff:127.0.0.1)
  const v4Dot = v6.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Dot) return isPrivateIp(v4Dot[1]);

  // IPv4 映射 IPv6 (十六进制形式)
  const v4Hex = v6.match(/^(?:::|(?:0:)+)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (v4Hex) {
    const hi = parseInt(v4Hex[1], 16);
    const lo = parseInt(v4Hex[2], 16);
    const ipStr = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
    return isPrivateIp(ipStr);
  }

  // 6to4 映射地址 2002::/16
  if (v6.startsWith('2002:')) {
    const parts = v6.split(':');
    if (parts.length >= 3) {
      const hexA = parseInt(parts[1], 16);
      if (!isNaN(hexA)) {
        const ipA = (hexA >> 8) & 0xff;
        const ipB = hexA & 0xff;
        if (isPrivateIp(`${ipA}.${ipB}.0.1`)) return true;
      }
    }
  }

  // NAT64 前缀 (64:ff9b::/96)
  if (v6.startsWith('64:ff9b::')) {
    const rest = v6.slice(9);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(rest)) return isPrivateIp(rest);
  }
  return false;
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
