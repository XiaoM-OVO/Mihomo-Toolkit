/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 订阅拉取与网络容灾调度层
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 提供带有 SSRF 防护、超时与自动重定向保护的安全 HTTP 拉取 (safeFetchText)
 * 2. 支持 本地代理调度、三态策略 (direct/proxy/auto) 与按订阅粒度覆盖
 * 3. 拉取重试策略：仅重试网络抖动/超时/5xx，快速失败 4xx、SSRF 策略拒绝与 DNS 域名不存在
 * 4. Stale 兜底容灾缓存：网络故障时复用上次有效内容，保障下游节点不掉线
 *
 * SSRF 语义：每跳重定向与每次重试/回退都重新校验。
 *   - 直连：本地 DNS 解析结果即权威，解析失败/无记录一律拒绝（fail-closed）；
 *     建连阶段再经 IP Pinning（pinned-agent.js）在同一次解析上固定已校验 IP，
 *     消除校验与建连之间的 DNS Rebinding (TOCTOU) 窗口。
 *   - 代理：目标域名由代理侧解析，本机校验不构成安全保证，仅做尽力过滤。
 *     代理模式残余风险（分裂 DNS / 代理侧私有解析 / 代理 ACL 缺失）无法在本层消除，
 *     需由代理侧 ACL 兜底；详见 io/ssrf.js 文件头。
 */

const net = require('net');
const os = require('os');
const { safeDecodeURIComponent } = require('./parsers/base64');
const { validateUrlSsrf, redactUrl } = require('./ssrf');
const { GenerationSource } = require('./generation');
const { getPinnedAgent, extractSsrfBlock } = require('./pinned-agent');

let fetchProxy = { resolveLocalProxyDispatcher: null };
try {
  fetchProxy = require('./fetch-proxy');
} catch {}
const { resolveLocalProxyDispatcher } = fetchProxy;

// fetch 实现必须与 dispatcher 同源：Node 内置 fetch 在不同大版本绑定的 undici 接口不一致，
// 混用 npm undici 的 Agent 会报 `invalid onRequestStart method`（Node 22/24 实测）。
// 因此正常运行时使用 npm undici 自带的 fetch；宿主或测试显式替换全局 fetch 时尊重其实现。
const nativeFetch = globalThis.fetch;
let undiciFetch = null;
try {
  const undici = require('undici');
  if (typeof undici.fetch === 'function') undiciFetch = undici.fetch;
} catch {}

function currentFetchImpl() {
  if (globalThis.fetch !== nativeFetch) return globalThis.fetch;
  return undiciFetch || nativeFetch;
}

// 订阅拉取容灾：保留每个订阅最近一次成功拉取的内容，拉取失败时降级复用
/**
 * 订阅容灾缓存增强类：支持单调递增版本号、版本快照与基于快照的安全淘汰
 */
class SubStaleCacheMap extends Map {
  constructor() {
    super();
    this._generation = new GenerationSource('SubStaleCacheMap');
    this._versions = new Map();
  }

  set(key, value) {
    const version = this._generation.next();
    this._versions.set(key, version);
    if (value && typeof value === 'object') {
      value.version = version;
    }
    return super.set(key, value);
  }

  delete(key) {
    this._versions.delete(key);
    return super.delete(key);
  }

  clear() {
    this._versions.clear();
    return super.clear();
  }

  /**
   * 获取当前缓存条目的不可变快照（包含对象引用与当时的独立版本号）
   * @param {string} key
   * @returns {{ entry: any, version: number } | null}
   */
  getSnapshot(key) {
    if (!key || !this.has(key)) return null;
    const entry = this.get(key);
    const version = this._versions.get(key) || 0;
    return { entry, version };
  }

  /**
   * 获取仍处于新鲜期内的条目（按条目自身 timestamp 判定）。
   *
   * 语义：本表是「原始订阅内容」的快照层（L1），key 为订阅 URL，与客户端 Host 无关，
   * 因此不同请求（不同 subDomain / 缓存键）可以共享同一份新鲜内容，避免重复回源。
   * 只有拉取成功才会写入 timestamp，命中后不回写，确保新鲜期不会被无谓延长。
   *
   * @param {string} key 订阅 URL
   * @param {number} ttlMs 新鲜期（毫秒），<=0 视为禁用
   * @returns {object|null} 命中的条目；未命中/过期返回 null
   */
  getFresh(key, ttlMs) {
    if (!key || !this.has(key)) return null;
    const ttl = Number(ttlMs);
    if (!Number.isFinite(ttl) || ttl <= 0) return null;
    const entry = this.get(key);
    if (!entry || !Number.isFinite(entry.timestamp)) return null;
    return (Date.now() - entry.timestamp < ttl) ? entry : null;
  }

