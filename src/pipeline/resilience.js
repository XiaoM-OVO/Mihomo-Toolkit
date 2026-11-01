/**
 * -----------------------------------------------------------------------------
 * Resilience Context: 弹性策略上下文
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 物理隔离「常驻服务状态 (Resident Stateful)」与「一次性命令构建 (Stateless One-Shot)」
 * 2. 封装订阅失败退避表 (subFailureBackoff)、L1 原始订阅快照 (subStaleCache) 与容灾降级决策
 * 3. 避免底层 Pipeline (ingestion / engine) 充斥 if (statefulRun) 或 if (isStateless) 等宿主环境判断
 *
 * 归属 Layer 2 (pipeline)：它承载终态判定与容灾决策等业务策略，而非 IO 副作用；
 * 因此可以合法依赖 core 日志词表与 infra 订阅信息基元。
 */

'use strict';

const {
  subStaleCache,
  subFailureBackoff,
  recordSubFetchFailure,
  clearSubFetchFailure,
  isSubInFetchBackoff,
  getSubFetchBackoff,
  pruneSubStaleCache
} = require('../io/fetcher');
const { parseSubscriptionInfo, evaluateExpiry, formatDateInZone } = require('../infra/sub-info');
const { formatBackoffDetail } = require('../core/log-copy');
const { redactUrl } = require('../io/ssrf');

/**
 * 统一的终态失效判定入口（401 / 到期或提前停用 / 流量耗尽）。
 * 常驻与一次性上下文共用，避免终态规则出现两份实现后逐渐漂移。
 *
 * @returns {{ isTerminal: boolean, terminalKind: string, terminalReason: string }}
 *   terminalKind — http401 | cutoff | expired | quota（非终态为空串）
 */
function detectTerminalState(err, cutoffHours = 0) {
  const httpStatus = err?.statusCode || err?.status;
  if (httpStatus === 401) {
    return { isTerminal: true, terminalKind: 'http401', terminalReason: 'HTTP 401 凭据失效' };
  }
  if (err?.isExpired) {
    if (evaluateExpiry(parseSubscriptionInfo(err.subInfo).expire, cutoffHours).cutoffExpired) {
      return { isTerminal: true, terminalKind: 'cutoff', terminalReason: `订阅已停用（距到期不足 ${cutoffHours} 小时）` };
    }
    return { isTerminal: true, terminalKind: 'expired', terminalReason: '订阅已失效' };
  }
  if (err?.isQuotaExhausted) {
    return { isTerminal: true, terminalKind: 'quota', terminalReason: '流量已耗尽' };
  }
  return { isTerminal: false, terminalKind: '', terminalReason: '' };
}

/**
 * 提取旧缓存中的到期时间并判定是否超期（到期或进入提前停用窗口）
 */
function describeStaleExpiry(stale, cutoffHours = 0, timeZone = '') {
  if (!stale || !stale.subInfo) return null;
  const parsed = parseSubscriptionInfo(stale.subInfo);
  const expire = parsed.expire;
  if (!expire || expire <= 0) return null;
  const expiry = evaluateExpiry(expire, cutoffHours);
  if (!expiry.expired) return null;
  const date = formatDateInZone(expire, timeZone);
  return expiry.cutoffExpired
    ? { kind: 'stale-cutoff', reason: `旧缓存已停用（${date} 到期）` }
    : { kind: 'stale-expired', reason: `旧缓存已失效（${date} 到期）` };
}

/**
 * 弹性策略上下文抽象基类
 */
class ResilienceContext {
  get isStateful() {
    return false;
  }

  getStaleSnapshot(_subKey) {
    return null;
  }

  getFreshSnapshot(_subKey, _freshTtlMs) {
    return null;
  }

  saveSnapshot(_subKey, _content, _subInfo, _staleMaxAgeMs) {}

  deleteStaleSnapshot(_subKey, _initialStale) {}

