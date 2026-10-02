/**
 * -----------------------------------------------------------------------------
 * Core Layer: DNS 安全核心 (不变式校验 + Fake-IP 域名聚合)
 * -----------------------------------------------------------------------------
 * 本模块提供两块能力：
 *   1. checkInvariants —— 内核 DNS 配置的 INV-1~9 自检
 *   2. deriveFakeIpFilterAdditions —— 从节点列表聚合推导 fake-ip-filter 域名
 *
 * 自检覆盖以下内核不变式：
 *
 *   INV-1  default-nameserver ⊆ IP 字面量（否则解析 DNS 服务器域名时死锁）
 *   INV-2  proxy-server-nameserver ∩ fake-ip-range = ∅（否则虚拟自环）
 *   INV-3  proxy-server-nameserver ⊆ IP 字面量（否则节点解析依赖自身，鸡蛋问题）
 *   INV-4  respect-rules = true ⇒ proxy-server-nameserver ≠ ∅
 *   INV-5  fallback ≠ ∅ ⇒ fallback-filter 必须显式声明（否则内核默认 geoip-code=CN 生效）
 *   INV-6  direct-nameserver-follow-policy = true ⇒ direct-nameserver ≠ ∅
 *   INV-7  enhanced-mode = fake-ip ⇒ 节点域名必须进入 fake-ip-filter（防环路）
 *   INV-8  dns.listen 必须绑定回环（否则成为开放解析器）
 *   INV-9  prefer-h3 与 respect-rules 不得同时为 true
 */

'use strict';

const ipaddr = require('ipaddr.js');

const { parseDnsServer, ipv4InCidrs } = require('./dns-sanitizer');

// ─────────────────────────────────────────────────────────────────────────────
// 1. 不变式校验器（可独立用于回归测试）
// ─────────────────────────────────────────────────────────────────────────────

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function checkInvariants(dns = {}, options = {}) {
  const v = [];
  const fakeRanges = [dns['fake-ip-range'] || '198.18.0.1/16'];

  // INV-1 引导层纯 IP
  for (const s of asArray(dns['default-nameserver'])) {
    const p = parseDnsServer(s);
    if ((p.kind !== 'ip' && !(p.kind === 'special' && s === 'system')) || (p.scheme && p.scheme !== 'plain')) {
      v.push({ id: 'INV-1', detail: `default-nameserver 必须为纯 IP 字面量，发现非纯 IP: ${s}` });
    }
  }

  // INV-2 / INV-3 节点解析层
  for (const s of asArray(dns['proxy-server-nameserver'])) {
    const p = parseDnsServer(s);
    if (p.isIpLiteral && p.host.includes('.')) {
      if (ipv4InCidrs(p.host, fakeRanges) || ipv4InCidrs(p.host, ['198.18.0.0/15'])) {
        v.push({ id: 'INV-2', detail: `proxy-server-nameserver 落在 fake-ip 网段: ${s}` });
      }
    }
    if (p.kind === 'url' && !p.isIpLiteral) {
      v.push({ id: 'INV-3', detail: `proxy-server-nameserver 含域名形式: ${s}` });
    }
  }

  // INV-4 respect-rules 依赖
  if (dns['respect-rules'] === true && asArray(dns['proxy-server-nameserver']).length === 0) {
    v.push({ id: 'INV-4', detail: 'respect-rules=true 但 proxy-server-nameserver 为空' });
  }

  // INV-5 fallback 必须显式声明 filter
  if (asArray(dns.fallback).length > 0 && !dns['fallback-filter']) {
    v.push({ id: 'INV-5', detail: '声明了 fallback 但缺少 fallback-filter，将使用内核默认 geoip-code=CN' });
  }

  // INV-6 direct-nameserver-follow-policy 依赖
  if (dns['direct-nameserver-follow-policy'] === true && asArray(dns['direct-nameserver']).length === 0) {
    v.push({ id: 'INV-6', detail: 'direct-nameserver-follow-policy=true 但 direct-nameserver 为空' });
  }

  // INV-7 enhanced-mode = fake-ip 时节点域名必须进入 fake-ip-filter（防虚拟自环）
  const fakeIpFilterMode = options.fakeIpFilterNodes !== undefined ? options.fakeIpFilterNodes : (options.fakeIpFilterMode || 'smart');
  if (fakeIpFilterMode !== 'off' && fakeIpFilterMode !== false &&
      dns['enhanced-mode'] === 'fake-ip' && options.proxies && Array.isArray(options.proxies)) {
    const requiredDomains = deriveFakeIpFilterAdditions(options.proxies, { mode: 'exact' });
    const filterList = Array.isArray(dns['fake-ip-filter']) ? dns['fake-ip-filter'] : [];
    for (const req of requiredDomains) {
      const covered = filterList.some(f => {
        if (f === req) return true;
        if (f.startsWith('+.') && (req === f.slice(2) || req.endsWith('.' + f.slice(2)))) return true;
        if (f.startsWith('*.') && req.endsWith(f.slice(1))) return true;
        return false;
      });
      if (!covered) {
        v.push({ id: 'INV-7', detail: `节点域名 ${req} 未进入 fake-ip-filter，存在 Fake-IP 环路风险` });
      }
    }
  }

  // INV-8 监听面
  const listen = String(dns.listen || '');
  if (listen && !/^(127\.0\.0\.1|\[::1\]|localhost):/.test(listen)) {
    v.push({ id: 'INV-8', detail: `dns.listen 未绑定回环，可能成为开放解析器: ${listen}` });
  }

  // INV-9 prefer-h3 与 respect-rules 冲突
  if (dns['prefer-h3'] === true && dns['respect-rules'] === true) {
    v.push({ id: 'INV-9', detail: 'prefer-h3 与 respect-rules 同时为 true（官方明确不建议）' });
  }

  return v;
}

