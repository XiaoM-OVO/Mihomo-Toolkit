/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 声明式策略组拓扑装配引擎 (Topology Engine)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 解析用户声明式策略组 DSL 配置 (customGroups)；
 * 2. 严格透传 Mihomo 原生配置字段 (type, url, interval, tolerance, strategy 等)；
 * 3. 驱动 matcher 进行节点筛选与黑名单剔除，求值计算各策略组节点清单；
 * 4. 解析策略组引用宏符号 (@matchedNodes, @residential, @allStandard, @defaultProxy 等)；
 * 5. 执行拓扑有向图环路检测 (Cycle Detection)，防范死循环与配置死锁；
 * 6. 支持出厂内置组的声明式覆盖 (Override) 与全新策略组追加 (Append)。
 */

const { filterNodes } = require('./matcher');
const { filterRegionsByContinent } = require('../core/shared/regions');
const { FIELDS_BY_KEY } = require('../data');

const SUPPORTED_GROUP_TYPES = new Set(['select', 'url-test', 'fallback', 'load-balance']);

/** 默认测速参数取自字段注册表（单一真相源，避免与配置默认值多处漂移） */
const DEFAULT_TEST_URL = FIELDS_BY_KEY.testURL.default;
const DEFAULT_INTERVAL = FIELDS_BY_KEY.testInterval.default;
const DEFAULT_TOLERANCE = FIELDS_BY_KEY.testTolerance.default;

/**
 * 模式与默认代理目标映射表
 */
const DEFAULT_MODE_MAP = {
  auto: '自动选择',
  manual: '手动选择',
  fallback: '故障转移',
  direct: 'DIRECT',
  reject: 'REJECT'
};

/**
 * 数组去重且保序
 * @param {Array<any>} arr
 * @returns {Array<any>}
 */
function dedupe(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.filter(Boolean))];
}

/**
 * 检测策略组之间的循环依赖 (DAG Cycle Detection)
 * @param {Array<object>} groups 策略组列表
 * @returns {{ hasCycle: boolean, cycles: Array<Array<string>> }}
 */
function detectGroupCycles(groups = []) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return { hasCycle: false, cycles: [] };
  }

  const groupNames = new Set(groups.map(g => g?.name).filter(Boolean));
  // 建立邻接表：仅记录组与组之间的引用边
  const adj = new Map();
  for (const g of groups) {
    if (!g || !g.name) continue;
    const targets = (Array.isArray(g.proxies) ? g.proxies : [])
      .filter(p => typeof p === 'string' && groupNames.has(p) && p !== g.name);
    adj.set(g.name, targets);
  }

  const visited = new Set();
  const inStack = new Set();
  const cycles = [];

  function dfs(curr, path) {
    visited.add(curr);
    inStack.add(curr);
    path.push(curr);

    const neighbors = adj.get(curr) || [];
    for (const n of neighbors) {
      if (!visited.has(n)) {
        dfs(n, path);
      } else if (inStack.has(n)) {
        const startIdx = path.indexOf(n);
        if (startIdx !== -1) {
          cycles.push(path.slice(startIdx).concat(n));
        }
      }
    }

    path.pop();
    inStack.delete(curr);
  }

  for (const name of groupNames) {
    if (!visited.has(name)) {
      dfs(name, []);
    }
  }

  return {
    hasCycle: cycles.length > 0,
    cycles
  };
}

/**
 * 展开策略组引用宏符号与节点列表
 * @param {object} params
 * @param {Array<string>} params.declaredProxies 用户声明的 proxies 列表
 * @param {Array<string>} params.matchedNodeNames 通过 match/exclude 筛选出的节点名列表
 * @param {object} params.macroContext 宏替换上下文
 * @returns {Array<string>}
 */