  isInBackoff(_subKey, _options = {}) {
    return false;
  }

  recordFailure(_subKey, _error, _isTerminal = false) {
    return null;
  }

  clearFailure(_subKey) {}

  getBackoffState(_subKey) {
    return null;
  }

  formatBackoffDetail(_options = {}) {
    return '';
  }

  /**
   * 子类必须实现：基类返回伪造决策会静默把终态失效当成普通失败。
   */
  evaluateStaleFallback(_err, _params = {}) {
    throw new Error('ResilienceContext.evaluateStaleFallback 必须由子类实现');
  }

  resolveBackoffStale(_subKey, _initialStale, _staleMaxAgeMs, _cutoffHours = 0, _timeZone = '') {
    return null;
  }

  logFallbackReject(_logger, _subUrl, _rejectReason, _options = {}) {}
}

/**
 * 常驻服务弹性上下文（Server / Daemon / 常驻 SDK）：
 * 持有进程级内存状态，执行两级退避、L1 快照复用、容灾旧缓存兜底与 SWR 状态流转。
 */
class ResidentResilienceContext extends ResilienceContext {
  /**
   * @param {object} [options]
   * @param {object} [options.staleCache] 自定义快照缓存（默认使用模块级全局单例 subStaleCache）
   * @param {Map} [options.failureBackoff] 自定义退避表（默认使用模块级全局单例 subFailureBackoff）
   */
  constructor(options = {}) {
    super();
    this.staleCache = options.staleCache || subStaleCache;
    this.failureBackoff = options.failureBackoff || subFailureBackoff;
  }

  get isStateful() {
    return true;
  }

  getStaleSnapshot(subKey) {
    if (!subKey) return null;
    if (typeof this.staleCache.getSnapshot === 'function') {
      return this.staleCache.getSnapshot(subKey);
    }
    return this.staleCache.get(subKey) || null;
  }

  getFreshSnapshot(subKey, freshTtlMs) {
    if (!subKey || typeof this.staleCache.getFresh !== 'function') return null;
    return this.staleCache.getFresh(subKey, freshTtlMs);
  }

  saveSnapshot(subKey, content, subInfo, staleMaxAgeMs) {
    if (!subKey) return;
    this.staleCache.set(subKey, { content, subInfo, timestamp: Date.now() });
    pruneSubStaleCache(staleMaxAgeMs);
  }

  deleteStaleSnapshot(subKey, initialStale) {
    if (!subKey) return;
    if (typeof this.staleCache.deleteIfMatch === 'function') {
      this.staleCache.deleteIfMatch(subKey, initialStale);
    } else if (initialStale && this.staleCache.get(subKey) === initialStale) {
      this.staleCache.delete(subKey);
    }
  }

  isInBackoff(subKey, options = {}) {
    if (!subKey) return false;
    // 用户显式强制刷新（非后台 Revalidate）时绕过退避，便于主动探测订阅是否恢复
    if (options.forceRefresh && !options.isRevalidating) {
      return false;
    }
    return isSubInFetchBackoff(subKey);
  }

  recordFailure(subKey, error, isTerminal = false) {
    if (!subKey || error?.isBackoff) return null;
    return recordSubFetchFailure(subKey, error, isTerminal);
  }

  clearFailure(subKey) {
    if (subKey) clearSubFetchFailure(subKey);
  }

  getBackoffState(subKey) {
    return subKey ? getSubFetchBackoff(subKey) : null;
  }

  formatBackoffDetail(options = {}) {
    return formatBackoffDetail(options);
  }

