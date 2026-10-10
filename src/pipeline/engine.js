/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 全流程总调度引擎 (Workflow / Pipeline Engine)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 唯一掌握流水线生命周期的总调度器
 * 2. 调度 IO 抓取 ➔ 调度 nodes 清洗 ➔ 根据交付目标 (Checkpoint) 截断刹车
 * 3. 内存级 Profile SWR 缓存状态机、Single-Flight 任务合并与时序代际保护
 */

const crypto = require('crypto');
const yaml = require('yaml');
const stableStringify = require('fast-json-stable-stringify');
const { runNodesPipeline } = require('./nodes');
const { runConfigPipeline } = require('./config');
const { buildAuditReport } = require('./report');
const { validateRequestLimits } = require('../io/limits');
const { profileCache, normalizeCacheDurations } = require('../io/cache');
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
 * 安全提取异常的错误消息字符串，防止非 Error 对象（如 null, undefined, string, plain object）
 * 在读取 .message 时二次抛出 TypeError
 * @param {any} err
 * @returns {string}
 */
function safeErrorMessage(err) {
  if (err instanceof Error) {
    return err.message || String(err);
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err && typeof err === 'object') {
    try {
      return err.message ? String(err.message) : JSON.stringify(err);
    } catch (_) {
      return String(err);
    }
  }
  return String(err);
}

/**
 * 缓存键结构版本号：键的组成方式发生不兼容变化时递增，避免历史条目被误命中。
 */
const CACHE_KEY_VERSION = 'v2';

/**
 * 除 userConfig 之外，仅这些 CLI / 运行时选项会影响产物内容
 * （options.debug / silent / logger / colors / onCacheStatus 等只影响行为与日志；
 * options.mode 经 normalizeOutputMode 归一化后单独纳入，故此处不重复计入原始字面量）
 */
const CACHE_KEY_OPTION_KEYS = ['url'];

/**
 * 计算构建产物缓存键 (纯函数)
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

    // 订阅清单：仅纳入生效订阅的完整描述
    const subs = (userConfig.subscriptions || []).filter(isSubEnabled);

    // 配置主体：剔除 subscriptions 与 outputMode
    const configRest = { ...userConfig };
    delete configRest.subscriptions;
    delete configRest.outputMode;

    const optionSubset = {};
    for (const key of CACHE_KEY_OPTION_KEYS) {
      if (options[key] !== undefined) optionSubset[key] = options[key];
    }

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

    const digest = crypto.createHash('sha256').update(canonical).digest('hex');
    return `profile:${CACHE_KEY_VERSION}:${digest}`;
  } catch {
    return null;
  }
}

// ─── Single-Flight 并发任务表 ────────────────────────────────────────────────
// 严格区分普通构建任务与强制构建任务：
// normalFlights: Map<cacheKey, Promise<object>>  普通构建单飞表
// forceFlights:  Map<cacheKey, Promise<object>>  强制穿透构建单飞表
const normalFlights = new Map();
const forceFlights = new Map();

// ─── 后台刷新失败退避表 ──────────────────────────────────────────────────────
// revalidateBackoffs: Map<cacheKey, { until: number, failures: number }>
// 仅针对后台 Revalidate 构建任务（options.isRevalidating: true），当其抛出异常或
// 因 hasFailedSub 未成功发布时记录退避，防止连续回源风暴。
const revalidateBackoffs = new Map();
const BACKOFF_MAX_ENTRIES = 200;
const INITIAL_BACKOFF_MS = 10000; // 首次失败退避 10 秒
const MAX_BACKOFF_MS = 60000;     // 最大退避 60 秒

function recordRevalidateFailure(cacheKey) {
  if (!cacheKey) return;
  const now = Date.now();
  const prev = revalidateBackoffs.get(cacheKey) || { failures: 0, until: 0 };
  const failures = prev.failures + 1;
  const delayMs = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, failures - 1), MAX_BACKOFF_MS);
  
  if (revalidateBackoffs.size >= BACKOFF_MAX_ENTRIES && !revalidateBackoffs.has(cacheKey)) {
    const oldestKey = revalidateBackoffs.keys().next().value;
    revalidateBackoffs.delete(oldestKey);
  }

  revalidateBackoffs.set(cacheKey, {
    failures,
    until: now + delayMs
  });
}

function clearRevalidateFailure(cacheKey) {
  if (cacheKey) revalidateBackoffs.delete(cacheKey);
}

function isInRevalidateBackoff(cacheKey) {
  if (!cacheKey || !revalidateBackoffs.has(cacheKey)) return false;
  const entry = revalidateBackoffs.get(cacheKey);
  // 保留 entry 记录（保持 failures 累积计数），仅判定当前时间戳是否在退避期内
  return Date.now() < entry.until;
}

/**
 * 实际流水线执行函数 (内部核心工作单元)
 * 必须在开始异步工作前由调用方分配 generation
 */
