/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 状态看板与多订阅聚合中心 (Dashboard & Aggregator)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 多订阅流量与到期时间多维度聚合计算 (min / max / first)
 * 2. 识别/提取机场自带重置周期与日期
 * 3. 结构化合成状态看板虚拟节点 (流量告急、到期预警、重置倒计时、拉取失败)
 * 4. 契合客户端 2 列网格布局的四层排版体系 (全局 -> 常规成对 -> 纯流量 -> 状态垫底)
 */

const { parseSubscriptionInfo, evaluateExpiry, formatDateInZone } = require('../infra/sub-info');
const { isNoticeNode } = require('../core/notice');
const { markTrustedSynthetic, isTrustedSynthetic, getTrustedProxyMetadata } = require('../core/node-trust');
const { ICONS, TERMS } = require('../core/log-copy');

/**
 * 看板节点四层排版梯队定义 (契合客户端 2 列 Grid 布局)
 */
const DASHBOARD_TIER = Object.freeze({
  GLOBAL: 1,       // 第 1 梯队：全局总盘
  TIMED: 2,        // 第 2 梯队：常规时限订阅 (成对排列：左到期，右流量)
  TRAFFIC_ONLY: 3, // 第 3 梯队：纯流量无时限订阅 (同类并排，不插队破坏常规对称)
  STATUS: 4        // 第 4 梯队：状态与异常垫底 (重置、旧缓存兜底、失效停用、拉取报错)
});

const SUB_KIND = Object.freeze({
  GLOBAL_EXPIRY: 'global_expiry',
  GLOBAL_TRAFFIC: 'global_traffic',
  TIMED_EXPIRY: 'timed_expiry',
  TIMED_TRAFFIC: 'timed_traffic',
  TRAFFIC_ONLY: 'traffic_only',
  RESET: 'reset',
  FALLBACK: 'fallback',
  CUTOFF: 'cutoff',
  EXPIRED: 'expired',
  ERROR: 'error'
});

/** 模块私有看板节点结构化元数据映射 (GC 友好，零属性污染) */
const DASHBOARD_NODE_META = new WeakMap();

/**
 * 赋予 synthetic 节点受信标记与结构化元数据
 */
function tagSyntheticNode(node, { tier, subKind, tag = '' }) {
  markTrustedSynthetic(node);
  DASHBOARD_NODE_META.set(node, { tier, subKind, tag });
  return node;
}

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
 * 提取节点名中的标签段（第一个方括号），无标签返回空串
 */
function extractNodeTag(name = '') {
  const match = /\[([^\]]+)\]/.exec(name);
  return match ? match[1] : '';
}

/**
 * 根据 subscription-userinfo 头合成流量状态与到期提示节点
 */
