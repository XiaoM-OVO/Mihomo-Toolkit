/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 策略组节点筛选谓词匹配器 (Recipe Matcher)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 负责解析 DSL 中声明的 match (节点匹配配方) 与 exclude (黑名单排除)；
 * 2. 将声明式过滤规则（地区、标签、倍率、名称正则、协议、特征池等）预编译为纯函数谓词；
 * 3. 面向 Strategy 拓扑引擎提供零副作用、高执行性能的节点过滤与分类计算能力。
 */

const { isRegionInContinent } = require('../core/shared/regions');
const { isKnownMacro, formatMacroHints } = require('./macros');

/** 声明式策略组允许的 Mihomo 原生组类型（单一真相源，供拓扑引擎与校验器共用） */
const SUPPORTED_GROUP_TYPES = new Set(['select', 'url-test', 'fallback', 'load-balance']);

/** groups 顶层允许字段白名单（未列出的键一律 fail-closed 抛错） */
const ALLOWED_GROUP_KEYS = new Set([
  'name', 'type', 'url', 'interval', 'tolerance', 'lazy', 'strategy',
  'icon', 'emoji', 'hidden', 'filter', 'exclude-filter',
  'match', 'exclude', 'proxies', 'preferredRegions', 'direction'
]);

/**
 * 编译倍率匹配器
 * @param {string|number|Array<number>} spec
 * @returns {((num: number) => boolean)|null}
 */
function compileMultiMatcher(spec) {
  if (spec == null || spec === '') return null;

  // 数组范围：[min, max]
  if (Array.isArray(spec)) {
    if (spec.length === 2 && typeof spec[0] === 'number' && typeof spec[1] === 'number') {
      const [min, max] = spec;
      return (num) => num >= min && num <= max;
    }
  }

  // 单一数字（等值匹配）
  if (typeof spec === 'number') {
    return (num) => Math.abs(num - spec) < 1e-6;
  }

  if (typeof spec !== 'string') return null;
  const s = spec.trim();

  // 区间表达式：[min, max], (min, max], [min, max), (min, max)
  const rangeMatch = s.match(/^([\[\(])\s*([0-9.]+)\s*,\s*([0-9.]+)\s*([\]\)])$/);
  if (rangeMatch) {
    const leftBracket = rangeMatch[1];
    const min = parseFloat(rangeMatch[2]);
    const max = parseFloat(rangeMatch[3]);
    const rightBracket = rangeMatch[4];
    return (num) => {
      const leftOk = leftBracket === '[' ? num >= min : num > min;
      const rightOk = rightBracket === ']' ? num <= max : num < max;
      return leftOk && rightOk;
    };
  }

  // 比较运算符：<=, <, >=, >, ==, =
  const opMatch = s.match(/^(<=|>=|<|>|==|=)?\s*([0-9.]+)$/);
  if (opMatch) {
    const op = opMatch[1] || '==';
    const target = parseFloat(opMatch[2]);
    switch (op) {
      case '<=': return (num) => num <= target;
      case '<':  return (num) => num < target;
      case '>=': return (num) => num >= target;
      case '>':  return (num) => num > target;
      case '=':
      case '==': return (num) => Math.abs(num - target) < 1e-6;
    }
  }

  return null;
}

/**
 * 编译名称/正则匹配器
 * @param {string|RegExp|Array<string|RegExp>} spec
 * @returns {((name: string) => boolean)|null}
 */
