const yaml = require('yaml');
const { operator } = require('./pure-nodes.js');
const { main: toolkitMain } = require('./mihomo-toolkit.js');

let dns;
try { dns = require('dns').promises; } catch { dns = null; }

// 简繁转换模块（Worker 环境不可用，构建时排除，运行时降级为空函数）
let chineseConvert = { toSimplified: (t) => t, toTraditional: (t) => t, deepConvertStrings: (o) => o, isAvailable: () => false };
try { chineseConvert = require('./chinese-convert'); } catch (e) {}

// undici 代理（Node 内置 fetch 不读系统代理；Worker 环境构建排除后运行时段降级为直连）
let undici = { ProxyAgent: null };
try { undici = require('./fetch-proxy'); } catch (e) {}
const { ProxyAgent } = undici;
const proxyAgentCache = new Map();

const {
  parseVlessUri,
  parseVmessUri,
  parseTrojanUri,
  parseSsUri,
  parseUriList,
  parseContent,
  parseSubscriptionInfo,
  isExpiredNow
} = require("./io/parsers");
const {
  decodeBase64,
  decodeBase64UrlSafe,
  safeDecodeURIComponent
} = require("./io/parsers/base64");
const {
  formatBytes,
  calcResetDays,
  generateInfoNodes
} = require("./io/sub-info");
const {
  isPrivateIp,
  isPrivateIPv6,
  isAllowedUrl,
  validateUrlSsrf,
  dnsResolveWithTimeout,
  redactUrl
} = require("./io/ssrf");

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

