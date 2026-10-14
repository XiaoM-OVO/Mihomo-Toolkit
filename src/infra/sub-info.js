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

/** 判定订阅是否已过期：expire>0 且到期时间戳已过（expire=0 或负数未知，不做判定） */
function isExpiredNow(expireEpochSec) {
  return typeof expireEpochSec === 'number' && expireEpochSec > 0 && Date.now() >= expireEpochSec * 1000;
}

/** 判定流量是否已耗尽：total>0 且已用流量 >= total */
function isQuotaExhausted(subInfo) {
  if (!subInfo || typeof subInfo !== 'object') return false;
  const { total = 0, upload = 0, download = 0 } = subInfo;
  return typeof total === 'number' && total > 0 && (upload + download) >= total;
}

module.exports = {
  parseSubscriptionInfo,
  isExpiredNow,
  isQuotaExhausted
};
