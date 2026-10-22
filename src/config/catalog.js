/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 领域服务编目投影 (Service Catalog Projection)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 将 `src/data/catalog/` 的只读编目基线投影为运行期 ServiceCatalog
 * 2. 提供正则编译、图标 URL 组装与深度合并等纯函数
 * 3. 面向 Core 与 Strategy 提供多维纯净投影
 *
 * 静态声明（仓库前缀 / 分类默认 / 服务字典 / 组声明）已下沉到 data 层，本文件不再保存事实数据。
 */

'use strict';

const {
  DEFAULT_REPOS,
  DEFAULT_AGGREGATES,
  SPECIAL_SERVICES,
  ADS_GROUPS,
  DOWNLOAD_GROUPS,
  SKELETON_GROUP_DEFS,
  CATEGORY_DEFAULTS,
  BUILTIN_SERVICES
} = require('../data/catalog');

// ─────────────────────────────────────────────────────────────
// 4. 辅助工具：正则智能提升与图标 URL 组装
// ─────────────────────────────────────────────────────────────

/**
 * 将字符串形式或原生正则安全转换为标准 RegExp 实例
 * @param {string|RegExp} input
 * @returns {RegExp|null}
 */
function compileRegex(input) {
  if (input instanceof RegExp) return input;
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 检测 /pattern/flags 形式
  const slashMatch = trimmed.match(/^\/(.*)\/([a-z]*)$/i);
  if (slashMatch) {
    try {
      return new RegExp(slashMatch[1], slashMatch[2]);
    } catch {
      // 回退容错
    }
  }

  // 普通文本转为大小写不敏感正则
  try {
    return new RegExp(trimmed, 'i');
  } catch {
    return null;
  }
}

/**
 * 根据图标定义与仓库前缀解析绝对图标链接
 * @param {string|object} iconDef
 * @param {object} repoMap
 * @returns {string}
 */
function resolveIconUrl(iconDef, repoMap = DEFAULT_REPOS.icons) {
  if (!iconDef) return '';
  if (typeof iconDef === 'string') {
    return iconDef.startsWith('http://') || iconDef.startsWith('https://') ? iconDef : '';
  }
  if (typeof iconDef === 'object') {
    if (iconDef.url) return iconDef.url;
    const repoBase = (iconDef.repo && repoMap[iconDef.repo]) || '';
    const file = iconDef.file || '';
    return repoBase && file ? `${repoBase}${file}` : '';
  }
  return '';
}

/**
 * 递归深度合并对象，数组直接替换（符合声明式覆写直觉）
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
function deepMerge(target, source) {
  const output = { ...target };
  if (!source || typeof source !== 'object') return output;

  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      output[key] = [...value]; // 数组整体覆盖
    } else if (value instanceof RegExp) {
      output[key] = value;
    } else if (typeof value === 'object') {
      output[key] = deepMerge(target[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

/**
 * 解析服务分流规则的目标策略组（杜绝私有魔术字符串，动态绑定大类聚合目标）
 * @param {string} rawTarget 原始 target 声明
 * @param {string} cat 服务所属大类 ('game', 'ai' 等)
 * @param {string} cleanName 服务名称
 * @param {object} catDefaults 大类默认配置对象
 * @returns {string} 目标策略组名称
 */
function resolveRuleTarget(rawTarget, cat, cleanName, catDefaults = {}) {
  const aggregates = catDefaults.aggregates || {};
  const defaultAggName = catDefaults.defaultAggregate ? aggregates[catDefaults.defaultAggregate]?.name : null;

  if (!rawTarget || rawTarget === '@self') {
    return defaultAggName || cleanName;
  }
  if (typeof rawTarget === 'string' && rawTarget.startsWith('@')) {
    const key = rawTarget.slice(1);
    if (aggregates[key]) {
      return aggregates[key].name;
    }
  }
  return rawTarget;
}

