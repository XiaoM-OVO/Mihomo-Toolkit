/**
 * 节点清洗流水线 (nodes pipeline)
 *
 * 专注节点过滤、去重、属性提取、重命名与垃圾节点拦截，适用于 Sub-Store Operator 及轻量清洗场景。
 */

const { resolveConfig } = require('../config');
const { dedupeNodes } = require('../core/dedupe');
const { classifyNode } = require('../core/cleaner');
const { renderTemplate, createSeparatorCleaners, computeNodeIndices } = require('../core/rename');
const { getEnhancedRegionDefs } = require('../core/shared/regions');
const { PROTOCOL_ICONS, FEATURE_ICONS, FEATURE_TEXT_MAP } = require('../core/shared/icons');
const { resolveProxiesDomains } = require('../io/dns-resolver');
const { fissionNodes } = require('../core/fission');

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

  // 1. 物理特征去重
  let dedupeCount = 0;
  if (config.enableDedupe) {
    const beforeDedupe = currentProxies.length;
    currentProxies = dedupeNodes(currentProxies, {
      onDuplicate: (dup, exist) => {
        if (logger) logger.debug(`🧽 [去重] 「${dup.name}」与「${exist.name}」重复，已移除`);
      }
    });
    dedupeCount = beforeDedupe - currentProxies.length;
  }

  // 2. 域名多 IP 节点裂变 (I/O 解析域名 -> Core 纯函数裂变)
  let fissionCount = 0;
  if (config.enableFission) {
    const beforeFission = currentProxies.length;
    const domainIpsMap = await resolveProxiesDomains(currentProxies, config);
    currentProxies = fissionNodes(currentProxies, domainIpsMap, config);
    fissionCount = Math.max(0, currentProxies.length - beforeFission);
  }

  // 3. 深度清洗打标
  const regionDefs = getEnhancedRegionDefs();
  const classified = currentProxies.map(p => classifyNode(p, config, { regionDefs }));

  // 4. 过滤被阻断或垃圾节点
  let discardedCount = 0;
  let infoCount = 0;
  let unknownCount = 0;

  const validItems = classified.filter(item => {
    if (item.skip) {
      discardedCount++;
      if (logger) logger.debug(`🗑️ [阻断/垃圾] 「${item.rawName}」 原因: ${item.blockReason}`);
      return false;
    }
    if (item.isInfo) {
      infoCount++;
      if (config.removeInfoNodes && !item.isSyntheticInfo) {
        if (logger) logger.debug(`🗑️ [信息说明] 「${item.rawName}」`);
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

  // 5. 统一计算动态序号与重命名
  const templateCleaners = createSeparatorCleaners(config.renameSeparators);
  const renameTemplate = config.renameTemplate;
  const isRenameEnabled = config.enableNodeRename !== false && config.enableStandardRename !== false;

  const indexMap = computeNodeIndices(validItems, config);

  // 动态合并来自 catalog 的特征图标与文本
  const catalogIcons = {};
  const catalogTexts = {};
  if (config.catalog && typeof config.catalog.getCoreMatchers === 'function') {
    config.catalog.getCoreMatchers().forEach(m => {
      if (m.uiIcon) catalogIcons[m.tag] = m.uiIcon;
      if (m.uiText) catalogTexts[m.tag] = m.uiText;
    });
  }
  const effectiveFeatureIcons = { ...FEATURE_ICONS, ...catalogIcons };
  const effectiveFeatureTexts = { ...FEATURE_TEXT_MAP, ...catalogTexts };

  const resultProxies = validItems.map(item => {
    if (item.isSpecial || item.isInfo) return item.proxy;
    if (!item.regionInfo) return item.proxy;

    const buildDestinationLine = () => {
      const icon = item.regionInfo?.icon ? `${item.regionInfo.icon} ` : '';
      const regionName = item.regionInfo ? `${item.regionInfo.name}节点` : '🌐 其他节点';
      const parts = [`[归组]: ${icon}${regionName}`];

      if (item.destCity) {
        parts.push(`城市: ${item.destCity}`);
      }

      const featureTokens = [];
      if (item.tags?.includes('download') || item.attrs?.isLowMulti) {
        featureTokens.push('低倍率');
      }
      (item.tags || []).forEach(t => {
        if (t === 'download' || t === 'garbage') return;
        const text = effectiveFeatureTexts[t] || t;
        if (!featureTokens.includes(text)) featureTokens.push(text);
      });
      if (item.transportTag && !featureTokens.includes(item.transportTag)) {
        featureTokens.push(item.transportTag);
      }
      if (item.attrs?.cleanLines && !featureTokens.includes(item.attrs.cleanLines)) {
        featureTokens.push(item.attrs.cleanLines);
      }
      if (featureTokens.length > 0) {
        parts.push(`特征: ${featureTokens.join(' · ')}`);
      }

      if (item.attrs?.multiStr) {
        parts.push(`倍率: ${item.attrs.multiStr}`);
      }

      return `└─ ${parts.join(' | ')}`;
    };

    if (isRenameEnabled && renameTemplate) {
      let featureStr = '';
      (item.tags || []).forEach(t => {
        if (t === 'ipv6' || t === 'dualstack') return;
        if (config.showFeatureIcon !== false) {
          if (effectiveFeatureIcons[t]) featureStr += effectiveFeatureIcons[t];
        } else {
          if (effectiveFeatureTexts[t]) featureStr += (featureStr ? '/' : '') + effectiveFeatureTexts[t];
        }
      });

      const protocolIcon = PROTOCOL_ICONS[item.pType] || '';
      const numStr = indexMap.get(item) || '';

      const vars = {
        airport: item.airportTag || '',
        icon: item.regionInfo.icon || '',
        region: item.regionInfo.name || '',
        index: numStr,
        features: featureStr,
        protocol: protocolIcon,
        multi: item.attrs?.multiStr || '',
        in: item.attrs?.entryStr || '',
        city: item.destCity || '',
        line: item.attrs?.cleanLines || '',
        ip_stack: item.tags?.includes('dualstack') ? '双栈' : (item.tags?.includes('ipv6') ? 'IPv6' : ''),
        transport: item.transportTag || ''
      };

      const newName = renderTemplate(renameTemplate, vars, item.proxy, templateCleaners);
      if (newName) {
        if (logger) {
          const detailLine = buildDestinationLine();
          if (newName !== item.rawName) {
            logger.debug(`✅ [清洗] 「${item.rawName}」 → 「${newName}」\n${detailLine}`);
          } else {
            logger.debug(`📌 [识别] 「${item.rawName}」\n${detailLine}`);
          }
        }
        item.proxy.name = newName;
      }
    } else {
      if (logger) {
        const detailLine = buildDestinationLine();
        logger.debug(`📌 [识别] 「${item.proxy.name || item.rawName}」\n${detailLine}`);
      }
    }

    item.proxy._cleaned = true;
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

  if (config.outputMode === 'object' || userConfig.withClassified) {
    return {
      proxies: resultProxies,
      classifiedNodes: validItems,
      meta: { stats }
    };
  }

  return resultProxies;
}

module.exports = {
  runNodesPipeline,
  runNodePipeline: runNodesPipeline,
  runCleanerPipeline: runNodesPipeline
};
