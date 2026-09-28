/**
 * Pure-Nodes 纯净节点清洗脚本
 *
 * 模块化委托至 src/pipeline/pure.js 流水线。
 */

const { runPurePipeline } = require('./pipeline/pure');

async function operator(proxies, targetPlatform, userConfig) {
  return await runPurePipeline(proxies, userConfig);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { operator };
}
