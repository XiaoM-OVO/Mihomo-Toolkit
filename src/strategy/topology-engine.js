/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 声明式策略组拓扑装配引擎 (Topology Engine)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 解析用户声明式策略组 DSL 配置 (groups)；
 * 2. 严格透传 Mihomo 原生配置字段 (type, url, interval, tolerance, strategy 等)；
 * 3. 驱动 matcher 进行节点筛选与黑名单剔除，求值计算各策略组节点清单；
 * 4. 解析策略组引用宏符号 (@matchedNodes, @residential, @allStandard, @defaultProxy 等)；
 * 5. 执行拓扑有向图环路检测 (Cycle Detection)，防范死循环与配置死锁；
 * 6. 支持出厂内置组的声明式覆盖 (Override) 与全新策略组追加 (Append)。
 */

const { filterNodes, SUPPORTED_GROUP_TYPES } = require('./matcher');
const { resolveMacro } = require('./macros');
const { stripGroupDecoration } = require('./presentation');
const { FIELDS_BY_KEY } = require('../data');

/** Mihomo 内置代理目标，非组引用，不参与悬空目标告警 */
const BUILTIN_PROXY_TARGETS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'COMPATIBLE', 'PASS', 'GLOBAL']);

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
  // 建立规范化组名映射 (支持去装饰匹配)
  const canonicalMap = new Map();
  for (const g of groups) {
    if (!g || !g.name) continue;
    canonicalMap.set(g.name, g.name);
    const stripped = stripGroupDecoration(g.name);
    if (!canonicalMap.has(stripped)) {
      canonicalMap.set(stripped, g.name);
    }
    canonicalMap.set(stripped.toLowerCase(), g.name);
  }

  // 建立邻接表：仅记录组与组之间的引用边
  const adj = new Map();
  for (const g of groups) {
    if (!g || !g.name) continue;
    const targets = [];
    for (const p of (Array.isArray(g.proxies) ? g.proxies : [])) {
      if (typeof p !== 'string') continue;
      const strippedP = stripGroupDecoration(p);
      const targetGroup = canonicalMap.get(p) || canonicalMap.get(strippedP) || canonicalMap.get(strippedP.toLowerCase());
      if (targetGroup && targetGroup !== g.name && stripGroupDecoration(targetGroup) !== stripGroupDecoration(g.name)) {
        targets.push(targetGroup);
      }
    }
    adj.set(g.name, dedupe(targets));
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
function resolveGroupProxies({
  declaredProxies = [],
  matchedNodeNames = [],
  macroContext = {},
  knownGroups = null,
  physicalNodeNames = null,
  logger = null
}) {
  const resolved = [];

  // 若用户未声明 proxies，默认交付所有匹配到的节点
  if (!Array.isArray(declaredProxies) || declaredProxies.length === 0) {
    return matchedNodeNames.length > 0 ? [...matchedNodeNames] : [];
  }

  const macroCtx = { ...macroContext, matchedNodeNames };

  for (const item of declaredProxies) {
    if (!item || typeof item !== 'string') continue;
    const token = item.trim();
    const tokenLower = token.toLowerCase();

    // 1. 已登记宏：别名与求值口径统一来自 ./macros（与配方校验器共用同一真相源）
    const macroValues = resolveMacro(tokenLower, macroCtx);
    if (macroValues !== null) {
      resolved.push(...macroValues);
      continue;
    }

    // 2. 未命中任何已知宏的 `@` 符号：视为配置错误，告警并跳过（禁止退化为字面组名）
    if (token.startsWith('@')) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`⚠️ [TopologyEngine] 未知宏变量「${token}」已跳过，可用宏见 CONFIGURATION.md 动态拓扑宏变量清单`);
      }
      continue;
    }

    // 3. 非宏 token：按「物理节点 / 已知组 / 内置目标」归一化
    let target = token;
    const isPhysical = physicalNodeNames && physicalNodeNames.has(token);
    if (!isPhysical) {
      const stripped = stripGroupDecoration(token);
      const knownTarget = knownGroups && (
        knownGroups.get(token) ||
        knownGroups.get(tokenLower) ||
        knownGroups.get(stripped) ||
        knownGroups.get(stripped.toLowerCase())
      );
      if (knownTarget) {
        target = knownTarget;
      } else if (token !== stripped) {
        target = stripped;
      } else if (!BUILTIN_PROXY_TARGETS.has(token.toUpperCase()) && logger && typeof logger.warn === 'function') {
        // 既非物理节点、也非已知组或内置目标：保留 token 交由 prune 兜底，但显式告警（避免静默悬空）
        logger.warn(`⚠️ [TopologyEngine] 目标「${token}」不是物理节点、已知策略组或内置目标，可能在生成配置中悬空`);
      }
    }
    resolved.push(target);
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

  const rawName = String(groupDef.name || '').trim();
  if (!rawName) return null;
  const name = rawName;
  const cleanName = stripGroupDecoration(rawName);

  const {
    classifiedNodes = [],
    buckets = {},
    userConfig = {},
    activeRegionGroups = [],
    existingGroups = [],
    groups = []
  } = context;

  // 1. 规范化组类型 (Mihomo 原生类型，支持继承已有骨架组类型)
  const existingGroup = context.existingGroupMap?.get(cleanName.toLowerCase());
  let rawType = groupDef.type
    ? String(groupDef.type).toLowerCase().trim()
    : (existingGroup?.type || 'select');
  if (!SUPPORTED_GROUP_TYPES.has(rawType)) {
    rawType = 'select';
  }

  // 2. 节点匹配与筛选 (声明式 DSL 仅支持 match/exclude 配方，不再提供 pool/tag 组级捷径)
  let matchedNodeNames = [];
  if (groupDef.match || groupDef.exclude) {
    const matched = filterNodes(classifiedNodes, {
      match: groupDef.match,
      exclude: groupDef.exclude
    });
    matchedNodeNames = matched.map(item => item.proxy?.name || item.rawName).filter(Boolean);
  }

  // 3. 构建宏上下文 (地区/家宽/中国分流等口径一律由调用方显式传入，禁止在此启发式推断)
  const defaultProxy = DEFAULT_MODE_MAP[userConfig.defaultProxyMode] || '自动选择';
  const resiGroup = context.residentialGroup || ((userConfig.enableResidential && buckets.residential?.length) ? ['家宽优选'] : []);
  const domesticGroup = context.domesticGroup || [];
  const nonCnRegions = context.nonCnRegions || [];

  // `@preferredRegions` 口径：组声明中的地区 id 经调用方显式传入的 regionNames 映射为地区组名，
  // 与内置配方 (AI/Crypto 等) 的「preferredRegions → regionNames」展开保持同一事实源。
  const regionNames = context.regionNames || {};
  const preferredRegions = Array.isArray(groupDef.preferredRegions)
    ? groupDef.preferredRegions.map(id => regionNames[id] || id)
    : [];

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
    nonCnRegions,
    preferredRegions
  };

  const physicalNodeNames = new Set(
    (classifiedNodes || []).map(item => item.proxy?.name || item.rawName).filter(Boolean)
  );

  // 已知组名注册表：原始名 / 小写名 / 去装饰名 / 去装饰小写名 四种键统一映射到真实组名
  // 全部键按小写归一，修复 `proxies: ['chatgpt']` 无法命中「ChatGPT」组的大小写问题。
  const knownGroups = new Map();
  const registerKnownGroup = (candidate) => {
    if (!candidate) return;
    const realName = candidate;
    const stripped = stripGroupDecoration(candidate);
    knownGroups.set(candidate, realName);
    knownGroups.set(candidate.toLowerCase(), realName);
    knownGroups.set(stripped, realName);
    knownGroups.set(stripped.toLowerCase(), realName);
  };
  if (Array.isArray(existingGroups)) {
    existingGroups.forEach(g => registerKnownGroup(g?.name));
  }
  if (Array.isArray(groups)) {
    groups.forEach(g => registerKnownGroup(g?.name));
  }
  (activeRegionGroups || []).forEach(registerKnownGroup);

  // 4. 组装并去重 proxies
  const proxies = resolveGroupProxies({
    declaredProxies: groupDef.proxies,
    matchedNodeNames,
    macroContext,
    knownGroups,
    physicalNodeNames,
    logger: context.logger || null
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
  //    rules 由分流流水线读取 userConfig.groups 原始声明；禁止在策略组对象上挂 _ 前缀隐式通道。
  if (typeof groupDef.hidden === 'boolean') result.hidden = groupDef.hidden;
  if (groupDef.filter) result.filter = groupDef.filter;
  if (groupDef['exclude-filter']) result['exclude-filter'] = groupDef['exclude-filter'];

  return result;
}

/**
 * 批量求解与装配自定义策略组
 * @param {object} params
 * @param {Array<object>} params.groups 用户声明式策略组配置列表
 * @param {Array<object>} [params.existingGroups=[]] 已存在的骨架策略组列表
 * @param {Array<object>} [params.classifiedNodes=[]] 已打标清洗的节点列表
 * @param {object} [params.buckets={}] 现有分发桶
 * @param {object} [params.userConfig={}] 用户配置对象
 * @param {object} [params.logger=null] 日志记录器
 * @returns {{ evaluatedGroups: Array<object>, cycles: Array<Array<string>> }}
 */
function evaluateCustomTopology({
  groups = [],
  existingGroups = [],
  classifiedNodes = [],
  buckets = {},
  userConfig = {},
  standardOptions = [],
  residentialGroup = [],
  activeRegionGroups = [],
  regionNames = {},
  nonCnRegions = [],
  domesticGroup = [],
  logger = null
} = {}) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return { evaluatedGroups: [], cycles: [] };
  }

  const existingGroupMap = new Map();
  for (const g of existingGroups) {
    if (!g || !g.name) continue;
    existingGroupMap.set(g.name.toLowerCase(), g);
    existingGroupMap.set(stripGroupDecoration(g.name).toLowerCase(), g);
  }

  const context = {
    classifiedNodes,
    buckets,
    userConfig,
    activeRegionGroups,
    regionNames,
    standardOptions,
    residentialGroup,
    domesticGroup,
    nonCnRegions,
    existingGroups,
    existingGroupMap,
    groups,
    logger
  };

  const evaluatedGroups = [];

  for (const def of groups) {
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
  if (hasCycle) {
    const cycleDesc = cycles.map(c => c.join(' -> ')).join(' | ');
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`⚠️ [TopologyEngine] 检测到策略组存在循环依赖: ${cycleDesc}`);
    }
    throw new Error(`[groups] 检测到策略组存在循环依赖 (Cycle Dependency): ${cycleDesc}`);
  }


  return {
    evaluatedGroups,
    cycles
  };
}

module.exports = {
  DEFAULT_MODE_MAP,
  detectGroupCycles,
  resolveGroupProxies,
  evaluateGroupDefinition,
  evaluateCustomTopology
};
