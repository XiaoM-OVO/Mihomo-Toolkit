/**
 * 日志文案词表与行构造器
 *
 * 只收敛跨文件复用的状态词、图标与固定句式；带业务上下文的句子仍留在调用点。
 * 术语与图标口径以 ARCHITECTURE.md 第七节为准，改词只改这里。
 */

const { formatDuration } = require('./logger');

const ICONS = {
  FETCH: '🌐',
  SNAPSHOT: '⚡',
  CACHE_HIT: '⚡',
  FALLBACK_STALE: '⚠️',
  DEGRADED: '🔄',
  BACKOFF: '⏳',
  TERMINAL: '🛑',
  FETCH_FAILED: '❌',
  DISABLED: '⏸️'
};

const TERMS = {
  FETCH: '回源',
  SNAPSHOT: '复用快照',
  CACHE_HIT: '命中缓存',
  FALLBACK_STALE: '缓存兜底',
  BACKOFF_SKIP: '退避跳过',
  BACKOFF_REUSE: '退避跳过 · 复用缓存兜底',
  TERMINAL: '终态失效',
  LONG_COOLDOWN: '长冷却',
  FETCH_FAILED: '拉取失败',
  FETCH_ERROR: '回源失败',
  DISABLED: '已禁用'
};

/**
 * 统一退避明细句式：「第 N 次失败 · 退避 6h · 剩余 6h」。
 * 缺失字段自动省略，调用方无需自行拼接分隔符。
 *
 * @param {object} [detail]
 * @param {number} [detail.failures=0] 失败次数
 * @param {number} [detail.delayMs] 本次退避/长冷却时长（毫秒）
 * @param {number} [detail.remainingMs] 距离下次可重试的剩余时间（毫秒）
 * @param {string} [detail.delayLabel='退避'] 时长前缀，终态场景传 `长冷却`
 * @returns {string}
 */
function formatBackoffDetail({ failures = 0, delayMs, remainingMs, delayLabel = '退避' } = {}) {
  const parts = [];
  if (failures > 0) parts.push(`第 ${failures} 次失败`);
  if (Number.isFinite(delayMs) && delayMs > 0) parts.push(`${delayLabel} ${formatDuration(delayMs)}`);
  if (Number.isFinite(remainingMs) && remainingMs > 0) parts.push(`剩余 ${formatDuration(remainingMs)}`);
  return parts.join(' · ');
}

/**
 * 构造订阅汇总树的单行状态文案（不含树形分支符）。
 *
 * @param {object} s 订阅摘要
 * @param {string} s.tag 订阅标识
 * @param {string} [s.expiryLabel] 到期/停用类终态文案
 * @param {boolean} [s.skipped] 是否因瞬时退避跳过回源
 * @param {boolean} [s.terminal] 是否终态失效
 * @param {string} [s.failReason] 失败原因（已精简）
 * @param {number} [s.backoffFailures] 失败次数
 * @param {number} [s.backoffTotalSec] 本次退避/长冷却时长（秒）
 * @param {number} [s.retryInSec] 距离下次可重试的剩余时间（秒）
 * @returns {string}
 */
function buildSubscriptionStateLine(s) {
  if (s.expiryLabel) {
    return `${ICONS.TERMINAL} [${s.tag}]：${s.expiryLabel}`;
  }

  const detail = formatBackoffDetail({
    failures: s.backoffFailures,
    delayMs: s.backoffTotalSec > 0 ? s.backoffTotalSec * 1000 : undefined,
    remainingMs: s.retryInSec > 0 ? s.retryInSec * 1000 : undefined,
    delayLabel: s.terminal ? TERMS.LONG_COOLDOWN : undefined
  });

  if (s.skipped) {
    return `${ICONS.BACKOFF} [${s.tag}]：${TERMS.BACKOFF_SKIP}（无可用缓存${detail ? ` · ${detail}` : ''}）`;
  }

  const parts = [s.failReason, detail].filter(Boolean);
  const label = s.terminal ? TERMS.TERMINAL : TERMS.FETCH_FAILED;
  return `${ICONS.FETCH_FAILED} [${s.tag}]：${label}（${parts.join(' · ')}）`;
}

module.exports = {
  ICONS,
  TERMS,
  formatBackoffDetail,
  buildSubscriptionStateLine
};
