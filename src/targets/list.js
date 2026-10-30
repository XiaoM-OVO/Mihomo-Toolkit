/**
 * -----------------------------------------------------------------------------
 * Target: `list` 子命令 — 反射当前配置下可引用的对象
 * -----------------------------------------------------------------------------
 * 只读命令：不拉订阅、不落盘。数据全部来自现有单一真相源，不另外维护清单：
 *   refs     ← registries.groups（`{ ref: <键> }` 的合法取值）
 *   presets  ← PRESET_DEFINITIONS（`routing[].preset` 的合法取值）
 *   macros   ← MACRO_GROUPS（`proxies` 里可用的 `@` 宏）
 *   pools    ← BUILTIN_POOL_DEFS + resolvePoolDefinitions()（`@pool:` / 池名目标）
 *   services ← 分类注册表 / specialized / aggregates / ADS_GROUPS（`routing[].service`）
 *
 * 输出契约：
 *   - 人类可读：树形文本，首行是域标题与计数；
 *   - `--json`：{ domain, configLoaded, count, items }，字段名即用户 API。
 * 内部实现字段（如 materializable / poolDependent / skeleton）一律先映射成
 * 「聚合组 / 可独立引用」「恒在 / 按需」「未启用」等用户语义再输出，
 * 避免把内部字段名固化成对外契约。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { resolveConfig } = require('../config');
const { ADS_GROUPS, buildMemberHints } = require('../config/catalog');
const { PRESET_DEFINITIONS } = require('../data/default-routing');
const { BUILTIN_POOL_DEFS } = require('../data/default-pools');
const { resolvePoolDefinitions } = require('../strategy/pools');
const { MACRO_GROUPS } = require('../strategy/macros');
const { absolutizeMountPaths } = require('../config/mounts');
const { expandIncludes } = require('../config/include');

/** 域 → 人类可读标题 */
const DOMAIN_LABELS = {
  refs: '可引用组目录',
  presets: '分流预设',
  macros: '动态拓扑宏',
  pools: '节点池',
  services: '服务条目'
};

/** 需要按当前配置投影的域；presets / macros 是静态事实，不因配置而变 */
const CONFIG_DEPENDENT_DOMAINS = new Set(['refs', 'pools', 'services']);

/** 服务分类 → 展示标签（分类标签复用预设定义，专项/聚合/广告单列） */
const CATEGORY_LABELS = {
  specialized: '专项服务',
  aggregate: '聚合组',
  ads: '广告规则'
};
// 注：ads 用「广告规则」而非组名，避免在逻辑层复写已登记的组身份字面量。

/**
 * 读取并解析配置，产出与流水线同一口径的合并配置
 * @param {string} [configPath] CLI `-c` 指定的路径
 * @returns {{ config: object, configLoaded: boolean }}
 */
function loadConfig(configPath) {
  if (!configPath) {
    return { config: resolveConfig({}), configLoaded: false };
  }
  const absPath = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`配置文件不存在：${absPath}`);
  }
  const baseDir = path.dirname(absPath);
  const content = fs.readFileSync(absPath, 'utf-8');
  const raw = /\.(yaml|yml)$/i.test(absPath)
    ? (yaml.parse(content) || {})
    : JSON.parse(content);
  // 与 CLI / server 装载现场保持同一顺序：先绝对化挂载路径，再展开 include
  const userConfig = expandIncludes(absolutizeMountPaths(raw, baseDir), baseDir);
  return { config: resolveConfig(userConfig, { baseDir }), configLoaded: true };
}

/**
 * `refs`：内置组目录（`{ ref: <键> }` 的合法取值）
 * @param {object} config 已解析配置
 */
function collectRefs(config) {
  const groups = config.registries?.groups || {};
  const aggregateRefs = new Set(
    Object.values(config.registries?.aggregates || {})
      .filter(Boolean)
      .map(item => item.refKey || item.key)
  );
  const disabled = new Set(config.disabledGroupRefs || []);

  return Object.entries(groups).map(([ref, item]) => ({
    ref,
    name: item.name,
    type: item.type || 'select',
    // 用户语义：聚合组（成员不单独成组） vs 可独立引用
    kind: aggregateRefs.has(ref) ? 'aggregate' : 'standalone',
    hidden: item.hidden === true,
    status: disabled.has(ref) ? 'disabled' : 'active'
  }));
}

