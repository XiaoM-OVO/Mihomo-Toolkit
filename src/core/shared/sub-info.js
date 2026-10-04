/**
 * -----------------------------------------------------------------------------
 * Core Layer: 订阅元信息解析 (Subscription Userinfo Parser)
 * -----------------------------------------------------------------------------
 * 纯函数、无副作用。位于 Core 层以满足架构红线：
 * strategy 层（dashboard.js）与 io 层（parsers/index.js）均直接引用本模块。
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

/** 判定订阅是否已过期：expire>0 且到期时间戳已过（expire=0 未知，不做判定） */
function isExpiredNow(expireEpochSec) {
  return expireEpochSec > 0 && Date.now() >= expireEpochSec * 1000;
}

module.exports = {
  parseSubscriptionInfo,
  isExpiredNow
};
