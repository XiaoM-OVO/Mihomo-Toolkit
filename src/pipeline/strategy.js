/**
 * Mihomo 策略构建流水线
 *
 * 编排配置合并、节点清洗、策略拓扑组装、分流规则生成、DAG 空组清理与内核覆写。
 */

const { resolveConfig } = require('../config');
const { dedupeNodes } = require('../core/dedupe');
const { classifyNode } = require('../core/cleaner');
const { renderTemplate, createSeparatorCleaners, computeNodeIndices } = require('../core/rename');
const { getEnhancedRegionDefs } = require('../core/shared/regions');
const { PROTOCOL_ICONS, FEATURE_ICONS, FEATURE_TEXT_MAP } = require('../core/shared/icons');
const { createServiceRegistries } = require('../strategy/registries');
const { buildProxyTopology } = require('../strategy/topology');
const { buildRoutingRules } = require('../strategy/rules');
const { pruneEmptyGroups } = require('../strategy/prune');
const { applyPresentation } = require('../strategy/presentation');
const { applyDnsOverlay } = require('../strategy/dns');
const { applyTunOverlay, applySnifferOverlay, applyCoreOptimize } = require('../strategy/kernel');

/**
 * 运行策略组完整构建流水线 (strategy pipeline)
 * @param {object} config 原始 Mihomo 配置 (包含 proxies 列表)
 * @param {object} [extConfig={}] 用户外部配置参数
 * @returns {object} 构建完毕的 Mihomo 配置
 */
function runStrategyPipeline(config = {}, extConfig = {}, pipelineContext = {}) {
  const safeExtConfig = (typeof extConfig === 'object' && extConfig !== null) ? extConfig : {};
  const userConfig = resolveConfig(safeExtConfig);
  if (!userConfig.enableScript) return config;

  let classifiedNodes = pipelineContext.classifiedNodes;

  // 若上游流水线未提供已分类打标的节点（如 Clash Verge 独立脚本入口），则在本地执行打标与格式化
  if (!classifiedNodes) {
    const rawProxies = config.proxies || [];
    const isPreCleaned = rawProxies.some(p => p && p._cleaned);
    let proxies = rawProxies;

    // 1. 节点底层去重（已清洗节点跳过）
    if (userConfig.enableDedupe && !isPreCleaned) {
      proxies = dedupeNodes(rawProxies);
    }

    // 2. 节点深度清洗与特征打标
    const regionDefs = getEnhancedRegionDefs();
    classifiedNodes = proxies.map(p => classifyNode(p, userConfig, { regionDefs }));

    // 3. 节点重命名与模板渲染（已清洗节点跳过，防二次重命名污染）
    const templateCleaners = createSeparatorCleaners(userConfig.renameSeparators);
    const renameTemplate = userConfig.renameTemplate;
    const isRenameEnabled = !isPreCleaned && userConfig.enableNodeRename !== false;

    if (isRenameEnabled && renameTemplate) {
      const indexMap = computeNodeIndices(classifiedNodes, userConfig);

      // 动态合并来自 catalog 的特征图标与文本
      const catalogIcons = {};
      const catalogTexts = {};
      if (userConfig.catalog && typeof userConfig.catalog.getCoreMatchers === 'function') {
        userConfig.catalog.getCoreMatchers().forEach(m => {
          if (m.uiIcon) catalogIcons[m.tag] = m.uiIcon;
          if (m.uiText) catalogTexts[m.tag] = m.uiText;
        });
      }
      const effectiveFeatureIcons = { ...FEATURE_ICONS, ...catalogIcons };
      const effectiveFeatureTexts = { ...FEATURE_TEXT_MAP, ...catalogTexts };

      classifiedNodes.forEach(item => {
        if (item.skip || item.isSpecial || item.isInfo || !item.regionInfo) return;

        let featureStr = '';
        (item.tags || []).forEach(t => {
          if (t === 'ipv6' || t === 'dualstack') return;
          if (userConfig.showFeatureIcon !== false) {
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
          item.proxy.name = newName;
        }
      });
    }
  }

  // 4. 组装服务注册表与策略拓扑
  const logger = pipelineContext.logger || userConfig.logger;
  const registries = createServiceRegistries(userConfig);
  const { proxyGroups } = buildProxyTopology({
    classifiedNodes,
    userConfig,
    registries,
    logger
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
    ruleProviders: config['rule-providers'],
    userConfig
  });
  config['proxy-groups'] = pruned.proxyGroups;
  config['rules'] = pruned.rules;
  config['rule-providers'] = pruned.ruleProviders;

  // 6.5 终末装配：根据 groupIconMode (emoji | both | icon) 统一赋予徽标或装配在线图标
  applyPresentation(config, userConfig, registries);

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

  // 8. 独立运行收尾：若非上游总调度驱动（如由 Clash Verge 独立调用），执行简繁同步与私有字段清理
  if (!pipelineContext.classifiedNodes) {
    const { syncChineseConvert } = require('../core/chinese-sync');
    syncChineseConvert(config, userConfig);

    if (Array.isArray(config.proxies)) {
      for (const p of config.proxies) {
        if (p && typeof p === 'object') {
          for (const key of Object.keys(p)) {
            if (key.startsWith('_')) delete p[key];
          }
        }
      }
    }
  }

  return config;
}

module.exports = {
  runStrategyPipeline,
  runProfilePipeline: runStrategyPipeline
};
