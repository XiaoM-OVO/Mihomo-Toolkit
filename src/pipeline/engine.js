/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 全流程总调度引擎 (Workflow / Pipeline Engine)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 唯一掌握流水线生命周期的总调度器
 * 2. 调度 IO 拉取 ➔ 调度 nodes 清洗 ➔ 根据交付目标 (Checkpoint) 截断刹车
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
const { processSubscriptionSources, isSubEnabled } = require('./ingestion');
const { chineseConvert } = require('../core/chinese-sync');
const { computeMountDigest, absolutizeMountPaths } = require('../config/mounts');
const { expandIncludes } = require('../config/include');
const dashboard = require('../strategy/dashboard');
const { createLogger } = require('../core/logger');

function normalizeOutputMode(rawMode) {
  return String(rawMode || 'config').toLowerCase();
}

/**
 * 判断当前是否处于自动化测试环境 (Node.js test runner 或 NODE_ENV=test)
 */
function isTestEnvironment() {
  return (
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    (Array.isArray(process.execArgv) && process.execArgv.some(arg => typeof arg === 'string' && arg.startsWith('--test')))
  );
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

    // 对 customServices 中可能出现的原生 RegExp 实例做字符串化归一，防止 fast-json-stable-stringify 序列化为 {} 产生碰撞
    if (configRest.customServices && typeof configRest.customServices === 'object') {
      const safeCustomServices = {};
      for (const [cat, sMap] of Object.entries(configRest.customServices)) {
        if (!sMap || typeof sMap !== 'object') continue;
        safeCustomServices[cat] = {};
        for (const [k, v] of Object.entries(sMap)) {
          if (v && typeof v === 'object') {
            safeCustomServices[cat][k] = {
              ...v,
              ...(v.reg instanceof RegExp ? { reg: v.reg.toString() } : {})
            };
          } else {
            safeCustomServices[cat][k] = v;
          }
        }
      }
      configRest.customServices = safeCustomServices;
    }

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
// 仅针对后台 Revalidate 构建任务（options.isRevalidating: true），当其未能发布新缓存时
// 记录退避，防止连续回源风暴。单订阅级失败退避由 IO 层独立维护。
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

  // 严格 LRU 容量控制：更新前先删后插，确保最新访问/更新的键排在 Map 末尾
  revalidateBackoffs.delete(cacheKey);
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

  // 4. Step 1: 订阅拉取与预处理网关 (IO 阶段)
  const {
    sourceSkeleton,
    dnsAssets,
    collectedSubInfos,
    hasFailedSub,
    hasTerminalFailure,
    perSubCounts,
    subStatuses = [],
    usableSubCount = 0
  } = await processSubscriptionSources({
    subscriptions: userConfig.subscriptions,
    url: options.url,
    userConfig,
    options,
    logger: ioLogger,
    dashboard,
    outputMode
  });

  // 逐订阅健康快照：仅保留标识用于监控/日志，严禁携带订阅 URL
  const failedTags = subStatuses
    .filter(s => s && (s.status === 'failed' || s.status === 'terminal'))
    .map(s => s.tag)
    .filter(Boolean);
  const staleTags = subStatuses
    .filter(s => s && s.status === 'stale')
    .map(s => s.tag)
    .filter(Boolean);
  // 降级交付：只要有订阅非 ok（失败 / 终态失效 / 旧缓存兜底），本次结果即为降级结果
  const degraded = hasFailedSub === true;
  // 只有产出可用内容（ok + stale）时才允许写入 Profile 缓存；全部失败时保留旧缓存
  const canPublish = enableCache && !!cacheKey && usableSubCount > 0;
  const cacheMeta = {
    generation,
    degraded,
    failedTags,
    staleTags,
    usableSubCount
  };

  // 4.1 资源配额二次校验：节点总量与单订阅节点量
  const nodeLimitErr = validateRequestLimits({
    totalNodes: (sourceSkeleton.proxies || []).length,
    perSubCounts,
    limits: securityLimits
  });
  if (nodeLimitErr) throw nodeLimitErr;

  // 5. Step 2: 节点标准化清洗与打标 (Core 纯算法阶段)
  const nodeConfig = { ...userConfig };

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
    if (canPublish) {
      published = profileCache.set(cacheKey, nodesResult, cacheMeta) === true;
    }
    return { result: nodesResult, hasFailedSub, hasTerminalFailure, published, usableSubCount, degraded, failedTags, staleTags };
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
    if (canPublish) {
      published = profileCache.set(cacheKey, reportResult, cacheMeta) === true;
    }
    return { result: reportResult, hasFailedSub, hasTerminalFailure, published, usableSubCount, degraded, failedTags, staleTags };
  }

  // ─── 🛑 Checkpoint 3: 交付完整配置 (config 模式跑完全程) ───
  const { yamlStr, outputData, userInfo, invariantViolations } = runConfigPipeline({
    sourceSkeleton,
    dnsAssets,
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

  // 写入 LRU 缓存 (严格代际防护；仅当有可用订阅时才发布，全部失败时保留旧快照)
  let published = false;
  if (canPublish) {
    published = profileCache.set(cacheKey, configResult, cacheMeta) === true;
  }

  return { result: configResult, hasFailedSub, hasTerminalFailure, published, usableSubCount, degraded, failedTags, staleTags };
}

/**
 * 触发 Single-Flight 封装的实际构建任务
 * @param {object} ctx
 * @returns {Promise<object>} 返回最终纯净 result
 */
async function launchSingleFlightBuild(ctx) {
  const { cacheKey, isForce, enableCache, options = {} } = ctx;
  const isRevalidating = !!options.isRevalidating;

  // 统一的构建执行器：分配 generation，处理终态失效淘汰（单一职责点并带代次保护）
  const runBuildTask = async (taskGeneration) => {
    const outcome = await executeBuildPipeline({ ...ctx, generation: taskGeneration });
    // 终态失效保护（单一职责点）：仅当本次构建「可用订阅为 0 且全部订阅均为终态失效」时，
    // 原 Profile 快照才真正失去可交付内容，必须物理淘汰 profileCache 中的条目。
    // 部分订阅终态失效但仍有健康订阅时，保留并覆盖为降级快照，避免一条 401 拖垮多订阅缓存。
    // 代际保护：若较新的构建已经成功发布了更高代际的缓存，禁止较旧的失败任务误删新缓存。
    if (outcome.hasTerminalFailure && outcome.usableSubCount === 0 && cacheKey) {
      profileCache.delete(cacheKey, taskGeneration);
    }
    return outcome;
  };

  // 不可缓存或未生成有效 key 时不进 Single-Flight 任务表，独立执行
  if (!enableCache || !cacheKey) {
    const generation = profileCache.nextGeneration();
    return runBuildTask(generation)
      .then((outcome) => {
        if (typeof options.onBuildOutcome === 'function') {
          try {
            options.onBuildOutcome({
              published: outcome.published === true,
              hasFailedSub: outcome.hasFailedSub === true,
              hasTerminalFailure: outcome.hasTerminalFailure === true,
              usableSubCount: outcome.usableSubCount,
              degraded: outcome.degraded === true,
              failedTags: outcome.failedTags,
              staleTags: outcome.staleTags
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
      const outcome = await runBuildTask(generation);
      // 成功发布新缓存后清除退避状态：降级发布（仍有可用订阅）同样视为有效发布，
      // 单订阅级失败退避已在 IO 层独立控制，不会再造成回源风暴。
      if (outcome.published) {
        clearRevalidateFailure(cacheKey);
      } else if (isRevalidating) {
        // 仅在后台 Revalidate 模式下：若构建完成但未能发布（无可用订阅或 Generation 拒绝），记录退避
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

  // 统一解包：向当前调用方安全分发 outcome 元数据（published / 健康度 / 降级订阅标识），
  // 并严格只返回纯净的 result 业务产物，杜绝内部元数据泄漏到客户端交付结果
  const finalOutcome = await flightPromise;

  if (typeof options.onBuildOutcome === 'function') {
    try {
      options.onBuildOutcome({
        published: finalOutcome.published,
        hasFailedSub: finalOutcome.hasFailedSub,
        hasTerminalFailure: finalOutcome.hasTerminalFailure === true,
        usableSubCount: finalOutcome.usableSubCount,
        degraded: finalOutcome.degraded === true,
        failedTags: finalOutcome.failedTags,
        staleTags: finalOutcome.staleTags
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
 * @param {object} [options={}] CLI 或运行时覆盖参数 (baseDir 可显式指定相对挂载路径基准目录)
 * @returns {Promise<object>} 构建交付结果
 */
async function runPipelineEngine(userConfig = {}, options = {}) {
  // 入口统一兜底：与 CLI / server 装载现场保持同一套处理顺序（先 absolutize 挂载路径，再展开 include）。
  // 基准目录优先取调用方显式传入的 options.baseDir —— SDK 跨目录调用时 cwd 不可信；
  // 装载现场已转过绝对路径的配置在此为幂等空操作，行为不变。
  const configBaseDir = options.baseDir || process.cwd();
  userConfig = expandIncludes(absolutizeMountPaths(userConfig || {}, configBaseDir), configBaseDir);

  const isTest = isTestEnvironment();
  const envLogLevel = process.env.LOG_LEVEL || (process.env.DEBUG ? 'debug' : '');
  const defaultLogLevel = (isTest && !envLogLevel) ? 'silent' : 'info';

  const effectiveLogLevel = options.debug
    ? 'debug'
    : (options.silent || options.quiet
        ? 'silent'
        : (options.logLevel || userConfig.logLevel || envLogLevel || defaultLogLevel));
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
        if (cacheEntry.degraded) {
          logger.warn(`⚠️ 命中降级内存缓存 (${cacheEntry.remainingSec}s 后转入后台刷新，失败订阅 ${cacheEntry.failedTags.length} 个)，直接响应缓存数据`);
        } else {
          logger.info(`⚡ 命中本地内存缓存 (${cacheEntry.remainingSec}s 后过期)，直接响应缓存数据`);
        }
        notifyCacheStatus('fresh', {
          remainingSec: cacheEntry.remainingSec,
          cacheKey,
          degraded: cacheEntry.degraded,
          failedTags: cacheEntry.failedTags,
          staleTags: cacheEntry.staleTags,
          usableSubCount: cacheEntry.usableSubCount
        });
        return cacheEntry.result;
      }

      // Case 2: Stale 陈旧可用（优先返回旧快照，不阻塞客户端，后台静默启动 Revalidate）
      if (cacheEntry.status === 'stale') {
        if (cacheEntry.degraded) {
          logger.warn(`⚠️ 命中降级陈旧快照 (SWR，${cacheEntry.remainingSec}s 后彻底失效，失败订阅 ${cacheEntry.failedTags.length} 个)，已启动后台更新`);
        } else {
          logger.info(`⚡ 命中陈旧内存快照 (SWR，${cacheEntry.remainingSec}s 后彻底失效)，优先快速返回旧数据`);
        }
        notifyCacheStatus('stale', {
          remainingSec: cacheEntry.remainingSec,
          cacheKey,
          degraded: cacheEntry.degraded,
          failedTags: cacheEntry.failedTags,
          staleTags: cacheEntry.staleTags,
          usableSubCount: cacheEntry.usableSubCount
        });
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
          published: finalOutcome.published === true,
          hasFailedSub: finalOutcome.hasFailedSub === true,
          hasTerminalFailure: finalOutcome.hasTerminalFailure === true,
          usableSubCount: finalOutcome.usableSubCount,
          degraded: finalOutcome.degraded === true,
          failedTags: finalOutcome.failedTags,
          staleTags: finalOutcome.staleTags
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
  /** 导出全局 Profile SWR 缓存运行指标（hits/misses/hitRate），供 targets 层 /healthz 监控消费 */
  getProfileCacheStats: () => profileCache.getStats(),
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
