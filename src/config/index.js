/**
 * 配置解析与合并器
 *
 * 将用户自定义参数与 DEFAULT_CONFIG 深度合并，并做基础类型与默认值兜底。
 */

const { DEFAULT_CONFIG } = require('./defaults');

/**
 * 解析并生成最终生效的配置对象
 * @param {object} [userConfig={}] 用户自定义配置
 * @returns {object} 合并后的最终配置
 */
function resolveConfig(userConfig = {}) {
  const merged = Object.assign({}, DEFAULT_CONFIG, userConfig || {});

  // 确保白名单和规则数组类型安全
  if (!Array.isArray(merged.whitelistKeywords)) {
    merged.whitelistKeywords = [];
  }
  if (!Array.isArray(merged.specialNodeRules)) {
    merged.specialNodeRules = [];
  }
  if (!merged.customNodeGroups || typeof merged.customNodeGroups !== 'object') {
    merged.customNodeGroups = {};
  }
  if (!merged.indexPrefixMap || typeof merged.indexPrefixMap !== 'object') {
    merged.indexPrefixMap = {};
  }

  return merged;
}

module.exports = {
  DEFAULT_CONFIG,
  resolveConfig
};