function generateInfoNodes(subInfo, tag, options = {}) {
  const isStale = !!options.isStale;
  const tagPrefix = tag ? `[${tag}] ` : '';
  const resetText = options.resetText || '';

  // 无 subscription-userinfo 的订阅也必须能透出重置或降级状态：
  if (!subInfo) {
    const nodes = [];
    if (resetText) nodes.push(createResetNode(tag, resetText));
    if (isStale) nodes.push(createFallbackStaleNode(tag));
    return { nodes, expireDays: -1 };
  }

  const { upload, download, total, expire } = parseSubscriptionInfo(subInfo);
  const cutoffHours = (typeof options.cutoffHours === 'number' && options.cutoffHours > 0) ? options.cutoffHours : 0;
  const timeZone = options.timeZone || '';

  const nodes = [];
  const { known, expired, cutoffExpired, expireDays } = evaluateExpiry(expire, cutoffHours);

  // 1. 到期状态节点
  if (known) {
    const dateStr = formatDateInZone(expire, timeZone);
    if (expired) {
      if (cutoffExpired) {
        // 主动跳过（提前停用）：归入 Tier 4 状态区垫底
        nodes.push(tagSyntheticNode({
          name: `🛑 ${tagPrefix}到期日：${dateStr} (已停用)`,
          type: 'direct',
          server: '1.0.0.1',
          port: 80,
          isSyntheticInfo: true
        }, { tier: DASHBOARD_TIER.STATUS, subKind: SUB_KIND.CUTOFF, tag }));
      } else {
        // 真过期：归入 Tier 4 状态区垫底
        nodes.push(tagSyntheticNode({
          name: `🛑 ${tagPrefix}到期日：${dateStr} (已失效)`,
          type: 'direct',
          server: '1.0.0.1',
          port: 80,
          isSyntheticInfo: true
        }, { tier: DASHBOARD_TIER.STATUS, subKind: SUB_KIND.EXPIRED, tag }));
      }
    } else {
      // 尚未过期 -> 正常带时限订阅 (Tier 2)
      let name;
      if (expireDays <= 0) {
        name = `⚠️ ${tagPrefix}即将到期：${dateStr} (不足 1 天，请及时续费)`;
      } else if (expireDays <= 3) {
        name = `⚠️ ${tagPrefix}即将到期：${dateStr} (仅剩 ${expireDays} 天，请及时续费)`;
      } else {
        name = `📅 ${tagPrefix}到期日：${dateStr} (余 ${expireDays} 天)`;
      }
      nodes.push(tagSyntheticNode({
        name,
        type: 'direct',
        server: '1.0.0.1',
        port: 80,
        isSyntheticInfo: true
      }, { tier: DASHBOARD_TIER.TIMED, subKind: SUB_KIND.TIMED_EXPIRY, tag }));
    }
  }

  // 2. 流量状态节点（仅在未过期且总流量 > 0 时生成）
  if (!expired && total > 0) {
    const used = upload + download;
    const remaining = Math.max(0, total - used);
    const percent = ((remaining / total) * 100).toFixed(1);
    const isLow = remaining <= 5 * 1024 * 1024 * 1024 || (remaining / total) <= 0.05;
    const icon = isLow ? '🪫' : '🏷️';
    const label = isLow ? '流量告急' : '剩余流量';

    // 如果有时限，作为 Tier 2 常规成对节点；如果无时限，作为 Tier 3 纯流量节点
    const isTimed = known && !expired;
    const tier = isTimed ? DASHBOARD_TIER.TIMED : DASHBOARD_TIER.TRAFFIC_ONLY;
    const subKind = isTimed ? SUB_KIND.TIMED_TRAFFIC : SUB_KIND.TRAFFIC_ONLY;

    nodes.push(tagSyntheticNode({
      name: `${icon} ${tagPrefix}${label}：${formatBytes(remaining)} / ${formatBytes(total)} (${percent}%)`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    }, { tier, subKind, tag }));
  }

  // 3. 机场自带重置周期节点 (归入 Tier 4 状态区垫底)
  if (resetText && (expireDays === -1 || expireDays > 30)) {
    nodes.push(createResetNode(tag, resetText));
  }

  // 4. 容灾降级标记（命中 stale 缓存时，归入 Tier 4 状态区垫底）
  if (isStale) nodes.push(createFallbackStaleNode(tag));

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
function aggregateSubscriptions(collectedSubInfos = [], { expireAggregation = 'min', logger, warnExpiredSubs = true } = {}) {
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

  if (logger && warnExpiredSubs) {
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
 * 构建多订阅全局流量与到期汇总节点（Tier 1 全局总盘）
 */
function buildGlobalDashboardNodes({ globalUpload, globalDownload, globalTotal, globalExpire, expireAggregation = 'min', cutoffHours = 0, timeZone = '' }) {
  if (globalTotal <= 0 && globalExpire <= 0) return [];

  const topNodes = [];

  // 全局成对时：到期在左（前），流量在右（后），与 Tier 2 常规订阅对齐
  if (globalExpire > 0) {
    const dateStr = formatDateInZone(globalExpire, timeZone);
    const { expired, cutoffExpired, expireDays: days } = evaluateExpiry(globalExpire, cutoffHours);

    let expireLabel = '最早到期';
    if (expireAggregation === 'max') expireLabel = '最晚到期';
    else if (expireAggregation === 'first') expireLabel = '首项到期';

    let expireIcon = '⌛';
    let expireDesc = `(余 ${days} 天)`;
    if (expired) {
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

    topNodes.push(tagSyntheticNode({
      name: `${expireIcon} [全局] ${expireLabel}：${dateStr} ${expireDesc}`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    }, { tier: DASHBOARD_TIER.GLOBAL, subKind: SUB_KIND.GLOBAL_EXPIRY, tag: '全局' }));
  }

  if (globalTotal > 0) {
    const globalRemaining = Math.max(0, globalTotal - (globalUpload + globalDownload));
    const globalPercent = ((globalRemaining / globalTotal) * 100).toFixed(1);
    const isLow = globalRemaining <= 10 * 1024 * 1024 * 1024 || (globalRemaining / globalTotal) <= 0.05;
    const globalIcon = isLow ? '🪫' : '📈';

    topNodes.push(tagSyntheticNode({
      name: `${globalIcon} [全局] 剩余流量：${formatBytes(globalRemaining)} / ${formatBytes(globalTotal)} (${globalPercent}%)`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    }, { tier: DASHBOARD_TIER.GLOBAL, subKind: SUB_KIND.GLOBAL_TRAFFIC, tag: '全局' }));
  }

  return topNodes;
}

/**
 * 构建拉取失败的占位节点 (Tier 4 状态区垫底)
 *
 * @param {string} effectiveTag 订阅标识
 * @param {string} [errorMsg] 原始错误或管道层给出的中文终态原因（已为中文时原样透传）
 */
function createFetchErrorNode(effectiveTag, errorMsg = '') {
  // 退避期并非一次失败事件，单独渲染，避免与「拉取失败」自相矛盾
  if (/fetch skipped/i.test(errorMsg)) {
    return tagSyntheticNode({
      name: `${ICONS.BACKOFF} [${effectiveTag}] ${TERMS.BACKOFF_SKIP} · 无可用缓存`,
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    }, { tier: DASHBOARD_TIER.STATUS, subKind: SUB_KIND.ERROR, tag: effectiveTag });
  }

  let shortMsg = errorMsg || TERMS.FETCH_FAILED;
  if (/fetch failed/i.test(errorMsg)) shortMsg = '网络连接失败';
  else if (/SSRF 预检失败/i.test(errorMsg)) {
    shortMsg = /域名解析失败/i.test(errorMsg) ? '域名解析失败' : '安全策略拦截';
  } else if (/timeout/i.test(errorMsg)) shortMsg = '拉取超时';
  else if (/HTTP Error: (\d+)/i.test(errorMsg)) shortMsg = `HTTP ${errorMsg.match(/HTTP Error: (\d+)/i)[1]}`;
  else if (/no nodes/i.test(errorMsg)) shortMsg = '未解析到有效节点';
  else if (/placeholder/i.test(errorMsg)) shortMsg = '仅返回占位/续费节点';
  else if (/expired/i.test(errorMsg)) shortMsg = '订阅已失效';
  else if (/quota exhausted/i.test(errorMsg)) shortMsg = '流量已耗尽';

  return tagSyntheticNode({
    name: `${ICONS.FETCH_FAILED} [${effectiveTag}] ${TERMS.FETCH_FAILED}：${shortMsg}`,
    type: 'direct',
    server: '1.0.0.1',
    port: 80,
    isSyntheticInfo: true
  }, { tier: DASHBOARD_TIER.STATUS, subKind: SUB_KIND.ERROR, tag: effectiveTag });
}

/**
 * 构建重置倒计时节点 (Tier 4 状态区垫底)
 */
function createResetNode(tag, resetText) {
  const tagPrefix = tag ? `[${tag}] ` : '';
  return tagSyntheticNode({
    name: `${ICONS.DEGRADED} ${tagPrefix}${resetText}`,
    type: 'direct',
    server: '1.0.0.1',
    port: 80,
    isSyntheticInfo: true
  }, { tier: DASHBOARD_TIER.STATUS, subKind: SUB_KIND.RESET, tag });
}

/**
 * 构建降级旧缓存兜底提示节点 (Tier 4 状态区垫底)
 */
function createFallbackStaleNode(tag) {
  const tagPrefix = tag ? `[${tag}] ` : '';
  return tagSyntheticNode({
    name: `${ICONS.DEGRADED} ${tagPrefix}拉取异常 · 当前为旧缓存`,
    type: 'direct',
    server: '1.0.0.1',
    port: 80,
    isSyntheticInfo: true
  }, { tier: DASHBOARD_TIER.STATUS, subKind: SUB_KIND.FALLBACK, tag });
}

/**
 * 读取节点元数据（优先读取私有 WeakMap 结构化元数据，旧 mock 对象通过确定性规则平滑降级）
 */
function getNodeMeta(node) {
  if (!node || !isTrustedSynthetic(node) || !node.isSyntheticInfo) {
    return null;
  }
  const cached = DASHBOARD_NODE_META.get(node);
  if (cached) return cached;

  // Fallback 兼容：支持外部单元测试直接 markTrustedSynthetic 构造的 mock 节点
  const name = node.name || '';
  const tag = extractNodeTag(name);
  if (tag === '全局') {
    return {
      tier: DASHBOARD_TIER.GLOBAL,
      subKind: name.includes('到期') ? SUB_KIND.GLOBAL_EXPIRY : SUB_KIND.GLOBAL_TRAFFIC,
      tag
    };
  }
  if (/已失效|已停用/.test(name)) {
    return {
      tier: DASHBOARD_TIER.STATUS,
      subKind: name.includes('已停用') ? SUB_KIND.CUTOFF : SUB_KIND.EXPIRED,
      tag
    };
  }
  if (/拉取异常|回源异常|旧缓存/.test(name)) {
    return { tier: DASHBOARD_TIER.STATUS, subKind: SUB_KIND.FALLBACK, tag };
  }
  if (/重置/.test(name)) {
    return { tier: DASHBOARD_TIER.STATUS, subKind: SUB_KIND.RESET, tag };
  }
  if (/拉取失败|跳过/.test(name)) {
    return { tier: DASHBOARD_TIER.STATUS, subKind: SUB_KIND.ERROR, tag };
  }
  if (name.includes('到期')) {
    return { tier: DASHBOARD_TIER.TIMED, subKind: SUB_KIND.TIMED_EXPIRY, tag };
  }
  if (/剩余流量|流量告急/.test(name)) {
    return { tier: DASHBOARD_TIER.TIMED, subKind: SUB_KIND.TIMED_TRAFFIC, tag };
  }
  return { tier: DASHBOARD_TIER.STATUS, subKind: 'unknown_status', tag };
}

/**
 * 重排看板节点：严格落实四层网格排版法则
 *
 * 梯队结构 (从上到下)：
 * 1. Tier 1 全局总盘：多源综合概览，永远稳居顶部
 * 2. Tier 2 常规成对订阅：有时限订阅，逐订阅 [到期, 流量] 成对输出，绝对保证双列对齐
 * 3. Tier 3 纯流量订阅：无时限订阅，同类收拢并排，不插队破坏第二梯队对称
 * 4. Tier 4 状态与异常垫底：重置倒计时、旧缓存兜底、失效停用、拉取报错按秩序沉底
 *
 * 后续非 synthetic 节点原样后排。
 */
function sortDashboardNodes(nodes = []) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  const tier1Global = [];
  const tier2ByTag = new Map(); // tag -> { expiry: [], traffic: [] }
  const tier3TrafficOnly = [];
  const tier4Status = [];
  const rest = [];

  for (const node of nodes) {
    const meta = getNodeMeta(node);
    if (!meta) {
      rest.push(node);
      continue;
    }

    if (meta.tier === DASHBOARD_TIER.GLOBAL) {
      tier1Global.push(node);
    } else if (meta.tier === DASHBOARD_TIER.TIMED) {
      const tag = meta.tag || '';
      if (!tier2ByTag.has(tag)) {
        tier2ByTag.set(tag, { expiry: [], traffic: [] });
      }
      const bucket = tier2ByTag.get(tag);
      if (meta.subKind === SUB_KIND.TIMED_EXPIRY) {
        bucket.expiry.push(node);
      } else {
        bucket.traffic.push(node);
      }
    } else if (meta.tier === DASHBOARD_TIER.TRAFFIC_ONLY) {
      tier3TrafficOnly.push(node);
    } else if (meta.tier === DASHBOARD_TIER.STATUS) {
      tier4Status.push(node);
    } else {
      rest.push(node);
    }
  }

  // 1. Tier 1 全局节点：成对优先（到期在左，流量在右）
  const tier1Ordered = [];
  const globalExpiry = tier1Global.find(n => getNodeMeta(n)?.subKind === SUB_KIND.GLOBAL_EXPIRY);
  const globalTraffic = tier1Global.find(n => getNodeMeta(n)?.subKind === SUB_KIND.GLOBAL_TRAFFIC);
  if (globalExpiry) tier1Ordered.push(globalExpiry);
  if (globalTraffic) tier1Ordered.push(globalTraffic);
  for (const n of tier1Global) {
    if (n !== globalExpiry && n !== globalTraffic) tier1Ordered.push(n);
  }

  // 2. Tier 2 常规成对节点：各订阅 [到期, 流量] 俩俩成对
  const tier2Ordered = [];
  for (const [, bucket] of tier2ByTag.entries()) {
    while (bucket.expiry.length > 0 && bucket.traffic.length > 0) {
      tier2Ordered.push(bucket.expiry.shift(), bucket.traffic.shift());
    }
    // 若有偶发的单出节点，移入 Tier 3 / Tier 4，绝不破坏 Tier 2 双列对称
    if (bucket.traffic.length > 0) {
      tier3TrafficOnly.push(...bucket.traffic);
    }
    if (bucket.expiry.length > 0) {
      tier4Status.push(...bucket.expiry);
    }
  }

  // 3. Tier 3 纯流量节点：同类并排，集中排列
  const tier3Ordered = tier3TrafficOnly;

  // 4. Tier 4 状态与异常节点：保持原有发现顺序沉底
  const tier4Ordered = tier4Status;

  return [...tier1Ordered, ...tier2Ordered, ...tier3Ordered, ...tier4Ordered, ...rest];
}

module.exports = {
  filterRawInfoNodes,
  extractResetText,
  aggregateSubscriptions,
  buildGlobalDashboardNodes,
  createFetchErrorNode,
  createResetNode,
  createFallbackStaleNode,
  sortDashboardNodes,
  formatBytes,
  calcResetDays,
  generateInfoNodes,
  DASHBOARD_TIER,
  SUB_KIND
};