/**
 * 常见多租户公共托管与动态 DNS 服务商域名
 * 此类域名若粗暴折叠到根域（如 +.workers.dev），会导致平台其他公用资产一并丧失 Fake-IP。
 * 对此类域名，保留其注册子域。
 */
const MULTI_TENANT_SUFFIXES = new Set([
  'workers.dev', 'pages.dev', 'github.io', 'gitlab.io',
  'vercel.app', 'netlify.app', 'herokuapp.com',
  'duckdns.org', 'ddns.net', 'no-ip.com', 'no-ip.org',
  'zapto.org', 'bounceme.net'
]);

const COMPOUND_TLD_REGEX = /(?:com|net|org|gov|edu|co|ne|or|ac|idv)\.[a-z]{2,3}$/i;

/**
 * 提取合法域名的主域名（注册域），用于安全泛化聚合。
 * @param {string} domain
 * @returns {string|null}
 */
function getRootDomain(domain) {
  if (!domain || typeof domain !== 'string') return null;
  const clean = domain.toLowerCase().trim().replace(/^\[|\]$/g, '').replace(/^\+?\./, '').replace(/^\*\./, '');
  const parts = clean.split('.');
  if (parts.length <= 1) return clean;
  if (parts.length === 2) return clean;

  // 1. 检查是否属于多租户平台域 (如 foo.workers.dev)
  for (const tenant of MULTI_TENANT_SUFFIXES) {
    if (clean === tenant || clean.endsWith('.' + tenant)) {
      const tenantParts = tenant.split('.');
      const keepPartsCount = tenantParts.length + 1;
      if (parts.length >= keepPartsCount) {
        return parts.slice(-keepPartsCount).join('.');
      }
      return clean;
    }
  }

  // 2. 检查复合二段 TLD (如 .com.cn, .co.jp)
  const lastTwo = parts.slice(-2).join('.');
  if (COMPOUND_TLD_REGEX.test(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }

  // 3. 普通 TLD (如 .com, .xyz, .net, .art) -> 返回最后两级 (如 lxyun.xyz, 7770006.xyz)
  return parts.slice(-2).join('.');
}

/**
 * 严格校验字符串是否为合法域名（排除 IPv4/IPv6，支持数字开头的合法域名如 123.com）
 */
function isValidDomain(str) {
  if (typeof str !== 'string' || !str) return false;
  const bare = str.trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (!bare || !bare.includes('.')) return false;
  // 排除合法 IP 字面量 (IPv4 / IPv6)
  if (ipaddr.isValid(bare)) return false;
  // 域名合法性：字母数字开头，允许点和连字符，至少含一个字母或数字
  return /^[a-zA-Z0-9][-a-zA-Z0-9.]*[a-zA-Z0-9]$/.test(bare) && /[a-zA-Z]/.test(bare);
}

/**
 * 从节点列表推导必须进入 fake-ip-filter 的域名（INV-7）。
 * 
 * 关键安全防线：
 * 1. 绝不收集 SNI/Servername（伪装域名）：许多节点使用 Apple、Google、米哈游、B站 CDN 伪装 SNI，
 *    若注入 fake-ip-filter 会破坏对应正常应用的 Fake-IP 解析并引发 DNS 泄漏。
 * 2. 智能聚合（mode: 'smart'）：将同一主域下的海量节点子域（如几十个 aws-link*.lxyun.xyz）
 *    自动折叠聚合为 '+.lxyun.xyz'，使配置大幅瘦身 80% 以上且天然覆盖所有子节点。
 * 3. 严格精准模式（mode: 'exact'）：逐项导出完整原始服务器域名。
 * 4. 关闭模式（mode: 'off' / false）：不推导任何节点域名。
 *
 * @param {Array} proxies 节点数组
 * @param {object|string} [options] 选项对象或 mode 字符串
 * @returns {string[]} 需要加入 fake-ip-filter 的规则列表
 */
function deriveFakeIpFilterAdditions(proxies = [], options = {}) {
  const opts = typeof options === 'string' ? { mode: options } : (options || {});
  const mode = opts.mode !== undefined ? opts.mode : 'smart';
  const includeSni = !!opts.includeSni; // 默认严格关闭，避免伪装域名污染

  if (mode === 'off' || mode === false) {
    return [];
  }

  const rawDomains = new Set();
  for (const p of proxies) {
    if (!p || typeof p !== 'object') continue;
    if (isValidDomain(p.server)) {
      rawDomains.add(p.server.trim().replace(/^\[|\]$/g, '').toLowerCase());
    }
    if (includeSni) {
      for (const key of ['sni', 'servername']) {
        if (isValidDomain(p[key])) {
          rawDomains.add(p[key].trim().replace(/^\[|\]$/g, '').toLowerCase());
        }
      }
    }
  }

  if (mode === 'exact') {
    return [...rawDomains];
  }

  // smart (默认/fold): 智能泛化折叠
  const folded = new Set();
  for (const domain of rawDomains) {
    const root = getRootDomain(domain);
    if (root) {
      folded.add(`+.${root}`);
    } else {
      folded.add(domain);
    }
  }

  return [...folded];
}

module.exports = {
  checkInvariants,
  getRootDomain,
  deriveFakeIpFilterAdditions
};
