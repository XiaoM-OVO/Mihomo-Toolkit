/**
 * Subscription-Userinfo 响应头解析器
 *
 * 解析流量使用量、总量与到期时间戳。
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

// 判定订阅是否已过期：expire>0 且到期时间戳已过（expire=0 未知，不做判定）
function isExpiredNow(expireEpochSec) {
  return expireEpochSec > 0 && Date.now() >= expireEpochSec * 1000;
}

module.exports = {
  parseSubscriptionInfo,
  isExpiredNow
};
