/**
 * 配置解析与合并器
 *
 * 将用户自定义参数与 DEFAULT_CONFIG 深度合并，并做基础类型与默认值兜底。
 */

const { DEFAULT_CONFIG } = require('./defaults');
const { ADDITIVE_FIELDS, ENTRY_NORMALIZERS, REMOVED_FIELDS, mergeBaseline } = require('../data');
const { resolveMountPath, readMountFile } = require('./mounts');
const { expandIncludes } = require('./include');
const { buildServiceCatalog, buildMemberHints, deepMerge } = require('./catalog');
const { resolveGroupDeclarations } = require('./groups');
const { POOL_NAMES } = require('../data/default-pools');
const { GROUP_KEYS, groupName } = require('../data/catalog/identity');

const POOL_PREFIX = '@pool:';

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
 * 已删除字段 fail-closed。
 *
 * 退役字段（`enableAI` / `aiServices` 一类）如果被静默忽略，用户会以为开关还生效，
 * 实际产物已按新默认表生成——属于最隐蔽的 fail-open。因此配置里再出现它们直接报错，
 * 并指向迁移对照表。
 *
 * 只拦「已退役的公开字段」，不拦内部运行时选项与未知拼写（后者由远程配置的
 * 白名单收敛负责）。
 *
 * @param {object} config 展开 include 之后的用户配置
 * @throws {Error} 出现已删除字段时
 */
const REMOVED_FIELD_SET = new Set(REMOVED_FIELDS);

/**
 * 退役字段的专用迁移提示。
 *
 * 开关类字段都指向 `routing` 表；但 `customRules` / `customGroups` 是「搬家」而不是
 * 「换开关」（前者进 `routing` 的 `{ rule, to }`，后者进 `groups`），统一文案会让用户
 * 以为把它们塞进 routing 就完事，所以单独给出落点。
 */
const REMOVED_FIELD_HINTS = {
  customRules: '规则请改写为 `routing` 里的 `{ rule: \'DOMAIN-SUFFIX,a.com\', to: <组名> }\` 条目（表内位置即优先级）',
  customGroups: '组请改写为 `groups` 声明（组只声明成员与呈现，不再携带 rules / providers / process）',
  enableResidential: `隔离组改由节点池表达：开 \`enableIsolation: true\` 启用内置「${groupName(GROUP_KEYS.residential)}」池，自定义用 \`pools\` 声明`,
  isolateHighMulti: `隔离组改由节点池表达：开 \`enableIsolation: true\` 启用内置「${groupName(GROUP_KEYS.highMulti)}」池，阈值仍是 \`highMultiThreshold\``,
  isolateExperimental: `隔离组改由节点池表达：开 \`enableIsolation: true\` 启用内置「${groupName(GROUP_KEYS.experimental)}」池`,
  isolateDownload: `隔离组改由节点池表达：「${groupName(GROUP_KEYS.lowMulti)}」是内置池（默认隐藏），用 \`@pool:${groupName(GROUP_KEYS.lowMulti)}\` 或 \`pools\` 引用`,
  processDirectWin: '进程名单更名为 `customProcessWin`（自定义进程，默认直连，可用 `{ preset: process, to }` 改道）',
  processDirectMac: '进程名单更名为 `customProcessMac`（自定义进程，默认直连，可用 `{ preset: process, to }` 改道）',
  processDirectLin: '进程名单更名为 `customProcessLin`（自定义进程，默认直连，可用 `{ preset: process, to }` 改道）',
  processProxyWin: '进程名单更名为 `downloadProcessWin`（下载软件，默认走下载组，可用 `{ preset: download, to }` 改道）',
  processProxyMac: '进程名单更名为 `downloadProcessMac`（下载软件，默认走下载组，可用 `{ preset: download, to }` 改道）',
  processProxyLin: '进程名单更名为 `downloadProcessLin`（下载软件，默认走下载组，可用 `{ preset: download, to }` 改道）',
};

function assertNoRemovedFields(config) {
  const removed = Object.keys(config || {}).filter(key => REMOVED_FIELD_SET.has(key));
  if (removed.length === 0) return;
  const plain = removed.filter(key => !REMOVED_FIELD_HINTS[key]);
  const hinted = removed.filter(key => REMOVED_FIELD_HINTS[key]);
  const parts = [];
  if (plain.length > 0) {
    parts.push(
      `已删除字段 ${plain.map(key => `\`${key}\``).join('、')}：批次 3 起分流由 \`routing\` 表表达` +
        '（批量用 preset、单项用 service）'
    );
  }
  for (const key of hinted) parts.push(`已删除字段 \`${key}\`：${REMOVED_FIELD_HINTS[key]}`);
  throw new Error(`[Config] ${parts.join('；')}，迁移对照见 ROADMAP.md 10.7`);
}

