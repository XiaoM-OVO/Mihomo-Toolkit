/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 全流程总调度引擎 (Workflow / Pipeline Engine)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 唯一掌握流水线生命周期的总调度器
 * 2. 调度 IO 抓取 ➔ 调度 nodes 清洗 ➔ 根据交付目标 (Checkpoint) 截断刹车
 * 3. 内存级 LRU-TTL 缓存管理与配额防御
 */

const crypto = require('crypto');
const yaml = require('yaml');
const stableStringify = require('fast-json-stable-stringify');
const { runNodesPipeline } = require('./nodes');
const { runConfigPipeline } = require('./config');
const { buildAuditReport } = require('./report');
const { validateRequestLimits } = require('../io/limits');
const { profileCache } = require('../io/cache');
const { processSubscriptionSources, isSubEnabled } = require('../io/sub-processor');
const { chineseConvert } = require('../core/chinese-sync');
const { computeMountDigest } = require('../config/mounts');
const { expandIncludes } = require('../config/include');
const dashboard = require('../strategy/dashboard');

const { createLogger } = require('../core/logger');

function normalizeOutputMode(rawMode) {
  return String(rawMode || 'config').toLowerCase();
}

/**
 * 缓存键结构版本号：键的组成方式发生不兼容变化时递增，避免历史条目被误命中。
 */
const CACHE_KEY_VERSION = 'v2';

/**
 * 除 userConfig 之外，仅这些 CLI / 运行时选项会影响产物内容
 * （options.debug / silent / logger / colors 等只影响日志；options.mode 经 normalizeOutputMode
 * 归一化后单独纳入，故此处不重复计入原始字面量）
 */
const CACHE_KEY_OPTION_KEYS = ['url'];

/**
 * 计算构建产物缓存键 (纯函数)
 *
 * 设计要点：配置主体整体参与哈希，而非手工枚举字段。此前仅摘取十余个字段，
 * 导致 hosts / nameserver-policy / dnsServer / dnsListen / enablePipeline /
 * assetClosure 等未登记配置项变化时命中旧产物（多租户 ?config= 场景下即为脏读）。
 * 结构性纳入后，任何新增配置开关都会自动进入缓存键。
 *
 * @param {object} [userConfig={}] 用户全局配置
 * @param {object} [options={}] CLI / 运行时选项
 * @returns {string|null} 定长哈希键；无法确定性序列化时返回 null（放弃缓存，宁可不缓存也不脏读）
 */