  /**
   * 安全淘汰：严格要求传入 getSnapshot(key) 捕获的有效快照对象 { entry, version }，
   * 仅当当前条目对象引用与版本号均严格一致时才执行淘汰，杜绝非快照或落后版本误删
   * @param {string} key
   * @param {object} snapshot getSnapshot 捕获的快照对象 { entry, version }
   * @returns {boolean} 是否实际执行了删除
   */
  deleteIfMatch(key, snapshot) {
    if (!key || !this.has(key)) return false;
    // 强制契约：必须是具备 entry 且 version 为有效数字的快照对象，拒绝裸条目
    if (!snapshot || typeof snapshot !== 'object' || !('entry' in snapshot) || typeof snapshot.version !== 'number') {
      return false;
    }

    const currentEntry = this.get(key);
    const currentVersion = this._versions.get(key) || 0;

    if (currentEntry !== snapshot.entry) return false;
    if (currentVersion !== snapshot.version) return false;

    return this.delete(key);
  }
}

const subStaleCache = new SubStaleCacheMap(); // url -> { content, subInfo, timestamp, version }
const DEFAULT_SUB_STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 兜底数据默认最长保留 24h
const SUB_STALE_MAX_ENTRIES = 200;

// ─── 单订阅拉取失败退避表 ────────────────────────────────────────────────────
// subFailureBackoff: Map<url, { failures, nextRetryAt, lastError }>
// 任一订阅失败后进入指数退避期（30s → 60s → 2m → 4m → 8m，上限 10m）：
// 退避期内不再发起网络请求，有可用旧缓存则直接复用，否则快速失败。
// 目的：单条订阅（域名 NXDOMAIN / 超时）不再拖慢整轮多订阅构建。
const SUB_BACKOFF_BASE_MS = 30 * 1000;
const SUB_BACKOFF_MAX_MS = 10 * 60 * 1000;
// 终态失效（401 / 到期 / 流量耗尽 / 旧缓存失效）改用低频探测：6h 起，12h、24h 封顶。
// 目的：避免已失效订阅每 10 分钟反复打源，同时保留自动恢复探测能力。
const SUB_TERMINAL_BACKOFF_BASE_MS = 6 * 60 * 60 * 1000;
const SUB_TERMINAL_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;
const SUB_BACKOFF_MAX_ENTRIES = 200;
const subFailureBackoff = new Map();

/** 为退避时长叠加 ±20% jitter，避免多订阅同时到期后集中探测 */
function withJitter(ms) {
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}

/**
 * 记录一次订阅拉取失败并推进指数退避
 * @param {string} key 订阅 URL
 * @param {any} [error] 上次错误（仅保留截断后的消息）
 * @param {boolean} [terminal=false] 是否属于终态失效（401 / 到期 / 流量耗尽），退避期内仍需保持终态语义
 * @returns {{ failures: number, terminalFailures: number, delayMs: number, nextRetryAt: number, lastError: string, terminal: boolean } | null}
 */