/** `presets`：`routing[].preset` 的合法取值 */
function collectPresets() {
  return Object.entries(PRESET_DEFINITIONS).map(([preset, def]) => ({
    preset,
    label: def.label,
    kind: def.kind,
    registry: def.registry || null
  }));
}

/** `macros`：`proxies` 里可用的 `@` 宏（规范写法 + 全部别名） */
function collectMacros() {
  return MACRO_GROUPS.map(def => ({
    macro: def.macro,
    aliases: [...def.aliases]
  }));
}

/**
 * `pools`：内置池与用户池
 *
 * 内置池会连同「当前未启用（被 enableIsolation 门控）」的一起列出，
 * 并与 `resolvePoolDefinitions()` 的启用口径保持一致。
 */
function collectPools(config) {
  const active = new Map(resolvePoolDefinitions(config).map(def => [def.name, def]));
  const items = BUILTIN_POOL_DEFS.map(def => {
    const current = active.get(def.name) || null;
    return {
      pool: def.name,
      status: current ? 'active' : 'inactive',
      // 恒在 = 总是物化；按需 = 被规则/组引用才物化
      activation: def.group === 'always' ? 'always' : 'onDemand',
      hidden: def.hidden === true,
      isolate: def.isolate === true,
      builtin: true,
      gate: current ? null : (def.gated === true ? 'enableIsolation' : null),
      match: current ? (current.match || null) : null
    };
  });

  for (const def of active.values()) {
    if (def.builtin) continue;
    items.push({
      pool: def.name,
      status: 'active',
      activation: def.group === 'always' ? 'always' : 'onDemand',
      hidden: def.hidden === true,
      isolate: def.isolate === true,
      builtin: false,
      gate: null,
      match: def.match || null
    });
  }

  return items;
}

/**
 * `services`：`routing[].service` 的合法取值
 *
 * 与 `findService` 的查找范围同源（分类 → 专项 → 聚合组 → 广告规则来源）。
 * 每条同时标注「能否直接 `{ ref: <键> }`」，聚合成员会给出应改引的聚合组。
 */
function collectServices(config) {
  const registries = config.registries || {};
  const groups = registries.groups || {};
  const memberHints = buildMemberHints(registries);
  const aggregateByRef = new Map(
    Object.values(registries.aggregates || {})
      .filter(Boolean)
      .map(item => [item.refKey || item.key, item])
  );

  const items = [];
  const seen = new Set();

  const push = (service, category, item) => {
    if (!service || seen.has(service)) return;
    seen.add(service);
    const direct = Boolean(groups[service]);
    const hintRef = direct ? null : (memberHints[service] || null);
    const hintItem = hintRef ? aggregateByRef.get(hintRef) : null;
    items.push({
      service,
      name: item?.cleanName || item?.name || service,
      category,
      hidden: item?.hidden === true,
      refStatus: direct ? 'direct' : (hintRef ? 'aggregate-member' : 'none'),
      ref: direct ? service : (hintRef || null),
      memberOf: hintItem ? (hintItem.cleanName || hintItem.name) : null
    });
  };

  for (const category of ['ai', 'streaming', 'social', 'game', 'dev', 'system']) {
    for (const [key, item] of Object.entries(registries[category] || {})) {
      push(key, category, item);
    }
  }
  for (const [key, item] of Object.entries(registries.specialized || {})) {
    push(key, 'specialized', item);
  }
  for (const [ref, item] of aggregateByRef) {
    push(ref, 'aggregate', item);
  }
  for (const [key, item] of Object.entries(ADS_GROUPS)) {
    const declared = groups[key];
    push(key, 'ads', declared || item);
  }

  return items;
}

const COLLECTORS = {
  refs: collectRefs,
  presets: collectPresets,
  macros: collectMacros,
  pools: collectPools,
  services: collectServices
};

/**
 * 各域的人类可读摘要（跟在标题后）
 * @param {string} domain
 * @param {Array<object>} items
 * @returns {string}
 */
