/**
 * 配置解析与合并器
 *
 * 将用户自定义参数与 DEFAULT_CONFIG 深度合并，并做基础类型与默认值兜底。
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { DEFAULT_CONFIG } = require('./defaults');
const { buildServiceCatalog, deepMerge } = require('./catalog');

/**
 * 加载外部服务定义配置文件 (.js, .cjs, .yaml, .yml, .json)
 * @param {string} filePath
 * @param {string} [baseDir]
 * @returns {object}
 */
function loadExternalServicesConfig(filePath, baseDir = process.cwd()) {
  if (!filePath || typeof filePath !== 'string') return {};
  const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
  if (!fs.existsSync(fullPath)) return {};

  const ext = path.extname(fullPath).toLowerCase();
  try {
    if (ext === '.js' || ext === '.cjs') {
      const loaded = require(fullPath);
      return typeof loaded === 'function' ? loaded() : loaded;
    }
    if (ext === '.yaml' || ext === '.yml') {
      const content = fs.readFileSync(fullPath, 'utf8');
      return yaml.parse(content) || {};
    }
    if (ext === '.json') {
      const content = fs.readFileSync(fullPath, 'utf8');
      return JSON.parse(content) || {};
    }
  } catch (err) {
    // 保持轻量警告，不打断主流程
    console.warn(`[Config] 加载外部服务配置文件异常: ${fullPath}`, err.message);
  }
  return {};
}

/**
 * 解析并生成最终生效的配置对象
 * @param {object} [userConfig={}] 用户自定义配置
 * @returns {object} 合并后的最终配置
 */
function resolveConfig(userConfig = {}) {
  const merged = Object.assign({}, DEFAULT_CONFIG, userConfig || {});

  // 1. 处理外部服务配置文件挂载
  const externalFile = merged.servicesConfigFile || merged.servicesConfig;
  if (externalFile) {
    const externalServices = loadExternalServicesConfig(externalFile);
    merged.customServices = deepMerge(merged.customServices || {}, externalServices);
  }

  // 2. 确保数组与对象基础字段的类型安全
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

  // 3. 构建单一事实来源 ServiceCatalog 实例
  merged.catalog = buildServiceCatalog(merged);
  merged.registries = merged.catalog.toLegacyRegistries();

  return merged;
}

module.exports = {
  DEFAULT_CONFIG,
  resolveConfig
};