function getCacheKey(userConfig = {}, options = {}) {
  try {
    userConfig = userConfig || {};
    options = options || {};
    const rawMode = options.mode || userConfig.outputMode || 'config';
    const outputMode = normalizeOutputMode(rawMode);

    // 订阅清单：仅纳入生效订阅的完整描述（retry / proxy 等字段同样影响抓取与产物），
    // 已禁用订阅的变化不应破坏缓存
    const subs = (userConfig.subscriptions || []).filter(isSubEnabled);

    // 配置主体：剔除 subscriptions（已单独归一化）与交付形态原始字面量（已归一化计入 outputMode），
    // 其余全部纳入
    const configRest = { ...userConfig };
    delete configRest.subscriptions;
    delete configRest.outputMode;

    const optionSubset = {};
    for (const key of CACHE_KEY_OPTION_KEYS) {
      if (options[key] !== undefined) optionSubset[key] = options[key];
    }

    // 外挂配置文件的内容指纹：配置主体里只有「路径字符串」，改动被挂载的文件
    // 不会改变键值，于是在 cacheTtl 内一直命中旧产物（文件是对的、产物是旧的）。
    // 带上内容摘要后，改文件即刻产生新键。
    const mounts = computeMountDigest(configRest);

    const canonical = stableStringify({
      v: CACHE_KEY_VERSION,
      outputMode,
      options: optionSubset,
      subs,
      mounts,
      config: configRest
    });
    if (!canonical) return null;

    // 哈希后作为键：既保证定长，也避免订阅 URL / Token 等敏感信息以明文形式驻留内存键
    const digest = crypto.createHash('sha256').update(canonical).digest('hex');
    return `profile:${CACHE_KEY_VERSION}:${digest}`;
  } catch {
    // 无法确定性序列化（如循环引用）时放弃缓存
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
  // 入口统一展开 include 片段（server / SDK 等未在装载现场展开的调用方兜底）。
  // 合并结果刻意保留 `include` 键（缓存指纹 computeMountDigest 依赖它），因此再次展开
  // 会重复读取片段文件但结果不变 —— 对 cli.js 已展开过的配置是幂等的。
  // 相对路径以 cwd 为基准：配置文件现场（CLI / server）已把 include 转为绝对路径，
  // 这里只兜底处理「SDK 直接传对象且写相对路径」的场景。
  userConfig = expandIncludes(userConfig || {}, process.cwd());

  const effectiveLogLevel = options.debug
    ? 'debug'
    : (options.silent || options.quiet ? 'silent' : (options.logLevel || userConfig.logLevel || 'info'));
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
  const outputMode = normalizeOutputMode(options.mode || userConfig.outputMode || 'config');

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
    if (options.forceRefresh) {
      logger.info('🔄 触发强制刷新 (forceRefresh=true)，绕过本地缓存直接拉取并构建');
    } else {
      const cached = profileCache.get(cacheKey, cacheTtlMs);
      if (cached) {
        logger.info(`⚡ 命中本地内存缓存 (${cached.remainingSec}s 后过期)，直接响应缓存数据`);
        return cached.result;
      }
    }
  }

  // 4. 简繁转换预处理
  const isOpenccReady = !!(chineseConvert.isAvailable && chineseConvert.isAvailable());
  if (userConfig.enableChineseConvert) {
    if (!isOpenccReady) {
      logger.warn('⚠️ 已启用简繁转换 (enableChineseConvert=true)，但可选依赖 opencc-js 未就绪，已跳过。执行: npm install opencc-js');
    } else {
      const modeText = userConfig.chineseConvertMode === 's2t' ? '简体 ➔ 繁体' : '繁体 ➔ 简体';
      if (logger.isLevelEnabled('debug')) {
        logger.debug(`🔤 简繁转换就绪: opencc-js (${modeText})`);
      }
      const convertFn = userConfig.chineseConvertMode === 's2t'
        ? chineseConvert.toTraditional
        : chineseConvert.toSimplified;
      userConfig = chineseConvert.deepConvertStrings(userConfig, convertFn);
    }
  } else if (logger.isLevelEnabled('debug')) {
    logger.debug(`🔤 简繁转换插件: opencc-js ${isOpenccReady ? '已安装' : '未安装(可选)'}`);
  }

  const redactLevel = userConfig.redactLevel || 'partial';
  const isProd = (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production') || !!options.production;
  if (redactLevel === 'off' && isProd) {
    throw new Error('[Security] redactLevel=off 不允许在生产环境使用！');
  }

  // 5. Step 1: 订阅抓取与预处理网关 (IO 阶段)
  const {
    sourceSkeleton,
    collectedSubInfos,
    hasFailedSub,
    hasInjectedTag,
    perSubCounts
  } = await processSubscriptionSources({
    subscriptions: userConfig.subscriptions,
    url: options.url,
    userConfig,
    options,
    logger: ioLogger,
    dashboard,
    outputMode
  });

  // 5.1 资源配额二次校验：节点总量与单订阅节点量
  //     （limits.js 早已定义 maxTotalNodes / perSubscriptionMaxNodes，但此前无任何调用方传参）
  const nodeLimitErr = validateRequestLimits({
    totalNodes: (sourceSkeleton.proxies || []).length,
    perSubCounts,
    limits: securityLimits
  });
  if (nodeLimitErr) throw nodeLimitErr;

  // 6. Step 2: 节点标准化清洗与打标 (Core 纯算法阶段)
  const nodeConfig = { ...userConfig };
  if (hasInjectedTag) nodeConfig.enableAirportTag = true;

  const {
    proxies: cleanProxies,
    classifiedNodes,
    meta
  } = await runNodesPipeline(sourceSkeleton.proxies, {
    ...nodeConfig,
    withClassified: true,
    logger: cleanLogger
  });

  const stats = meta?.stats;
  if (stats) {
    const details = [];
    if (stats.dedupeCount > 0) details.push(`去重: ${stats.dedupeCount}`);
    if (stats.discardedCount > 0) details.push(`过滤: ${stats.discardedCount}`);
    if (stats.fissionCount > 0) details.push(`裂变: ${stats.fissionCount}`);
    const detailStr = details.length > 0 ? ` (${details.join(' | ')})` : '';
    cleanLogger.info(`🧹 节点清洗完成: ${stats.total} 输入 ➔ ${cleanProxies.length} 有效${detailStr}`);
  }

  // ─── 🛑 Checkpoint 1: 交付纯净节点 (nodes 模式早退截断) ───
  if (outputMode === 'nodes') {
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
  if (outputMode === 'report') {
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
  const { yamlStr, outputData, userInfo, invariantViolations } = runConfigPipeline({
    sourceSkeleton,
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
    invariantViolations,
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
  buildProfileCacheKey: getCacheKey,
  normalizeOutputMode,
  createLogger
};
