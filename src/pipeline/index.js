/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 流水线统一引擎入口 (Pipeline Engine)
 * -----------------------------------------------------------------------------
 * 1. engine.js   -> runPipelineEngine / buildProfile (总调度引擎，根据交付物截断)
 * 2. nodes.js    -> runNodesPipeline    (纯节点清洗交付物)
 * 3. config.js   -> runConfigPipeline   (完整配置装配交付物)
 * 4. report.js   -> buildAuditReport    (结构化审计报告交付物)
 * 5. strategy.js -> runStrategyPipeline (策略组与分流拓扑组装)
 */

const { runPipelineEngine, buildProfile } = require('./engine');
const { runNodesPipeline, runCleanerPipeline, runNodePipeline } = require('./nodes');
const { runConfigPipeline } = require('./config');
const { runStrategyPipeline, runProfilePipeline } = require('./strategy');
const { buildAuditReport } = require('./report');

module.exports = {
  // 总调度引擎
  runPipelineEngine,
  buildProfile,
  build: buildProfile,

  // 专项交付流水线
  runConfigPipeline,
  runNodesPipeline,
  buildAuditReport,
  runStrategyPipeline,

  // 语义别名与兼容导出
  runNodePipeline,
  runCleanerPipeline,
  runProfilePipeline,
  runFullPipeline: buildProfile
};
