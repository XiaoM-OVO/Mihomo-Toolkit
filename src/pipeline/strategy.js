/**
 * Mihomo 策略构建流水线
 *
 * 编排配置合并、节点清洗、策略拓扑组装、分流规则生成、DAG 空组清理与内核覆写。
 */

const { resolveConfig } = require('../config');
const { dedupeNodes } = require('../core/dedupe');
const { classifyNode, matchUserBlacklist, getFeatureRules } = require('../core/cleaner');
const { buildRenamePlan, applyRenamePlan } = require('../core/rename');
const { isTrustedCleanedNode, isTrustedSynthetic, markTrustedCleanedNode, restoreTrustedProxyMetadata, sanitizeExternalProxy } = require('../core/node-trust');
const { sortNodes } = require('../core/sort');
const { getEnhancedRegionDefs } = require('../core/shared/regions');
// Name rendering and feature variables are owned by core/rename.
const { createServiceRegistries } = require('../strategy/registries');
const { buildProxyTopology } = require('../strategy/topology');
const { buildRoutingRules } = require('../strategy/rules');
const { pruneEmptyGroups } = require('../strategy/prune');
const { applyPresentation } = require('../strategy/presentation');
const { applyDnsOverlay } = require('../strategy/dns');
const { applyTunOverlay, applySnifferOverlay, applyCoreOptimize } = require('../strategy/kernel');

/**
 * 运行策略组完整构建流水线 (strategy pipeline)
 * @param {object} sourceSkeleton 原始 Mihomo 配置骨架 (包含 proxies 列表)
 * @param {object} [userConfigOrProfile={}] 用户外部配置参数
 * @param {object} [pipelineContext={}] 流水线上下文
 * @returns {object} 构建完毕的 Mihomo 配置
 */
function runStrategyPipeline(sourceSkeleton = {}, userConfigOrProfile = {}, pipelineContext = {}) {
  const safeExtConfig = (typeof userConfigOrProfile === 'object' && userConfigOrProfile !== null) ? userConfigOrProfile : {};
  const userConfig = resolveConfig(safeExtConfig);
  if (!userConfig.enablePipeline) return sourceSkeleton;

  let classifiedNodes = pipelineContext.classifiedNodes;

  // 若上游流水线未提供已分类打标的节点（如 Clash Verge 独立脚本入口），则在本地执行打标与格式化
  if (!classifiedNodes) {
    const rawProxies = Array.isArray(sourceSkeleton.proxies) ? sourceSkeleton.proxies : [];
    const regionDefs = getEnhancedRegionDefs();
    const entries = [];

    // Trust comes from the private in-process WeakSet, never from a caller supplied _cleaned field.
    rawProxies.forEach((rawProxy, index) => {
      if (!rawProxy || typeof rawProxy !== 'object' || Array.isArray(rawProxy)) return;
      const trustedCleaned = isTrustedCleanedNode(rawProxy);
      const trustedInternal = trustedCleaned || isTrustedSynthetic(rawProxy);
      const proxy = trustedInternal ? rawProxy : restoreTrustedProxyMetadata(rawProxy, sanitizeExternalProxy(rawProxy));
      const rawName = proxy._rawName || proxy.name || '';
      if (matchUserBlacklist(proxy, rawName, userConfig)) return;
      entries.push({ proxy, trustedCleaned, index });
    });

    // Existing in-process pipeline output wins physical duplicates; raw additions are deduped against it.
    if (userConfig.enableDedupe && entries.some(entry => !entry.trustedCleaned)) {
      const preferred = [
        ...entries.filter(entry => entry.trustedCleaned),
        ...entries.filter(entry => !entry.trustedCleaned)
      ];
      const deduped = dedupeNodes(preferred.map(entry => entry.proxy));
      const counts = new Map();
      for (const proxy of deduped) counts.set(proxy, (counts.get(proxy) || 0) + 1);
      const kept = new Set(deduped);
      const used = new Map();
      for (let i = entries.length - 1; i >= 0; i--) {
        const proxy = entries[i].proxy;
        const count = used.get(proxy) || 0;
        if (!kept.has(proxy) || count >= (counts.get(proxy) || 0)) entries.splice(i, 1);
        else used.set(proxy, count + 1);
      }
    }

    const featureRules = getFeatureRules(userConfig);
    const classifiedEntries = entries.map(entry => ({
      ...entry,
      item: classifyNode(entry.proxy, userConfig, { regionDefs, featureRules })
    })).filter(entry => !entry.item.skip);

    const existingItems = classifiedEntries
      .filter(entry => entry.trustedCleaned)
      .map(entry => ({ ...entry.item, _preserveExistingName: true }));
    let newItems = classifiedEntries.filter(entry => !entry.trustedCleaned).map(entry => entry.item);
    if (userConfig.enableNodeSort && newItems.length > 1) {
      newItems = sortNodes(newItems, userConfig);
    }
    classifiedNodes = [...existingItems, ...newItems];

    const renamePlan = buildRenamePlan(classifiedNodes, userConfig);
    applyRenamePlan(classifiedNodes, renamePlan);
    for (const item of classifiedNodes) {
      item.proxy._cleaned = true;
      markTrustedCleanedNode(item.proxy);
    }
    sourceSkeleton.proxies = classifiedNodes.map(item => item.proxy);

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
  sourceSkeleton['proxy-groups'] = proxyGroups;

  // 5. 组装路由规则与 Rule-Providers
  const { rules, providers } = buildRoutingRules(userConfig, registries);
  sourceSkeleton['rules'] = rules;
  sourceSkeleton['rule-providers'] = providers;

  // 6. DAG 级联空组清理机制
  const pruned = pruneEmptyGroups({
    proxyGroups: sourceSkeleton['proxy-groups'],
    proxies: sourceSkeleton.proxies,
    rules: sourceSkeleton.rules,
    ruleProviders: sourceSkeleton['rule-providers'],
    exemptGroups: userConfig.exemptGroups,
    userConfig
  });
  sourceSkeleton['proxy-groups'] = pruned.proxyGroups;
  sourceSkeleton['rules'] = pruned.rules;
  sourceSkeleton['rule-providers'] = pruned.ruleProviders;

  // 6.5 终末装配：根据 groupIconMode (emoji | both | icon) 统一赋予徽标或装配在线图标
  applyPresentation(sourceSkeleton, userConfig, registries);

  // 7. 内核层高级配置覆写
  if (userConfig.overwriteDns) {
    applyDnsOverlay(sourceSkeleton, userConfig, { logger });
  }
  if (userConfig.overwriteTun) {
    applyTunOverlay(sourceSkeleton, userConfig);
  }
  if (userConfig.overwriteSniffer) {
    applySnifferOverlay(sourceSkeleton, userConfig);
  }
  if (userConfig.enableCoreOptimize) {
    applyCoreOptimize(sourceSkeleton, userConfig);
  }

  // 8. 独立运行收尾：若非上游总调度驱动（如由 Clash Verge 独立调用），执行简繁同步与私有字段清理
  if (!pipelineContext.classifiedNodes) {
    const { syncChineseConvert } = require('../core/chinese-sync');
    syncChineseConvert(sourceSkeleton, userConfig);

    if (Array.isArray(sourceSkeleton.proxies)) {
      for (const p of sourceSkeleton.proxies) {
        if (p && typeof p === 'object') {
          for (const key of Object.keys(p)) {
            if (key.startsWith('_')) delete p[key];
          }
        }
      }
    }
  }

  return sourceSkeleton;
}

module.exports = {
  runStrategyPipeline
};