function compilePatternMatcher(spec) {
  if (spec == null || spec === '') return null;

  const compileSingle = (item) => {
    if (item instanceof RegExp) {
      const flags = (item.flags || '').replace(/[gy]/g, '');
      return new RegExp(item.source, flags);
    }
    if (typeof item !== 'string') return null;
    const str = item.trim();
    if (!str) return null;

    // 格式形如 /regex/flags
    const regMatch = str.match(/^\/(.+)\/([a-z]*)$/i);
    if (regMatch) {
      try {
        const safeFlags = (regMatch[2] || '').replace(/[gy]/g, '');
        return new RegExp(regMatch[1], safeFlags);
      } catch {
        // 非法正则安全降级为子串
      }
    }
    // 默认子串不区分大小写匹配
    return { substring: str.toLowerCase() };
  };

  const list = Array.isArray(spec)
    ? spec.map(compileSingle).filter(Boolean)
    : [compileSingle(spec)].filter(Boolean);

  if (list.length === 0) return null;

  return (name) => {
    const str = String(name || '');
    const lower = str.toLowerCase();
    return list.some(matcher => {
      if (matcher instanceof RegExp) {
        matcher.lastIndex = 0;
        return matcher.test(str);
      }
      if (matcher && matcher.substring) return lower.includes(matcher.substring);
      return false;
    });
  };
}

/**
 * 编译地区匹配器
 * 支持：国家/大区代码 (hk, us)、中文名称 (香港, 美国)、大洲代码 (asia, eu)、取反 (!cn) 以及 unknown / other
 * @param {string|Array<string>} spec
 * @returns {((item: object) => boolean)|null}
 */
function compileRegionMatcher(spec) {
  if (spec == null || spec === '') return null;
  const rawList = Array.isArray(spec) ? spec : [spec];
  const positive = [];
  const negative = [];

  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const s = item.trim().toLowerCase();
    if (!s) continue;
    if (s.startsWith('!')) {
      const neg = s.slice(1).trim();
      if (neg) negative.push(neg);
    } else {
      positive.push(s);
    }
  }

  if (positive.length === 0 && negative.length === 0) return null;

  return (item) => {
    const regionInfo = item.regionInfo;
    const id = (regionInfo?.id || '').toLowerCase();
    const code = (regionInfo?.code || '').toLowerCase();
    const name = (regionInfo?.name || '').toLowerCase();
    const foldGroup = (regionInfo?.foldGroup || regionInfo?.group || '').toLowerCase();
    const groupKey = (item.groupKey || '').toLowerCase();
    const isUnknown = Boolean(item.isUnknownRegion || (!regionInfo && groupKey === 'unknown'));

    const matchToken = (token) => {
      if (token === 'unknown' || token === '未知识别') {
        return isUnknown;
      }
      if (token === 'other' || token === '其它' || token === '其他') {
        return groupKey === 'other' || foldGroup === 'other';
      }

      // 大洲与次大区层级匹配 (如 asia / 亚洲 / sea / 东南亚 / europe / americas 等)
      if (regionInfo && isRegionInContinent(regionInfo, token)) {
        return true;
      }

      return (
        (id && id === token) ||
        (code && code === token) ||
        (name && (name === token || name.includes(token))) ||
        (foldGroup && foldGroup === token) ||
        (groupKey && groupKey === token)
      );
    };

    // 1. 负向拦截 (Fail-Closed)
    if (negative.some(matchToken)) {
      return false;
    }

    // 2. 若无正向限制，通过负向检验即可放行
    if (positive.length === 0) {
      return true;
    }

    // 3. 正向匹配至少命中一个
    return positive.some(matchToken);
  };
}

/**
 * 编译标签匹配器
 * 支持：字符串、数组（默认任一满足 OR）或对象 { any: [...], all: [...] }，支持 !tag 排除
 * @param {string|Array<string>|object} spec
 * @returns {((nodeTags: Array<string>) => boolean)|null}
 */
