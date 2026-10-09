/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 状态看板与多订阅聚合中心 (Dashboard & Aggregator)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 多订阅流量与到期时间多维度聚合计算 (min / max / first)
 * 2. 识别/提取机场自带重置周期与日期
 * 3. 合成彩色状态看板虚拟节点 (流量告急、到期预警、重置倒计时、抓取失败)
 * 4. 契合客户端 2 列网格布局的全局配对汇总节点
 */

const { parseSubscriptionInfo, isExpiredNow } = require('../core/shared/sub-info');

const REGEX_INFO_NODES = /剩余|到期|过期|套餐|流量|时间|有效|更新|官网|维护|群|发布|节点说明|失效|获取|网址|Q群|电报|Tg群|下次|关注|官方|签到/i;

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

/**
 * 根据 subscription-userinfo 头合成流量状态与到期提示节点
 */
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

/**
 * 过滤机场原生自带的说明/伪节点
 */
function filterRawInfoNodes(proxies = [], logger) {
  return proxies.filter(p => {
    if (!p || !p.name) return false;
    if (REGEX_INFO_NODES.test(p.name)) {
      if (logger) logger.debug(`🗑️ [说明过滤] 「${p.name}」`);
      return false;
    }
    return true;
  });
}

/**
 * 提取机场自带重置信息或按配置计算重置天数
 */
function extractResetText(sub = {}, subProxies = []) {
  const cfgResetDays = calcResetDays({ resetDay: sub.resetDay });
  if (cfgResetDays != null) {
    return `距离重置剩余：${cfgResetDays} 天`;
  }
  const resetNode = subProxies.find(p => p && p.name && (p.name.includes('重置') || p.name.toLowerCase().includes('reset')));
  if (resetNode) {
    const cleanName = resetNode.name.replace(/^\[.*?\]\s*/, '').trim();
    const daysMatch = cleanName.match(/(\d+)\s*(?:天|Days?)/i);
    const dateMatch = cleanName.match(/\d{4}[-/]\d{2}[-/]\d{2}/);
    if (daysMatch) {
      return `距离重置剩余：${daysMatch[1]} 天`;
    }
    if (dateMatch) {
      return `流量重置时间：${dateMatch[0]}`;
    }
    const numMatch = cleanName.match(/\d+/);
    return numMatch ? `距离重置剩余：${numMatch[0]} 天` : cleanName;
  }
  return '';
}

/**
 * 汇总多订阅流量与到期时间
 */
function aggregateSubscriptions(collectedSubInfos = [], { expireAggregation = 'min', logger } = {}) {
  let globalUpload = 0;
  let globalDownload = 0;
  let globalTotal = 0;
  let globalExpire = 0;

  if (collectedSubInfos.length === 0) {
    return { globalUpload, globalDownload, globalTotal, globalExpire };
  }

  // 1. 流量聚合：已过期的订阅不参与综合流量聚合，避免把失效套餐流量算进总和
  const activeSubs = collectedSubInfos.filter(s => !s.expired && s.total > 0);
  const expiredSubs = collectedSubInfos.filter(s => s.expired);

  if (logger) {
    expiredSubs.forEach(s => {
      logger.warn(`↩️ 订阅${s.tag ? ` [${s.tag}]` : ''}已过期，跳过其流量聚合`);
    });
  }

  globalUpload = activeSubs.reduce((acc, s) => acc + s.upload, 0);
  globalDownload = activeSubs.reduce((acc, s) => acc + s.download, 0);
  globalTotal = activeSubs.reduce((acc, s) => acc + s.total, 0);

  // 2. 到期时间聚合：支持 min / max / first
  const subsWithExpire = collectedSubInfos.filter(s => s.expire > 0);
  if (subsWithExpire.length > 0) {
    const validSubs = subsWithExpire.filter(s => !s.expired);
    const candidatePool = validSubs.length > 0 ? validSubs : subsWithExpire;

    if (expireAggregation === 'max') {
      globalExpire = Math.max(...candidatePool.map(s => s.expire));
    } else if (expireAggregation === 'first') {
      globalExpire = candidatePool[0].expire;
    } else {
      // 默认 min：未过期取最早到期(Math.min)预警，全过期取最近失效历史时间戳(Math.max)
      globalExpire = validSubs.length > 0
        ? Math.min(...candidatePool.map(s => s.expire))
        : Math.max(...candidatePool.map(s => s.expire));
    }
  }

  return { globalUpload, globalDownload, globalTotal, globalExpire };
}

/**
 * 构建多订阅全局流量与到期汇总节点（双列网格高颜值展示）
 */
function buildGlobalDashboardNodes({ globalUpload, globalDownload, globalTotal, globalExpire, expireAggregation = 'min' }) {
  if (globalTotal <= 0 && globalExpire <= 0) return [];

  const topNodes = [];

  if (globalTotal > 0) {
    const globalRemaining = Math.max(0, globalTotal - (globalUpload + globalDownload));
    const globalPercent = ((globalRemaining / globalTotal) * 100).toFixed(1);
    const isLow = globalRemaining <= 10 * 1024 * 1024 * 1024 || (globalRemaining / globalTotal) <= 0.05;
    const globalIcon = isLow ? '🪫' : '📈';

    topNodes.push({
      name: `${globalIcon} [全局] 剩余流量：${formatBytes(globalRemaining)} / ${formatBytes(globalTotal)} (${globalPercent}%)`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    });
  }

  if (globalExpire > 0) {
    const d = new Date(globalExpire * 1000);
    const dateStr = d.toISOString().split('T')[0];
    const now = new Date();
    const days = Math.ceil((d - now) / 86400000);

    let expireLabel = '临近到期';
    if (expireAggregation === 'max') expireLabel = '最晚到期';
    else if (expireAggregation === 'first') expireLabel = '首项到期';

    let expireIcon = '⌛';
    let expireDesc = `(余 ${days} 天)`;
    if (days <= 0) {
      expireIcon = '🛑';
      expireDesc = `(已失效 ${Math.max(1, Math.floor((now - d) / 86400000))} 天)`;
    } else if (days <= 3) {
      expireIcon = '⚠️';
      expireDesc = `(仅剩 ${days} 天)`;
    }

    topNodes.push({
      name: `${expireIcon} [全局] ${expireLabel}：${dateStr} ${expireDesc}`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    });
  }

  return topNodes;
}

/**
 * 构建拉取失败的占位节点
 */
function createFetchErrorNode(effectiveTag, errorMsg = '') {
  let shortMsg = errorMsg || '抓取失败';
  if (/fetch failed/i.test(errorMsg)) shortMsg = '网络连接失败';
  else if (/timeout/i.test(errorMsg)) shortMsg = '拉取超时';
  else if (/HTTP Error: (\d+)/i.test(errorMsg)) shortMsg = `HTTP ${errorMsg.match(/HTTP Error: (\d+)/i)[1]}`;
  else if (/no nodes/i.test(errorMsg)) shortMsg = '未解析到有效节点';

  return {
    name: `❌ [${effectiveTag}] 拉取失败：${shortMsg}`,
    type: 'direct',
    server: '1.0.0.1',
    port: 80,
    isSyntheticInfo: true
  };
}

module.exports = {
  filterRawInfoNodes,
  extractResetText,
  aggregateSubscriptions,
  buildGlobalDashboardNodes,
  createFetchErrorNode,
  formatBytes,
  calcResetDays,
  generateInfoNodes
};
