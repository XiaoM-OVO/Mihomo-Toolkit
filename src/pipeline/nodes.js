/**
 * 节点清洗流水线 (nodes pipeline)
 *
 * 专注节点过滤、去重、属性提取、重命名与无效/说明节点拦截，适用于 Sub-Store Operator 及轻量清洗场景。
 */

const { resolveConfig } = require('../config');
const { dedupeNodes } = require('../core/dedupe');
const { classifyNode, matchUserBlacklist, getFeatureRules } = require('../core/cleaner');
const { buildRenamePlan, applyRenamePlan } = require('../core/rename');
const { markTrustedCleanedNode, getTrustedProxyMetadata } = require('../core/node-trust');
const { sortNodes } = require('../core/sort');
const { getEnhancedRegionDefs } = require('../core/shared/regions');
// Name rendering and feature variables are owned by core/rename.
const { FEATURE_TEXT_MAP } = require('../core/shared/icons');
const { resolveProxiesDomains } = require('../io/dns-resolver');
const { resolveProxyUrl } = require('../io/fetcher');
const { fissionNodes } = require('../core/fission');
const { createEnvelopesBypass } = require('./envelope');

/**
 * 执行纯净节点清洗与标准化流水线
 * @param {Array<object>} proxies 原始节点数组
 * @param {object} [userConfig={}] 用户自定义配置
 * @returns {Promise<Array<object>>} 清洗后的纯净节点数组
 */
