/**
 * -----------------------------------------------------------------------------
 * Core Layer: IP 地址分类纯工具 (IP Address Classification)
 * -----------------------------------------------------------------------------
 * 纯函数、无副作用、无 I/O。位于 Core 层是为了满足架构红线：
 * core / strategy 不得反向依赖 io 层（历史实现把这两个函数放在 io/ssrf.js，
 * 导致 core/security/dns-sanitizer.js 反向 require io 层）。
 *
 * io/ssrf.js 继续 re-export 本模块的两个函数，保持既有调用方不变。
 */

'use strict';

const ipaddr = require('ipaddr.js');

/**
 * 是否为私网/保留/不可路由的 IPv4（私网、回环、CGNAT、链路本地、组播、基准测试网段等）
 * @param {string} ip
 * @returns {boolean}
 */
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

/**
 * 是否为私网/保留 IPv6，含 IPv4 映射地址、6to4 与 NAT64 内嵌 IPv4 的递归判定
 * @param {string} ip
 * @returns {boolean}
 */
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
      } catch {}
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

module.exports = {
  isPrivateIp,
  isPrivateIPv6
};
