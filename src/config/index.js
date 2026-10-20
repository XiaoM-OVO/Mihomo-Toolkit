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
const { resolveGroupDeclarations } = require('./groups');

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
 * @param {object} [logger] 可选分级日志记录器
 * @returns {object} merged
 */
function applyAdditiveFields(merged, logger) {
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
      const msg = `[Config] ${field.key} 有 ${rejected.length} 个条目格式非法、已忽略（只读基线不受影响）: ${rejected.join(', ')}`;
      if (logger && typeof logger.warn === 'function') {
        logger.warn(msg);
      } else if (merged.logLevel !== 'silent') {
        console.warn(msg);
      }
    }
  }
  return merged;
}

/**
 * 解析并生成最终生效的配置对象
 * @param {object} [userConfig={}] 用户自定义配置
 * @param {object} [options={}] 可选解析选项 (baseDir: 相对挂载路径基准目录, logger)
 * @returns {object} 合并后的最终配置
 */
function resolveConfig(userConfig = {}, options = {}) {
  // 0. 先展开通用片段挂载（include）：主文件优先、数组并集去重、支持递归 include。
  //    相对路径的基准目录优先取调用方显式传入的 options.baseDir；SDK 跨目录调用**必须**显式传入，
  //    否则回退到 cwd，相对路径片段会按错误的目录解析。CLI / server 在读取配置文件现场已把
  //    挂载路径转成绝对路径（absolutizeMountPaths），此处不再受 cwd 影响。
  const baseDir = options.baseDir || process.cwd();
  const expanded = expandIncludes(userConfig || {}, baseDir);

  // 深层合并出厂默认与用户配置：
  //   - 深合并：嵌套子对象**递归**合并，避免浅拷贝把默认值里的子属性整体覆盖丢失；
  //   - structuredClone：先断开出厂默认的数组/对象引用，避免下游原地突变污染全局 DEFAULT_CONFIG
  //     （DEFAULT_CONFIG 由模块加载时构建一次，浅拷贝会让每次 resolveConfig 共享同一份嵌套引用）。
  const merged = deepMerge(structuredClone(DEFAULT_CONFIG), expanded || {});

  // 1. 处理外部服务配置文件挂载（同上，基准目录与 include 保持一致）
  const externalFile = merged.servicesConfigFile;
  if (externalFile) {
    const externalServices = loadExternalServicesConfig(externalFile, baseDir);
    merged.customServices = deepMerge(merged.customServices || {}, externalServices);
  }

  // 2. 确保数组与对象基础字段的类型安全
  if (!Array.isArray(merged.whitelistKeywords)) {
    merged.whitelistKeywords = [];
  }
  if (!Array.isArray(merged.specialNodeRules)) {
    merged.specialNodeRules = [];
  }
  if (!merged.indexPrefixMap || typeof merged.indexPrefixMap !== 'object') {
    merged.indexPrefixMap = {};
  }

  // 3. 只读基线 + 用户追加：安全基线只能加强，不能被配置削减
  const logger = options?.logger || userConfig?.logger;
  applyAdditiveFields(merged, logger);

  // 4. 构建单一事实来源 ServiceCatalog 实例
  merged.catalog = buildServiceCatalog(merged);
  merged.registries = merged.catalog.toRegistries();

  // 5. 归一化声明式策略组清单：`groups` → 引擎可直接消费的完整组声明。
  //    `{ ref: <键> }` 从内置组目录取出完整声明（含 rules → 自动生成 RULE-SET 与规则集 Provider），
  //    并允许条目内覆写任意字段；`disabled: true` 显式关闭；未知 ref 键 fail-closed。
  //    归一化结果并入 customGroups，作为引擎/规则/展示层当下唯一的内部入口
  //    （批次 3 落地后将由 groups 直接取代 customGroups，届时此处合流即拆除）。
  const declaredGroups = resolveGroupDeclarations(merged.groups, {
    directory: merged.registries.groups,
    memberHints: merged.catalog.getGroupMemberHints(),
    fieldPath: 'groups'
  });
  if (declaredGroups.length > 0) {
    const baseGroups = Array.isArray(merged.customGroups) ? merged.customGroups : [];
    merged.customGroups = [...baseGroups, ...declaredGroups];
  }

  return merged;
}

module.exports = {
  DEFAULT_CONFIG,
  resolveConfig
};
