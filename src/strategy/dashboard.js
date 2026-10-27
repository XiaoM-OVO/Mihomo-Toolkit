/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 状态看板与多订阅聚合中心 (Dashboard & Aggregator)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 多订阅流量与到期时间多维度聚合计算 (min / max / first)
 * 2. 识别/提取机场自带重置周期与日期
 * 3. 合成彩色状态看板虚拟节点 (流量告急、到期预警、重置倒计时、拉取失败)
 * 4. 契合客户端 2 列网格布局的全局配对汇总节点
 */

const { parseSubscriptionInfo, evaluateExpiry, formatDateInZone } = require('../infra/sub-info');
const { isNoticeNode } = require('../core/notice');
const { markTrustedSynthetic, isTrustedSynthetic, getTrustedProxyMetadata } = require('../core/node-trust');

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
  const cutoffHours = (typeof options.cutoffHours === 'number' && options.cutoffHours > 0) ? options.cutoffHours : 0;
  const timeZone = options.timeZone || '';
  const tagPrefix = tag ? `[${tag}] ` : '';

  const nodes = [];
  const { known, expired, cutoffExpired, expireDays } = evaluateExpiry(expire, cutoffHours);

  // 1. 流量状态节点（仅在未过期且总流量 > 0 时生成）
  if (!expired && total > 0) {
    const used = upload + download;
    const remaining = Math.max(0, total - used);
    const percent = ((remaining / total) * 100).toFixed(1);
    const isLow = remaining <= 5 * 1024 * 1024 * 1024 || (remaining / total) <= 0.05;
    const icon = isLow ? '🪫' : '🏷️';
    const label = isLow ? '流量告急' : '剩余流量';
    nodes.push(markTrustedSynthetic({
      name: `${icon} ${tagPrefix}${label}：${formatBytes(remaining)} / ${formatBytes(total)} (${percent}%)`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    }));
  }

  // 2. 到期状态节点
  if (known) {
    const dateStr = formatDateInZone(expire, timeZone);
    if (expired) {
      if (cutoffExpired) {
        // 主动跳过（提前停用）：尚未到到期时刻，但已按 expireCutoffHours 停用
        nodes.push(markTrustedSynthetic({
          name: `🛑 ${tagPrefix}到期日：${dateStr} (已停用)`,
          type: 'direct',
          server: '1.0.0.1',
          port: 80,
          isSyntheticInfo: true
        }));
      } else {
        // 真过期：不再计算失效天数，口径更干净
        nodes.push(markTrustedSynthetic({
          name: `🛑 ${tagPrefix}到期日：${dateStr} (已失效)`,
          type: 'direct',
          server: '1.0.0.1',
          port: 80,
          isSyntheticInfo: true
        }));
      }
    } else if (expireDays <= 0) {
      // 尚未过期但不足 1 整天：不能与「已失效」混淆
      nodes.push(markTrustedSynthetic({
        name: `⚠️ ${tagPrefix}即将到期：${dateStr} (不足 1 天，请及时续费)`,
        type: 'direct',
        server: '1.0.0.1',
        port: 80,
        isSyntheticInfo: true
      }));
    } else if (expireDays <= 3) {
      nodes.push(markTrustedSynthetic({
        name: `⚠️ ${tagPrefix}即将到期：${dateStr} (仅剩 ${expireDays} 天，请及时续费)`,
        type: 'direct',
        server: '1.0.0.1',
        port: 80,
        isSyntheticInfo: true
      }));
    } else {
      nodes.push(markTrustedSynthetic({
        name: `📅 ${tagPrefix}到期日：${dateStr} (余 ${expireDays} 天)`,
        type: 'direct',
        server: '1.0.0.1',
        port: 80,
        isSyntheticInfo: true
      }));
    }
  }

  // 3. 容灾降级标记（命中 stale 缓存时）
  if (isStale) {
    nodes.push(markTrustedSynthetic({
      name: `🔄 ${tagPrefix}拉取异常 · 已启用缓存兜底`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    }));
  }

  return { nodes, expireDays };
}

/**
 * 过滤机场原生自带的说明/伪节点 (权威复用 isNoticeNode 判定，绝不误伤真实代理节点与合成看板)
 */