async function executeBuildPipeline({
  userConfig,
  options,
  logger,
  cacheKey,
  enableCache,
  generation
}) {
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

  // 3. 简繁转换预处理
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

  // 4. Step 1: 订阅抓取与预处理网关 (IO 阶段)
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

  // 4.1 资源配额二次校验：节点总量与单订阅节点量
  const nodeLimitErr = validateRequestLimits({
    totalNodes: (sourceSkeleton.proxies || []).length,
    perSubCounts,
    limits: securityLimits
  });
  if (nodeLimitErr) throw nodeLimitErr;

  // 5. Step 2: 节点标准化清洗与打标 (Core 纯算法阶段)
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
    let published = false;
    if (enableCache && cacheKey && !hasFailedSub) {
      published = profileCache.set(cacheKey, nodesResult, { generation }) === true;
    }
    return { result: nodesResult, hasFailedSub, published };
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
    let published = false;
    if (enableCache && cacheKey && !hasFailedSub) {
      published = profileCache.set(cacheKey, reportResult, { generation }) === true;
    }
    return { result: reportResult, hasFailedSub, published };
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

  // 写入 LRU 缓存 (严格代际防护与 hasFailedSub 保护)
  let published = false;
  if (enableCache && cacheKey && !hasFailedSub) {
    published = profileCache.set(cacheKey, configResult, { generation }) === true;
  }

  return { result: configResult, hasFailedSub, published };
}

/**
 * 触发 Single-Flight 封装的实际构建任务
 * @param {object} ctx
 * @returns {Promise<object>} 返回最终纯净 result
 */
async function launchSingleFlightBuild(ctx) {
  const { cacheKey, isForce, enableCache, options = {} } = ctx;
  const isRevalidating = !!options.isRevalidating;

  // 不可缓存或未生成有效 key 时不进 Single-Flight 任务表，独立执行
  if (!enableCache || !cacheKey) {
    const generation = profileCache.nextGeneration();
    return executeBuildPipeline({ ...ctx, generation })
      .then((outcome) => {
        if (typeof options.onBuildOutcome === 'function') {
          try {
            options.onBuildOutcome({
              published: outcome.published === true,
              hasFailedSub: outcome.hasFailedSub === true
            });
          } catch (_) {}
        }
        return outcome.result;
      });
  }

  // 构建开始前分配 generation
  const generation = profileCache.nextGeneration();

  const flightPromise = (async () => {
    try {
      const outcome = await executeBuildPipeline({ ...ctx, generation });
      // 成功发布新缓存后清除退避状态（仅由成功写入缓存触发）
      if (outcome.published && !outcome.hasFailedSub) {
        clearRevalidateFailure(cacheKey);
      } else if (isRevalidating) {
        // 仅在后台 Revalidate 模式下：若构建完成但未能发布（如 hasFailedSub 或 Generation 拒绝），记录退避
        recordRevalidateFailure(cacheKey);
      }
      return outcome;
    } catch (err) {
      // 仅在后台 Revalidate 模式下抛出异常时记录退避
      if (isRevalidating) {
        recordRevalidateFailure(cacheKey);
      }
      throw err;
    } finally {
      // 任务完成清理，校验当前记录仍指向自身才删除，防止新任务被误删
      if (isForce) {
        if (forceFlights.get(cacheKey) === flightPromise) forceFlights.delete(cacheKey);
      } else {
        if (normalFlights.get(cacheKey) === flightPromise) normalFlights.delete(cacheKey);
      }
    }
  })();

  if (isForce) {
    forceFlights.set(cacheKey, flightPromise);
  } else {
    normalFlights.set(cacheKey, flightPromise);
  }

  // 统一解包：向当前调用方安全分发 outcome 元数据（仅 published 与 hasFailedSub），
  // 并严格只返回纯净的 result 业务产物，杜绝内部元数据泄漏到客户端交付结果
  const finalOutcome = await flightPromise;
  if (typeof options.onBuildOutcome === 'function') {
    try {
      options.onBuildOutcome({
        published: finalOutcome.published,
        hasFailedSub: finalOutcome.hasFailedSub
      });
    } catch (_) {}
  }
  return finalOutcome.result;
}

