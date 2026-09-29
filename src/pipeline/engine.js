/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 全流程总调度引擎 (Workflow / Pipeline Engine)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 唯一掌握流水线生命周期的总调度器
 * 2. 调度 IO 抓取 ➔ 调度 nodes 清洗 ➔ 根据交付目标 (Checkpoint) 截断刹车
 * 3. 内存级 LRU-TTL 缓存管理与配额防御
 */

const yaml = require('yaml');
const { runNodesPipeline } = require('./nodes');
const { runConfigPipeline } = require('./config');
const { buildAuditReport } = require('./report');
const { validateRequestLimits } = require('../io/limits');
const { profileCache } = require('../io/cache');
const { processSubscriptionSources, isSubEnabled } = require('../io/sub-processor');
const { chineseConvert } = require('../core/chinese-sync');
const dashboard = require('../strategy/dashboard');

const { createLogger } = require('../core/logger');

let BUILDER_VERSION = 'v1.7.0';
try {
  const pkg = require('../../package.json');
  if (pkg && pkg.version) BUILDER_VERSION = `v${pkg.version}`;
} catch (e) {}

function normalizeTargetType(rawType) {
  let targetType = String(rawType || 'config').toLowerCase();
  if (targetType === 'full') targetType = 'config';
  if (targetType === 'cleaner' || targetType === 'pure') targetType = 'nodes';
  if (targetType === 'meta' || targetType === 'audit') targetType = 'report';
  return targetType;
}

function getCacheKey(userConfig, options) {
  try {
    const subs = (userConfig.subscriptions || []).filter(isSubEnabled).map(s => ({ url: s.url, uri: s.uri, tag: s.tag, proxy: s.proxy }));
    const rawType = options.type || userConfig.outputMode || userConfig.type || 'config';
    return JSON.stringify({
      subs,
      url: options.url,
      type: normalizeTargetType(rawType),
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
 * 全流程流水线总调度入口 (Pipeline Engine)
 * @param {object} [userConfig={}] 用户全局配置
 * @param {object} [options={}] CLI 或运行时覆盖参数
 * @returns {Promise<object>} 构建交付结果
 */
async function runPipelineEngine(userConfig = {}, options = {}) {
  const effectiveLogLevel = options.debug ? 'debug' : (userConfig.logLevel || 'info');
  const logger = (options.logger && typeof options.logger.child === 'function')
    ? options.logger
    : createLogger({
        tag: 'CLI',
        level: effectiveLogLevel,
        colors: options.colors,
        timestamps: options.timestamps !== false
      });

  const ioLogger = typeof logger.child === 'function' ? logger.child('IO') : logger;
  const cleanLogger = typeof logger.child === 'function' ? logger.child('Cleaner') : logger;
  const stratLogger = typeof logger.child === 'function' ? logger.child('Strategy') : logger;

  // 1. 交付形态解析: config | nodes | report
  const targetType = normalizeTargetType(options.type || userConfig.outputMode || userConfig.type || 'config');

  // 2. 资源安全配额防御
  const securityLimits = userConfig.security || {};
  const limitErr = validateRequestLimits({
    subscriptionUrls: (userConfig.subscriptions || []).filter(isSubEnabled).map(s => s.url).filter(Boolean),
    limits: securityLimits
  });
  if (limitErr) throw limitErr;

  // 3. 内存缓存检查 (LRU-TTL)
  const enableCache = userConfig.enableCache !== false && !options.noCache;
  const cacheTtlMs = (userConfig.cacheTtl || 300) * 1000;
  const cacheKey = getCacheKey(userConfig, options);

  if (enableCache && cacheKey) {
    const cached = profileCache.get(cacheKey, cacheTtlMs);
    if (cached) {
      logger.info(`⚡ 命中本地内存缓存 (${cached.remainingSec}s 后过期)，直接响应缓存数据`);
      return cached.result;
    }
  }

  // 4. 简繁转换预处理
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

  // 5. Step 1: 订阅抓取与预处理网关 (IO 阶段)
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
    logger: ioLogger,
    dashboard
  });

  // 6. Step 2: 节点标准化清洗与打标 (Core 纯算法阶段)
  const nodeConfig = { ...userConfig };
  if (hasInjectedTag) nodeConfig.enableAirportTag = true;

  const {
    proxies: cleanProxies,
    classifiedNodes,
    meta
  } = await runNodesPipeline(configData.proxies, {
    ...nodeConfig,
    withClassified: true,
    logger: cleanLogger
  });

  const stats = meta?.stats;
  if (stats) {
    const details = [];
    if (stats.dedupeCount > 0) details.push(`去重: ${stats.dedupeCount}`);
    if (stats.discardedCount > 0) details.push(`丢弃: ${stats.discardedCount}`);
    if (stats.fissionCount > 0) details.push(`裂变: ${stats.fissionCount}`);
    const detailStr = details.length > 0 ? ` (${details.join(' | ')})` : '';
    cleanLogger.info(`🧹 节点清洗完成: ${stats.total} 输入 ➔ ${cleanProxies.length} 有效${detailStr}`);
  }

  // ─── 🛑 Checkpoint 1: 交付纯净节点 (nodes 模式早退截断) ───
  if (targetType === 'nodes') {
    const nodesResult = {
      yamlStr: yaml.stringify({ proxies: cleanProxies }),
      proxies: cleanProxies,
      meta,
      outputData: { proxies: cleanProxies }
    };
    if (enableCache && cacheKey && !hasFailedSub) {
      profileCache.set(cacheKey, nodesResult);
    }
    return nodesResult;
  }

  // ─── 🛑 Checkpoint 2: 交付审计报告 (report 模式早退截断) ───
  if (targetType === 'report') {
    const reportData = buildAuditReport(meta, cleanProxies);
    const reportResult = {
      yamlStr: JSON.stringify(reportData, null, 2),
      proxies: cleanProxies,
      meta,
      report: reportData
    };
    if (enableCache && cacheKey && !hasFailedSub) {
      profileCache.set(cacheKey, reportResult);
    }
    return reportResult;
  }

  // ─── 🛑 Checkpoint 3: 交付完整配置 (config 模式跑完全程) ───
  const { yamlStr, outputData, userInfo } = runConfigPipeline({
    configData,
    cleanProxies,
    classifiedNodes,
    collectedSubInfos,
    userConfig,
    logger: stratLogger
  });

  const configResult = {
    yamlStr,
    meta,
    proxies: cleanProxies,
    outputData,
    userInfo
  };

  // 7. 写入 LRU 缓存
  if (enableCache && cacheKey && !hasFailedSub) {
    profileCache.set(cacheKey, configResult);
  }

  return configResult;
}

module.exports = {
  runPipelineEngine,
  buildProfile: runPipelineEngine,
  createLogger
};
