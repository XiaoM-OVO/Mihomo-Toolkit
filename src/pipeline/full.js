/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 全链路端到端构建流水线 (Builder Pipeline)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 订阅拉取与网络调度（HTTP 抓取、Stale 容灾兜底、并发解析、多订阅树状日志）
 * 2. 状态看板与聚合计算（流量汇总、到期预警、重置倒计时）
 * 3. 阶段编排：
 *    - 阶段 1: runPurePipeline (节点清洗、安全拦截、去重、裂变、地区识别、重命名)
 *    - 阶段 2: runToolkitPipeline (六维注册表、拓扑装配、分流规则、DNS与内核覆写、DAG剪枝)
 * 4. 简繁转换协调、内部私有字段脱敏、YAML 序列化与订阅头注入
 */

const yaml = require('yaml');
const { runCleanerPipeline } = require('./cleaner');
const { runProfilePipeline } = require('./profile');

const { parseContent, parseSubscriptionInfo, isExpiredNow } = require('../io/parsers');
const { generateInfoNodes } = require('../io/sub-info');
const { redactUrl } = require('../io/ssrf');
const { fetchNodes, resolveProxyUrl, subStaleCache, pruneSubStaleCache } = require('../io/fetcher');
const { validateRequestLimits } = require('../io/limits');
const {
  filterRawInfoNodes,
  extractResetText,
  aggregateSubscriptions,
  buildGlobalDashboardNodes,
  createFetchErrorNode
} = require('../strategy/dashboard');

// 简繁转换模块
let chineseConvert = {
  toSimplified: (t) => t,
  toTraditional: (t) => t,
  deepConvertStrings: (o) => o,
  isAvailable: () => false
};
try {
  chineseConvert = require('../chinese-convert');
} catch (e) {}

let BUILDER_VERSION = 'v1.7.0';
try {
  const pkg = require('../../package.json');
  if (pkg && pkg.version) BUILDER_VERSION = `v${pkg.version}`;
} catch (e) {}

// 本地内存 TTL 缓存
const profileCacheMap = new Map();

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
      type: options.type || userConfig.type || 'cleaner',
      convert: userConfig.enableChineseConvert,
      convertMode: userConfig.chineseConvertMode,
      redactLevel: userConfig.redactLevel,
      fetchProxyPort: userConfig.fetchProxyPort,
      fetchProxyStrategy: userConfig.fetchProxyStrategy,
      enableDashboard: userConfig.enableDashboard,
      expireAggregation: userConfig.expireAggregation
    });
  } catch (e) {
    return null;
  }
}

/**
 * 端到端全链路构建主函数
 */