/**
 * 解析单个服务条目的路由规则与 Provider 归属。
 *
 * 每条规则同时携带「已解析目标组名」与「前缀」，供两层消费者共用：
 * - 服务条目投影：直接取 `text` 作为最终规则串；
 * - 聚合条目投影：按 `target` 归属到对应聚合组，并可改写目标组名（自路由规则 → 聚合组名）。
 *
 * @param {object} s 服务定义
 * @param {string} cat 分类键
 * @param {string} key 服务键
 * @param {object} catDefaults 分类默认策略
 * @returns {{ providerPath: string, ruleSetName: string, entries: Array<object> }}
 */
function resolveServiceRuleEntries(s, cat, key, catDefaults) {
  const cleanName = s.name || key;
  let providerPath = `geosite/${key}`;
  let ruleSetName = key;
  const entries = [];

  if (s.provider) {
    providerPath = s.provider;
  } else if (s.providerPath) {
    providerPath = s.providerPath.startsWith('geosite/') || s.providerPath.startsWith('geoip/')
      ? s.providerPath
      : `geosite/${s.providerPath}`;
  }

  if (typeof s.rules === 'string') {
    if (!s.provider && !s.providerPath) providerPath = `geosite/${s.rules}`;
    ruleSetName = s.rules;
    const target = resolveRuleTarget(s.target, cat, cleanName, catDefaults);
    entries.push({
      text: `RULE-SET,${s.rules},${target}`,
      prefix: `RULE-SET,${s.rules}`,
      suffix: '',
      target,
      providerName: s.rules
    });
  } else if (Array.isArray(s.rules)) {
    if (!s.provider && !s.providerPath) {
      const ruleSetItem = s.rules.find(r => r && r.type === 'RULE-SET' && r.path);
      if (ruleSetItem) {
        providerPath = `geosite/${ruleSetItem.path}`;
      }
    }
    for (const r of s.rules) {
      if (typeof r === 'string') {
        entries.push({ text: r, prefix: r, suffix: '', target: null, providerName: null });
        continue;
      }
      const target = resolveRuleTarget(r.target, cat, cleanName, catDefaults);
      entries.push({
        text: `${r.type},${r.value},${target}`,
        prefix: `${r.type},${r.value}`,
        suffix: '',
        target,
        providerName: String(r.type).toUpperCase() === 'RULE-SET' ? r.value : null
      });
    }
  } else if (s.rules && typeof s.rules === 'object') {
    ruleSetName = s.rules.name || key;
    if (!s.provider && !s.providerPath) {
      providerPath = s.rules.path ? `geosite/${s.rules.path}` : `geosite/${ruleSetName}`;
    }
    const target = resolveRuleTarget(s.rules.target || s.target, cat, cleanName, catDefaults);
    entries.push({
      text: `RULE-SET,${ruleSetName},${target}`,
      prefix: `RULE-SET,${ruleSetName}`,
      suffix: '',
      target,
      providerName: ruleSetName
    });
  }

  return { providerPath, ruleSetName, entries };
}

// ─────────────────────────────────────────────────────────────
// 5. 编目解析引擎 (ServiceCatalog)
// ─────────────────────────────────────────────────────────────

class ServiceCatalog {
  constructor(services = {}, repos = DEFAULT_REPOS, userConfig = {}) {
    this.services = services;
    this.repos = repos;
    this.userConfig = userConfig;
  }

  /**
   * 获取指定分类下的单个服务定义
   * @param {string} category 'ai' | 'streaming' | 'social' | 'game' | 'dev' | 'system'
   * @param {string} key
   * @returns {object|null}
   */
  getService(category, key) {
    return this.services[category]?.[key] || null;
  }

  /**
   * 获取某分类下所有服务列表（全量内置服务 + 用户自定义服务）
   * @param {string} category 分类名称
   * @returns {Array<{ key: string, category: string, service: object }>}
   */
  getActiveServices(category) {
    const catServices = this.services[category] || {};
    return Object.keys(catServices).map(key => ({
      key,
      category,
      service: catServices[key]
    }));
  }

