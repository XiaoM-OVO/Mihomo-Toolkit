/**
 * 订阅状态与虚拟信息节点合成
 *
 * 将订阅剩余流量、到期时间、重置周期计算并转换为直观的提示节点。
 */

const { parseSubscriptionInfo, isExpiredNow } = require('./parsers/sub-info');

function formatBytes(bytes, fractionDigits = 2) {
  const units = ['MB', 'GB', 'TB', 'PB'];
  let value = bytes / (1024 * 1024);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return value.toFixed(fractionDigits) + ' ' + units[i];
}

/**
 * 计算距下次每月流量重置的天数：每月 resetDay 天重置，今日恰为重置日则顺延到下月。
 * resetDay 不在 1-31 或未配置时返回 null。
 */
function calcResetDays({ resetDay } = {}) {
  if (typeof resetDay !== 'number' || resetDay < 1 || resetDay > 31) return null;
  const DAY = 86400000;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = new Date(y, m, now.getDate());
  const lastThis = new Date(y, m + 1, 0).getDate();
  const candidate = new Date(y, m, Math.min(resetDay, lastThis));
  if (candidate > today) {
    return Math.round((candidate - today) / DAY);
  }
  const lastNext = new Date(y, m + 2, 0).getDate();
  const next = new Date(y, m + 1, Math.min(resetDay, lastNext));
  return Math.round((next - today) / DAY);
}

function generateInfoNodes(subInfo, tag, options = {}) {
  if (!subInfo) return { nodes: [], expireDays: -1 };
  const { upload, download, total, expire } = parseSubscriptionInfo(subInfo);
  const isStale = !!options.isStale;
  const tagPrefix = tag ? `[${tag}] ` : '';

  const nodes = [];
  const expired = isExpiredNow(expire);

  // 1. 流量状态节点（仅在未过期且总流量 > 0 时生成）
  if (!expired && total > 0) {
    const used = upload + download;
    const remaining = Math.max(0, total - used);
    const percent = ((remaining / total) * 100).toFixed(1);
    const isLow = remaining <= 5 * 1024 * 1024 * 1024 || (remaining / total) <= 0.05;
    const icon = isLow ? '🪫' : '🏷️';
    const label = isLow ? '流量告急' : '剩余流量';
    nodes.push({
      name: `${icon} ${tagPrefix}${label}：${formatBytes(remaining)} / ${formatBytes(total)} (${percent}%)`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    });
  }

  // 2. 到期状态节点
  let expireDays = -1;
  if (expire > 0) {
    const d = new Date(expire * 1000);
    const dateStr = d.toISOString().split('T')[0];
    const now = new Date();
    expireDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    if (expired || expireDays <= 0) {
      const expiredDays = Math.max(1, Math.floor((now - d) / (1000 * 60 * 60 * 24)));
      nodes.push({
        name: `🛑 ${tagPrefix}套餐到期：${dateStr} (已失效 ${expiredDays} 天)`,
        type: 'direct',
        server: '1.0.0.1',
        port: 80,
        isSyntheticInfo: true
      });
    } else if (expireDays <= 3) {
      nodes.push({
        name: `⚠️ ${tagPrefix}即将到期：${dateStr} (仅剩 ${expireDays} 天，请及时续费)`,
        type: 'direct',
        server: '1.0.0.1',
        port: 80,
        isSyntheticInfo: true
      });
    } else {
      nodes.push({
        name: `📅 ${tagPrefix}套餐到期：${dateStr} (余 ${expireDays} 天)`,
        type: 'direct',
        server: '1.0.0.1',
        port: 80,
        isSyntheticInfo: true
      });
    }
  }

  // 3. 容灾降级标记（命中 stale 缓存时）
  if (isStale) {
    nodes.push({
      name: `🔄 ${tagPrefix}抓取异常 · 启用缓存兜底`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    });
  }

  return { nodes, expireDays };
}

module.exports = {
  formatBytes,
  calcResetDays,
  generateInfoNodes,
  parseSubscriptionInfo,
  isExpiredNow
};
