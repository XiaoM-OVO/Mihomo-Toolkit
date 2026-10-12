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

/**
 * 校验是否为合法 IPv4 地址字面量
 * @param {string} ip
 * @returns {boolean}
 */
function isIPv4(ip) {
  if (!ip || typeof ip !== 'string') return false;
  return ipaddr.IPv4.isValid(ip.trim());
}

/**
 * 校验是否为合法 IPv6 地址字面量（支持方括号 [::1] 形式）
 * @param {string} ip
 * @returns {boolean}
 */
function isIPv6(ip) {
  if (!ip || typeof ip !== 'string') return false;
  let clean = ip.trim();
  if (clean.startsWith('[') && clean.endsWith(']')) clean = clean.slice(1, -1);
  return ipaddr.IPv6.isValid(clean);
}

/**
 * 从 URL、host:port 或裸域名/IP 中提取纯净的主机名/IP
 * 自动剥离协议头 (http/https)、端口号、路径及查询参数
 * @param {string} target
 * @returns {string|null}
 */
function extractDomainOrIp(target) {
  if (!target || typeof target !== 'string') return null;
  let str = target.trim();
  if (!str) return null;

  // 1. 若为标准 URL，借助 URL 解析提取 hostname
  if (/^https?:\/\//i.test(str)) {
    try {
      const u = new URL(str);
      str = u.hostname;
    } catch {
      str = str.replace(/^https?:\/\//i, '').split('/')[0];
    }
  } else {
    str = str.split('/')[0];
  }

  // 2. 剥离 IPv6 方括号端口 [2001:db8::1]:8080 ➔ 2001:db8::1
  const v6Match = str.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (v6Match) {
    return v6Match[1].toLowerCase();
  }

  // 3. 剥离 IPv4 / 域名端口 host:port
  if (str.includes(':')) {
    const colonCount = (str.match(/:/g) || []).length;
    if (colonCount === 1) {
      str = str.split(':')[0];
    }
  }

  str = str.trim().toLowerCase().replace(/\.+$/, '');
  return str || null;
}

/**
 * 归一化并清洗订阅服务域名/IP 列表（过滤回环与无效地址，确保无空、去重）
 * @param {string|string[]} input
 * @returns {string[]}
 */
function normalizeSubDomains(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  const results = [];
  const seen = new Set();

  for (const item of list) {
    if (typeof item !== 'string') continue;
    const parts = item.split(/[,;\s]+/);
    for (const part of parts) {
      const clean = extractDomainOrIp(part);
      if (!clean) continue;
      // 过滤回环与未指定地址（这些地址无需且不应注入直连规则）
      if (clean === 'localhost' || clean === '127.0.0.1' || clean === '::1' || clean === '0.0.0.0') {
        continue;
      }
      if (!seen.has(clean)) {
        seen.add(clean);
        results.push(clean);
      }
    }
  }
  return results;
}

module.exports = {
  isPrivateIp,
  isPrivateIPv6,
  isIPv4,
  isIPv6,
  extractDomainOrIp,
  normalizeSubDomains
};