async function buildProfile(userConfig = {}, options = {}) {
  const effectiveLogLevel = options.debug ? 'debug' : (userConfig.logLevel || 'info');
  const logger = createLogger('[Builder]', effectiveLogLevel);

  // 资源限制校验
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

  if (userConfig.enableChineseConvert && !isOpenccReady) {
    logger.warn('已配置 enableChineseConvert=true 但 opencc-js 依赖未就绪，已跳过简繁转换。执行: npm install opencc-js');
  }

  if (canConvert) {
    userConfig = chineseConvert.deepConvertStrings(userConfig, chineseConvert.toSimplified);
  }

  let redactLevel = userConfig.redactLevel || 'partial';
  const debug = options.debug || false;

  logger.log(`🔨 mihomo-toolkit-builder ${BUILDER_VERSION}`);

  // 启动概览
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
  const fetchRetry = typeof userConfig.fetchRetry === 'number' ? userConfig.fetchRetry : 2;
  const fetchTimeoutSec = typeof userConfig.fetchTimeout === 'number' ? userConfig.fetchTimeout : 15;
  const staleMaxAgeMs = (typeof userConfig.fetchStaleTtl === 'number' ? userConfig.fetchStaleTtl : 24) * 60 * 60 * 1000;
  let hasFailedSub = false;

  const enableDashboard = userConfig.enableDashboard !== false;
  const expireAggregation = userConfig.expireAggregation || 'min';
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

  if (userConfig.subscriptions && Array.isArray(userConfig.subscriptions) && userConfig.subscriptions.length > 0) {
    const fetchTasks = userConfig.subscriptions.map(async (sub) => {
      if (!isSubEnabled(sub)) {
        return { sub, rawResult: null, error: null, disabled: true };
      }
      if (!sub.url && !sub.uri) return { sub, rawResult: null, error: null };
      try {
        let rawResult;
        if (sub.uri) {
          rawResult = { content: sub.uri, subInfo: null };
        } else {
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
            if (!rawResult.content || (parseContent(rawResult.content).proxies || []).length === 0) {
              throw new Error('Subscription returned no nodes');
            }
          } catch (e) {
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

        if (sub.uri && sub.name && subProxies.length > 0) {
          subProxies[0].name = sub.name;
        }

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
          let bestTag = '';
          let maxCount = 0;
          for (const [t, c] of Object.entries(tagCounts)) {
            if (c > maxCount) { maxCount = c; bestTag = t; }
          }
          effectiveTag = bestTag;
          if (!effectiveTag && sub.url && sub.url.startsWith('http')) {
            try { effectiveTag = new URL(sub.url).hostname; } catch (e) {}
          }
          if (!effectiveTag) effectiveTag = '订阅';
        }

        const resetText = extractResetText(sub, subProxies);
        const rawCount = subProxies.length;
        subProxies = filterRawInfoNodes(subProxies, logger);
        const filteredCount = rawCount - subProxies.length;

        if (sub.tag) {
          subProxies.forEach(p => {
            if (!p._subTag) p._subTag = sub.tag;
          });
        }

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

        if ((userConfig.passthrough || userConfig.preserveRawConfig) && subConfig && typeof subConfig === 'object') {
          for (const [k, v] of Object.entries(subConfig)) {
            if (k !== 'proxies' && configData[k] === undefined) {
              configData[k] = v;
            }
          }
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
          try { effectiveTag = new URL(sub.url).hostname; } catch (err) {}
        }
        if (!effectiveTag) effectiveTag = '订阅';

        if (enableDashboard) {
          const failNode = createFetchErrorNode(effectiveTag, e.message);
          configData.proxies.push(failNode);
        }

        let shortMsg = e.message || '抓取失败';
        if (/fetch failed/i.test(shortMsg)) shortMsg = '网络连接失败';
        else if (/timeout/i.test(shortMsg)) shortMsg = '拉取超时';
        else if (/HTTP Error: (\d+)/i.test(shortMsg)) shortMsg = `HTTP ${shortMsg.match(/HTTP Error: (\d+)/i)[1]}`;
        else if (/no nodes/i.test(shortMsg)) shortMsg = '未解析到有效节点';

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

    const agg = aggregateSubscriptions(collectedSubInfos, { expireAggregation, logger });
    globalUpload = agg.globalUpload;
    globalDownload = agg.globalDownload;
    globalTotal = agg.globalTotal;
    globalExpire = agg.globalExpire;

    const activeSubsWithTraffic = collectedSubInfos.filter(s => !s.expired && s.total > 0);
    if (enableDashboard && activeSubsWithTraffic.length > 1 && globalTotal > 0) {
      const topNodes = buildGlobalDashboardNodes({
        globalUpload,
        globalDownload,
        globalTotal,
        globalExpire,
        expireAggregation
      });
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
    recordSubInfo(rawResult.subInfo, '');
    const agg = aggregateSubscriptions(collectedSubInfos, { expireAggregation, logger });
    globalUpload = agg.globalUpload;
    globalDownload = agg.globalDownload;
    globalTotal = agg.globalTotal;
    globalExpire = agg.globalExpire;

    configData = parseContent(rawResult.content);
    const nodeCount = configData.proxies ? configData.proxies.length : 0;
    logger.log(`📡 节点解析完成: ${nodeCount} 个节点`);
    if (enableDashboard) {
      const { nodes: synthNodes } = generateInfoNodes(rawResult.subInfo, '');
      if (synthNodes.length > 0 && configData.proxies) {
        configData.proxies.unshift(...synthNodes);
      }
    }
  } else {
    throw new Error('No URL or subscriptions provided.');
  }

  // 配置协调
  let cleanerUserConfig = { ...userConfig, ...(userConfig.cleanerConfig || userConfig.pureConfig || {}) };
  let profileUserConfig = { ...userConfig, ...(userConfig.profileConfig || userConfig.toolkitConfig || {}) };

  if (hasInjectedTag) {
    cleanerUserConfig.enableAirportTag = true;
    profileUserConfig.enableAirportTag = true;
  }

  let targetType = (options.type || userConfig.outputMode || userConfig.type || 'config').toLowerCase();
  if (targetType === 'full') targetType = 'config';
  if (targetType === 'cleaner' || targetType === 'pure') targetType = 'nodes';
  if (targetType === 'meta' || targetType === 'audit') targetType = 'report';

  const isPassthrough = !!(userConfig.passthrough || userConfig.preserveRawConfig);

  if (targetType === 'config' && !isPassthrough) {
    profileUserConfig.enableNodeRename = (userConfig.enableNodeRename !== undefined)
      ? userConfig.enableNodeRename
      : false;
    cleanerUserConfig.showFeatureIcon = false;
    cleanerUserConfig.removeInfoNodes = userConfig.removeInfoNodes ?? true;
  }

  const whitelist = userConfig.whitelistKeywords || [];
  const specialRules = userConfig.specialNodeRules || [];
  if (whitelist.length > 0) {
    cleanerUserConfig.whitelistKeywords = [...new Set([...(cleanerUserConfig.whitelistKeywords || []), ...whitelist])];
    profileUserConfig.whitelistKeywords = [...new Set([...(profileUserConfig.whitelistKeywords || []), ...whitelist])];
  }
  if (specialRules.length > 0) {
    cleanerUserConfig.specialNodeRules = [...new Set([...(cleanerUserConfig.specialNodeRules || []), ...specialRules])];
    profileUserConfig.specialNodeRules = [...new Set([...(profileUserConfig.specialNodeRules || []), ...specialRules])];
  }

  let finalProxies = configData.proxies;
  let result = null;

  if (canConvert) {
    configData.proxies = configData.proxies.map(proxy => ({
      ...proxy,
      name: chineseConvert.toSimplified(proxy.name)
    }));
  }

  // 阶段 1：节点清洗 (nodes / config / report 均执行)
  if (targetType === 'config' && !isPassthrough) logger.log('🔄 阶段 1/2: cleaner 节点清洗');
  else logger.log('🔄 阶段: cleaner 节点清洗');

  if (targetType === 'report' || options.report || options.meta || userConfig.outputMode === 'object') {
    cleanerUserConfig.outputMode = 'object';
  }

  result = await runCleanerPipeline(configData.proxies, cleanerUserConfig);
  finalProxies = Array.isArray(result) ? result : result.proxies;

  let outputData;
  if (targetType === 'nodes') {
    // 纯节点模式契约：仅输出干净的 proxies 数组
    outputData = { proxies: finalProxies };
    logger.log(`✅ 清洗完成: ${finalProxies.length} 个节点`);
  } else if (targetType === 'config' && isPassthrough) {
    // 完整配置透传模式：保留原配置顶层键，仅替换洗白后的 proxies
    outputData = { ...configData, proxies: finalProxies };
    logger.log(`✅ 透传完成: 继承原配置并替换为 ${finalProxies.length} 个干净节点`);
  } else {
    // 完整配置全新构建模式
    configData.proxies = finalProxies;
    outputData = configData;
    logger.log('🔄 阶段 2/2: profile 策略组构建');
    outputData = runProfilePipeline(outputData, profileUserConfig);
  }

  if (canConvert) {
    const modeLabel = userConfig.chineseConvertMode === 's2t' ? '繁体' : '简体';
    logger.log(`🔤 简繁转换: 输出 ${modeLabel}`);
    const convertFn = userConfig.chineseConvertMode === 's2t' ? chineseConvert.toTraditional : chineseConvert.toSimplified;
    const nameMap = {};

    for (const proxy of outputData.proxies) {
      const oldName = proxy.name;
      proxy.name = convertFn(proxy.name);
      if (oldName !== proxy.name) nameMap[oldName] = proxy.name;
    }

    if (outputData['proxy-groups']) {
      for (const group of outputData['proxy-groups']) {
        const oldName = group.name;
        group.name = convertFn(group.name);
        if (oldName !== group.name) nameMap[oldName] = group.name;
        if (group.proxies) group.proxies = group.proxies.map(p => convertFn(p));
        if (group.use) group.use = group.use.map(u => convertFn(u));
      }
    }

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

  if (targetType === 'config' && !isPassthrough) {
    const groups = outputData['proxy-groups'] || [];
    const proxies = outputData.proxies || [];
    const featureSwitches = [
      profileUserConfig.enableAI && 'AI', profileUserConfig.enableStreaming && '流媒体',
      profileUserConfig.enableGame && '游戏', profileUserConfig.enableTelegram && 'TG',
      profileUserConfig.enableGitHub && 'GitHub', profileUserConfig.enableScholar && 'Scholar',
      profileUserConfig.enableSystemServices && '系统', profileUserConfig.enableDomesticGroup && '中国分流',
      profileUserConfig.enableAdBlock && '广告拦截'
    ].filter(Boolean);
    logger.log(`✅ 构建完成: ${proxies.length} 个节点, ${groups.length} 个策略组` +
      (featureSwitches.length > 0 ? ` | ${featureSwitches.join(' ')}` : ''));
  }

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
    proxies: finalProxies,
    outputData,
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

module.exports = {
  buildProfile,
  profileCacheMap,
  createLogger
};