  /**
   * 获取特征打标规则列表 (供 Core/cleaner 使用)
   * 包含编译后的 RegExp、tag/pool、Emoji 图标与显示文本
   * @param {object} [runtimeConfig]
   * @returns {Array<{ id: string, reg: RegExp, tag: string, pool: string, uiIcon: string, uiText: string }>}
   */
  getCoreMatchers(runtimeConfig) {
    const cfg = runtimeConfig || this.userConfig;
    const matchers = [];

    // 遍历所有允许打标分类（分流开关已退役，打标不再按分类门禁）
    const categories = ['ai', 'streaming', 'social', 'game', 'dev', 'system'];
    for (const cat of categories) {
      const active = this.getActiveServices(cat, cfg);
      const catDefaults = CATEGORY_DEFAULTS[cat] || {};
      for (const { key, service } of active) {
        if (service && service.reg) {
          const compiledReg = compileRegex(service.reg);
          if (compiledReg) {
            matchers.push({
              id: key,
              reg: compiledReg,
              tag: service.tag || key,
              pool: service.pool || key,
              uiIcon: service.emoji || catDefaults.emoji || '',
              uiText: service.name || key
            });
          }
        }
      }
    }

    return matchers;
  }

  /**
   * 导出面向节点重命名与分流展示的服务级特征图标与文本字典 (Feature Maps)
   * 包含 tag, key 与 pool 多维别名映射，支持 O(1) 幂等缓存
   * @returns {{ icons: Record<string, string>, texts: Record<string, string> }}
   */
  getFeatureMaps() {
    if (this._featureMaps) {
      return this._featureMaps;
    }
    const icons = {};
    const texts = {};
    for (const [cat, catServices] of Object.entries(this.services)) {
      const catDefaults = CATEGORY_DEFAULTS[cat] || {};
      for (const [key, service] of Object.entries(catServices)) {
        if (!service) continue;
        const tag = service.tag || key;
        const pool = service.pool || key;
        const emoji = service.emoji || catDefaults.emoji || '';
        const name = service.name || key;

        if (emoji) {
          icons[tag] = emoji;
          icons[key] = emoji;
          if (pool) icons[pool] = emoji;
        }
        if (name) {
          texts[tag] = name;
          texts[key] = name;
          if (pool) texts[pool] = name;
        }
      }
    }
    this._featureMaps = { icons, texts };
    return this._featureMaps;
  }

  /**
   * 计算策略组的展示全名（依据 groupIconMode）
   * @param {object} service
   * @param {string} [mode] "emoji" | "icon" | "both"
   * @returns {string}
   */
  getGroupName(service, mode) {
    const iconMode = mode || this.userConfig.groupIconMode || 'emoji';
    const name = service.name;
    const catDefaults = service.category ? CATEGORY_DEFAULTS[service.category] : null;
    const emoji = service.emoji || catDefaults?.emoji || '';

    if (iconMode === 'icon') {
      return name;
    }
    return emoji ? `${emoji} ${name}` : name;
  }