function compileTagMatcher(spec) {
  if (spec == null || spec === '') return null;

  let anyTokens = [];
  let allTokens = [];
  const negativeTokens = [];

  if (typeof spec === 'object' && !Array.isArray(spec)) {
    if (Array.isArray(spec.any)) anyTokens.push(...spec.any);
    if (Array.isArray(spec.all)) allTokens.push(...spec.all);
  } else {
    const rawList = Array.isArray(spec) ? spec : [spec];
    anyTokens.push(...rawList);
  }

  const clean = (arr) => arr.map(t => String(t || '').trim().toLowerCase()).filter(Boolean);
  const extractNeg = (arr) => {
    const pos = [];
    for (const t of arr) {
      if (t.startsWith('!')) {
        const neg = t.slice(1).trim();
        if (neg) negativeTokens.push(neg);
      } else {
        pos.push(t);
      }
    }
    return pos;
  };

  anyTokens = extractNeg(clean(anyTokens));
  allTokens = extractNeg(clean(allTokens));

  if (anyTokens.length === 0 && allTokens.length === 0 && negativeTokens.length === 0) {
    return null;
  }

  return (nodeTags) => {
    const tagSet = new Set(
      (Array.isArray(nodeTags) ? nodeTags : [])
        .map(t => String(t || '').trim().toLowerCase())
        .filter(Boolean)
    );

    // 1. 排除检查
    if (negativeTokens.some(t => tagSet.has(t))) {
      return false;
    }

    // 2. 全量必须检查 (all)
    if (allTokens.length > 0 && !allTokens.every(t => tagSet.has(t))) {
      return false;
    }

    // 3. 任一满足检查 (any)
    if (anyTokens.length > 0 && !anyTokens.some(t => tagSet.has(t))) {
      return false;
    }

    return true;
  };
}

/**
 * 编译协议类型匹配器
 * @param {string|Array<string>} spec
 * @returns {((item: object) => boolean)|null}
 */
function compileProtocolMatcher(spec) {
  if (spec == null || spec === '') return null;
  const rawList = Array.isArray(spec) ? spec : [spec];
  const positive = [];
  const negative = [];

  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const s = item.trim().toLowerCase();
    if (!s) continue;
    if (s.startsWith('!')) {
      const neg = s.slice(1).trim();
      if (neg) negative.push(neg);
    } else {
      positive.push(s);
    }
  }

  if (positive.length === 0 && negative.length === 0) return null;

  return (item) => {
    const proto = (item.protocol || item.proxy?.type || '').toLowerCase();
    if (negative.includes(proto)) return false;
    if (positive.length === 0) return true;
    return positive.includes(proto);
  };
}

/**
 * 编译机场订阅标签匹配器
 * @param {string|Array<string>} spec
 * @returns {((item: object) => boolean)|null}
 */
function compileAirportMatcher(spec) {
  if (spec == null || spec === '') return null;
  const rawList = Array.isArray(spec) ? spec : [spec];
  const positive = [];
  const negative = [];

  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const s = item.trim().toLowerCase();
    if (!s) continue;
    if (s.startsWith('!')) {
      const neg = s.slice(1).trim();
      if (neg) negative.push(neg);
    } else {
      positive.push(s);
    }
  }

  if (positive.length === 0 && negative.length === 0) return null;

  return (item) => {
    const airport = (item.airportTag || '').toLowerCase();
    if (negative.includes(airport)) return false;
    if (positive.length === 0) return true;
    return positive.includes(airport);
  };
}

/**
 * 编译特征池匹配器 (featurePools)
 * @param {string|Array<string>} spec
 * @returns {((item: object) => boolean)|null}
 */
function compileFeaturePoolMatcher(spec) {
  if (spec == null || spec === '') return null;
  const rawList = (Array.isArray(spec) ? spec : [spec])
    .map(s => String(s || '').trim().toLowerCase())
    .filter(Boolean);
  if (rawList.length === 0) return null;

  return (item) => {
    const pools = new Set((item.featurePools || []).map(p => String(p || '').toLowerCase()));
    return rawList.some(p => pools.has(p));
  };
}

/**
 * 断言非空字符串或非空字符串数组
 */
function assertNonEmptyStringOrArray(val, path, label = '字符串') {
  if (typeof val === 'string') {
    if (!val.trim()) {
      throw new Error(`[groups] ${path}: ${label}值不能为空`);
    }
    return;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) {
      throw new Error(`[groups] ${path}: 数组不能为空`);
    }
    for (let i = 0; i < val.length; i++) {
      if (typeof val[i] !== 'string' || !val[i].trim()) {
        throw new TypeError(`[groups] ${path}[${i}]: 期望非空 string 类型`);
      }
    }
    return;
  }
  throw new TypeError(`[groups] ${path}: 期望 string 或 string[] 类型`);
}