async function runNodesPipeline(proxies = [], userConfig = {}) {
  const config = resolveConfig(userConfig);
  const logger = userConfig.logger;
  let currentProxies = Array.isArray(proxies) ? proxies : [];
  const totalCount = currentProxies.length;

  // 0. 旁路接入: 只读 Envelope 与节点元数据提取 (零副作用，单节点异常隔离)
  try {
    createEnvelopesBypass(currentProxies, { logger });
  } catch (bypassErr) {
    if (logger && typeof logger.debug === 'function') {
      logger.debug(`⚠️ [Envelope 旁路] 批次处理异常: ${bypassErr?.message || bypassErr}`);
    }
  }

  let discardedCount = 0;
  let dedupeCount = 0;
  let fissionCount = 0;
  let infoCount = 0;
  let unknownCount = 0;

  // 1. 前置安全门禁：防御非法输入 + 用户黑名单检查 (必须在物理去重前执行，确保黑名单节点不抢先去重掉后续正常节点)
  const unblockedProxies = [];
  for (const p of currentProxies) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      discardedCount++;
      if (logger) logger.debug(`🗑️ [阻断] 无效节点数据`);
      continue;
    }
    const rawName = getTrustedProxyMetadata(p, 'rawName') || p.name || '';
    const blacklistReason = matchUserBlacklist(p, rawName, config);
    if (blacklistReason) {
      discardedCount++;
      if (logger) logger.debug(`🗑️ [阻断] 「${rawName}」 原因: ${blacklistReason}`);
      continue;
    }
    unblockedProxies.push(p);
  }
  currentProxies = unblockedProxies;

  // 2. 物理特征去重 (仅对未命中黑名单的合法候选节点去重)
  if (config.enableDedupe) {
    const beforeDedupe = currentProxies.length;
    currentProxies = dedupeNodes(currentProxies, {
      onDuplicate: (dup, exist) => {
        if (logger) logger.debug(`🧽 [去重] 「${dup.name}」与「${exist.name}」重复，已剔除`);
      }
    });
    dedupeCount = beforeDedupe - currentProxies.length;
  }

  // 3. 域名多 IP 节点裂变 (I/O 解析域名 -> Core 纯函数裂变)
  if (config.enableFission) {
    const beforeFission = currentProxies.length;
    // DoH 兜底与订阅抓取保持同一出口策略：仅当选择 proxy/auto 出口时经本地回环代理
    const proxyStrategy = config.fetchProxyStrategy || 'direct';
    const dohProxyUrl = (proxyStrategy === 'proxy' || proxyStrategy === 'auto') ? resolveProxyUrl(config) : '';
    const domainIpsMap = await resolveProxiesDomains(currentProxies, { ...config, dohProxyUrl });
    currentProxies = fissionNodes(currentProxies, domainIpsMap, config);
    fissionCount = Math.max(0, currentProxies.length - beforeFission);
  }

  // 3.5 裂变后黑名单复查 (防止域名解析为 IP 后绕过 blockServers)
  if (fissionCount > 0) {
    const postFissionProxies = [];
    for (const p of currentProxies) {
      const rawName = getTrustedProxyMetadata(p, 'rawName') || p.name || '';
      const blacklistReason = matchUserBlacklist(p, rawName, config);
      if (blacklistReason) {
        discardedCount++;
        if (logger) logger.debug(`🗑️ [阻断] 裂变节点「${rawName}」 原因: ${blacklistReason}`);
        continue;
      }
      postFissionProxies.push(p);
    }
    currentProxies = postFissionProxies;
  }

  // 4. 深度清洗打标与硬结构校验 (classifyNode 内置自包含黑名单保护，针对独立调用提供兜底)
  const regionDefs = getEnhancedRegionDefs();
  const featureRules = getFeatureRules(config);
  const classified = currentProxies.map(p => classifyNode(p, config, { regionDefs, featureRules }));

  // 5. 过滤被阻断或无效/说明节点
  const validItems = classified.filter(item => {
    if (item.skip) {
      discardedCount++;
      if (logger) logger.debug(`🗑️ [阻断] 「${item.rawName}」 原因: ${item.blockReason}`);
      return false;
    }
    if (item.isInfo) {
      infoCount++;
      if (config.removeInfoNodes && !item.isSyntheticInfo) {
        if (logger) logger.debug(`🗑️ [说明过滤] 「${item.rawName}」`);
        return false;
      }
    }
    if (!item.regionInfo || item.regionInfo.isUnknown) {
      unknownCount++;
      if (logger && !item.isInfo && !item.isSpecial) {
        logger.debug(`❓ [未识别地区] 「${item.rawName}」`);
      }
    }
    return true;
  });

  // 4.5 多维智能排序 (Core 纯函数)
  const effectiveItems = config.enableNodeSort
    ? sortNodes(validItems, config)
    : validItems;

  // 5. 统一计算动态序号与重命名计划，并完成两阶段冲突仲裁与最终名称提交
  const isRenameEnabled = config.enableNodeRename !== false;
  const renamePlan = buildRenamePlan(effectiveItems, isRenameEnabled ? config : { ...config, enableNodeRename: false });
  const finalNames = applyRenamePlan(effectiveItems, renamePlan);
  for (const item of effectiveItems) markTrustedCleanedNode(item.proxy);

  const catalogTexts = {};
  if (config.catalog && typeof config.catalog.getCoreMatchers === 'function') {
    config.catalog.getCoreMatchers().forEach(m => {
      if (m.uiText) catalogTexts[m.tag] = m.uiText;
    });
  }
  const effectiveFeatureTexts = { ...FEATURE_TEXT_MAP, ...catalogTexts };

  const buildDestinationLine = (item) => {
    const tags = item.tags || [];
    const multi = item.attrs?.multiNum ?? 1;
    const highMultiThreshold = config.highMultiThreshold ?? 2.5;

    let groupName = '';
    let isolateReason = '';

    if (config.enableResidential && tags.includes('residential')) {
      groupName = '🏠 家宽优选';
      isolateReason = '家宽隔离';
    } else if (config.isolateHighMulti && multi > highMultiThreshold) {
      groupName = '🛑 高倍率节点';
      isolateReason = '高倍率隔离';
    } else if (config.isolateDownload && tags.includes('download')) {
      groupName = '⏬ 下载策略';
      isolateReason = '低倍率隔离';
    } else if (config.isolateExperimental && tags.includes('experimental')) {
      groupName = '🧪 实验节点';
      isolateReason = '实验节点隔离';
    } else if (item.regionInfo) {
      const icon = item.regionInfo.icon ? `${item.regionInfo.icon} ` : '';
      groupName = `${icon}${item.regionInfo.name}节点`;
    } else {
      groupName = '🌐 其他节点';
    }

    const parts = [`[归组]: ${groupName}${isolateReason ? ` (${isolateReason})` : ''}`];

    // 仅展示命中并影响策略分流的业务池 (如 AI, 流媒体, 游戏, 家宽)，绝不重复已在节点名中呈现的协议与线路
    const activePools = (item.featurePools || []).filter(p => p !== 'unknown');
    const poolLabels = activePools.map(p => effectiveFeatureTexts[p] || p);
    if (poolLabels.length > 0) {
      parts.push(`业务: ${poolLabels.join(' · ')}`);
    }

    return `└─ ${parts.join(' | ')}`;
  };

  const resultProxies = effectiveItems.map(item => {
    if (item.isSpecial || item.isInfo || item.keepName) return item.proxy;
    if (!item.regionInfo) return item.proxy;

    if (isRenameEnabled && config.renameTemplate) {
      const newName = finalNames.get(item) || item.proxy?.name || '';
      if (newName) {
        if (logger) {
          const detailLine = buildDestinationLine(item);
          if (newName !== item.rawName) {
            logger.debug(`✅ [清洗] 「${item.rawName}」 → 「${newName}」\n${detailLine}`);
          } else {
            logger.debug(`📌 [识别] 「${item.rawName}」\n${detailLine}`);
          }
        }
      }
    } else {
      if (logger) {
        const detailLine = buildDestinationLine(item);
        logger.debug(`📌 [识别] 「${item.proxy.name || item.rawName}」\n${detailLine}`);
      }
    }

    // 注入节点连接 IP 栈策略 (Mihomo 原生 ip-version 字段)
    if (config.nodeIpVersion && typeof config.nodeIpVersion === 'string') {
      const v = config.nodeIpVersion.trim().toLowerCase();
      const VALID_IP_VERSIONS = ['dual', 'ipv4', 'ipv6', 'ipv4-prefer', 'ipv6-prefer'];
      if (VALID_IP_VERSIONS.includes(v)) {
        item.proxy['ip-version'] = v;
      }
    }

    markTrustedCleanedNode(item.proxy);
    return item.proxy;
  });

  const stats = {
    total: totalCount,
    outputCount: resultProxies.length,
    dedupeCount,
    discardedCount,
    infoCount,
    unknownCount,
    fissionCount
  };

  if (userConfig.withClassified) {
    return {
      proxies: resultProxies,
      classifiedNodes: effectiveItems,
      meta: { stats }
    };
  }

  return resultProxies;
}

module.exports = {
  runNodesPipeline
};
