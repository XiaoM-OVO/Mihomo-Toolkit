/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 流水线统一引擎入口 (Pipeline Engine)
 * -----------------------------------------------------------------------------
 * 严格与三大交付物形态对齐：
 * 1. nodes.js    -> runNodesPipeline    (纯节点清洗交付)
 * 2. config.js   -> runConfigPipeline   (完整配置交付，含 passthrough 透传)
 * 3. report.js   -> buildAuditReport    (结构化审计报告交付)
 * 辅助：
 * 4. strategy.js -> runStrategyPipeline (策略组与分流拓扑组装)
 */

const { runNodesPipeline, runCleanerPipeline, runNodePipeline } = require('./nodes');
const { runConfigPipeline, runFullPipeline, buildProfile } = require('./config');
const { runStrategyPipeline, runProfilePipeline } = require('./strategy');
const { buildAuditReport } = require('./report');

module.exports = {
  // 三大核心交付流水线
  runNodesPipeline,
  runConfigPipeline,
  buildAuditReport,

  // 策略拓扑流水线
  runStrategyPipeline,

  // 语义别名与兼容导出
  buildProfile,
  runNodePipeline,
  runCleanerPipeline,
  runProfilePipeline,
  runFullPipeline
};