/**
 * 断言模式/正则参数
 */
function assertPattern(val, path) {
  if (typeof val === 'string') {
    if (!val.trim()) {
      throw new Error(`[groups] ${path}: 正则/名称关键词不能为空`);
    }
  } else if (val instanceof RegExp) {
    // 正则实例合法
  } else if (Array.isArray(val)) {
    if (val.length === 0) {
      throw new Error(`[groups] ${path}: 数组不能为空`);
    }
    for (let i = 0; i < val.length; i++) {
      const item = val[i];
      const isPattern = (typeof item === 'string' && Boolean(item.trim())) || item instanceof RegExp;
      if (!isPattern) {
        throw new TypeError(`[groups] ${path}[${i}]: 期望非空 string 或 RegExp 类型`);
      }
    }
  } else {
    throw new TypeError(`[groups] ${path}: 期望 string, RegExp 或由它们组成的非空数组`);
  }
}

/**
 * 断言倍率参数
 */
function assertMulti(val, path) {
  if (typeof val === 'number') {
    if (Number.isNaN(val)) {
      throw new TypeError(`[groups] ${path}: 倍率数值不能为 NaN`);
    }
  } else if (typeof val === 'string') {
    const s = val.trim();
    if (!s) {
      throw new Error(`[groups] ${path}: 倍率字符串表达式不能为空`);
    }
    const rangeMatch = s.match(/^([\[\(])\s*([0-9.]+)\s*,\s*([0-9.]+)\s*([\]\)])$/);
    const opMatch = s.match(/^(<=|>=|<|>|==|=)?\s*([0-9.]+)$/);
    if (!rangeMatch && !opMatch) {
      throw new Error(`[groups] ${path}: 倍率格式不合法「${val}」，仅支持比较运算符（如 '<= 1.5'）或区间（如 '[1.0, 2.0]'）`);
    }
  } else if (Array.isArray(val)) {
    if (val.length !== 2 || typeof val[0] !== 'number' || typeof val[1] !== 'number' || Number.isNaN(val[0]) || Number.isNaN(val[1])) {
      throw new TypeError(`[groups] ${path}: 数组范围必须为包含两个数字的元组 [min, max]`);
    }
  } else {
    throw new TypeError(`[groups] ${path}: 期望 number, string (不等式/区间) 或 [min, max] 数字范围数组`);
  }
}

/**
 * 断言标签参数
 */
function assertTags(val, path) {
  if (typeof val === 'string') {
    if (!val.trim()) {
      throw new Error(`[groups] ${path}: 标签名不能为空`);
    }
  } else if (Array.isArray(val)) {
    if (val.length === 0) {
      throw new Error(`[groups] ${path}: 标签数组不能为空`);
    }
    for (let i = 0; i < val.length; i++) {
      if (typeof val[i] !== 'string' || !val[i].trim()) {
        throw new TypeError(`[groups] ${path}[${i}]: 期望非空 string 标签`);
      }
    }
  } else if (typeof val === 'object' && val !== null) {
    const tagKeys = Object.keys(val);
    for (const tk of tagKeys) {
      if (tk !== 'any' && tk !== 'all') {
        throw new Error(`[groups] ${path}: 复合标签对象包含未知键「${tk}」，仅允许 'any' 或 'all'`);
      }
    }
    if (!tagKeys.includes('any') && !tagKeys.includes('all')) {
      throw new Error(`[groups] ${path}: 复合标签对象必须至少包含 'any' 或 'all' 中的一个`);
    }
    for (const tk of ['any', 'all']) {
      if (val[tk] !== undefined) {
        if (!Array.isArray(val[tk]) || val[tk].length === 0) {
          throw new TypeError(`[groups] ${path}.${tk}: 期望非空 string[] 数组`);
        }
        for (let i = 0; i < val[tk].length; i++) {
          if (typeof val[tk][i] !== 'string' || !val[tk][i].trim()) {
            throw new TypeError(`[groups] ${path}.${tk}[${i}]: 期望非空 string 标签`);
          }
        }
      }
    }
  } else {
    throw new TypeError(`[groups] ${path}: 期望 string, string[] 或包含 any/all 成员数组的复合对象`);
  }
}

