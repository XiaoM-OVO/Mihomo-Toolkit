/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 订阅抓取与网络容灾调度层
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 提供带有 SSRF 防护、超时与自动重定向保护的安全 HTTP 抓取 (safeFetchText)
 * 2. 支持 本地代理调度、三态策略 (direct/proxy/auto) 与按订阅粒度覆盖
 * 3. 抓取重试策略：仅重试网络抖动/超时/5xx，快速失败 4xx 确定性错误
 * 4. Stale 兜底容灾缓存：网络故障时复用上次有效内容，保障下游节点不掉线
 */

const { safeDecodeURIComponent } = require('./parsers/base64');
const { validateUrlSsrf, redactUrl } = require('./ssrf');
const { parseContent } = require('./parsers');

let undici = { ProxyAgent: null };
try {
  undici = require('../fetch-proxy');
} catch (e) {}
const { ProxyAgent } = undici;

const proxyAgentCache = new Map();

// 订阅抓取容灾：保留每个订阅最近一次成功抓取的内容，抓取失败时降级复用
const subStaleCache = new Map(); // url -> { content, subInfo, timestamp }
const DEFAULT_SUB_STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 兜底数据默认最长保留 24h
const SUB_STALE_MAX_ENTRIES = 200;

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
 * 带有全套安全校验的文本抓取
 */
async function safeFetchText(url, options = {}) {
  const { maxRedirects = 5, timeoutMs = 15000, showFullUrl = false, proxyUrl = '' } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let proxyDispatcher = null;
  if (proxyUrl) {
    if (!ProxyAgent) throw new Error('Proxy support unavailable (undici not loaded)');
    const pUrl = new URL(proxyUrl);
    const isLocalTrusted = pUrl.hostname === '127.0.0.1' || pUrl.hostname === 'localhost' || pUrl.hostname === '::1';
    if (!isLocalTrusted) throw new Error(`SSRF blocked: proxy must be local, got ${pUrl.hostname}`);
    const cached = proxyAgentCache.get(proxyUrl);
    proxyDispatcher = cached || new ProxyAgent(proxyUrl);
    proxyAgentCache.set(proxyUrl, proxyDispatcher);
  }

  let currentUrl = url;
  let redirects = 0;

  try {
    while (true) {
      await validateUrlSsrf(currentUrl);
      const parsedUrl = new URL(currentUrl);
      const fetchOpts = buildFetchOpts(parsedUrl, controller.signal);
      const res = await fetch(parsedUrl.toString(), proxyDispatcher ? { ...fetchOpts, dispatcher: proxyDispatcher } : fetchOpts);

      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        redirects++;
        if (redirects > maxRedirects) {
          const err = new Error(`Too many redirects (>${maxRedirects})`);
          err.retryable = false;
          throw err;
        }
        const location = res.headers.get('location');
        if (!location) {
          const err = new Error(`Redirect with no Location header (status ${res.status})`);
          err.retryable = false;
          throw err;
        }
        const nextUrl = new URL(location, currentUrl).toString();
        currentUrl = nextUrl;
        continue;
      }

      if (!res.ok) {
        const err = new Error(`HTTP Error: ${res.status}`);
        err.retryable = res.status >= 500; // 5xx 可重试，4xx 等确定性错误不重试
        throw err;
      }
      const text = await res.text();
      return { text, response: res, finalUrl: currentUrl };
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`Fetch timeout (${timeoutMs / 1000}s): ${redactUrl(url, showFullUrl)}`);
      e.retryable = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 解析订阅抓取方式：每订阅显式 proxy 覆盖全局策略，未显式时遵循全局三态
 */
function resolveFetchPlan({ strategy, perSubProxy }) {
  if (perSubProxy === true) return { mode: 'proxy' };
  if (perSubProxy === false) return { mode: 'direct' };
  if (strategy === 'proxy') return { mode: 'proxy' };
  if (strategy === 'auto') return { mode: 'auto' };
  return { mode: 'direct' };
}

/**
 * 代理端点强制本地回环：只暴露端口配置
 */
function resolveProxyUrl(userConfig = {}) {
  return userConfig.fetchProxyPort ? `http://127.0.0.1:${userConfig.fetchProxyPort}` : '';
}

/**
 * 节点抓取主调度（带重试与自动降级）
 */
async function fetchNodes(url, options = {}) {
  const { showFullUrl = false, debug = false, proxyUrl = '', strategy = 'direct', perSubProxy, logger, retry = 2, timeoutMs = 15000 } = options;
  const { mode } = resolveFetchPlan({ strategy, perSubProxy });
  const useProxy = mode === 'proxy';
  if (logger) {
    logger.debug(`Fetching${useProxy && proxyUrl ? `(via proxy)` : ''}: ${redactUrl(url, showFullUrl)}`);
  }
  const doFetch = async (p) => {
    const { text: content, response: res } = await safeFetchText(url, { showFullUrl, proxyUrl: p ? proxyUrl : '', timeoutMs });
    const subInfo = res.headers.get('subscription-userinfo');
    if (debug && logger) {
      logger.debug(`Debug response: status=${res.status}, content-length=${content.length}, content-type=${res.headers.get('content-type') || 'unknown'}, subInfo=${subInfo ? 'present' : 'missing'}`);
      logger.debug(`Debug content preview: ${content.substring(0, 200).replace(/\n/g, '\\n')}`);
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
        if (err && err.retryable === false) throw err;
        if (i < attempts - 1) {
          if (logger) logger.warn(`订阅抓取失败，第 ${i + 1}/${attempts - 1} 次重试: ${err.message}`);
          await new Promise(r => setTimeout(r, 500 * (i + 1)));
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
      try { return await attemptFetch(true); }
      catch (e2) { throw e2; }
    }
  }
  return attemptFetch(useProxy);
}

module.exports = {
  safeFetchText,
  fetchNodes,
  resolveFetchPlan,
  resolveProxyUrl,
  subStaleCache,
  pruneSubStaleCache,
  DEFAULT_SUB_STALE_MAX_AGE_MS
};