  /**
   * 导出结构化服务注册表对象
   * @returns {object} { ai, streaming, social, game, dev, system, aggregates, specialized, groups }
   */
  toRegistries() {
    const registries = {};
    // 规则条目（含已解析目标组名）按分类缓存：聚合组投影需要按目标归属合并成员规则，
    // 与服务条目投影共用同一份解析结果，避免「同一规则解析两遍」。
    const ruleEntriesByCategory = {};
    for (const [cat, catServices] of Object.entries(this.services)) {
      const catDefaults = CATEGORY_DEFAULTS[cat] || {};
      registries[cat] = {};
      ruleEntriesByCategory[cat] = {};
      for (const [key, s] of Object.entries(catServices)) {
        const cleanName = s.name || key;
        const emoji = s.emoji || catDefaults.emoji || '';
        const fullName = emoji ? `${emoji} ${cleanName}` : cleanName;
        const iconDef = s.icon || catDefaults.icon;
        const iconUrl = resolveIconUrl(iconDef, this.repos.icons);
        const compiledReg = compileRegex(s.reg);

        const { providerPath, ruleSetName, entries } = resolveServiceRuleEntries(s, cat, key, catDefaults);
        ruleEntriesByCategory[cat][key] = entries;

        registries[cat][key] = {
          tag: s.tag || key,
          category: cat,
          name: cleanName,
          cleanName,
          fullName,
          iconUrl,
          uiIcon: emoji,
          reg: compiledReg,
          provider: s.provider || providerPath,
          ruleSet: s.ruleSet || ruleSetName,
          pool: s.pool || key,
          rules: entries.map(e => e.text),
          proxies: s.proxies ? [...s.proxies] : undefined,
          preferredRegions: s.preferredRegions || catDefaults.preferredRegions || [],
          type: s.type,
          match: s.match,
          exclude: s.exclude,
          hidden: s.hidden,
          providerOnly: Boolean(s.providerOnly)
        };
      }
    }

    // 聚合策略组投影：**归属完全由「规则目标名」决定**，不再有成员清单 / 多聚合仲裁。
    // 服务条目的 `target`（如 game 的 '@download'、social 的 '@combined'）在解析期就落成组名，
    // 聚合条目只负责收集「目标指向自己」的规则——新增一个聚合组只需：
    //   1) 在 CATEGORY_DEFAULTS 里加一条组定义；2) 把相关规则的 target 指过去。本段代码无需改动。
    const aggregates = {};
    const aggregateDirectoryEntries = {};
    for (const [cat, catDef] of Object.entries(CATEGORY_DEFAULTS)) {
      if (!catDef.aggregates) continue;
      const catReg = registries[cat] || {};
      const catEntries = ruleEntriesByCategory[cat] || {};
      // Provider 名 → 路径：由本分类各服务条目的 RULE-SET 规则名统一解析（与内置开关路径同一口径）
      const providerMap = {};
      for (const item of Object.values(catReg)) {
        if (item && item.ruleSet && item.provider) providerMap[item.ruleSet] = item.provider;
      }

      for (const [aggKey, meta] of Object.entries(catDef.aggregates)) {
        aggregates[meta.name] = {
          key: aggKey,
          category: cat,
          refKey: meta.refKey || aggKey,
          name: meta.name,
          cleanName: meta.name,
          fullName: meta.emoji ? `${meta.emoji} ${meta.name}` : meta.name,
          uiIcon: meta.emoji || '',
          iconUrl: resolveIconUrl(meta.icon, this.repos.icons),
          type: meta.type || 'select',
          match: meta.match,
          exclude: meta.exclude,
          proxies: meta.proxies ? [...meta.proxies] : undefined
        };

        const rules = [];
        const providers = {};
        for (const [serviceKey, entries] of Object.entries(catEntries)) {
          if (!catReg[serviceKey]) continue;
          for (const e of entries) {
            if (!e.target || e.target !== meta.name) continue;
            rules.push(`${e.prefix},${e.target}${e.suffix}`);
            if (e.providerName && providerMap[e.providerName]) {
              providers[e.providerName] = providerMap[e.providerName];
            }
          }
        }

        // 规则来源归属聚合条目本身；组目录只投影「可独立成立的组声明」。
        aggregates[meta.name].rules = rules;
        if (Object.keys(providers).length > 0) aggregates[meta.name].providers = providers;
        aggregateDirectoryEntries[meta.refKey || aggKey] = {
          name: meta.name,
          type: meta.type || 'select',
          match: meta.match,
          exclude: meta.exclude,
          proxies: meta.proxies ? [...meta.proxies] : undefined,
          preferredRegions: undefined,
          hidden: meta.hidden
        };
      }
    }
    registries.aggregates = aggregates;

    // 专项独立服务全量投影 (Crypto, PayPal, WebRTC, Telegram - 包含 rules/providers/process/proxies)
    const specialized = {};
    for (const [specKey, spec] of Object.entries(SPECIAL_SERVICES)) {
      specialized[specKey] = {
        key: specKey,
        name: spec.name,
        cleanName: spec.name,
        fullName: spec.emoji ? `${spec.emoji} ${spec.name}` : spec.name,
        uiIcon: spec.emoji || '',
        iconUrl: resolveIconUrl(spec.icon, this.repos.icons),
        providers: spec.providers ? { ...spec.providers } : {},
        rules: spec.rules ? [...spec.rules] : [],
        process: spec.process ? { ...spec.process } : undefined,
        preferredRegions: spec.preferredRegions ? [...spec.preferredRegions] : undefined,
        proxies: spec.proxies ? [...spec.proxies] : undefined
      };
    }
    registries.specialized = specialized;

    // 内置策略组目录 (供 `groups: [{ ref: <键> }]` 引用)：
    // 条目必须自身就是一条「可独立成立的组声明」(自带非空 `proxies`) 才可被引用，
    // 否则引用它只会得到空壳组——那是「配了不生效」，必须 fail-closed 而非静默降级。
    // 该目录不是第二份真相源：它只是同一批 catalog 条目的另一种投影形态。
    // 目录只投影「组声明」：rules / providers / process 属于规则来源，留在分类条目、
    // 聚合条目或 ADS_GROUPS 中，由 routing 直接读取，不得混入声明层。
    const groupDirectory = {};
    for (const [cat, catReg] of Object.entries(registries)) {
      if (cat === 'aggregates') continue;
      for (const [key, item] of Object.entries(catReg)) {
        if (!item || !Array.isArray(item.proxies) || item.proxies.length === 0) continue;
        // AI 大类偏好地区允许用户用 aiPreferredRegions 全局覆写（与内置配方口径一致）
        const prefOverride = cat === 'ai' && Array.isArray(this.userConfig.aiPreferredRegions)
          ? this.userConfig.aiPreferredRegions
          : null;
        const prefList = prefOverride || item.preferredRegions || [];
        groupDirectory[key] = {
          name: item.cleanName,
          type: item.type || 'select',
          match: item.match,
          exclude: item.exclude,
          proxies: [...item.proxies],
          preferredRegions: prefList.length > 0 ? [...prefList] : undefined,
          hidden: item.hidden
        };
      }
    }
    // 聚合组条目入目录：与分类条目同构，都是「自带非空 proxies 的组声明」；
    // 其规则来源存放在 registries.aggregates 条目上。
    for (const [refKey, item] of Object.entries(aggregateDirectoryEntries)) {
      if (!Array.isArray(item.proxies) || item.proxies.length === 0) continue;
      groupDirectory[refKey] = item;
    }

    // 独立单组规则条目（「广告拦截」的两条规则来源）入目录：
    // 目录只承载组声明，规则与 Provider 由 ADS_GROUPS 提供。
    for (const [refKey, item] of Object.entries(ADS_GROUPS)) {
      groupDirectory[refKey] = {
        name: item.name,
        type: item.type || 'select',
        match: item.match,
        exclude: item.exclude,
        proxies: [...item.proxies],
        preferredRegions: undefined,
        hidden: item.hidden
      };
    }

    registries.groups = groupDirectory;

    return registries;
  }
}

