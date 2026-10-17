/**
 * Mihomo 策略构建流水线
 *
 * 编排配置合并、节点清洗、策略拓扑组装、分流规则生成、DAG 空组清理与内核覆写。
 */

const { resolveConfig } = require('../config');
const { cleanAndClassifyNodesSync } = require('./nodes');
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
 * @param {object} [pipelineContext.dnsAssets] 订阅携带的 DNS 资产闭包（显式值通道，仅 overwriteDns 时消费）
 * @returns {object} 构建完毕的 Mihomo 配置
 */
function runStrategyPipeline(sourceSkeleton = {}, userConfigOrProfile = {}, pipelineContext = {}) {
  const safeExtConfig = (typeof userConfigOrProfile === 'object' && userConfigOrProfile !== null) ? userConfigOrProfile : {};
  const userConfig = resolveConfig(safeExtConfig, { logger: pipelineContext.logger });
  if (!userConfig.enablePipeline) return sourceSkeleton;

  let classifiedNodes = pipelineContext.classifiedNodes;

  // 若上游流水线未提供已分类打标的节点（如独立脚本入口），统一复用 nodes 同步清洗打标流水线
  if (!classifiedNodes) {
    const rawProxies = Array.isArray(sourceSkeleton.proxies) ? sourceSkeleton.proxies : [];
    classifiedNodes = cleanAndClassifyNodesSync(rawProxies, userConfig);
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
    userConfig,
    logger
  });
  sourceSkeleton['proxy-groups'] = pruned.proxyGroups;
  sourceSkeleton['rules'] = pruned.rules;
  sourceSkeleton['rule-providers'] = pruned.ruleProviders;

  // 6.5 终末装配：根据 groupIconMode (emoji | both | icon) 统一赋予徽标或装配在线图标
  applyPresentation(sourceSkeleton, userConfig, registries);

  // 7. 内核层高级配置覆写
  if (userConfig.overwriteDns) {
    applyDnsOverlay(sourceSkeleton, userConfig, { logger, dnsAssets: pipelineContext.dnsAssets });
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

  // 8. 独立运行收尾：若非上游总调度驱动（如由 Clash Verge 独立调用），执行简繁同步
  if (!pipelineContext.classifiedNodes) {
    const { syncChineseConvert } = require('../core/chinese-sync');
    syncChineseConvert(sourceSkeleton, userConfig);
  }

  return sourceSkeleton;
}

module.exports = {
  runStrategyPipeline
};