/**
 * 配方维度单一事实源 (SSOT) 映射表
 */
const RECIPE_DIMENSIONS = {
  region: {
    validate: (val, path) => assertNonEmptyStringOrArray(val, path, '字符串'),
    compile: compileRegionMatcher
  },
  multi: {
    validate: assertMulti,
    compile: (val) => {
      const fn = compileMultiMatcher(val);
      return fn ? (item) => fn(item.attrs?.multiNum ?? 1.0) : null;
    }
  },
  tags: {
    validate: assertTags,
    compile: (val) => {
      const fn = compileTagMatcher(val);
      return fn ? (item) => fn(item.tags) : null;
    }
  },
  pattern: {
    validate: assertPattern,
    compile: (val) => {
      const fn = compilePatternMatcher(val);
      return fn ? (item) => fn(item.proxy?.name || item.rawName) : null;
    }
  },
  protocol: {
    validate: (val, path) => assertNonEmptyStringOrArray(val, path, '字符串'),
    compile: compileProtocolMatcher
  },
  airport: {
    validate: (val, path) => assertNonEmptyStringOrArray(val, path, '字符串'),
    compile: compileAirportMatcher
  },
  pool: {
    validate: (val, path) => assertNonEmptyStringOrArray(val, path, '字符串'),
    compile: compileFeaturePoolMatcher
  },
  isSpecial: {
    validate: (val, path) => {
      if (typeof val !== 'boolean') throw new TypeError(`[groups] ${path}: 期望 boolean 类型`);
    },
    compile: (val) => ((item) => Boolean(item.isSpecial) === val)
  },
  isUnknownRegion: {
    validate: (val, path) => {
      if (typeof val !== 'boolean') throw new TypeError(`[groups] ${path}: 期望 boolean 类型`);
    },
    compile: (val) => ((item) => Boolean(item.isUnknownRegion) === val)
  },
  custom: {
    validate: (val, path) => {
      if (typeof val !== 'function') throw new TypeError(`[groups] ${path}: 期望 function 谓词类型`);
    },
    compile: (fn) => fn
  }
};

const ALLOWED_RECIPE_KEYS = new Set([...Object.keys(RECIPE_DIMENSIONS), 'mode']);

/**
 * 校验单个配方对象 (Recipe) 字段名与值类型
 * @param {any} recipe 配方对象
 * @param {string} path 错误路径提示
 */
function validateRecipe(recipe, path) {
  if (typeof recipe === 'function') return;

  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    throw new TypeError(`[groups] ${path}: 配方必须为非空普通对象 (Plain Object) 或函数`);
  }

  const keys = Object.keys(recipe);
  if (keys.length === 0) {
    throw new Error(`[groups] ${path}: 配方对象不能为空，至少需包含一个有效匹配维度`);
  }

  for (const key of keys) {
    if (key === 'mode') {
      if (recipe.mode !== 'all' && recipe.mode !== 'any') {
        throw new Error(`[groups] ${path}.mode: 期望 'all' 或 'any'`);
      }
      continue;
    }

    const dim = RECIPE_DIMENSIONS[key];
    if (!dim) {
      throw new Error(`[groups] ${path}: 未知匹配维度「${key}」，支持字段: ${[...ALLOWED_RECIPE_KEYS].join(', ')}`);
    }

    const val = recipe[key];
    if (val === undefined || val === null) {
      throw new TypeError(`[groups] ${path}.${key}: 匹配规则值不能为空或 undefined`);
    }

    dim.validate(val, `${path}.${key}`);
  }
}

/**
 * 校验 groups 列表中所有 match 与 exclude 配方
 * @param {Array<object>} groups 声明式自定义策略组定义列表
 */