/**
 * 组装生成完整的 ServiceCatalog 实例
 * @param {object} [userConfig={}]
 * @returns {ServiceCatalog}
 */
function buildServiceCatalog(userConfig = {}) {
  // 1. 组装全局仓库
  const repos = {
    cdn: userConfig.ruleProviderCDN || DEFAULT_REPOS.cdn,
    geosite: userConfig.geositeRepo || DEFAULT_REPOS.geosite,
    geoip: userConfig.geoipRepo || DEFAULT_REPOS.geoip,
    icons: {
      orz: userConfig.iconRepoOrz || DEFAULT_REPOS.icons.orz,
      koolson: userConfig.iconRepoKoolson || DEFAULT_REPOS.icons.koolson,
      lige47: userConfig.iconRepoLige47 || DEFAULT_REPOS.icons.lige47
    }
  };

  // 2. 初始化服务字典（深拷贝内置默认基准）
  const mergedServices = {};
  for (const [cat, sMap] of Object.entries(BUILTIN_SERVICES)) {
    mergedServices[cat] = {};
    for (const [k, v] of Object.entries(sMap)) {
      mergedServices[cat][k] = { category: cat, ...v };
    }
  }

  // 3. 增量合并用户的自定义服务 (customServices)
  const custom = userConfig.customServices || {};
  for (const [cat, catCustom] of Object.entries(custom)) {
    if (!mergedServices[cat]) {
      mergedServices[cat] = {};
    }
    for (const [key, def] of Object.entries(catCustom || {})) {
      if (!def) continue;

      // 规范化用户传入的定义
      const normalized = { category: cat, ...def };
      if (normalized.reg) {
        normalized.reg = compileRegex(normalized.reg);
      }
      if (normalized.icon && typeof normalized.icon === 'string' && !normalized.icon.startsWith('http')) {
        normalized.icon = { repo: 'koolson', file: normalized.icon };
      }

      if (mergedServices[cat][key]) {
        // 用户修改已有服务 -> 深度合并，保留官方未被修改的字段
        mergedServices[cat][key] = deepMerge(mergedServices[cat][key], normalized);
      } else {
        // 用户新增全新服务 -> 直接注册
        mergedServices[cat][key] = normalized;
      }
    }
  }

  return new ServiceCatalog(mergedServices, repos, userConfig);
}

