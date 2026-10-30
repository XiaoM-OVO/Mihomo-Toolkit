/**
 * SSRF 安全防护与私网拦截
 *
 * 校验并拦截 IPv4/IPv6 私网、回环、CGNAT 及云元数据地址，防范服务端请求伪造。
 *
 * 三道防线：
 *   - `isAllowedUrl`：同步字面量校验（协议 / 回环字面量 / 字面量 IP），零 I/O，供高频预筛；
 *   - `validateUrlSsrf`：在其之上补做 DNS 解析，拦截「域名本身合法、但解析结果指向内网」的绕过。
 *     它是**请求前**的强制校验，凡放行后会真实发起请求的入口都必须过它。
 *   - 建连期 IP Pinning（`pinned-agent.js`）：直连模式下 fetch 的 `connect.lookup` 在
 *     **同一次 DNS 解析**上完成校验并返回已固定 IP，消除「请求前校验」与「建连解析」之间的
 *     DNS Rebinding (TOCTOU) 窗口。
 *   - `isAllowedUrlAsync`：预检用途（server 参数化入口），采用**非严格**语义：
 *     本地解析失败不据此拒绝（此时尚不知道后续走直连还是代理），严格判定留给连接现场。
 *
 * 分模式严格度（`validateUrlSsrf` 的 `strict` 选项）：
 *   - 直连（strict=true，默认）：本地解析结果即权威。
 *     DNS 解析失败 / 超时 / A/AAAA 均无记录 → 一律拒绝（fail-closed）；
 *     解析成功的全部候选地址逐一检查，只要存在禁止地址即拒绝整个目标。
 *   - 代理（strict=false）：目标域名由代理侧解析，本地解析结果**不构成安全保证**，
 *     因此解析失败不据此拒绝，仅对能解析到的地址做「尽力而为」过滤。
 *
 * 残余风险（代理模式，必须显式认知）：
 *   本机回环代理**不等于**可信安全边界——代理由用户自行配置，其路由与 ACL 本工具无法读取、
 *   无法验证、也无法强制。代理模式**无法**防护：分裂 DNS（本机解析得公网、代理侧解析得内网）、
 *   代理侧私有解析、以及代理自身 ACL 缺失导致的私网/回环/元数据出站。
 *   若需完整 SSRF 防护，必须在代理侧自行配置 ACL 拒绝私网/回环/元数据目标。
 *   本工具不宣称代理模式已完整防护 SSRF。
 *   直连模式的建连期 IP 固定由 `io/pinned-agent.js` 承担；代理模式因解析发生在代理侧，
 *   无法在本机固定 IP，上述残余风险保留。
 */

const { isPrivateIp, isPrivateIPv6 } = require('../infra/ip');

let dns;
try { dns = require('dns').promises; } catch { dns = null; }

const dnsCache = new Map();
const DNS_CACHE_TTL_MS = 30000;
const DNS_CACHE_MAX = 1000;
const DNS_TIMEOUT_MS = 5000;

/** 回环 / 未指定地址字面量（localhost、0.0.0.0、::1） */
const LOOPBACK_LITERAL_REGEX = /^(localhost|0\.0\.0\.0|::1)$/;
const IPV4_LITERAL_REGEX = /^\d+\.\d+\.\d+\.\d+$/;

/**
 * 判定主机名是否为回环 / 未指定 / localhost 子域。
 * 这类主机名无需 DNS 即可判定，且必须在解析**之前**前置拒绝：
 * 否则「解析失败即放行」的非严格路径会被 `evil.localhost` 之类的子域绕过。
 */
