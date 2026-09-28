/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit 流水线统一入口 (Pipeline Engine)
 * -----------------------------------------------------------------------------
 */

const { runCleanerPipeline } = require('./cleaner');
const { runProfilePipeline } = require('./profile');
const { buildProfile } = require('./full');

module.exports = {
  // 现代三大核心流水线
  runCleanerPipeline,
  runProfilePipeline,
  runFullPipeline: buildProfile,
  buildProfile,

  // 语义别名
  runNodePipeline: runCleanerPipeline,
  runStrategyPipeline: runProfilePipeline
};
