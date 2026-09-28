/**
 * 节点清洗流水线 (nodes pipeline)
 *
 * 专注节点过滤、去重、属性提取、重命名与垃圾节点拦截，适用于 Sub-Store Operator 及轻量清洗场景。
 */

const { resolveConfig } = require('../config');
const { dedupeNodes } = require('../core/dedupe');
const { classifyNode } = require('../core/cleaner');
const { renderTemplate, createSeparatorCleaners } = require('../core/rename');
const { getEnhancedRegionDefs } = require('../core/shared/regions');
const { PROTOCOL_ICONS, FEATURE_ICONS, FEATURE_TEXT_MAP } = require('../core/shared/icons');
const { expandDomainFission } = require('../core/fission');

/**
 * 执行纯净节点清洗与标准化流水线
 * @param {Array<object>} proxies 原始节点数组
 * @param {object} [userConfig={}] 用户自定义配置
 * @returns {Promise<Array<object>>} 清洗后的纯净节点数组
 */
async function runNodesPipeline(proxies = [], userConfig = {}) {
  const config = resolveConfig(userConfig);
  let currentProxies = Array.isArray(proxies) ? proxies : [];
  const totalCount = currentProxies.length;

  // 1. 物理特征去重
  let dedupeCount = 0;
  if (config.enableDedupe) {
    const beforeDedupe = currentProxies.length;
    currentProxies = dedupeNodes(currentProxies);
    dedupeCount = beforeDedupe - currentProxies.length;
  }

  // 2. 域名多 IP 节点裂变
  let fissionCount = 0;
  if (config.enableFission) {
    const beforeFission = currentProxies.length;
    currentProxies = await expandDomainFission(currentProxies, config);
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
      return false;
    }
    if (item.isInfo) {
      infoCount++;
      if (config.removeInfoNodes && !item.isSyntheticInfo) return false;
    }
    if (!item.regionInfo || item.regionInfo.isUnknown) {
      unknownCount++;
    }
    return true;
  });

  // 5. 重命名
  const templateCleaners = createSeparatorCleaners(config.renameSeparators);
  const renameTemplate = config.renameTemplate;
  const isRenameEnabled = config.enableNodeRename !== false;

  const resultProxies = validItems.map(item => {
    if (item.isSpecial || item.isInfo) return item.proxy;
    if (!item.regionInfo) return item.proxy;

    if (isRenameEnabled && renameTemplate) {
      let featureStr = '';
      (item.tags || []).forEach(t => {
        if (t === 'ipv6' || t === 'dualstack') return;
        if (config.showFeatureIcon !== false) {
          if (FEATURE_ICONS[t]) featureStr += FEATURE_ICONS[t];
        } else {
          if (FEATURE_TEXT_MAP[t]) featureStr += (featureStr ? '/' : '') + FEATURE_TEXT_MAP[t];
        }
      });

      const protocolIcon = PROTOCOL_ICONS[item.pType] || '';
      const vars = {
        airport: item.airportTag || '',
        icon: item.regionInfo.icon || '',
        region: item.regionInfo.name || '',
        index: '',
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
        item.proxy.name = newName;
      }
    }

    return item.proxy;
  });

  if (config.outputMode === 'object') {
    const stats = {
      total: totalCount,
      outputCount: resultProxies.length,
      dedupeCount,
      discardedCount,
      infoCount,
      unknownCount,
      fissionCount
    };
    return {
      proxies: resultProxies,
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
