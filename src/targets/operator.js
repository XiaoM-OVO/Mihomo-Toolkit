/**
 * -----------------------------------------------------------------------------
 * Target: Sub-Store 节点操作脚本 (Operator)
 * -----------------------------------------------------------------------------
 * 适用于：Sub-Store、Surge、Loon 等订阅管理器的「节点操作 / 脚本操作」
 * 输入：节点数组 proxies, 目标平台 targetPlatform, 运行时配置 userConfig
 * 输出：清洗、去重、打标、重命名后的纯净节点数组
 */

const { runNodesPipeline } = require('../pipeline/nodes');

async function operator(proxies = [], targetPlatform, userConfig) {
  let config = userConfig;
  if (!config && typeof $arguments !== 'undefined') {
    config = typeof $arguments === 'object' ? $arguments : {};
  }
  return await runNodesPipeline(proxies, config || {});
}

module.exports = { operator };
