/**
 * Mihomo 策略构建流水线
 *
 * 编排配置合并、节点清洗、策略拓扑组装、分流规则生成、DAG 空组清理与内核覆写。
 */

const { resolveConfig } = require('../config');
const { cleanAndClassifyNodesSync } = require('./nodes');
const { createServiceRegistries } = require('../strategy/registries');
const { validateConfigSchema } = require('./config-schema');
const { buildProxyTopology } = require('../strategy/topology');
const { expandRouting } = require('../strategy/routing');
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

  // 激活摘要收集器由上游（config pipeline）按需创建；未启用时为 null，产物与行为不变
  const trace = pipelineContext.explainTrace || null;

  // 3.5 配置装载后统一 schema 校验：groups / routing 的结构、配方与目标合法性
  //     在清洗节点与装配之前 fail-closed，避免非法配置走到装配期才暴露。
  const registries = createServiceRegistries(userConfig);
  validateConfigSchema(userConfig, registries, {
    disabledRefs: userConfig.disabledGroupRefs
  });

  let classifiedNodes = pipelineContext.classifiedNodes;

  // 若上游流水线未提供已分类打标的节点（如独立脚本入口），统一复用 nodes 同步清洗打标流水线
  if (!classifiedNodes) {
    const rawProxies = Array.isArray(sourceSkeleton.proxies) ? sourceSkeleton.proxies : [];
    classifiedNodes = cleanAndClassifyNodesSync(rawProxies, userConfig);
    sourceSkeleton.proxies = classifiedNodes.map(item => item.proxy);
  }

  // 4. 组装路由规则（规则先展开：组是否生成由「被规则引用」决定）
  const logger = pipelineContext.logger || userConfig.logger;
  const { rules, providers, targets } = expandRouting(userConfig, registries, {
    disabledRefs: userConfig.disabledGroupRefs,
    trace
  });

  // 5. 组装策略拓扑（ruleTargets 决定哪些内置应用组需要生成）
  const { proxyGroups } = buildProxyTopology({
    classifiedNodes,
    userConfig,
    registries,
    ruleTargets: targets,
    logger,
    trace
  });
  sourceSkeleton['proxy-groups'] = proxyGroups;

  // 5.1 路由规则与 Rule-Providers
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
    logger,
    trace
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
