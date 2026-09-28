/**
 * Mihomo-Toolkit 通用动态策略组脚本
 *
 * 模块化委托至 src/pipeline/toolkit.js 策略构建流水线。
 */

const { runToolkitPipeline } = require('./pipeline/toolkit');

function main(config, extConfig) {
  return runToolkitPipeline(config, extConfig);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { main };
}
