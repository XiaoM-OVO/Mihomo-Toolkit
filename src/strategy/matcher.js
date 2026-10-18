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
    if (item instanceof RegExp) return item;
    if (typeof item !== 'string') return null;
    const str = item.trim();
    if (!str) return null;

    // 格式形如 /regex/flags
    const regMatch = str.match(/^\/(.+)\/([a-z]*)$/i);
    if (regMatch) {
      try {
        return new RegExp(regMatch[1], regMatch[2]);
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
      if (matcher instanceof RegExp) return matcher.test(str);
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
 * 编译单个过滤规则对象
 * @param {object} rule
 * @param {object} [options]
 * @param {'all'|'any'} [options.defaultLogic='all']
 * @returns {((item: object) => boolean)|null}
 */
function compileRule(rule, { defaultLogic = 'all' } = {}) {
  if (!rule || typeof rule !== 'object') return null;

  const checks = [];

  // 1. 地区 (region)
  if (rule.region !== undefined) {
    const fn = compileRegionMatcher(rule.region);
    if (fn) checks.push(fn);
  }

  // 2. 标签 (tags)
  if (rule.tags !== undefined) {
    const fn = compileTagMatcher(rule.tags);
    if (fn) checks.push((item) => fn(item.tags));
  }

  // 3. 倍率 (multi)
  if (rule.multi !== undefined) {
    const fn = compileMultiMatcher(rule.multi);
    if (fn) checks.push((item) => fn(item.attrs?.multiNum ?? 1.0));
  }

  // 4. 正则/名称关键词 (pattern / name)
  if (rule.pattern !== undefined || rule.name !== undefined) {
    const fn = compilePatternMatcher(rule.pattern !== undefined ? rule.pattern : rule.name);
    if (fn) checks.push((item) => fn(item.proxy?.name || item.rawName));
  }

  // 5. 协议 (protocol / type)
  if (rule.protocol !== undefined || rule.type !== undefined) {
    const fn = compileProtocolMatcher(rule.protocol !== undefined ? rule.protocol : rule.type);
    if (fn) checks.push(fn);
  }

  // 6. 机场来源 (airport / subTag)
  if (rule.airport !== undefined || rule.subTag !== undefined) {
    const fn = compileAirportMatcher(rule.airport !== undefined ? rule.airport : rule.subTag);
    if (fn) checks.push(fn);
  }

  // 7. 特征业务池 (featurePools / pool)
  if (rule.featurePools !== undefined || rule.pool !== undefined) {
    const fn = compileFeaturePoolMatcher(rule.featurePools !== undefined ? rule.featurePools : rule.pool);
    if (fn) checks.push(fn);
  }

  // 8. 布尔标识
  if (typeof rule.isSpecial === 'boolean') {
    checks.push((item) => Boolean(item.isSpecial) === rule.isSpecial);
  }
  if (typeof rule.isUnknownRegion === 'boolean') {
    checks.push((item) => Boolean(item.isUnknownRegion) === rule.isUnknownRegion);
  }

  // 9. 自定义 JS 谓词函数 (供 services.config.js 等场景调用)
  if (typeof rule.custom === 'function') {
    checks.push(rule.custom);
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
  filterNodes
};
