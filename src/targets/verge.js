/**
 * -----------------------------------------------------------------------------
 * Target: Clash Verge Rev / Mihomo 客户端扩展脚本 (Verge Plugin)
 * -----------------------------------------------------------------------------
 * 适用于：Clash Verge Rev 等 GUI 客户端的「扩展脚本 / Script」
 * 输入：已有配置 config, 外部配置 extConfig
 * 输出：组装好策略组、分流规则、DNS 与内核优化的完整配置
 */

const { runStrategyPipeline } = require('../pipeline/strategy');

function main(config, extConfig) {
  return runStrategyPipeline(config, extConfig);
}

module.exports = { main };
