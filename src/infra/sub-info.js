/**
 * -----------------------------------------------------------------------------
 * Infra Layer: 订阅元信息解析与流量换算基元 (Subscription Userinfo Primitives)
 * -----------------------------------------------------------------------------
 * 本模块属于 `src/infra/` 基础设施层：无状态纯函数、零副作用、零 I/O。
 * 规范化解析 Subscription-Userinfo 响应头中的上传、下载、总配额与到期时间戳，
 * 并提供到期与配额耗尽的不变式逻辑判定。
 *
 * 分层契约：
 *   1. 纯只读数据转换与状态判定，不发起网络请求；
 *   2. 零外部依赖，不依赖任何内部业务模块；
 *   3. 供全仓各层（IO, Strategy, Pipeline 等）按需单向引用。
 */

'use strict';

/**
 * 解析 Subscription-Userinfo 响应头
 * @param {string} subInfo 形如 "upload=1; download=2; total=3; expire=1700000000"
 * @returns {{ upload: number, download: number, total: number, expire: number }}
 */
function parseSubscriptionInfo(subInfo) {
  if (!subInfo) return { upload: 0, download: 0, total: 0, expire: 0 };
  const parts = subInfo.split(';').map(s => s.trim());
  let upload = 0, download = 0, total = 0, expire = 0;
  parts.forEach(p => {
    const [k, v] = p.split('=');
    if (k === 'upload') upload = parseInt(v) || 0;
    if (k === 'download') download = parseInt(v) || 0;
    if (k === 'total') total = parseInt(v) || 0;
    if (k === 'expire') expire = parseInt(v) || 0;
  });
  return { upload, download, total, expire };
}

const DAY_MS = 86400000;

/**
 * 统一到期状态判定（单订阅看板 / 全局看板 / 容灾终态判定共用）。
 *
 * `cutoffHours > 0` 时按「到期时刻前 N 小时」提前判定停用：凌晨到期的订阅（如 00:30）
 * 会在前一天更早时刻即被停用，避免继续下发已死节点直到上游掐断。
 * 该判定基于绝对时间轴，与时区无关。
 *
 * @param {number} expireEpochSec 到期时间戳（秒）
 * @param {number} [cutoffHours=0] 提前判定的小时数（0 = 关闭提前判定）
 * @param {number} [now=Date.now()] 当前时间戳（毫秒，便于测试注入）
 * @returns {{ known: boolean, expired: boolean, cutoffExpired: boolean, remainingMs: number, expireDays: number }}
 *   known          — expire 是否为有效到期时间戳（>0）
 *   expired        — 是否已失效（真过期或命中提前停用窗口）
 *   cutoffExpired  — 是否仅命中提前停用窗口（尚未到真实到期时刻）
 *   remainingMs    — 距真实到期时刻的毫秒数（负数表示已过期）
 *   expireDays     — 距到期时刻的完整天数向下取整；未知到期时间为 -1
 */
function evaluateExpiry(expireEpochSec, cutoffHours = 0, now = Date.now()) {
  if (typeof expireEpochSec !== 'number' || !(expireEpochSec > 0)) {
    return { known: false, expired: false, cutoffExpired: false, remainingMs: 0, expireDays: -1 };
  }
  const cutoffMs = (typeof cutoffHours === 'number' && cutoffHours > 0) ? cutoffHours * 3600000 : 0;
  const remainingMs = expireEpochSec * 1000 - now;
  const expired = remainingMs <= cutoffMs;
  return {
    known: true,
    expired,
    cutoffExpired: expired && remainingMs > 0,
    remainingMs,
    expireDays: Math.floor(remainingMs / DAY_MS)
  };
}

/**
 * 归一化看板日期时区配置：
 *   - 空值 / `local` / `system` → `''`（跟随运行环境本地时区）
 *   - 合法 IANA 名称（如 `Asia/Shanghai`）→ 原样返回
 *   - 非法名称 → `null`（由调用方告警并回退本地时区）
 *
 * @param {string} [timeZone]
 * @returns {string|null}
 */
function normalizeTimeZone(timeZone) {
  if (timeZone == null) return '';
  const raw = String(timeZone).trim();
  if (!raw || /^(local|system)$/i.test(raw)) return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return null;
  }
}

/**
 * 按指定时区格式化到期日期为 YYYY-MM-DD。
 * `timeZone` 为空时使用运行环境本地时区，避免 UTC 截断导致凌晨到期显示成前一天。
 *
 * @param {number} expireEpochSec 到期时间戳（秒）
 * @param {string} [timeZone=''] IANA 时区名称（空 = 本地时区）
 * @returns {string} 形如 2026-11-01；无效时间戳返回空串
 */
function formatDateInZone(expireEpochSec, timeZone = '') {
  if (typeof expireEpochSec !== 'number' || !(expireEpochSec > 0)) return '';
  const date = new Date(expireEpochSec * 1000);
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(date);
      const pick = type => parts.find(p => p.type === type)?.value || '';
      return `${pick('year')}-${pick('month')}-${pick('day')}`;
    } catch {}
  }
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * 判定订阅是否已失效：expire>0 且到期时间戳已过（expire=0 或负数未知，不做判定）。
 * 命中 `cutoffHours` 提前停用窗口时同样返回 true。详见 evaluateExpiry。
 *
 * @param {number} expireEpochSec 到期时间戳（秒）
 * @param {number} [cutoffHours=0] 提前判定的小时数（0 = 关闭提前判定）
 */
function isExpiredNow(expireEpochSec, cutoffHours = 0) {
  return evaluateExpiry(expireEpochSec, cutoffHours).expired;
}

/** 判定流量是否已耗尽：total>0 且已用流量 >= total */
function isQuotaExhausted(subInfo) {
  if (!subInfo || typeof subInfo !== 'object') return false;
  const { total = 0, upload = 0, download = 0 } = subInfo;
  return typeof total === 'number' && total > 0 && (upload + download) >= total;
}

module.exports = {
  parseSubscriptionInfo,
  evaluateExpiry,
  normalizeTimeZone,
  formatDateInZone,
  isExpiredNow,
  isQuotaExhausted
};