/**
 * 校验 `@pool:<池名>` 引用是否指向已声明的池
 *
 * 口径统一（装载期 fail-closed）：`groups[].proxies` 与 `routing[].to` 中的池引用
 * 必须在内置池表或用户 `pools` 中声明，否则报出字段路径并中止。
 * 「池已声明但当前为空 / 未启用」仍属合法状态，由装配期的空成员跳过处理。
 *
 * @param {object} config 归一化后的完整配置
 */
function validatePoolReferences(config) {
  const knownPools = new Set(Object.values(POOL_NAMES));
  for (const pool of Array.isArray(config.pools) ? config.pools : []) {
    if (pool && typeof pool.name === 'string' && pool.name.trim()) {
      knownPools.add(pool.name.trim());
    }
  }

  const available = [...knownPools].join(' / ') || '无';
  const check = (value, path) => {
    if (typeof value !== 'string') return;
    const token = value.trim();
    if (!token.toLowerCase().startsWith(POOL_PREFIX)) return;
    const poolName = token.slice(POOL_PREFIX.length).trim();
    if (!poolName) {
      throw new Error(`[Config] ${path}: \`@pool:\` 后缺少池名`);
    }
    if (!knownPools.has(poolName)) {
      throw new Error(`[Config] ${path}: 节点池「${poolName}」未声明，可用池: ${available}（自定义池见 pools）`);
    }
  };

  (Array.isArray(config.groups) ? config.groups : []).forEach((group, gIdx) => {
    if (!group || !Array.isArray(group.proxies)) return;
    group.proxies.forEach((item, pIdx) => check(item, `groups[${gIdx}].proxies[${pIdx}]`));
  });

  (Array.isArray(config.routing) ? config.routing : []).forEach((entry, idx) => {
    if (entry && typeof entry === 'object') check(entry.to, `routing[${idx}].to`);
  });
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
  assertNoRemovedFields(expanded);

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
  const logger = options?.logger || merged.logger || userConfig?.logger;
  applyAdditiveFields(merged, logger);

  // 4. 构建单一事实来源 ServiceCatalog 实例
  merged.catalog = buildServiceCatalog(merged);
  merged.registries = merged.catalog.toRegistries();

  // 5. 归一化声明式策略组清单：`groups` → 引擎可直接消费的完整组声明。
  //    `{ ref: <键> }` 从内置组目录取出完整声明并允许条目内覆写任意字段；
  //    `disabled: true` 显式关闭；未知 ref 键 fail-closed。
  //    归一化结果原地写回 `groups`，作为引擎/展示层唯一的组声明入口——组只声明成员与呈现，
  //    分流规则一律来自 `routing` 表（`{ rule }` 条目或 `preset` / `service` 的 `to`）。
  const { declarations: declaredGroups, refKeys, disabledRefs } = resolveGroupDeclarations(merged.groups, {
    directory: merged.registries.groups,
    memberHints: buildMemberHints(merged.registries),
    fieldPath: 'groups'
  });

  // 改名不断链：用户覆写的组名实时同步至 registries，使 routing 展开与目标解析自动随动
  declaredGroups.forEach((decl, index) => {
    const refKey = refKeys[index];
    if (!refKey) return;
    if (decl.name) {
      const groupEntry = merged.registries.groups?.[refKey];
      if (groupEntry) {
        groupEntry.name = decl.name;
        if (groupEntry.cleanName !== undefined) groupEntry.cleanName = decl.name;
        if (groupEntry.uiIcon) groupEntry.fullName = `${groupEntry.uiIcon} ${decl.name}`;
      }
      for (const cat of ['ai', 'streaming', 'social', 'game', 'dev', 'system', 'specialized', 'aggregates']) {
        const item = merged.registries[cat]?.[refKey];
        if (item) {
          item.name = decl.name;
          item.cleanName = decl.name;
          item.fullName = item.uiIcon ? `${item.uiIcon} ${decl.name}` : decl.name;
        }
      }
    }
  });

  merged.groups = declaredGroups;
  // 关闭状态以显式字段随配置下传；routing 展开据此报出「目标组已关闭」，不再读目录上的隐式标记
  merged.disabledGroupRefs = disabledRefs;

  // 6. 池引用统一在装载期 fail-closed：groups[].proxies 与 routing[].to 同一套口径
  validatePoolReferences(merged);

  return merged;
}

module.exports = {
  DEFAULT_CONFIG,
  resolveConfig
};