function recordSubFetchFailure(key, error, terminal = false) {
  if (!key) return null;
  const prev = subFailureBackoff.get(key);
  const failures = (prev ? prev.failures : 0) + 1;
  const prevTerminalFailures = prev ? (prev.terminalFailures || 0) : 0;
  const terminalFailures = terminal ? prevTerminalFailures + 1 : prevTerminalFailures;
  // 终态标记具有粘性：一旦判定失效，后续冷却均按低频探测处理
  const terminalState = terminal === true || (prev ? prev.terminal === true : false);

  let delayMs;
  if (terminalState) {
    const base = SUB_TERMINAL_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, terminalFailures - 1));
    // 先封顶再抖动：抖动必须作用在上限后的基准上，否则第 4 次起会被 min 直接裁成常量 24h，
    // 多订阅失去分散探测能力。最终仍裁到上限，保证「终态冷却 ≤24h」的既有语义。
    delayMs = Math.min(SUB_TERMINAL_BACKOFF_MAX_MS, withJitter(Math.min(base, SUB_TERMINAL_BACKOFF_MAX_MS)));
  } else {
    delayMs = Math.min(SUB_BACKOFF_BASE_MS * Math.pow(2, failures - 1), SUB_BACKOFF_MAX_MS);
  }

  if (subFailureBackoff.size >= SUB_BACKOFF_MAX_ENTRIES && !subFailureBackoff.has(key)) {
    const oldestKey = subFailureBackoff.keys().next().value;
    subFailureBackoff.delete(oldestKey);
  }

  // 先删后插：让最近失败的键保持在 Map 末尾，淘汰时优先丢弃最久未更新的记录
  subFailureBackoff.delete(key);
  const entry = {
    failures,
    terminalFailures,
    delayMs,
    nextRetryAt: Date.now() + delayMs,
    lastError: String((error && error.message) || error || '').slice(0, 200),
    terminal: terminalState
  };
  subFailureBackoff.set(key, entry);
  return entry;
}

/**
 * 拉取成功后清除该订阅的失败退避状态
 * @param {string} key
 */
function clearSubFetchFailure(key) {
  if (key) subFailureBackoff.delete(key);
}

/**
 * 当前是否处于该订阅的失败退避期（仅判定时间戳，不删除记录以保留失败计数）
 * @param {string} key
 * @returns {boolean}
 */
function isSubInFetchBackoff(key) {
  const state = key ? subFailureBackoff.get(key) : null;
  return !!state && Date.now() < state.nextRetryAt;
}

/**
 * 读取订阅失败退避状态（供监控/日志使用）
 * @param {string} key
 * @returns {{ failures: number, nextRetryAt: number, lastError: string } | null}
 */
function getSubFetchBackoff(key) {
  return key ? subFailureBackoff.get(key) || null : null;
}