  /**
   * 拉取失败后的「终态失效判定 + 容灾降级决策」
   */
  evaluateStaleFallback(err, { subKey, initialStale, staleMaxAgeMs, cutoffHours = 0, timeZone = '' } = {}) {
    const stale = this.staleCache.get(subKey);

    let { isTerminal, terminalKind, terminalReason } = detectTerminalState(err, cutoffHours);

    // 旧缓存自身失效同样构成终态（仅常驻上下文存在旧缓存）
    if (!isTerminal && stale) {
      const staleExpiry = describeStaleExpiry(stale, cutoffHours, timeZone);
      if (staleExpiry) {
        isTerminal = true;
        terminalKind = staleExpiry.kind;
        terminalReason = staleExpiry.reason;
      }
    }

    if (isTerminal) {
      this.deleteStaleSnapshot(subKey, initialStale);
    }

    let allowFallback = false;
    let fallbackRejectReason = '';

    if (isTerminal) {
      fallbackRejectReason = `${terminalReason}，拒绝回退旧缓存`;
    } else if (!stale) {
      fallbackRejectReason = '无历史缓存';
    } else if (Date.now() - stale.timestamp >= staleMaxAgeMs) {
      fallbackRejectReason = '缓存超过保留期限 (fetchStaleTtl)';
    } else {
      allowFallback = true;
    }

    return { isTerminal, terminalKind, terminalReason, fallbackRejectReason, allowFallback, stale };
  }

  resolveBackoffStale(subKey, initialStale, staleMaxAgeMs, cutoffHours = 0, timeZone = '') {
    const state = this.getBackoffState(subKey);
    if (!state) return null;

    const stale = this.staleCache.get(subKey);
    const staleExpiry = stale ? describeStaleExpiry(stale, cutoffHours, timeZone) : null;
    const expired = !!staleExpiry;

    if (expired) {
      this.deleteStaleSnapshot(subKey, initialStale);
    }

    const usable = !!stale && !expired && (Date.now() - stale.timestamp < staleMaxAgeMs);
    return { state, stale, usable, expired, staleExpiry };
  }

  logFallbackReject(logger, subUrl, rejectReason, { showFullUrl = false, debug = false } = {}) {
    if (rejectReason && logger && debug && typeof logger.debug === 'function') {
      logger.debug(`🛡️ 兜底被拒绝 [${redactUrl(subUrl, showFullUrl)}]：${rejectReason}`);
    }
  }
}

/**
 * 一次性运行弹性上下文（CLI / One-Shot / 批处理脚本 / Serverless）：
 * 彻底纯无状态，不记录、不读取退避状态，不写入常驻缓存，不输出退避明细与旧缓存决策。
 */
class StatelessResilienceContext extends ResilienceContext {
  evaluateStaleFallback(err, { cutoffHours = 0 } = {}) {
    const { isTerminal, terminalKind, terminalReason } = detectTerminalState(err, cutoffHours);
    // 一次性运行无历史缓存，兜底决策恒不成立，且不生成误导性的拒绝理由
    return {
      isTerminal,
      terminalKind,
      terminalReason,
      fallbackRejectReason: '',
      allowFallback: false,
      stale: null
    };
  }
}

const defaultResidentContext = new ResidentResilienceContext();
const defaultStatelessContext = new StatelessResilienceContext();

function createResidentResilienceContext(options) {
  return options ? new ResidentResilienceContext(options) : defaultResidentContext;
}

function createStatelessResilienceContext() {
  return defaultStatelessContext;
}

/**
 * 根据 options 解析出目标 ResilienceContext。
 * 兼容性规则：
 * 1. 显式传入 options.resilience 则直接采信；
 * 2. 未传入时默认回退为常驻 ResidentResilienceContext。
 *
 * @param {object} [options={}]
 * @returns {ResilienceContext}
 */
function resolveResilienceContext(options = {}) {
  if (options.resilience instanceof ResilienceContext) {
    return options.resilience;
  }
  return defaultResidentContext;
}

module.exports = {
  ResilienceContext,
  ResidentResilienceContext,
  StatelessResilienceContext,
  createResidentResilienceContext,
  createStatelessResilienceContext,
  resolveResilienceContext
};