/**
 * 聚合组成员键 → 所属聚合组 ref 键（引用期报错指引）
 *
 * 成员条目（如 steam / epic / facebook）不单独成组：它的规则目标指向聚合组，
 * 单独引用它只会得到「有组无规则」的空壳，因此引用期必须 fail-closed。
 * 本函数给出「应当改引哪个聚合组」的指引——判据与聚合投影完全一致：
 * **看条目自己的规则目标名落在哪个聚合组上**，不再依赖任何成员清单或分类推断。
 *
 * @param {object} registries `ServiceCatalog#toRegistries()` 的返回值
 * @returns {Record<string, string>} 服务键 → 聚合组 ref 键
 */
function buildMemberHints(registries = {}) {
  const aggregates = registries.aggregates || {};
  const directory = registries.groups || {};
  const byName = new Map(Object.values(aggregates).map(agg => [agg.name, agg]));
  const hints = {};

  for (const [cat, catReg] of Object.entries(registries)) {
    if (cat === 'aggregates' || cat === 'groups' || !catReg || typeof catReg !== 'object') continue;
    const catDef = CATEGORY_DEFAULTS[cat] || {};
    // 指引优先落在分类默认聚合组（如 game 的 @service → game-service），避免多目标条目指向次要聚合组
    const defaultAggName = catDef.defaultAggregate
      ? catDef.aggregates?.[catDef.defaultAggregate]?.name
      : null;

    for (const [key, item] of Object.entries(catReg)) {
      if (directory[key] || !item || !Array.isArray(item.rules)) continue;
      const targets = new Set(
        item.rules.map(rule => String(rule).split(',').pop().trim()).filter(Boolean)
      );
      const agg = (defaultAggName && targets.has(defaultAggName) && byName.get(defaultAggName))
        || [...targets].map(t => byName.get(t)).find(Boolean);
      if (agg) hints[key] = agg.refKey || agg.key;
    }
  }

  return hints;
}

module.exports = {
  compileRegex,
  resolveIconUrl,
  resolveRuleTarget,
  deepMerge,
  buildMemberHints,
  CATEGORY_DEFAULTS,
  DEFAULT_AGGREGATES,
  SPECIAL_SERVICES,
  ADS_GROUPS,
  DOWNLOAD_GROUPS,
  SKELETON_GROUP_DEFS,
  BUILTIN_SERVICES,
  ServiceCatalog,
  buildServiceCatalog
};