function pruneSubStaleCache(maxAgeMs = DEFAULT_SUB_STALE_MAX_AGE_MS) {
  const now = Date.now();
  for (const [k, v] of subStaleCache) {
    if (now - v.timestamp > maxAgeMs) subStaleCache.delete(k);
  }
  if (subStaleCache.size > SUB_STALE_MAX_ENTRIES) {
    const sorted = [...subStaleCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const excess = subStaleCache.size - SUB_STALE_MAX_ENTRIES;
    for (let i = 0; i < excess; i++) subStaleCache.delete(sorted[i][0]);
  }
}

function buildFetchOpts(parsedUrl, signal) {
  const fetchOpts = {
    headers: { 'User-Agent': 'clash-verge/v1.3.8' },
    signal,
    redirect: 'manual'
  };
  if (parsedUrl.username || parsedUrl.password) {
    const user = safeDecodeURIComponent(parsedUrl.username);
    const pass = safeDecodeURIComponent(parsedUrl.password);
    const auth = (typeof btoa !== 'undefined')
      ? btoa(`${user}:${pass}`)
      : Buffer.from(`${user}:${pass}`).toString('base64');
    fetchOpts.headers['Authorization'] = `Basic ${auth}`;
    parsedUrl.username = '';
    parsedUrl.password = '';
  }
  return fetchOpts;
}

/**
 * 带字节上限的响应体读取（流式截断）。
 *
 * 背景：原先直接 `res.text()` 会把任意大小的响应体整体读入内存，
 * 恶意订阅/配置可借此耗尽进程内存。此处按块累加并在超限时立即中止。
 *
 * @param {Response} res
 * @param {number} [maxBytes=0] 0 表示不限制
 * @returns {Promise<string>}
 */
async function readBodyWithLimit(res, maxBytes = 0) {
  const limited = Number.isFinite(maxBytes) && maxBytes > 0;
  if (!limited) return await res.text();

  // 快路径：Content-Length 已声明超限则直接拒绝，不读 body
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) {
    try { if (res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch {}
    const err = new Error(`Response too large: ${declared} > ${maxBytes} bytes`);
    err.retryable = false;
    throw err;
  }

  if (!res.body || typeof res.body.getReader !== 'function') return await res.text();

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        const err = new Error(`Response too large: exceeded ${maxBytes} bytes`);
        err.retryable = false;
        throw err;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * 带有全套安全校验的文本拉取
 */
async function safeFetchText(url, options = {}) {
  const { maxRedirects = 5, timeoutMs = 15000, showFullUrl = false, proxyUrl = '', maxBytes = 0 } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 所有可能抛错的步骤（含代理解析器构造）都必须位于 try 内，
  // 保证 finally 的 clearTimeout 一定执行，不留下悬挂的超时定时器。
  try {
    let proxyDispatcher = null;
    if (proxyUrl) {
      if (typeof resolveLocalProxyDispatcher !== 'function') throw new Error('Proxy support unavailable (undici not loaded)');
      proxyDispatcher = resolveLocalProxyDispatcher(proxyUrl);
    }

    // SSRF 严格度随模式变化：
    //   - 直连：本地解析结果即权威 → strict，DNS 失败/无记录一律拒绝（fail-closed）；
    //     并注入 IP Pinning Agent，使建连使用与校验同源的已固定 IP（阻断 DNS Rebinding）。
    //   - 代理：目标由代理侧解析，本地结果不构成安全保证 → 非严格，仅尽力过滤。
    //     残余风险（分裂 DNS / 代理侧私有解析 / 代理 ACL 缺失）无法在本层消除，见 ssrf.js 文件头。
    const ssrfStrict = !proxyDispatcher;
    const dispatcher = proxyDispatcher || getPinnedAgent();

    let currentUrl = url;
    let redirects = 0;

    while (true) {
      await validateUrlSsrf(currentUrl, { strict: ssrfStrict });
      const parsedUrl = new URL(currentUrl);
      const fetchOpts = buildFetchOpts(parsedUrl, controller.signal);
      const res = await currentFetchImpl()(parsedUrl.toString(), dispatcher ? { ...fetchOpts, dispatcher } : fetchOpts);

      // 说明：浏览器里 `redirect: 'manual'` 会产生 `type === 'opaqueredirect'`，
      // 但 Node/undici 不会（实测 302 的 response.type 为 'basic'，状态码仍是 302），
      // 因此这里只看状态码；不要依赖 `res.type` 判断重定向。
      if (res.status >= 300 && res.status < 400) {
        redirects++;
        if (redirects > maxRedirects) {
          try { if (res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch {}
          const err = new Error(`Too many redirects (>${maxRedirects})`);
          err.retryable = false;
          throw err;
        }
        const location = res.headers.get('location');
        if (!location) {
          try { if (res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch {}
          const err = new Error(`Redirect with no Location header (status ${res.status})`);
          err.retryable = false;
          throw err;
        }
        // 重定向响应体一律丢弃，避免连接池泄漏
        try { if (res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch {}
        const nextUrl = new URL(location, currentUrl).toString();
        currentUrl = nextUrl;
        continue;
      }

      if (!res.ok) {
        try { if (res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch {}
        const err = new Error(`HTTP Error: ${res.status}`);
        err.status = res.status;
        err.statusCode = res.status;
        // 5xx 服务端故障、408 请求超时、429 限流均属瞬时错误，可重试；其余 4xx 为确定性错误不重试
        err.retryable = res.status >= 500 || res.status === 408 || res.status === 429;
        throw err;
      }
      const text = await readBodyWithLimit(res, maxBytes);
      return { text, response: res, finalUrl: currentUrl };
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`Fetch timeout (${timeoutMs / 1000}s): ${redactUrl(url, showFullUrl)}`);
      e.retryable = true;
      throw e;
    }
    // 建连期 IP Pinning 拦截：从 undici 的错误包装中还原，保持与预检一致的分类语义
    const blocked = extractSsrfBlock(err);
    if (blocked) {
      const e = new Error(blocked.message);
      e.ssrfBlocked = blocked.ssrfBlocked;
      // 保留确定性 DNS 标记：上层据此跳过同模式重试（仍允许 auto 回退代理）
      if (blocked.dnsDeterministic === true) e.dnsDeterministic = true;
      if (blocked.ssrfBlocked === 'policy') e.retryable = false;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 解析订阅拉取方式：每订阅显式 proxy 覆盖全局策略，未显式时遵循全局三态
 */
function resolveFetchPlan({ strategy, perSubProxy }) {
  if (perSubProxy === true) return { mode: 'proxy' };
  if (perSubProxy === false) return { mode: 'direct' };
  if (strategy === 'proxy') return { mode: 'proxy' };
  if (strategy === 'auto') return { mode: 'auto' };
  return { mode: 'direct' };
}

function checkPortReachable(port, host = '127.0.0.1', timeoutMs = 300) {
  return new Promise((resolve) => {
    if (!port || port <= 0 || port > 65535) {
      resolve(false);
      return;
    }
    const socket = new net.Socket();
    let settled = false;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(true);
      }
    });

    socket.once('timeout', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(false);
      }
    });

    socket.once('error', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(false);
      }
    });

    try {
      socket.connect(port, host);
    } catch {
      cleanup();
      resolve(false);
    }
  });
}

function detectTunInterface() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      const lower = name.toLowerCase();
      if (
        /^(utun|tun\d*|wintun)/i.test(lower) ||
        lower.includes('mihomo') ||
        lower.includes('meta-tun') ||
        lower.includes('clash') ||
        lower.includes('sing-box')
      ) {
        return name;
      }
    }
  } catch {}
  return null;
}

/**
 * 代理端点强制本地回环：只暴露端口配置
 */
function resolveProxyUrl(userConfig = {}) {
  return userConfig.fetchProxyPort ? `http://127.0.0.1:${userConfig.fetchProxyPort}` : '';
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 节点拉取主调度（带重试与自动降级）
 */
async function fetchNodes(url, options = {}) {
  const { showFullUrl = false, proxyUrl = '', strategy = 'direct', perSubProxy, logger, tag = '', retry = 2, timeoutMs = 15000, maxBytes = 0 } = options;
  const { mode } = resolveFetchPlan({ strategy, perSubProxy });
  const useProxy = mode === 'proxy';
  // 订阅标识仅用于日志归属，不参与请求行为
  const tagPart = tag ? `[${tag}] ` : '';

  const doFetch = async (p) => {
    const { text: content, response: res } = await safeFetchText(url, { showFullUrl, proxyUrl: p ? proxyUrl : '', timeoutMs, maxBytes });
    const subInfo = res.headers.get('subscription-userinfo');
    if (logger) {
      const sizeStr = formatBytes(Buffer.byteLength(content, 'utf-8'));
      const infoTag = subInfo ? ' · 含流量信息' : '';
      const proxyTag = p && proxyUrl ? '(代理)' : '';
      logger.debug(`🌐 回源成功${proxyTag}：${tagPart}${redactUrl(url, showFullUrl)} [${res.status} OK · ${sizeStr}${infoTag}]`);
    }
    return { content, subInfo };
  };

  const attemptFetch = async (p) => {
    const attempts = Math.max(1, (retry || 0) + 1);
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await doFetch(p);
      } catch (err) {
        lastErr = err;
        // 确定性失败不消耗重试次数：4xx / SSRF 策略拒绝 -> retryable=false；
        // DNS 域名不存在 -> dnsDeterministic（仍保留 auto 代理回退能力）。
        if (err && (err.retryable === false || err.dnsDeterministic === true)) throw err;
        if (i < attempts - 1) {
          const via = (p && proxyUrl) ? ` (经代理 ${proxyUrl.replace('http://', '')})` : '';
          if (logger) logger.debug(`🔄 回源失败，第 ${i + 1}/${attempts - 1} 次重试${via}：${tagPart}${err.message}`);
          await new Promise((r) => { setTimeout(r, 500 * (i + 1)); });
        }
      }
    }
    throw lastErr;
  };

  if (mode === 'auto') {
    try {
      return await attemptFetch(false);
    } catch (err) {
      if (!proxyUrl || err?.retryable === false) throw err;
      return await attemptFetch(true);
    }
  }
  return attemptFetch(useProxy);
}

module.exports = {
  safeFetchText,
  readBodyWithLimit,
  fetchNodes,
  checkPortReachable,
  detectTunInterface,
  resolveProxyUrl,
  subStaleCache,
  SubStaleCacheMap,
  pruneSubStaleCache,
  subFailureBackoff,
  recordSubFetchFailure,
  clearSubFetchFailure,
  isSubInFetchBackoff,
  getSubFetchBackoff
};
