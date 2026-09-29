/**
 * -----------------------------------------------------------------------------
 * Target: Clash Verge Rev / Mihomo 客户端扩展脚本 (Verge Plugin)
 * -----------------------------------------------------------------------------
 * 适用于：Clash Verge Rev 等 GUI 客户端的「扩展脚本 / Script」
 * 输入：已有配置 config, 外部配置 extConfig (或 profileName)
 * 输出：组装好策略组、分流规则、DNS 与内核优化的完整配置
 */

const { runStrategyPipeline } = require('../pipeline/strategy');

/**
 * Clash Verge Rev 扩展脚本主函数
 * @param {object} config 待处理的基础配置对象
 * @param {object|string} [extConfig] 外部传入配置（若为字符串则为 profileName，自动安全忽略）
 * @returns {object} 构建完毕的完整配置
 */
function main(config, extConfig) {
  const resolvedExtConfig = (typeof extConfig === 'object' && extConfig !== null) ? extConfig : {};
  return runStrategyPipeline(config, resolvedExtConfig);
}

module.exports = { main };