function filterRawInfoNodes(proxies = [], logger) {
  if (!Array.isArray(proxies)) return [];
  return proxies.filter(p => {
    if (!p || typeof p !== 'object') return false;
    if (isTrustedSynthetic(p)) return true;
    if (isNoticeNode(p)) {
      if (logger) logger.debug(`🗑️ [说明过滤] 「${p.name || getTrustedProxyMetadata(p, 'rawName')}」`);
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
      logger.warn(s.tag
        ? `↩️ 订阅 [${s.tag}] 已失效，跳过其流量聚合`
        : '↩️ 订阅已失效，跳过其流量聚合');
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
function buildGlobalDashboardNodes({ globalUpload, globalDownload, globalTotal, globalExpire, expireAggregation = 'min', cutoffHours = 0, timeZone = '' }) {
  if (globalTotal <= 0 && globalExpire <= 0) return [];

  const topNodes = [];

  if (globalTotal > 0) {
    const globalRemaining = Math.max(0, globalTotal - (globalUpload + globalDownload));
    const globalPercent = ((globalRemaining / globalTotal) * 100).toFixed(1);
    const isLow = globalRemaining <= 10 * 1024 * 1024 * 1024 || (globalRemaining / globalTotal) <= 0.05;
    const globalIcon = isLow ? '🪫' : '📈';

    topNodes.push(markTrustedSynthetic({
      name: `${globalIcon} [全局] 剩余流量：${formatBytes(globalRemaining)} / ${formatBytes(globalTotal)} (${globalPercent}%)`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    }));
  }

  if (globalExpire > 0) {
    const dateStr = formatDateInZone(globalExpire, timeZone);
    const { expired, cutoffExpired, expireDays: days } = evaluateExpiry(globalExpire, cutoffHours);

    let expireLabel = '最早到期';
    if (expireAggregation === 'max') expireLabel = '最晚到期';
    else if (expireAggregation === 'first') expireLabel = '首项到期';

    let expireIcon = '⌛';
    let expireDesc = `(余 ${days} 天)`;
    if (expired) {
      // 主动跳过或真过期：统一收敛为「到期日」，避免「最早到期 + 已停用」语义打架
      expireIcon = '🛑';
      expireLabel = '到期日';
      expireDesc = cutoffExpired ? '(已停用)' : '(已失效)';
    } else if (days <= 0) {
      expireIcon = '⚠️';
      expireDesc = '(不足 1 天)';
    } else if (days <= 3) {
      expireIcon = '⚠️';
      expireDesc = `(仅剩 ${days} 天)`;
    }

    topNodes.push(markTrustedSynthetic({
      name: `${expireIcon} [全局] ${expireLabel}：${dateStr} ${expireDesc}`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    }));
  }

  return topNodes;
}

/**
 * 构建拉取失败的占位节点
 *
 * @param {string} effectiveTag 订阅标识
 * @param {string} [errorMsg] 原始错误或管道层给出的中文终态原因（已为中文时原样透传）
 */
function createFetchErrorNode(effectiveTag, errorMsg = '') {
  // 退避期并非一次失败事件，单独渲染，避免「拉取失败：暂缓拉取」的自相矛盾
  if (/fetch skipped/i.test(errorMsg)) {
    return markTrustedSynthetic({
      name: `⏳ [${effectiveTag}] 暂缓拉取 · 退避中`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    });
  }

  let shortMsg = errorMsg || '拉取失败';
  if (/fetch failed/i.test(errorMsg)) shortMsg = '网络连接失败';
  else if (/timeout/i.test(errorMsg)) shortMsg = '拉取超时';
  else if (/HTTP Error: (\d+)/i.test(errorMsg)) shortMsg = `HTTP ${errorMsg.match(/HTTP Error: (\d+)/i)[1]}`;
  else if (/no nodes/i.test(errorMsg)) shortMsg = '未解析到有效节点';
  else if (/placeholder/i.test(errorMsg)) shortMsg = '仅返回占位/续费节点';
  else if (/expired/i.test(errorMsg)) shortMsg = '订阅已失效';
  else if (/quota exhausted/i.test(errorMsg)) shortMsg = '流量已耗尽';

  return markTrustedSynthetic({
    name: `❌ [${effectiveTag}] 拉取失败：${shortMsg}`,
    type: 'direct',
    server: '1.0.0.1',
    port: 80,
    isSyntheticInfo: true
  });
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