function validateGroups(groups) {
  if (!groups) return;
  if (!Array.isArray(groups)) {
    throw new TypeError(`[groups] groups 配置必须为策略组对象数组`);
  }

  groups.forEach((group, index) => {
    if (!group || typeof group !== 'object') {
      throw new TypeError(`[groups] groups[${index}]: 策略组定义必须为有效对象`);
    }

    const groupName = group.name ? `「${group.name}」` : `[${index}]`;

    // 1. 顶层字段白名单 (Fail-Closed)：未知字段直接抛错，杜绝静默忽略的"幽灵配置"
    for (const key of Object.keys(group)) {
      if (!ALLOWED_GROUP_KEYS.has(key)) {
        throw new Error(`[groups] 策略组 ${groupName}: 未知字段「${key}」，支持字段: ${[...ALLOWED_GROUP_KEYS].join(', ')}`);
      }
    }

    // 2. 方向限定值：非法取值在此 fail-closed（未生效方向的声明同样会被校验）
    if (group.direction !== undefined && group.direction !== 'split' && group.direction !== 'return') {
      throw new Error(`[groups] 策略组 ${groupName}.direction: 仅支持 split / return，收到 ${JSON.stringify(group.direction)}`);
    }

    // 3. 组类型白名单：禁止非法类型静默降级为 select
    if (group.type !== undefined && group.type !== null) {
      const type = String(group.type).toLowerCase().trim();
      if (!SUPPORTED_GROUP_TYPES.has(type)) {
        throw new Error(`[groups] 策略组 ${groupName}.type: 未知策略组类型「${group.type}」，支持: ${[...SUPPORTED_GROUP_TYPES].join(' | ')}`);
      }
    }

    // 4. proxies 必须为 string[]，且其中出现的 `@` 宏必须是已登记宏（配置期 fail-closed）
    if (group.proxies !== undefined && group.proxies !== null) {
      if (!Array.isArray(group.proxies)) {
        throw new TypeError(`[groups] 策略组 ${groupName}.proxies: 期望 string[] 数组`);
      }
      group.proxies.forEach((item, pIdx) => {
        if (typeof item !== 'string' || !item.trim()) {
          throw new TypeError(`[groups] 策略组 ${groupName}.proxies[${pIdx}]: 期望非空 string`);
        }
        const token = item.trim();
        // @pool:<池名> 动态宏在运行期按池成员展开；池名存在性已在装载期校验
        if (token.toLowerCase().startsWith('@pool:')) return;
        if (token.startsWith('@') && !isKnownMacro(token)) {
          throw new Error(
            `[groups] 策略组 ${groupName}.proxies[${pIdx}]: 未知宏「${token}」，` +
            `可用宏: ${formatMacroHints()}（完整别名与含义见 CONFIGURATION.md）`
          );
        }
      });
    }

    // 3.2 preferredRegions 必须为非空字符串数组（供 `@preferredRegions` 宏展开）
    if (group.preferredRegions !== undefined && group.preferredRegions !== null) {
      const pref = group.preferredRegions;
      if (!Array.isArray(pref) || pref.length === 0) {
        throw new TypeError(`[groups] 策略组 ${groupName}.preferredRegions: 期望非空 string[] 数组`);
      }
      pref.forEach((item, pIdx) => {
        if (typeof item !== 'string' || !item.trim()) {
          throw new TypeError(`[groups] 策略组 ${groupName}.preferredRegions[${pIdx}]: 期望非空 string`);
        }
      });
    }

    for (const field of ['match', 'exclude']) {
      if (group[field] === undefined || group[field] === null) continue;

      const pathPrefix = `策略组 ${groupName} -> ${field}`;
      const val = group[field];

      if (Array.isArray(val)) {
        if (val.length === 0) {
          throw new Error(`[groups] ${pathPrefix}: 配方数组不能为空`);
        }
        val.forEach((recipe, rIdx) => {
          validateRecipe(recipe, `${pathPrefix}[${rIdx}]`);
        });
      } else {
        validateRecipe(val, pathPrefix);
      }
    }
  });
}

/**
 * 编译单个过滤规则对象
 * @param {object} rule
 * @param {object} [options]
 * @param {'all'|'any'} [options.defaultLogic='all']
 * @returns {((item: object) => boolean)|null}
 */