function resolveGroupProxies({ declaredProxies = [], matchedNodeNames = [], macroContext = {} }) {
  const resolved = [];

  // 若用户未声明 proxies，默认交付所有匹配到的节点
  if (!Array.isArray(declaredProxies) || declaredProxies.length === 0) {
    return matchedNodeNames.length > 0 ? [...matchedNodeNames] : [];
  }

  const {
    residential = [],
    allStandard = [],
    highMulti = [],
    special = [],
    activeRegions = [],
    defaultProxy = '自动选择'
  } = macroContext;

  for (const item of declaredProxies) {
    if (!item || typeof item !== 'string') continue;
    const token = item.trim();
    const tokenLower = token.toLowerCase();

    switch (tokenLower) {
      case '@matchednodes':
      case '@matched':
      case '@nodes':
        resolved.push(...matchedNodeNames);
        break;

      case '@residential':
      case '@resi':
        resolved.push(...residential);
        break;

      case '@residentialgroup':
      case '@resigroup':
        resolved.push(...(macroContext.residentialGroup || []));
        break;

      case '@allstandard':
      case '@all':
        resolved.push(...allStandard);
        break;

      case '@highmulti':
        resolved.push(...highMulti);
        break;

      case '@special':
        resolved.push(...special);
        break;

      case '@activeregions':
      case '@regions':
        resolved.push(...activeRegions);
        break;

      case '@asia':
      case '@asiaregions':
      case '@亚洲':
        resolved.push(...filterRegionsByContinent(activeRegions, 'asia'));
        break;

      case '@europe':
      case '@eu':
      case '@euregions':
      case '@欧洲':
        resolved.push(...filterRegionsByContinent(activeRegions, 'europe'));
        break;

      case '@americas':
      case '@america':
      case '@am':
      case '@americaregions':
      case '@美洲':
        resolved.push(...filterRegionsByContinent(activeRegions, 'americas'));
        break;

      case '@oceania':
      case '@oc':
      case '@oceaniaregions':
      case '@大洋洲':
      case '@澳洲':
        resolved.push(...filterRegionsByContinent(activeRegions, 'oceania'));
        break;

      case '@africa':
      case '@af':
      case '@africaregions':
      case '@非洲':
        resolved.push(...filterRegionsByContinent(activeRegions, 'africa'));
        break;

      case '@sea':
      case '@searegions':
      case '@东南亚':
        resolved.push(...filterRegionsByContinent(activeRegions, 'sea'));
        break;

      case '@me':
      case '@meregions':
      case '@中东':
        resolved.push(...filterRegionsByContinent(activeRegions, 'me'));
        break;

      case '@sa':
      case '@saregions':
      case '@南亚':
        resolved.push(...filterRegionsByContinent(activeRegions, 'sa'));
        break;

      case '@na':
      case '@naregions':
      case '@北美':
        resolved.push(...filterRegionsByContinent(activeRegions, 'na'));
        break;

      case '@latam':
      case '@南美':
      case '@拉美':
        resolved.push(...filterRegionsByContinent(activeRegions, 'latam'));
        break;

      case '@ea':
      case '@东亚':
        resolved.push(...filterRegionsByContinent(activeRegions, 'ea'));
        break;

      case '@defaultproxy':
      case '@proxy':
        resolved.push(defaultProxy);
        break;

      case '@standardoptions':
      case '@standard':
        resolved.push(...(macroContext.standardOptions || []));
        break;

      case '@domesticgroup':
      case '@domestic':
        resolved.push(...(macroContext.domesticGroup || []));
        break;

      case '@noncnregions':
      case '@noncn':
      case '@tiktokregions':
        resolved.push(...(macroContext.nonCnRegions || []));
        break;

      default:
        resolved.push(token);
        break;
    }
  }

  return dedupe(resolved);
}

/**
 * 求解单个声明式策略组配置
 * @param {object} groupDef 声明式策略组定义
 * @param {object} context 求解上下文
 * @returns {object|null} Mihomo 标准 proxy-group 对象
 */