function isLoopbackHostName(host) {
  if (LOOPBACK_LITERAL_REGEX.test(host)) return true;
  return host === 'localhost' || host.endsWith('.localhost');
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('DNS timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * OS 解析器兜底：getaddrinfo（`dns.lookup`）。
 *
 * `dns.resolve4/6` 是 c-ares 直查**系统配置的 DNS 服务器**；当该服务器拒连
 * （如网卡 DNS 指向的网关 ECONNREFUSED）时整机 c-ares 不可用，但 fetch/socket
 * 建连实际走的是 getaddrinfo，仍可解析 → 会形成「预检失败、实际连得上」的假阳性拦截。
 * 此处回退到与实际建连一致的解析路径；结果仍交由调用方逐地址做私网/回环拦截。
 * 解析失败返回空结果（fail-closed 判定留给调用方）。
 * @param {string} host
 * @returns {Promise<{ v4: string[], v6: string[], error: Error|null }>}
 */
async function lookupViaOsResolver(host) {
  if (!dns || typeof dns.lookup !== 'function') {
    return { v4: [], v6: [], error: new Error('DNS module unavailable') };
  }
  try {
    const all = await dns.lookup(host, { all: true, verbatim: true });
    const v4 = [];
    const v6 = [];
    for (const entry of all) {
      if (entry.family === 4) v4.push(entry.address);
      else if (entry.family === 6) v6.push(entry.address);
    }
    return { v4, v6, error: null };
  } catch (error) {
    return { v4: [], v6: [], error };
  }
}

/**
 * 判定 DNS 失败是否属于确定性（域名确实不存在），而非瞬时（超时/服务器不可达）。
 * 仅确定性失败可跳过重试；瞬时失败仍需按 fetchRetry 重试。
 */
function isDnsNotFound(err) {
  return /ENOTFOUND|ENODATA|NXDOMAIN|NOTFOUND/i.test(String((err && (err.code || err.message)) || ''));
}

/**
 * 默认域名解析器：并发查询 A/AAAA 并缓存成功结果。
 *
 * c-ares 两条查询均失败时，回退 OS 解析器（getaddrinfo，即实际建连路径）再定夺；
 * 两条路径都无法解析才向上传播（由调用方按 `strict` 决定拒绝还是放行）。
 * @param {string} host
 * @param {4|6} family
 * @returns {Promise<string[]>}
 */
function defaultResolver(host, family) {
  if (!dns) return Promise.reject(new Error('DNS module unavailable'));
  const now = Date.now();
  const cached = dnsCache.get(host);
  if (cached && cached.expireAt > now) {
    return Promise.resolve(family === 4 ? cached.v4 : cached.v6);
  }

  const work = (async () => {
    const [r4, r6] = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
    let v4 = r4.status === 'fulfilled' ? r4.value : [];
    let v6 = r6.status === 'fulfilled' ? r6.value : [];

    // c-ares 整体失败（NXDOMAIN / 服务器拒连 / 网络不可用）→ 回退 OS 解析器
    if (r4.status === 'rejected' && r6.status === 'rejected') {
      const viaOs = await lookupViaOsResolver(host);
      v4 = viaOs.v4;
      v6 = viaOs.v6;
      // 两条路径均无记录 → 无法证明目标安全，向上传播
      if (v4.length === 0 && v6.length === 0) {
        const err = new Error(`DNS resolution failed: ${host}`);
        // OS 解析器是实际建连路径：明确返回「域名不存在」时属确定性失败，供上层跳过重试
        if (isDnsNotFound(viaOs.error)) err.code = 'ENOTFOUND';
        throw err;
      }
    }

    if (v4.length > 0 || v6.length > 0) {
      if (dnsCache.size >= DNS_CACHE_MAX) dnsCache.delete(dnsCache.keys().next().value);
      dnsCache.set(host, { v4, v6, expireAt: Date.now() + DNS_CACHE_TTL_MS });
    }
    return family === 4 ? v4 : v6;
  })();

  return withTimeout(work, DNS_TIMEOUT_MS);
}

/**
 * 解析域名的全部候选地址（A + AAAA）。
 *
 * @param {string} host
 * @param {object} [options]
 * @param {(host: string, family: 4|6) => Promise<string[]>} [options.resolve] 可注入解析器（测试用）
 * @returns {Promise<{ ok: boolean, v4: string[], v6: string[] }>}
 *   ok=false 表示「无法证明目标安全」：解析失败、超时或 A/AAAA 均无记录。
 *   ok=true 时 v4/v6 为**全部**候选地址，调用方必须逐一检查——
 *   避免客户端或代理在多个地址中挑中未被检查的那一个。
 */
async function resolveCandidates(host, options = {}) {
  const resolveFn = typeof options.resolve === 'function' ? options.resolve : defaultResolver;
  const [r4, r6] = await Promise.allSettled([resolveFn(host, 4), resolveFn(host, 6)]);
  const v4 = r4.status === 'fulfilled' && Array.isArray(r4.value) ? r4.value : [];
  const v6 = r6.status === 'fulfilled' && Array.isArray(r6.value) ? r6.value : [];
  const ok = v4.length > 0 || v6.length > 0;
  // 全部候选为空时才讨论确定性：仅当所有拒绝原因都是「域名不存在」才算确定性失败；
  // 出现超时/服务器不可达（瞬时错误）时仍保留重试机会。
  const reasons = [r4, r6].filter(r => r.status === 'rejected').map(r => r.reason);
  const deterministic = !ok && reasons.every(isDnsNotFound);
  return { ok, v4, v6, deterministic };
}

/** 构造确定性策略拦截错误（协议 / 回环 / 私网 / 元数据字面量） */
function policyBlocked(message) {
  const err = new Error(message);
  err.ssrfBlocked = 'policy';
  // 确定性策略拦截：不重试、且不允许 auto 模式回退代理
  err.retryable = false;
  return err;
}

/** 构造「无法证明目标安全」错误（DNS 失败 / 超时 / 无记录） */
function unverifiedBlocked(message, deterministic = false) {
  const err = new Error(message);
  err.ssrfBlocked = 'unverified';
  // 确定性失败（域名确实不存在）标记：上层跳过同模式重试，但仍不设 retryable=false，
  // 以便 auto 模式在直连解析失败后回退代理（存在「仅代理侧可解析」的合法场景）。
  if (deterministic) err.dnsDeterministic = true;
  return err;
}

function isAllowedUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
    if (isLoopbackHostName(host)) return false;
    if (isPrivateIp(host)) return false;
    if (isPrivateIPv6(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * 连接现场的强制 SSRF 校验。
 *
 * @param {string} urlStr
 * @param {object} [options]
 * @param {boolean} [options.strict=true] true=直连语义（DNS 失败/无记录一律拒绝）；
 *   false=代理语义（本地解析不权威，失败不据此拒绝，仅尽力过滤）
 * @param {(host: string, family: 4|6) => Promise<string[]>} [options.resolve] 可注入解析器（测试用）
 * @returns {Promise<true>}
 * @throws {Error} 命中策略拦截（`ssrfBlocked='policy'`）或无法证明（`ssrfBlocked='unverified'`）
 */
async function validateUrlSsrf(urlStr, options = {}) {
  const strict = options.strict !== false;
  const parsedUrl = new URL(urlStr);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw policyBlocked(`SSRF 预检失败：不支持的协议 ${parsedUrl.protocol}`);
  }

  let host = parsedUrl.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

  // 1. 回环 / 未指定 / localhost 子域：无需 DNS 前置拒绝
  if (isLoopbackHostName(host)) {
    throw policyBlocked(`SSRF 预检失败：非法主机 ${host}`);
  }

  // 2. 字面量 IP 直判（覆盖 IPv4、IPv6 及 IPv4 映射地址）
  if (IPV4_LITERAL_REGEX.test(host)) {
    if (isPrivateIp(host)) throw policyBlocked(`SSRF 预检失败：目标是私网 IP ${host}`);
    return true;
  }
  if (host.includes(':')) {
    if (isPrivateIPv6(host)) throw policyBlocked(`SSRF 预检失败：目标是私网 IPv6 ${host}`);
    return true;
  }

  // 3. 域名：解析全部候选地址后逐一检查
  const { ok, v4, v6, deterministic } = await resolveCandidates(host, options);
  if (!ok) {
    if (strict) {
      throw unverifiedBlocked(
        `SSRF 预检失败：${host} 域名解析失败（已拒绝连接）`,
        deterministic
      );
    }
    // 代理模式：本地解析结果不构成保证，交由代理侧策略兜底（残余风险见文件头注释）
    return true;
  }
  for (const ip of v4) {
    if (isPrivateIp(ip)) throw policyBlocked(`SSRF 预检失败：${host} 解析到私网 IP ${ip}`);
  }
  for (const ip of v6) {
    if (isPrivateIPv6(ip)) throw policyBlocked(`SSRF 预检失败：${host} 解析到私网 IPv6 ${ip}`);
  }
  return true;
}

/**
 * 异步 SSRF 预检（**非严格**）：在 `isAllowedUrl` 的字面量校验之上补做 DNS 解析。
 *
 * 供 server 参数化入口在「尚不知道后续走直连还是代理」时做廉价前置过滤：
 * 只拒绝字面量违规与「能解析到私网」的目标；解析失败不据此拒绝，
 * 强制判定留给连接现场 `safeFetchText` 按模式执行（见 validateUrlSsrf）。
 *
 * @param {string} urlStr
 * @returns {Promise<boolean>}
 */
async function isAllowedUrlAsync(urlStr) {
  if (!isAllowedUrl(urlStr)) return false;
  try {
    await validateUrlSsrf(urlStr, { strict: false });
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
  redactUrl,
  policyBlocked,
  unverifiedBlocked
};