function compileRule(rule, { defaultLogic = 'all' } = {}) {
  if (!rule || typeof rule !== 'object') return null;

  const checks = [];
  for (const [key, dim] of Object.entries(RECIPE_DIMENSIONS)) {
    if (rule[key] !== undefined) {
      const fn = dim.compile(rule[key]);
      if (fn) checks.push(fn);
    }
  }

  if (checks.length === 0) return null;

  const logic = rule.mode || defaultLogic;
  if (logic === 'any') {
    return (item) => checks.some(fn => fn(item));
  }
  return (item) => checks.every(fn => fn(item));
}

/**
 * 编译节点匹配配方 (match)
 * @param {object|Array<object>|Function} matchSpec
 * @returns {(item: object) => boolean}
 */
function compileMatch(matchSpec) {
  if (matchSpec == null || matchSpec === '') {
    return () => true;
  }
  if (typeof matchSpec === 'function') {
    return matchSpec;
  }
  if (Array.isArray(matchSpec)) {
    const rules = matchSpec.map(r => compileRule(r, { defaultLogic: 'all' })).filter(Boolean);
    if (rules.length === 0) return () => true;
    return (item) => rules.some(r => r(item));
  }
  const single = compileRule(matchSpec, { defaultLogic: 'all' });
  return single || (() => true);
}

/**
 * 编译黑名单排除配方 (exclude)
 * 默认模式为 disjunction (任一排除条件命中即排除)
 * @param {object|Array<object>|Function} excludeSpec
 * @returns {(item: object) => boolean}
 */
function compileExclude(excludeSpec) {
  if (excludeSpec == null || excludeSpec === '') {
    return () => false;
  }
  if (typeof excludeSpec === 'function') {
    return excludeSpec;
  }
  if (Array.isArray(excludeSpec)) {
    const rules = excludeSpec.map(r => compileRule(r, { defaultLogic: 'any' })).filter(Boolean);
    if (rules.length === 0) return () => false;
    return (item) => rules.some(r => r(item));
  }
  const single = compileRule(excludeSpec, { defaultLogic: 'any' });
  return single || (() => false);
}

/**
 * 创建一体化节点筛选谓词
 * @param {object} [spec={}]
 * @param {object|Array|Function} [spec.match] 命中配方
 * @param {object|Array|Function} [spec.exclude] 排除配方
 * @returns {(item: object) => boolean}
 */
function createNodePredicate({ match, exclude } = {}) {
  const matchFn = compileMatch(match);
  const excludeFn = compileExclude(exclude);

  return (item) => {
    if (!item) return false;
    if (item.skip) return false;
    return matchFn(item) && !excludeFn(item);
  };
}

/**
 * 批量过滤节点列表 (纯函数)
 * @param {Array<object>} nodes 已打标节点列表
 * @param {object} [options={}]
 * @param {object|Array|Function} [options.match]
 * @param {object|Array|Function} [options.exclude]
 * @param {boolean} [options.includeInfo=false] 是否保留看板/说明节点
 * @param {boolean} [options.includeSpecial=true] 是否保留特殊节点
 * @returns {Array<object>}
 */
function filterNodes(nodes = [], { match, exclude, includeInfo = false, includeSpecial = true } = {}) {
  if (!Array.isArray(nodes)) return [];
  const predicate = createNodePredicate({ match, exclude });

  return nodes.filter(item => {
    if (!item) return false;
    if (!includeInfo && item.isInfo) return false;
    if (!includeSpecial && item.isSpecial) return false;
    return predicate(item);
  });
}

module.exports = {
  SUPPORTED_GROUP_TYPES,
  compileMultiMatcher,
  compilePatternMatcher,
  compileRegionMatcher,
  compileTagMatcher,
  compileProtocolMatcher,
  compileAirportMatcher,
  compileFeaturePoolMatcher,
  compileRule,
  compileMatch,
  compileExclude,
  createNodePredicate,
  filterNodes,
  validateRecipe,
  validateGroups
};

