/**
 * -----------------------------------------------------------------------------
 * Infra Layer: IP 地址与域名语法判定基元 (IP & Domain Primitives)
 * -----------------------------------------------------------------------------
 * 本模块属于 `src/infra/` 基础设施层：无状态纯函数、零副作用、零 I/O。
 * 提供底层通用的 IPv4 / IPv6 分类、私网与保留网段判定、回环探测及规范 FQDN 语法校验，
 * 供全仓各层（IO, Core, Strategy, Targets）按需直接引用，不依赖任何内部业务模块。
 *
 * 分层契约：
 *   1. 纯计算基元，无网络 I/O、无文件读写与环境探测；
 *   2. 零内部依赖，仅依赖 npm 底层地址库 (ipaddr.js)；
 *   3. 位于最底层（Layer 0），严禁反向引用任何业务分层。
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

const DOMAIN_LABEL_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

/**
 * 校验是否为合法的 FQDN 域名（或以 +. / *. 开头的通配域名）
 * @param {string} str
 * @returns {boolean}
 */
function isValidDomain(str) {
  if (!str || typeof str !== 'string' || str.length > 253) return false;
  let clean = str.trim().toLowerCase();
  if (clean.startsWith('+.') || clean.startsWith('*.')) {
    clean = clean.slice(2);
  }
  if (!clean.includes('.')) return false;
  const labels = clean.split('.');
  if (labels.some(l => !l || !DOMAIN_LABEL_REGEX.test(l))) return false;
  const tld = labels[labels.length - 1];
  if (!/^[a-zA-Z]{2,}$|^xn--[a-zA-Z0-9]+$/i.test(tld)) return false;
  return true;
}

/**
 * 是否属于回环（127.0.0.0/8、::1、localhost）或未指定地址（0.0.0.0、::）
 * @param {string} host
 * @returns {boolean}
 */
function isLoopbackOrUnspecified(host) {
  if (!host || typeof host !== 'string') return false;
  const clean = host.trim().toLowerCase();
  if (clean === 'localhost' || clean.endsWith('.localhost')) return true;
  if (isIPv4(clean)) {
    try {
      const p = ipaddr.parse(clean);
      return p.range() === 'loopback' || p.range() === 'unspecified';
    } catch {
      return false;
    }
  }
  if (isIPv6(clean)) {
    try {
      let v6 = clean;
      if (v6.startsWith('[') && v6.endsWith(']')) v6 = v6.slice(1, -1);
      const p = ipaddr.parse(v6);
      return p.range() === 'loopback' || p.range() === 'unspecified';
    } catch {
      return false;
    }
  }
  return false;
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
 * 归一化并清洗订阅服务域名/IP 列表（严格语法校验，过滤全量回环与非法字符，确保无空、去重）
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
    const parts = item.split(/[,;]+/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || /\s/.test(trimmed)) continue;
      const clean = extractDomainOrIp(trimmed);
      if (!clean) continue;
      // 1. 过滤回环与未指定地址（127.0.0.0/8、::1、localhost、0.0.0.0、::）
      if (isLoopbackOrUnspecified(clean)) continue;
      // 2. 语法合法性硬校验：必须是合法 IPv4、IPv6 或规范 FQDN 域名
      const isIp = isIPv4(clean) || isIPv6(clean);
      const isDomain = isValidDomain(clean);
      if (!isIp && !isDomain) continue;

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
  isValidDomain,
  isLoopbackOrUnspecified,
  extractDomainOrIp,
  normalizeSubDomains
};