function evaluateGroupDefinition(groupDef, context = {}) {
  if (!groupDef || typeof groupDef !== 'object') return null;

  const name = String(groupDef.name || '').trim();
  if (!name) return null;

  const {
    classifiedNodes = [],
    buckets = {},
    userConfig = {},
    activeRegionGroups = []
  } = context;

  // 1. 规范化组类型 (Mihomo 原生类型)
  let rawType = String(groupDef.type || 'select').toLowerCase().trim();
  if (!SUPPORTED_GROUP_TYPES.has(rawType)) {
    rawType = 'select';
  }

  // 2. 节点匹配与筛选
  let matchedNodeNames = [];
  if (groupDef.match || groupDef.exclude) {
    const matched = filterNodes(classifiedNodes, {
      match: groupDef.match,
      exclude: groupDef.exclude,
      includeInfo: Boolean(groupDef.includeInfo),
      includeSpecial: groupDef.includeSpecial !== false
    });
    matchedNodeNames = matched.map(item => item.proxy?.name || item.rawName).filter(Boolean);
  } else if (groupDef.pool || groupDef.tag) {
    const poolNodes = buckets[groupDef.pool] || [];
    const tagNodes = buckets[groupDef.tag] || [];
    matchedNodeNames = dedupe([...poolNodes, ...tagNodes]);
  }

  // 3. 构建宏上下文
  const defaultProxy = DEFAULT_MODE_MAP[userConfig.defaultProxyMode] || '自动选择';
  const resiGroup = context.residentialGroup || ((userConfig.enableResidential && buckets.residential?.length) ? ['家宽优选'] : []);
  const domesticGroup = context.domesticGroup || (userConfig.enableDomesticGroup ? ['中国分流'] : ['DIRECT']);
  const nonCnRegions = context.nonCnRegions || activeRegionGroups.filter(g => !['香港节点', '大陆节点', '中国节点', '未知识别'].includes(g));

  const macroContext = {
    residential: buckets.residential || [],
    residentialGroup: resiGroup,
    allStandard: buckets.allStandard || [],
    highMulti: buckets.highMulti || [],
    special: buckets.special || [],
    activeRegions: activeRegionGroups || [],
    defaultProxy,
    standardOptions: context.standardOptions || [],
    domesticGroup,
    nonCnRegions
  };

  // 4. 组装并去重 proxies
  const proxies = resolveGroupProxies({
    declaredProxies: groupDef.proxies,
    matchedNodeNames,
    macroContext
  });

  // 5. 组装基础 proxy-group 对象 (零字段丢失)
  const result = {
    name,
    type: rawType,
    proxies
  };

  // 6. 原生测速与调度属性透传
  const testURL = groupDef.url || userConfig.testURL || DEFAULT_TEST_URL;
  const testInterval = groupDef.interval || userConfig.testInterval || DEFAULT_INTERVAL;
  const testTolerance = groupDef.tolerance || userConfig.testTolerance || DEFAULT_TOLERANCE;

  if (rawType === 'url-test') {
    Object.assign(result, {
      url: testURL,
      interval: testInterval,
      tolerance: testTolerance,
      lazy: groupDef.lazy !== undefined ? Boolean(groupDef.lazy) : true
    });
  } else if (rawType === 'fallback') {
    Object.assign(result, {
      url: testURL,
      interval: testInterval,
      lazy: groupDef.lazy !== undefined ? Boolean(groupDef.lazy) : true
    });
  } else if (rawType === 'load-balance') {
    Object.assign(result, {
      strategy: groupDef.strategy || 'consistent-hashing',
      url: testURL,
      interval: testInterval,
      lazy: groupDef.lazy !== undefined ? Boolean(groupDef.lazy) : true
    });
  }

  // 7. 其它原生布尔与扩展字段透传
  //    注：icon / emoji / rules 一律不透传——icon 与 emoji 由展示层 (presentation) 统一解析渲染，
  //    rules 由分流流水线读取 userConfig.customGroups 原始声明；禁止在策略组对象上挂 _ 前缀隐式通道。
  if (typeof groupDef.hidden === 'boolean') result.hidden = groupDef.hidden;
  if (groupDef.filter) result.filter = groupDef.filter;
  if (groupDef['exclude-filter']) result['exclude-filter'] = groupDef['exclude-filter'];

  return result;
}

/**
 * 批量求解与装配自定义策略组
 * @param {object} params
 * @param {Array<object>} params.customGroups 用户声明式策略组配置列表
 * @param {Array<object>} [params.existingGroups=[]] 已存在的骨架策略组列表
 * @param {Array<object>} [params.classifiedNodes=[]] 已打标清洗的节点列表
 * @param {object} [params.buckets={}] 现有分发桶
 * @param {object} [params.userConfig={}] 用户配置对象
 * @param {object} [params.logger=null] 日志记录器
 * @returns {{ evaluatedGroups: Array<object>, cycles: Array<Array<string>> }}
 */
function evaluateCustomTopology({
  customGroups = [],
  existingGroups = [],
  classifiedNodes = [],
  buckets = {},
  userConfig = {},
  standardOptions = [],
  residentialGroup = [],
  logger = null
} = {}) {
  if (!Array.isArray(customGroups) || customGroups.length === 0) {
    return { evaluatedGroups: [], cycles: [] };
  }

  const activeRegionGroups = existingGroups
    .map(g => g.name)
    .filter(name => name.endsWith('节点'));

  const domesticGroup = userConfig.enableDomesticGroup ? ['中国分流'] : ['DIRECT'];
  const nonCnRegions = activeRegionGroups.filter(g => !['香港节点', '大陆节点', '中国节点', '未知识别'].includes(g));

  const context = {
    classifiedNodes,
    buckets,
    userConfig,
    activeRegionGroups,
    standardOptions,
    residentialGroup,
    domesticGroup,
    nonCnRegions
  };

  const evaluatedGroups = [];

  for (const def of customGroups) {
    try {
      const group = evaluateGroupDefinition(def, context);
      if (group) {
        evaluatedGroups.push(group);
      }
    } catch (err) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`⚠️ [TopologyEngine] 策略组「${def?.name}」构建异常: ${err.message}`);
      }
    }
  }

  // 环路检测 (包含已存在策略组与新增策略组的全景图)
  const combinedAll = [...existingGroups, ...evaluatedGroups];
  const { hasCycle, cycles } = detectGroupCycles(combinedAll);
  if (hasCycle && logger && typeof logger.warn === 'function') {
    logger.warn(`⚠️ [TopologyEngine] 检测到策略组存在循环依赖: ${cycles.map(c => c.join(' -> ')).join(' | ')}`);
  }

  return {
    evaluatedGroups,
    cycles
  };
}

module.exports = {
  SUPPORTED_GROUP_TYPES,
  DEFAULT_MODE_MAP,
  detectGroupCycles,
  resolveGroupProxies,
  evaluateGroupDefinition,
  evaluateCustomTopology
};
