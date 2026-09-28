/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 全链路端到端配置构建流水线 (Config Pipeline)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 负责串联订阅拉取 (sub-processor)、内存缓存 (cache)、配置协调 (inherit)
 * 2. 阶段 1: runNodesPipeline 纯节点清洗与打标
 * 3. 阶段 2: runStrategyPipeline 策略组拓扑与分流规则装配
 * 4. 简繁同步 (chinese-sync)、内部私有字段脱敏、YAML 序列化与订阅头注入
 */

const yaml = require('yaml');
const { runNodesPipeline } = require('./nodes');
const { runStrategyPipeline } = require('./strategy');
const { validateRequestLimits } = require('../io/limits');
const { profileCache } = require('../io/cache');
const { processSubscriptionSources, isSubEnabled } = require('../io/sub-processor');
const { aggregateSubscriptions, buildGlobalDashboardNodes } = require('../strategy/dashboard');
const { syncChineseConvert, chineseConvert } = require('../core/chinese-sync');
const { coordinateConfigs } = require('../config/inherit');

let BUILDER_VERSION = 'v1.7.0';
try {
  const pkg = require('../../package.json');
  if (pkg && pkg.version) BUILDER_VERSION = `v${pkg.version}`;
} catch (e) {}

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

function getCacheKey(userConfig, options) {
  try {
    const subs = (userConfig.subscriptions || []).filter(isSubEnabled).map(s => ({ url: s.url, uri: s.uri, tag: s.tag, proxy: s.proxy }));
    return JSON.stringify({
      subs,
      url: options.url,
      type: options.type || userConfig.outputMode || userConfig.type || 'config',
      convert: userConfig.enableChineseConvert,
      convertMode: userConfig.chineseConvertMode,
      redactLevel: userConfig.redactLevel,
      fetchProxyPort: userConfig.fetchProxyPort,
      fetchProxyStrategy: userConfig.fetchProxyStrategy,
      enableDashboard: userConfig.enableDashboard,
      expireAggregation: userConfig.expireAggregation,
      passthrough: userConfig.passthrough || userConfig.preserveRawConfig
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

  // 1. 资源配额校验
  const securityLimits = userConfig.security || {};
  const limitErr = validateRequestLimits({
    subscriptionUrls: (userConfig.subscriptions || []).filter(isSubEnabled).map(s => s.url).filter(Boolean),
    limits: securityLimits
  });
  if (limitErr) throw limitErr;

  // 2. 检查内存缓存 (LRU TTL)
  const enableCache = userConfig.enableCache !== false && !options.noCache;
  const cacheTtlMs = (userConfig.cacheTtl || 300) * 1000;
  const cacheKey = getCacheKey(userConfig, options);

  if (enableCache && cacheKey) {
    const cached = profileCache.get(cacheKey, cacheTtlMs);
    if (cached) {
      logger.log(`⚡ 命中本地内存缓存 (${cached.remainingSec}s 后过期)，直接响应缓存数据`);
      return cached.result;
    }
  }

  // 3. 简繁转换入口协调
  const isOpenccReady = !!(chineseConvert.isAvailable && chineseConvert.isAvailable());
  if (userConfig.enableChineseConvert && !isOpenccReady) {
    logger.warn('已配置 enableChineseConvert=true 但 opencc-js 依赖未就绪，已跳过简繁转换。执行: npm install opencc-js');
  }
  if (userConfig.enableChineseConvert && isOpenccReady) {
    userConfig = chineseConvert.deepConvertStrings(userConfig, chineseConvert.toSimplified);
  }

  const redactLevel = userConfig.redactLevel || 'partial';
  const isProd = (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production') || !!options.production;
  if (redactLevel === 'off' && isProd) {
    throw new Error('[Security] redactLevel=off 不允许在生产环境使用！');
  }

  logger.log(`🔨 mihomo-toolkit-builder ${BUILDER_VERSION}`);

  // 4. 订阅抓取与预处理 (抽取自 sub-processor)
  const {
    configData,
    collectedSubInfos,
    hasFailedSub,
    hasInjectedTag
  } = await processSubscriptionSources({
    subscriptions: userConfig.subscriptions,
    url: options.url,
    userConfig,
    options,
    logger
  });

  // 5. 汇总多订阅流量与到期时间
  const expireAggregation = userConfig.expireAggregation || 'min';
  const {
    globalUpload,
    globalDownload,
    globalTotal,
    globalExpire
  } = aggregateSubscriptions(collectedSubInfos, { expireAggregation, logger });

  // 仅在多订阅且至少 2 个有流量的有效源时，在最顶部注入一组「全局总额」配对节点
  const activeSubsWithTraffic = collectedSubInfos.filter(s => !s.expired && s.total > 0);
  if (userConfig.enableDashboard !== false && activeSubsWithTraffic.length > 1 && globalTotal > 0) {
    const topNodes = buildGlobalDashboardNodes({
      globalUpload,
      globalDownload,
      globalTotal,
      globalExpire,
      expireAggregation
    });
    configData.proxies.unshift(...topNodes);
  }

  // 6. 配置继承与模式协调 (抽取自 inherit)
  const {
    cleanerConfig,
    strategyConfig,
    targetType,
    isPassthrough
  } = coordinateConfigs(userConfig, options, { hasInjectedTag });

  // 7. 阶段 1：节点纯净清洗与打标
  if (targetType === 'config' && !isPassthrough) logger.log('🔄 阶段 1/2: nodes 节点清洗');
  else logger.log('🔄 阶段: nodes 节点清洗');

  if (targetType === 'report' || options.report || options.meta || userConfig.outputMode === 'object') {
    cleanerConfig.outputMode = 'object';
  }

  const nodesResult = await runNodesPipeline(configData.proxies, cleanerConfig);
  const finalProxies = Array.isArray(nodesResult) ? nodesResult : nodesResult.proxies;

  // 8. 阶段 2：交付物形态装配
  let outputData;
  if (targetType === 'nodes') {
    outputData = { proxies: finalProxies };
    logger.log(`✅ 清洗完成: ${finalProxies.length} 个节点`);
  } else if (targetType === 'config' && isPassthrough) {
    outputData = { ...configData, proxies: finalProxies };
    logger.log(`✅ 透传完成: 继承原配置并替换为 ${finalProxies.length} 个干净节点`);
  } else {
    configData.proxies = finalProxies;
    outputData = configData;
    logger.log('🔄 阶段 2/2: strategy 策略组构建');
    outputData = runStrategyPipeline(outputData, strategyConfig);
  }

  // 9. 简繁中文全链路四路同步 (抽取自 chinese-sync)
  outputData = syncChineseConvert(outputData, userConfig, logger);

  // 10. 构建摘要
  if (targetType === 'config' && !isPassthrough) {
    const groups = outputData['proxy-groups'] || [];
    const proxies = outputData.proxies || [];
    const featureSwitches = [
      strategyConfig.enableAI && 'AI', strategyConfig.enableStreaming && '流媒体',
      strategyConfig.enableGame && '游戏', strategyConfig.enableTelegram && 'TG',
      strategyConfig.enableGitHub && 'GitHub', strategyConfig.enableScholar && 'Scholar',
      strategyConfig.enableSystemServices && '系统', strategyConfig.enableDomesticGroup && '中国分流',
      strategyConfig.enableAdBlock && '广告拦截'
    ].filter(Boolean);
    logger.log(`✅ 构建完成: ${proxies.length} 个节点, ${groups.length} 个策略组` +
      (featureSwitches.length > 0 ? ` | ${featureSwitches.join(' ')}` : ''));
  }

  // 移除内部私有字段（_ 前缀）
  if (Array.isArray(outputData.proxies)) {
    for (const p of outputData.proxies) {
      if (p && typeof p === 'object') {
        for (const key of Object.keys(p)) {
          if (key.startsWith('_')) delete p[key];
        }
      }
    }
  }

  // 11. YAML 序列化与订阅头注入
  let yamlStr = yaml.stringify(outputData);
  if (globalTotal > 0 || globalExpire > 0) {
    yamlStr = `# subscription-userinfo: upload=${globalUpload}; download=${globalDownload}; total=${globalTotal}; expire=${globalExpire}\n` +
              `# profile-web-page-url: https://github.com/mihomo-toolkit\n` +
              `# upload=${globalUpload}; download=${globalDownload}; total=${globalTotal}; expire=${globalExpire}\n` +
              yamlStr;
  }

  const profileResult = {
    yamlStr,
    meta: nodesResult && !Array.isArray(nodesResult) ? nodesResult.meta : null,
    proxies: finalProxies,
    outputData,
    userInfo: {
      upload: globalUpload,
      download: globalDownload,
      total: globalTotal,
      expire: globalExpire
    }
  };

  // 12. 写入 LRU 缓存（失败时跳过）
  if (enableCache && cacheKey && !hasFailedSub) {
    profileCache.set(cacheKey, profileResult);
  }

  return profileResult;
}

module.exports = {
  runConfigPipeline: buildProfile,
  runFullPipeline: buildProfile,
  buildProfile,
  createLogger
};
