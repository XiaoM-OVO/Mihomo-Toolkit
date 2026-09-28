/**
 * Mihomo 策略构建流水线
 *
 * 编排配置合并、节点清洗、策略拓扑组装、分流规则生成、DAG 空组清理与内核覆写。
 */

const { resolveConfig } = require('../config');
const { dedupeNodes } = require('../core/dedupe');
const { classifyNode } = require('../core/cleaner');
const { renderTemplate, createSeparatorCleaners } = require('../core/rename');
const { getEnhancedRegionDefs } = require('../core/shared/regions');
const { PROTOCOL_ICONS, FEATURE_ICONS, FEATURE_TEXT_MAP } = require('../core/shared/icons');
const { createServiceRegistries } = require('../strategy/registries');
const { buildProxyTopology } = require('../strategy/topology');
const { buildRoutingRules } = require('../strategy/rules');
const { pruneEmptyGroups } = require('../strategy/prune');
const { applyDnsOverlay } = require('../strategy/dns');
const { applyTunOverlay, applySnifferOverlay, applyCoreOptimize } = require('../strategy/kernel');

/**
 * 运行策略组完整构建流水线
 * @param {object} config 原始 Mihomo 配置 (包含 proxies 列表)
 * @param {object} [extConfig={}] 用户外部配置参数
 * @returns {object} 构建完毕的 Mihomo 配置
 */
function runProfilePipeline(config = {}, extConfig = {}) {
  const userConfig = resolveConfig(extConfig);
  if (!userConfig.enableScript) return config;

  // 1. 节点底层去重
  const rawProxies = config.proxies || [];
  let proxies = rawProxies;
  if (userConfig.enableDedupe) {
    proxies = dedupeNodes(rawProxies);
  }

  // 2. 节点深度清洗与特征打标
  const regionDefs = getEnhancedRegionDefs();
  const classifiedNodes = proxies.map(p => classifyNode(p, userConfig, { regionDefs }));

  // 3. 节点重命名与模板渲染 (可选)
  const templateCleaners = createSeparatorCleaners(userConfig.renameSeparators);
  const renameTemplate = userConfig.renameTemplate;
  const isRenameEnabled = userConfig.enableNodeRename !== false;

  const regionCounts = {};
  classifiedNodes.forEach(item => {
    if (item.skip || item.isSpecial || item.isInfo || !item.regionInfo) return;
    const rKey = item.regionInfo.id || item.regionInfo.name;
    regionCounts[rKey] = (regionCounts[rKey] || 0) + 1;
  });
  const maxCount = Math.max(...Object.values(regionCounts), 9);
  const indexPad = Math.max(2, maxCount.toString().length);
  const regionTracker = {};

  classifiedNodes.forEach(item => {
    if (item.skip || item.isSpecial || item.isInfo) return;
    if (!item.regionInfo) return;

    const rKey = item.regionInfo.id || item.regionInfo.name;
    const total = regionCounts[rKey] || 1;
    let numStr = '';
    if (total > 1) {
      regionTracker[rKey] = (regionTracker[rKey] || 0) + 1;
      numStr = String(regionTracker[rKey]).padStart(indexPad, '0');
    }

    if (isRenameEnabled && renameTemplate) {
      let featureStr = '';
      (item.tags || []).forEach(t => {
        if (t === 'ipv6' || t === 'dualstack') return;
        if (userConfig.showFeatureIcon !== false) {
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
        item.proxy.name = newName;
      }
    }
  });

  // 4. 组装服务注册表与策略拓扑
  const registries = createServiceRegistries(userConfig);
  const { proxyGroups } = buildProxyTopology({
    classifiedNodes,
    userConfig,
    registries
  });
  config['proxy-groups'] = proxyGroups;

  // 5. 组装路由规则与 Rule-Providers
  const { rules, providers } = buildRoutingRules(userConfig, registries);
  config['rules'] = rules;
  config['rule-providers'] = providers;

  // 6. DAG 级联空组清理机制
  const pruned = pruneEmptyGroups({
    proxyGroups: config['proxy-groups'],
    proxies: config.proxies,
    rules: config.rules,
    ruleProviders: config['rule-providers']
  });
  config['proxy-groups'] = pruned.proxyGroups;
  config['rules'] = pruned.rules;
  config['rule-providers'] = pruned.ruleProviders;

  // 7. 内核层高级配置覆写
  if (userConfig.overwriteDns) {
    applyDnsOverlay(config, userConfig);
  }
  if (userConfig.overwriteTun) {
    applyTunOverlay(config, userConfig);
  }
  if (userConfig.overwriteSniffer) {
    applySnifferOverlay(config, userConfig);
  }
  if (userConfig.enableCoreOptimize) {
    applyCoreOptimize(config, userConfig);
  }

  return config;
}

module.exports = {
  runProfilePipeline,
  runStrategyPipeline: runProfilePipeline
};