function summarize(domain, items) {
  switch (domain) {
    case 'refs': {
      const aggregateCount = items.filter(item => item.kind === 'aggregate').length;
      return `（聚合组 ${aggregateCount} · 可独立引用 ${items.length - aggregateCount}）`;
    }
    case 'macros': {
      const aliasCount = items.reduce((sum, item) => sum + item.aliases.length, 0);
      return `（规范写法 ${items.length} · 含别名共 ${aliasCount}）`;
    }
    case 'pools': {
      const inactiveCount = items.filter(item => item.status === 'inactive').length;
      return `（启用 ${items.length - inactiveCount} · 未启用 ${inactiveCount}）`;
    }
    default:
      return '';
  }
}

/** 单个条目 → 一行人类可读文本 */
function renderItem(domain, item) {
  switch (domain) {
    case 'refs': {
      const marks = [
        `[${item.kind === 'aggregate' ? '聚合组' : '可独立引用'}]`,
        item.ref,
        '·',
        item.name,
        `(${item.type})`
      ];
      if (item.hidden) marks.push('· 隐藏');
      if (item.status === 'disabled') marks.push('· 已禁用');
      return marks.join(' ');
    }
    case 'presets':
      return `${item.preset} · ${item.label}（${item.kind}${item.registry ? `：${item.registry}` : ''}）`;
    case 'macros': {
      const aliasText = item.aliases.filter(alias => alias !== item.macro);
      return `${item.macro}${aliasText.length > 0 ? `（别名：${aliasText.join(' / ')}）` : ''}`;
    }
    case 'pools': {
      const marks = [item.pool];
      if (item.status === 'inactive') {
        marks.push(`· 未启用${item.gate ? `（需 ${item.gate}：true）` : ''}`);
      } else {
        marks.push(item.activation === 'always' ? '· 恒在' : '· 按需');
      }
      if (!item.builtin) marks.push('· 自定义');
      if (item.hidden) marks.push('· 隐藏');
      if (item.isolate) marks.push('· 隔离');
      return marks.join(' ');
    }
    case 'services': {
      const categoryLabel = CATEGORY_LABELS[item.category]
        || PRESET_DEFINITIONS[item.category]?.label
        || item.category;
      const refText = item.refStatus === 'direct'
        ? '可独立引用'
        : (item.refStatus === 'aggregate-member'
          ? `聚合成员（不可单独 ref${item.ref ? `，改引 ${item.ref}` : ''}）`
          : '仅可作 service 引用');
      return `${item.service} · ${categoryLabel} · ${refText}${item.hidden ? ' · 隐藏' : ''}`;
    }
    default:
      return '';
  }
}

/** 渲染人类可读输出 */
function renderHuman(domain, items) {
  const title = `🧾 ${DOMAIN_LABELS[domain]} (${domain})：共 ${items.length} 个${summarize(domain, items)}`;
  if (items.length === 0) return [title, '└── （无）'].join('\n');
  const lines = items.map((item, index) => {
    const branch = index === items.length - 1 ? '└──' : '├──';
    return `${branch} ${renderItem(domain, item)}`;
  });
  return [title, ...lines].join('\n');
}

/**
 * 执行 `list` 子命令
 * @param {object} params
 * @param {string} [params.domain] 域：refs | presets | macros | pools | services
 * @param {string} [params.config] 配置文件路径
 * @param {boolean} [params.json] 是否输出 JSON
 */
function runListCommand({ domain, config, json = false } = {}) {
  const available = Object.keys(DOMAIN_LABELS);
  if (!domain) {
    console.error(`❌ 缺少 list 域，可选：${available.join(' / ')}`);
    process.exitCode = 1;
    return;
  }
  if (!available.includes(domain)) {
    console.error(`❌ 未知 list 域「${domain}」，可选：${available.join(' / ')}`);
    process.exitCode = 1;
    return;
  }

  try {
    let resolved = null;
    let configLoaded = false;
    if (CONFIG_DEPENDENT_DOMAINS.has(domain)) {
      const loaded = loadConfig(config);
      resolved = loaded.config;
      configLoaded = loaded.configLoaded;
    }
    const items = COLLECTORS[domain](resolved);

    if (json) {
      console.log(JSON.stringify({
        domain,
        configLoaded,
        count: items.length,
        items
      }, null, 2));
      return;
    }
    console.log(renderHuman(domain, items));
  } catch (err) {
    console.error(`❌ list 失败：${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { runListCommand };