/**
 * 异步触发后台 Revalidate (Stale 触发)
 */
function triggerBackgroundRevalidate(userConfig, options, logger, cacheKey) {
  // 1. 若处于失败退避期，直接放弃本次触发，避免连续回源风暴
  if (isInRevalidateBackoff(cacheKey)) {
    if (logger.isLevelEnabled('debug')) {
      logger.debug(`⏳ [SWR] 处于后台刷新退避期，跳过本次后台拉取 [${cacheKey}]`);
    }
    return;
  }

  // 2. 若已有正在进行的强制刷新，直接复用该任务，不重复开工
  if (forceFlights.has(cacheKey)) {
    if (logger.isLevelEnabled('debug')) {
      logger.debug(`🔄 [SWR] 已有同键强制构建正在运行，复用当前任务 [${cacheKey}]`);
    }
    return;
  }

  // 3. 启动后台 Revalidate (以 isForce: true 方式穿透，以 isRevalidating: true 区分语义)
  const revalidateLogger = (typeof logger.child === 'function')
    ? logger.child('SWR')
    : logger;

  revalidateLogger.info('🔄 [SWR] 命中陈旧快照，已在后台启动异步更新 (Revalidate)...');

  launchSingleFlightBuild({
    userConfig,
    options: { ...options, forceRefresh: true, isRevalidating: true },
    logger: revalidateLogger,
    cacheKey,
    enableCache: true,
    isForce: true
  }).catch((err) => {
    // 捕获所有后台异常并使用 safeErrorMessage 安全格式化，严禁二次抛错与未捕获的 Promise rejection
    revalidateLogger.warn(`⚠️ [SWR] 后台异步更新失败 (维持原有效缓存): ${safeErrorMessage(err)}`);
  });
}

/**
 * 全流程流水线总调度入口 (Pipeline Engine)
 * @param {object} [userConfig={}] 用户全局配置
 * @param {object} [options={}] CLI 或运行时覆盖参数
 * @returns {Promise<object>} 构建交付结果
 */
