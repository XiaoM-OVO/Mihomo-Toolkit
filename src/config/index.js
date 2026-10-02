/**
 * 配置解析与合并器
 *
 * 将用户自定义参数与 DEFAULT_CONFIG 深度合并，并做基础类型与默认值兜底。
 */

const { DEFAULT_CONFIG } = require('./defaults');
const { ADDITIVE_FIELDS, ENTRY_NORMALIZERS, mergeBaseline } = require('../data');
const { resolveMountPath, readMountFile } = require('./mounts');
const { expandIncludes } = require('./include');
const { buildServiceCatalog, deepMerge } = require('./catalog');

/**
 * 加载外部服务定义配置文件 (.js, .cjs, .yaml, .yml, .json)
 *
 * 失败即抛错（fail-closed）：文件缺失、扩展名不支持、解析异常都会带上完整路径抛出。
 * 旧实现在这些情况下静默返回 `{}`，用户会看到「自定义服务凭空消失」且日志里毫无线索。
 *
 * @param {string} filePath
 * @param {string} [baseDir]
 * @returns {object}
 */
function loadExternalServicesConfig(filePath, baseDir = process.cwd()) {
  const fullPath = resolveMountPath(filePath, baseDir);
  if (!fullPath) return {};
  return readMountFile(fullPath);
}

/**
 * 应用「只增不减」的加法合并字段（注册表中 `merge: 'additive'` 的字段）。
 *
 * 语义：最终值 = 只读基线 ∪ 用户追加值。基线**永远保留**，
 * 用户既不能删除也不能替换它——这样即使配置来自不可信来源，
 * 也无法把 `github.com` 从受保护域名里摘掉。
 *
 * 用户条目被规范化丢弃时**不静默**：把 `github.com` 拼错成 `github` 却以为已受保护，
 * 属于 fail-open，必须显式告警（基线本身不受影响）。
 *
 * @param {object} merged 合并后的配置对象（原地修改）
 * @returns {object} merged
 */
function applyAdditiveFields(merged) {
  for (const field of ADDITIVE_FIELDS) {
    const normalize = ENTRY_NORMALIZERS[field.normalize] || ENTRY_NORMALIZERS.text;
    const raw = merged[field.key];
    const rejected = [];
    if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
      rejected.push(String(raw));
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!normalize(item)) rejected.push(String(item));
      }
    }
    merged[field.key] = mergeBaseline(field.baseline, raw, normalize);
    if (rejected.length > 0) {
      console.warn(
        `[Config] ${field.key} 有 ${rejected.length} 个条目格式非法、已忽略（只读基线不受影响）: ${rejected.join(', ')}`
      );
    }
  }
  return merged;
}

/**
 * 解析并生成最终生效的配置对象
 * @param {object} [userConfig={}] 用户自定义配置
 * @returns {object} 合并后的最终配置
 */
function resolveConfig(userConfig = {}) {
  // 0. 先展开通用片段挂载（include）：主文件优先、数组并集去重、支持递归 include。
  //    CLI / server 在读取配置文件现场已把挂载路径转成绝对路径，故此处以 cwd 为基准
  //    只影响「SDK 直接传对象且写相对路径」的场景。
  const expanded = expandIncludes(userConfig || {}, process.cwd());

  const merged = Object.assign({}, DEFAULT_CONFIG, expanded || {});

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

  // 3. 只读基线 + 用户追加：安全基线只能加强，不能被配置削减
  applyAdditiveFields(merged);

  // 4. 构建单一事实来源 ServiceCatalog 实例
  merged.catalog = buildServiceCatalog(merged);
  merged.registries = merged.catalog.toLegacyRegistries();

  return merged;
}

module.exports = {
  DEFAULT_CONFIG,
  resolveConfig,
  loadExternalServicesConfig
};