async function safeFetchText(url, options = {}) {
  const { maxRedirects = 5, timeoutMs = 15000, showFullUrl = false, proxyUrl = '' } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 校验代理端点只能为本地可信地址（防止任意代理劫持），并解析其 Basic Auth 供传入
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

// 解析订阅抓取方式：每订阅显式 proxy 覆盖全局策略，未显式时遵循全局三态
function resolveFetchPlan({ strategy, perSubProxy }) {
  if (perSubProxy === true) return { mode: 'proxy' };
  if (perSubProxy === false) return { mode: 'direct' };
  if (strategy === 'proxy') return { mode: 'proxy' };
  if (strategy === 'auto') return { mode: 'auto' };
  return { mode: 'direct' };
}

// 代理端点强制本地回环：只暴露端口配置，不允许指定任意地址（防远程代理被滥用/反连内网）
function resolveProxyUrl(userConfig) {
  return userConfig.fetchProxyPort ? `http://127.0.0.1:${userConfig.fetchProxyPort}` : '';
}

function createLogger(prefix, levelName = 'info') {
  const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
  const currentLevel = LOG_LEVELS[levelName] ?? 3;
  return {
    debug: (...args) => { if (currentLevel >= 4) console.log(`${prefix} DBG  ${args.join(' ')}`); },
    info:  (...args) => { if (currentLevel >= 3) console.log(`${prefix} INFO ${args.join(' ')}`); },
    log:   (...args) => { if (currentLevel >= 3) console.log(`${prefix} ${args.join(' ')}`); },
    warn:  (...args) => { if (currentLevel >= 2) console.warn(`${prefix} WARN ${args.join(' ')}`); },
    error: (...args) => { if (currentLevel >= 1) console.error(`${prefix} ERR  ${args.join(' ')}`); }
  };
}

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

  // 拉取失败重试：仅对可重试错误（超时/网络抖动/5xx）重试，4xx 等确定性错误直接放弃
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

let BUILDER_VERSION = "v1.7.0";
try {
  const pkg = require('../package.json');
  if (pkg && pkg.version) BUILDER_VERSION = `v${pkg.version}`;
} catch (e) {}

// 本地内存 TTL 缓存
const profileCacheMap = new Map();

// 订阅抓取容灾：保留每个订阅最近一次成功抓取的内容，抓取失败时降级复用，避免缺节点
const subStaleCache = new Map(); // url -> { content, subInfo, timestamp }
const DEFAULT_SUB_STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 兜底数据默认最长保留 24h（可用 fetchStaleTtl 覆盖）
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

function isSubEnabled(s) {
  if (!s || typeof s !== 'object') return false;
  return s.enable !== false && s.enabled !== false && s.disabled !== true;
}

function getCacheKey(userConfig, options) {
  try {
    const subs = (userConfig.subscriptions || []).filter(isSubEnabled).map(s => ({ url: s.url, uri: s.uri, tag: s.tag, proxy: s.proxy }));
    return JSON.stringify({
      subs,
      url: options.url,
      type: options.type || userConfig.type || 'pure',
      convert: userConfig.enableChineseConvert,
      convertMode: userConfig.chineseConvertMode,
      redactLevel: userConfig.redactLevel,
      fetchProxyPort: userConfig.fetchProxyPort,
      fetchProxyStrategy: userConfig.fetchProxyStrategy,
      enableDashboard: userConfig.enableDashboard,
      expireAggregation: userConfig.expireAggregation
    });
  } catch { return null; }
}

async function buildProfile(userConfig, options = {}) {
  const effectiveLogLevel = options.debug ? 'debug' : (userConfig.logLevel || 'info');
  const logger = createLogger('[Builder]', effectiveLogLevel);

  // 资源限制纵深防御：拦截订阅数量异常
  const securityLimits = userConfig.security || {};
  const limitErr = validateRequestLimits({
    subscriptionUrls: (userConfig.subscriptions || []).filter(isSubEnabled).map(s => s.url).filter(Boolean),
    limits: securityLimits
  });
  if (limitErr) throw limitErr;

  const enableCache = userConfig.enableCache !== false && !options.noCache;
  const cacheTtlMs = (userConfig.cacheTtl || 300) * 1000;
  const cacheKey = getCacheKey(userConfig, options);

  if (enableCache && cacheKey && profileCacheMap.has(cacheKey)) {
    const cached = profileCacheMap.get(cacheKey);
    if (Date.now() - cached.timestamp < cacheTtlMs) {
      const remainingSec = Math.round((cacheTtlMs - (Date.now() - cached.timestamp)) / 1000);
      logger.log(`⚡ 命中本地内存缓存 (${remainingSec}s 后过期)，直接响应缓存数据`);
      return cached.result;
    }
  }

  let configData = { proxies: [] };
  let hasInjectedTag = false;
  let globalUpload = 0, globalDownload = 0, globalTotal = 0, globalExpire = 0;
  
  const isOpenccReady = !!(chineseConvert.isAvailable && chineseConvert.isAvailable());
  const canConvert = !!(userConfig.enableChineseConvert && isOpenccReady);

  // 简繁转换开启但未安装依赖时给出明确提示
  if (userConfig.enableChineseConvert && !isOpenccReady) {
    logger.warn(`已配置 enableChineseConvert=true 但 opencc-js 依赖未就绪，已跳过简繁转换。执行: npm install opencc-js`);
  }

  // 简繁转换：入口处先将 config 中所有字符串值繁→简，确保后续匹配逻辑一致
  if (canConvert) {
    userConfig = chineseConvert.deepConvertStrings(userConfig, chineseConvert.toSimplified);
  }

  let redactLevel = userConfig.redactLevel || 'partial';
  const debug = options.debug || false;

  logger.log(`🔨 mihomo-toolkit-builder ${BUILDER_VERSION}`);

  // 启动概览：依赖状态 + 订阅概况
  const openccStatus = userConfig.enableChineseConvert
    ? (isOpenccReady ? '已就绪' : '未安装(降级)')
    : (isOpenccReady ? '已就绪(未启用)' : '未启用');
  const allSubs = userConfig.subscriptions || [];
  const activeSubs = allSubs.filter(isSubEnabled);
  const disabledCount = allSubs.length - activeSubs.length;
  const subCount = activeSubs.length;
  const urlSubs = activeSubs.filter(s => s.url).length;
  const uriSubs = activeSubs.filter(s => s.uri).length;
  const disabledInfo = disabledCount > 0 ? ` (已停用 ${disabledCount})` : '';
  logger.log(`依赖: opencc-js ${openccStatus} | 订阅: ${subCount} 个有效${disabledInfo} (URL ${urlSubs}, URI ${uriSubs})`);

  const isProd = (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production') || !!options.production;
  if (redactLevel === 'off' && isProd) {
    throw new Error('[Security] redactLevel=off 不允许在生产环境使用！');
  }
  
  const showFullUrl = (redactLevel === 'off');

  // 订阅抓取容灾配置：重试次数与单次拉取超时（秒），可被每个订阅项的 retry 字段覆盖
  const fetchRetry = typeof userConfig.fetchRetry === 'number' ? userConfig.fetchRetry : 2;
  const fetchTimeoutSec = typeof userConfig.fetchTimeout === 'number' ? userConfig.fetchTimeout : 15;
  const staleMaxAgeMs = (typeof userConfig.fetchStaleTtl === 'number' ? userConfig.fetchStaleTtl : 24) * 60 * 60 * 1000; // 兜底数据保留时长（小时）
  let hasFailedSub = false; // 存在最终失败的订阅（无兜底可用）时，构建结果不完整，不写入缓存

  const enableDashboard = userConfig.enableDashboard !== false;
  const expireAggregation = userConfig.expireAggregation || 'min'; // 'min' | 'max' | 'first'
  const collectedSubInfos = [];

  function recordSubInfo(subInfo, subTag) {
    if (!subInfo) return;
    const { upload, download, total, expire } = parseSubscriptionInfo(subInfo);
    collectedSubInfos.push({
      tag: subTag,
      upload,
      download,
      total,
      expire,
      expired: isExpiredNow(expire)
    });
  }

  function finalizeGlobalSubInfo() {
    if (collectedSubInfos.length === 0) return;

    // 1. 流量聚合：已过期的订阅不参与综合流量聚合，避免把失效套餐流量算进总和
    const activeSubs = collectedSubInfos.filter(s => !s.expired && s.total > 0);
    const expiredSubs = collectedSubInfos.filter(s => s.expired);

    expiredSubs.forEach(s => {
      logger.warn(`↩️ 订阅${s.tag ? ` [${s.tag}]` : ''}已过期，跳过其流量聚合`);
    });

    globalUpload = activeSubs.reduce((acc, s) => acc + s.upload, 0);
    globalDownload = activeSubs.reduce((acc, s) => acc + s.download, 0);
    globalTotal = activeSubs.reduce((acc, s) => acc + s.total, 0);

    // 2. 到期时间聚合：支持 min / max / first
    const subsWithExpire = collectedSubInfos.filter(s => s.expire > 0);
    if (subsWithExpire.length > 0) {
      const validSubs = subsWithExpire.filter(s => !s.expired);
      const candidatePool = validSubs.length > 0 ? validSubs : subsWithExpire;

      if (expireAggregation === 'max') {
        globalExpire = Math.max(...candidatePool.map(s => s.expire));
      } else if (expireAggregation === 'first') {
        globalExpire = candidatePool[0].expire;
      } else {
        // 默认 min：未过期取最早到期(Math.min)预警，全过期取最近失效历史时间戳(Math.max)
        globalExpire = validSubs.length > 0
          ? Math.min(...candidatePool.map(s => s.expire))
          : Math.max(...candidatePool.map(s => s.expire));
      }
    }
  }

  if (userConfig.subscriptions && Array.isArray(userConfig.subscriptions) && userConfig.subscriptions.length > 0) {
    const fetchTasks = userConfig.subscriptions.map(async (sub) => {
      if (!isSubEnabled(sub)) {
        return { sub, rawResult: null, error: null, disabled: true };
      }
      if (!sub.url && !sub.uri) return { sub, rawResult: null, error: null };
      try {
        let rawResult;
        if (sub.uri) {
          // uri 字段：直接节点，跳过 HTTP fetch，交给 parseContent 识别
          rawResult = { content: sub.uri, subInfo: null };
        } else {
          // url 字段：HTTP 抓取，代理策略 = per-sub proxy 覆盖全局 fetchProxyStrategy
          const subKey = sub.url;
          try {
            rawResult = await fetchNodes(sub.url, {
              showFullUrl, debug,
              proxyUrl: resolveProxyUrl(userConfig),
              strategy: userConfig.fetchProxyStrategy,
              perSubProxy: sub.proxy,
              retry: typeof sub.retry === 'number' ? sub.retry : fetchRetry,
              timeoutMs: fetchTimeoutSec * 1000
            });
            // 内容有效性校验：解析不出节点视为抓取失败（订阅源可能返回了限流页/错误页）
            if (!rawResult.content || (parseContent(rawResult.content).proxies || []).length === 0) {
              throw new Error('Subscription returned no nodes');
            }
          } catch (e) {
            // 容灾降级：复用该订阅上次成功抓取的内容，避免节点消失
            const stale = subStaleCache.get(subKey);
            if (stale && Date.now() - stale.timestamp < staleMaxAgeMs) {
              logger.warn(`⚠️ 订阅拉取失败，降级使用上次成功数据: ${e.message}`);
              rawResult = { content: stale.content, subInfo: stale.subInfo, stale: true };
            } else {
              throw e;
            }
          }
          if (rawResult && !rawResult.stale) {
            subStaleCache.set(subKey, { content: rawResult.content, subInfo: rawResult.subInfo, timestamp: Date.now() });
            pruneSubStaleCache(staleMaxAgeMs);
          }
        }
        return { sub, rawResult, error: null };
      } catch (e) {
        hasFailedSub = true;
        return { sub, rawResult: null, error: e };
      }
    });

    const fetchedResults = await Promise.all(fetchTasks);

    const subSummaries = [];
    for (const { sub, rawResult, error, disabled } of fetchedResults) {
      if (disabled) {
        const tag = sub.tag || (sub.url ? redactUrl(sub.url, showFullUrl) : (sub.name || '自建'));
        subSummaries.push({ disabled: true, tag, type: sub.uri ? 'uri' : 'url' });
        continue;
      }
      if (!rawResult && !error) continue;
      try {
        if (error) throw error;
        recordSubInfo(rawResult.subInfo, sub.tag);
        const subConfig = parseContent(rawResult.content);
        let subProxies = subConfig.proxies || [];
        
        // URI 节点自定义名称覆盖
        if (sub.uri && sub.name && subProxies.length > 0) {
          subProxies[0].name = sub.name;
        }

        // URI 节点日志
        if (sub.uri) {
          const nameHint = subProxies[0] ? subProxies[0].name : '未知';
          logger.debug(`URI 节点: ${nameHint}${sub.tag ? ` [${sub.tag}]` : ''}`);
        }
        
        let effectiveTag = sub.tag;
        let effectiveIndexPrefix = sub.indexPrefix;
        if (!effectiveTag) {
          const reg = /^\[([^\]]{1,12})\]/i;
          const tagCounts = {};
          for (const p of subProxies) {
            if (p.name) {
              const m = p.name.match(reg);
              if (m) {
                const tag = m[1].trim();
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
              }
            }
          }
          let bestTag = "";
          let maxCount = 0;
          for (const [t, c] of Object.entries(tagCounts)) {
            if (c > maxCount) { maxCount = c; bestTag = t; }
          }
          effectiveTag = bestTag;
          if (!effectiveTag && sub.url && sub.url.startsWith('http')) {
            try { effectiveTag = new URL(sub.url).hostname; } catch(e) {}
          }
          if (!effectiveTag) effectiveTag = "订阅";
        }

        // 重置信息：优先订阅配置（resetDay），未配置则自动捕捉机场重置节点名
        const cfgResetDays = calcResetDays({ resetDay: sub.resetDay });
        let resetText = "";
        if (cfgResetDays != null) {
          resetText = `距离重置剩余：${cfgResetDays} 天`;
        } else {
          const resetNode = subProxies.find(p => p.name && (p.name.includes('重置') || p.name.toLowerCase().includes('reset')));
          if (resetNode) {
            let cleanName = resetNode.name.replace(/^\[.*?\]\s*/, '').trim();
            const daysMatch = cleanName.match(/(\d+)\s*(?:天|Days?)/i);
            const dateMatch = cleanName.match(/\d{4}[-\/]\d{2}[-\/]\d{2}/);
            if (daysMatch) {
              resetText = `距离重置剩余：${daysMatch[1]} 天`;
            } else if (dateMatch) {
              resetText = `流量重置时间：${dateMatch[0]}`;
            } else {
              const numMatch = cleanName.match(/\d+/);
              resetText = numMatch ? `距离重置剩余：${numMatch[0]} 天` : cleanName;
            }
          }
        }

        const REGEX_INFO = /剩余|到期|过期|套餐|流量|时间|有效|更新|官网|维护|群|发布|节点说明|失效|获取|网址|Q群|电报|Tg群|下次|关注|官方|签到/i;
        const rawCount = subProxies.length;
        subProxies = subProxies.filter(p => {
          if (REGEX_INFO.test(p.name)) {
            logger.debug(`🗑️ [过滤信息] 「${p.name}」`);
            return false;
          }
          return true;
        });
        const filteredCount = rawCount - subProxies.length;
        
        // 通过字段传输订阅标签（不再污染名字），单订阅也打 _subTag 供下游使用
        // 是否启用标签提取由 enableAirportTag 控制，多订阅时 builder 自动强制开启
        if (sub.tag) {
          subProxies.forEach(p => {
            if (!p._subTag) p._subTag = sub.tag;
          });
        }

        // URI 注入节点自动加入白名单，无需手动配置
        // 确保节点能通过 pure 清洗并正常注入 customNodeGroups 指定的策略组
        // pure 白名单匹配会同时检查 proxy._subTag 字段（无需名字包含 tag）
        if (sub.uri && sub.tag) {
          const whitelist = userConfig.whitelistKeywords || [];
          const tagLower = sub.tag.toLowerCase();
          if (!whitelist.some(k => k.toLowerCase() === tagLower)) {
            if (!userConfig.whitelistKeywords) userConfig.whitelistKeywords = [];
            userConfig.whitelistKeywords.push(sub.tag);
          }
        }
        
        if (effectiveIndexPrefix) {
          subProxies.forEach(p => { p._indexPrefix = effectiveIndexPrefix; });
        }
        
        const { nodes: synthNodes, expireDays } = enableDashboard
          ? generateInfoNodes(rawResult.subInfo, effectiveTag, { isStale: !!rawResult.stale })
          : { nodes: [], expireDays: -1 };

        // 到期临近（≤30 天）时不显示重置——到期信息已够，重置无意义
        if (enableDashboard && resetText && (expireDays === -1 || expireDays > 30)) {
          synthNodes.push({
            name: `🔄 [${effectiveTag}] ${resetText}`,
            type: 'direct',
            server: '1.0.0.1',
            port: 80,
            isSyntheticInfo: true
          });
        }

        if (synthNodes.length > 0) {
          synthNodes.forEach(n => logger.debug(`ℹ️ [合成信息] 「${n.name}」`));
          subProxies.unshift(...synthNodes);
        }
        
        if (sub.tag && urlSubs > 1) {
          hasInjectedTag = true;
        }
        configData.proxies = configData.proxies.concat(subProxies);
        
        const nodeCount = subProxies.length;
        subSummaries.push({
          type: sub.uri ? 'uri' : 'url',
          nameHint: sub.uri ? (subProxies[0] ? subProxies[0].name : '未知') : '',
          tag: sub.tag || effectiveTag,
          total: nodeCount,
          filtered: filteredCount,
          synth: synthNodes.length
        });
      } catch (e) {
        const subId = sub.uri ? 'direct-uri' : redactUrl(sub.url, showFullUrl);
        logger.error(`Error processing subscription ${subId}: ${e.message}`);

        let effectiveTag = sub.tag;
        if (!effectiveTag && sub.url && sub.url.startsWith('http')) {
          try { effectiveTag = new URL(sub.url).hostname; } catch(err) {}
        }
        if (!effectiveTag) effectiveTag = "订阅";

        const errorMsg = e.message || '抓取失败';
        let shortMsg = errorMsg;
        if (/fetch failed/i.test(errorMsg)) shortMsg = '网络连接失败';
        else if (/timeout/i.test(errorMsg)) shortMsg = '拉取超时';
        else if (/HTTP Error: (\d+)/i.test(errorMsg)) shortMsg = `HTTP ${errorMsg.match(/HTTP Error: (\d+)/i)[1]}`;
        else if (/no nodes/i.test(errorMsg)) shortMsg = '未解析到有效节点';

        if (enableDashboard) {
          const failNode = {
            name: `❌ [${effectiveTag}] 拉取失败：${shortMsg}`,
            type: 'direct',
            server: '1.0.0.1',
            port: 80,
            isSyntheticInfo: true
          };
          configData.proxies.push(failNode);
        }

        subSummaries.push({
          type: sub.uri ? 'uri' : 'url',
          nameHint: '',
          tag: effectiveTag,
          total: 0,
          failed: true,
          failReason: shortMsg
        });
      }
    }

    finalizeGlobalSubInfo();

    // 仅在多订阅 (>=2 个有流量的有效源) 且启用看板时，在最顶部注入一组「全局总额」配对节点（流量 + 到期）
    // 完美契合客户端常见的 2 列网格布局 (左列流量 / 右列到期)
    const activeSubsWithTraffic = collectedSubInfos.filter(s => !s.expired && s.total > 0);
    if (enableDashboard && activeSubsWithTraffic.length > 1 && globalTotal > 0) {
      const globalRemaining = Math.max(0, globalTotal - (globalUpload + globalDownload));
      const globalPercent = ((globalRemaining / globalTotal) * 100).toFixed(1);
      const isLow = globalRemaining <= 10 * 1024 * 1024 * 1024 || (globalRemaining / globalTotal) <= 0.05;
      const globalIcon = isLow ? '🪫' : '📈';
      const globalTrafficNode = {
        name: `${globalIcon} [全局] 剩余流量：${formatBytes(globalRemaining)} / ${formatBytes(globalTotal)} (${globalPercent}%)`,
        type: 'direct',
        server: '1.0.0.1',
        port: 80,
        isSyntheticInfo: true
      };

      const topNodes = [globalTrafficNode];

      if (globalExpire > 0) {
        const d = new Date(globalExpire * 1000);
        const dateStr = d.toISOString().split('T')[0];
        const now = new Date();
        const days = Math.ceil((d - now) / 86400000);
        let expireLabel = '临近到期';
        if (expireAggregation === 'max') expireLabel = '最晚到期';
        else if (expireAggregation === 'first') expireLabel = '首项到期';

        let expireIcon = '⌛';
        let expireDesc = `(余 ${days} 天)`;
        if (days <= 0) {
          expireIcon = '🛑';
          expireDesc = `(已失效 ${Math.max(1, Math.floor((now - d) / 86400000))} 天)`;
        } else if (days <= 3) {
          expireIcon = '⚠️';
          expireDesc = `(仅剩 ${days} 天)`;
        }

        const globalExpireNode = {
          name: `${expireIcon} [全局] ${expireLabel}：${dateStr} ${expireDesc}`,
          type: 'direct',
          server: '1.0.0.1',
          port: 80,
          isSyntheticInfo: true
        };
        topNodes.push(globalExpireNode);
      }

      configData.proxies.unshift(...topNodes);
    }

    if (subSummaries.length > 0) {
      logger.log(`📡 订阅解析完成 (${subSummaries.length} 个源):`);
      subSummaries.forEach((s, idx) => {
        const isLast = idx === subSummaries.length - 1;
        const branch = isLast ? '└──' : '├──';
        if (s.disabled) {
          logger.log(`    ${branch} ⏸️ [${s.tag}]: 已停用 (跳过)`);
        } else if (s.failed) {
          logger.log(`    ${branch} ❌ [${s.tag}]: 拉取失败 (${s.failReason})`);
        } else {
          const icon = s.type === 'uri' ? '📌' : '🌐';
          const details = [];
          if (s.filtered > 0) details.push(`过滤 ${s.filtered}`);
          if (s.synth > 0) details.push(`合成 ${s.synth}`);
          const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
          const namePart = s.type === 'uri' ? `${s.nameHint}${s.tag ? ` [${s.tag}]` : ''}` : `[${s.tag}]`;
          logger.log(`    ${branch} ${icon} ${namePart}: ${s.total} 个节点${detailStr}`);
        }
      });
    }
  } else if (options.url) {
    let rawResult;
    if (/^(vless|vmess|trojan|ss):\/\//i.test(options.url)) {
      // 直接 URI 节点，跳过 HTTP fetch，交给 parseContent 识别
      logger.debug(`URI 节点: ${options.url.split('#').pop() || '未知'}`);
      rawResult = { content: options.url, subInfo: null };
    } else {
      rawResult = await fetchNodes(options.url, {
        showFullUrl, debug, logger,
        proxyUrl: resolveProxyUrl(userConfig),
        strategy: userConfig.fetchProxyStrategy,
        retry: fetchRetry,
        timeoutMs: fetchTimeoutSec * 1000
      });
    }
    recordSubInfo(rawResult.subInfo, "");
    finalizeGlobalSubInfo();
    configData = parseContent(rawResult.content);
    const nodeCount = configData.proxies ? configData.proxies.length : 0;
    logger.log(`📡 节点解析完成: ${nodeCount} 个节点`);
    if (enableDashboard) {
      const { nodes: synthNodes } = generateInfoNodes(rawResult.subInfo, "");
      if (synthNodes.length > 0 && configData.proxies) {
        configData.proxies.unshift(...synthNodes);
      }
    }
  } else {
    throw new Error("No URL or subscriptions provided.");
  }

  // =========================================================================
  // 配置继承与冲突协调
  // 根级 userConfig → 同时继承给 pure 和 toolkit
  // pureConfig / toolkitConfig → 各自覆盖根级同名配置
  // =========================================================================
  let pureUserConfig = { ...userConfig, ...(userConfig.pureConfig || {}) };
  let toolkitUserConfig = { ...userConfig, ...(userConfig.toolkitConfig || {}) };

  // 多订阅时强制双端启用标签提取（_subTag 字段已注入，需 enableAirportTag 激活读取）
  // 标签是否写入最终节点名，由 rename 模板中是否包含 {airport} 决定
  if (hasInjectedTag) {
    pureUserConfig.enableAirportTag = true;
    toolkitUserConfig.enableAirportTag = true;
  }

  const targetType = options.type || userConfig.type || 'pure';

  // --- full 模式自动协调（硬约束，无条件强制，防止用户误配破坏两阶段流水线）---
  if (targetType === 'full') {
    // toolkit 强制跳过二次重命名，避免覆盖 pure 的清洗结果
    toolkitUserConfig.enableNodeRename = false;
    // pure 强制输出文字特征（不转 Emoji），让 toolkit 能识别文字并正确分桶
    pureUserConfig.showFeatureIcon = false;
    // full 模式默认剔除机场原生说明假节点（由 builder 统一合成高颜值彩色状态看板，避免双重展示）
    pureUserConfig.removeInfoNodes = userConfig.removeInfoNodes ?? true;
  }

  // 根级白名单/注入规则同步合并进双端（任意模式生效，pureConfig/toolkitConfig 是覆盖语义，
  // 会冲掉根级同名配置，这里按并集合并回去，保证根级共享规则不被吞掉）
  const whitelist = userConfig.whitelistKeywords || [];
  const specialRules = userConfig.specialNodeRules || [];
  if (whitelist.length > 0) {
    pureUserConfig.whitelistKeywords = [...new Set([...(pureUserConfig.whitelistKeywords || []), ...whitelist])];
    toolkitUserConfig.whitelistKeywords = [...new Set([...(toolkitUserConfig.whitelistKeywords || []), ...whitelist])];
  }
  if (specialRules.length > 0) {
    pureUserConfig.specialNodeRules = [...new Set([...(pureUserConfig.specialNodeRules || []), ...specialRules])];
    toolkitUserConfig.specialNodeRules = [...new Set([...(toolkitUserConfig.specialNodeRules || []), ...specialRules])];
  }

  let finalProxies = configData.proxies;
  let result = null;

  // 简繁转换：pure 处理前将节点名统一转为简体，提高 pure 和 toolkit 的识别率
  if (canConvert) {
    configData.proxies = configData.proxies.map(proxy => ({
      ...proxy,
      name: chineseConvert.toSimplified(proxy.name)
    }));
  }

  if (targetType === 'pure' || targetType === 'full') {
    if (targetType === 'full') logger.log('🔄 阶段 1/2: pure-nodes 节点清洗');
    result = await operator(configData.proxies, "clash", pureUserConfig);
    finalProxies = Array.isArray(result) ? result : result.proxies;
  }

  configData.proxies = finalProxies;
  let outputData = configData;
  
  if (targetType === 'full' || targetType === 'toolkit') {
    if (targetType === 'full') logger.log('🔄 阶段 2/2: mihomo-toolkit 策略组构建');
    outputData = toolkitMain(outputData, toolkitUserConfig);
  }

  // 简繁转换：toolkit 处理后按配置输出简体或繁体
  if (canConvert) {
    const modeLabel = userConfig.chineseConvertMode === 's2t' ? '繁体' : '简体';
    logger.log(`🔤 简繁转换: 输出 ${modeLabel}`);
    const convertFn = userConfig.chineseConvertMode === 's2t' ? chineseConvert.toTraditional : chineseConvert.toSimplified;
    const nameMap = {};

    // 转换节点名
    for (const proxy of outputData.proxies) {
      const oldName = proxy.name;
      proxy.name = convertFn(proxy.name);
      if (oldName !== proxy.name) nameMap[oldName] = proxy.name;
    }

    // 转换策略组名 + 组内引用 + use 引用
    if (outputData['proxy-groups']) {
      for (const group of outputData['proxy-groups']) {
        const oldName = group.name;
        group.name = convertFn(group.name);
        if (oldName !== group.name) nameMap[oldName] = group.name;
        if (group.proxies) group.proxies = group.proxies.map(p => convertFn(p));
        if (group.use) group.use = group.use.map(u => convertFn(u));
      }
    }

    // 转换 rules 中的组名引用（如 RULE-SET,ads,🚫 广告拦截 → 🚫 廣告攔截）
    if (outputData.rules && Object.keys(nameMap).length > 0) {
      outputData.rules = outputData.rules.map(rule => {
        for (const [oldName, newName] of Object.entries(nameMap)) {
          if (rule.includes(oldName)) {
            rule = rule.replace(oldName, newName);
          }
        }
        return rule;
      });
    }
  }

  // 构建摘要
  if (targetType === 'full' || targetType === 'toolkit') {
    const groups = outputData['proxy-groups'] || [];
    const proxies = outputData.proxies || [];
    const featureSwitches = [
      toolkitUserConfig.enableAI && 'AI', toolkitUserConfig.enableStreaming && '流媒体',
      toolkitUserConfig.enableGame && '游戏', toolkitUserConfig.enableTelegram && 'TG',
      toolkitUserConfig.enableGitHub && 'GitHub', toolkitUserConfig.enableScholar && 'Scholar',
      toolkitUserConfig.enableSystemServices && '系统', toolkitUserConfig.enableDomesticGroup && '中国分流',
      toolkitUserConfig.enableAdBlock && '广告拦截'
    ].filter(Boolean);
    logger.log(`✅ 构建完成: ${proxies.length} 个节点, ${groups.length} 个策略组` +
      (featureSwitches.length > 0 ? ` | ${featureSwitches.join(' ')}` : ''));
  }
  
  // 移除内部私有字段（_ 前缀，如 _subTag/_indexPrefix/_rawName），防止泄漏到最终 YAML
  if (Array.isArray(outputData.proxies)) {
    for (const p of outputData.proxies) {
      if (p && typeof p === 'object') {
        for (const key of Object.keys(p)) {
          if (key.startsWith('_')) delete p[key];
        }
      }
    }
  }

  let yamlStr = yaml.stringify(outputData);
    
  if (globalTotal > 0 || globalExpire > 0) {
    yamlStr = `# subscription-userinfo: upload=${globalUpload}; download=${globalDownload}; total=${globalTotal}; expire=${globalExpire}\n` +
              `# profile-web-page-url: https://github.com/mihomo-toolkit\n` +
              `# upload=${globalUpload}; download=${globalDownload}; total=${globalTotal}; expire=${globalExpire}\n` +
              yamlStr;
  }
  
  const profileResult = {
    yamlStr,
    meta: result && !Array.isArray(result) ? result.meta : null,
    userInfo: {
      upload: globalUpload,
      download: globalDownload,
      total: globalTotal,
      expire: globalExpire
    }
  };

  if (enableCache && cacheKey && !hasFailedSub) {
    profileCacheMap.set(cacheKey, { timestamp: Date.now(), result: profileResult });
  }

  return profileResult;
}

// 单次请求资源限制默认值（保守值，防止恶意 config 注入导致资源耗尽）
const DEFAULT_REQUEST_LIMITS = {
  maxSubscriptionUrls: 20,        // ?url= 参数最多允许的订阅数
  maxRemoteConfigBytes: 1048576,  // ?config= 远程配置文件最大字节数 (1MB)
  maxTotalNodes: 5000,            // 单次构建允许的最大节点总数
  perSubscriptionMaxNodes: 3000   // 单个订阅最多允许的节点数
};

// 校验单次请求的资源限制，返回 null 表示通过，返回 Error 表示超限
function validateRequestLimits({ subscriptionUrls, remoteConfigSize, totalNodes, perSubCounts, limits = {} }) {
  const merged = { ...DEFAULT_REQUEST_LIMITS, ...limits };
  if (subscriptionUrls && subscriptionUrls.length > merged.maxSubscriptionUrls) {
    return new Error(`Too many subscription URLs: ${subscriptionUrls.length} > ${merged.maxSubscriptionUrls}`);
  }
  if (remoteConfigSize && remoteConfigSize > merged.maxRemoteConfigBytes) {
    return new Error(`Remote config too large: ${remoteConfigSize} > ${merged.maxRemoteConfigBytes} bytes`);
  }
  if (totalNodes && totalNodes > merged.maxTotalNodes) {
    return new Error(`Too many total nodes: ${totalNodes} > ${merged.maxTotalNodes}`);
  }
  if (perSubCounts) {
    for (const [url, count] of Object.entries(perSubCounts)) {
      if (count > merged.perSubscriptionMaxNodes) {
        return new Error(`Subscription returned too many nodes: ${count} > ${merged.perSubscriptionMaxNodes}`);
      }
    }
  }
  return null;
}

module.exports = {
  buildProfile,
  redactUrl,
  isAllowedUrl,
  safeFetchText,
  validateRequestLimits,
  DEFAULT_REQUEST_LIMITS,
  validateUrlSsrf,
  parseContent,
  parseVlessUri,
  parseVmessUri,
  parseTrojanUri,
  parseSsUri
};
