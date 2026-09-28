/**
 * Mihomo-Toolkit 流水线统一入口
 */

const { runToolkitPipeline } = require('./toolkit');
const { runPurePipeline } = require('./pure');

module.exports = {
  runToolkitPipeline,
  runPurePipeline
};