async function runPipelineEngine(userConfig = {}, options = {}) {
  // 入口统一展开 include 片段
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

  const enableCache = userConfig.enableCache !== false && !options.noCache;
  const cacheKey = getCacheKey(userConfig, options);
  const isForce = !!options.forceRefresh;

  // 状态感知回调：旧调用方未传时为空调用
  const notifyCacheStatus = (status, payload = {}) => {
    if (typeof options.onCacheStatus === 'function') {
      try { options.onCacheStatus(status, payload); } catch (_) {}
    }
  };

  // ─── 缓存三态判定与分流 (Fresh / Stale 优先裁决) ──────────────────────────
  if (enableCache && cacheKey) {
    if (isForce) {
      logger.info('🔄 触发强制刷新 (forceRefresh=true)，绕过本地缓存直接拉取并构建');
      notifyCacheStatus('force', { cacheKey });
    } else {
      const durations = normalizeCacheDurations(userConfig);
      const cacheEntry = profileCache.getWithStatus(cacheKey, durations);

      // Case 1: Fresh 绝对新鲜（优先返回，即使后台有强制刷新在跑也不阻塞，直接秒回）
      if (cacheEntry.status === 'fresh') {
        logger.info(`⚡ 命中本地内存缓存 (${cacheEntry.remainingSec}s 后过期)，直接响应缓存数据`);
        notifyCacheStatus('fresh', { remainingSec: cacheEntry.remainingSec, cacheKey });
        return cacheEntry.result;
      }

      // Case 2: Stale 陈旧可用（优先返回旧快照，不阻塞客户端，后台静默启动 Revalidate）
      if (cacheEntry.status === 'stale') {
        logger.info(`⚡ 命中陈旧内存快照 (SWR，${cacheEntry.remainingSec}s 后彻底失效)，优先快速返回旧数据`);
        notifyCacheStatus('stale', { remainingSec: cacheEntry.remainingSec, cacheKey });
        // 启动后台静默更新
        triggerBackgroundRevalidate(userConfig, options, logger, cacheKey);
        // 立即返回陈旧快照
        return cacheEntry.result;
      }

      // Case 3: Miss / Expired（无缓存或超过最大总寿命，必须进入任务表等待现场构建）
      notifyCacheStatus('miss', { cacheKey });
    }
  } else {
    notifyCacheStatus('bypass', { cacheKey });
  }

  // ─── Single-Flight 并发任务调度 (仅对 Miss / Expired 或 Force 请求生效) ──────
  // 辅助函数：解包复用的 Single-Flight Promise，并向当前复用方安全分发 outcome 元数据
  const awaitFlightAndNotify = async (flightPromise) => {
    const finalOutcome = await flightPromise;
    if (typeof options.onBuildOutcome === 'function') {
      try {
        options.onBuildOutcome({
          published: finalOutcome.published,
          hasFailedSub: finalOutcome.hasFailedSub
        });
      } catch (_) {}
    }
    return finalOutcome.result;
  };

  if (isForce) {
    // 强制请求：规则 3 & 4
    // 若已有正在执行的强制构建，直接共享；不得共享普通构建
    if (cacheKey && forceFlights.has(cacheKey)) {
      logger.info('⏳ 共享当前正在执行的强制构建任务...');
      return await awaitFlightAndNotify(forceFlights.get(cacheKey));
    }
  } else {
    // 普通请求 (Miss / Expired)：规则 1 & 2
    // 优先：若已有同键强制构建正在跑，直接复用等待强制构建
    if (cacheKey && forceFlights.has(cacheKey)) {
      logger.info('⏳ 发现同键强制构建正在运行，直接共享等待...');
      return await awaitFlightAndNotify(forceFlights.get(cacheKey));
    }
    // 其次：若已有同键普通构建正在跑，直接共享
    if (cacheKey && normalFlights.has(cacheKey)) {
      logger.info('⏳ 发现同键普通构建正在运行，直接共享...');
      return await awaitFlightAndNotify(normalFlights.get(cacheKey));
    }
  }

  // 启动全新的 Single-Flight 构建
  return await launchSingleFlightBuild({
    userConfig,
    options,
    logger,
    cacheKey,
    enableCache,
    isForce
  });
}

module.exports = {
  runPipelineEngine,
  buildProfile: runPipelineEngine,
  buildProfileCacheKey: getCacheKey,
  normalizeOutputMode,
  createLogger,
  safeErrorMessage,
  // 导出单测可控接口
  _internal: {
    normalFlights,
    forceFlights,
    revalidateBackoffs,
    recordRevalidateFailure,
    clearRevalidateFailure,
    isInRevalidateBackoff
  }
};
