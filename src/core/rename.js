/**
 * -----------------------------------------------------------------------------
 * Core Layer: 节点重命名与模板渲染 (Pure Rename & Index Computation)
 * -----------------------------------------------------------------------------
 * 严格遵循洋葱模型 Core 层规范：
 * 1. 纯计算函数：输入节点数据与变量，输出清洗后的标准名称
 * 2. 统一序号补零算法：基于大区与机场前缀的全局对齐计算
 * 3. 悬空标点与非法连续分隔符安全擦除
 */

const { FIELDS_BY_KEY } = require('../data');
const { PROTOCOL_ICONS, FEATURE_ICONS, FEATURE_TEXT_MAP } = require('./shared/icons');
const { getIsolationBucket } = require('./isolation');

/** 悬空分隔符默认清单：取自字段注册表（单一真相源，避免与配置默认值漂移） */
const DEFAULT_SEPARATORS = FIELDS_BY_KEY.renameSeparators.default;

/**
 * 构建用于清理多余/连续分隔符的正则表达式
 * @param {Array<string>} [separators]
 */
function createSeparatorCleaners(separators = DEFAULT_SEPARATORS) {
  const charSeps = [];
  const wordSeps = [];

  (separators || DEFAULT_SEPARATORS).forEach(s => {
    const esc = String(s).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    if (s.length === 1) charSeps.push(esc);
    else wordSeps.push(esc);
  });

  const charClass = charSeps.length > 0 ? `[${charSeps.join('')}]` : '';
  const wordStr = wordSeps.join('|');
  const combined = wordSeps.length > 0
    ? (charClass ? `(?:${charClass}|${wordStr})` : `(?:${wordStr})`)
    : charClass;

  const regAdjacent = combined ? new RegExp(`${combined}(?=\\s*${combined})`, 'g') : null;
  const regEdge = combined ? new RegExp(`^(?:\\s|${combined})+|(?:\\s|${combined})+$`, 'g') : null;

  return { regAdjacent, regEdge };
}

/**
 * 统一计算节点列表在各个大区及订阅源前缀下的动态序号
 * @param {Array<object>} items 包含 regionInfo, proxy, airportTag 等属性的对象列表
 * @param {object} [options={}] 配置项 (包含 indexPrefixMap 等)
 * @returns {Map<object, string>} item -> indexStr 映射表
 */
function computeNodeIndices(items = [], options = {}) {
  const indexMap = new Map();
  if (!Array.isArray(items) || items.length === 0) return indexMap;

  const regionTotals = {};
  const groupTotals = {};

  items.forEach(item => {
    if (!item || item.skip || item.isSpecial || item.isInfo || !item.regionInfo) return;
    const regionKey = item.regionInfo.id || item.regionInfo.name;
    const tag = item.airportTag || '';
    const prefix = item.proxy?._indexPrefix || (options.indexPrefixMap && options.indexPrefixMap[tag]) || '';
    const isoBucket = item.isolateBucket !== undefined ? item.isolateBucket : getIsolationBucket(item, options);
    const trackKey = [regionKey, prefix, isoBucket].filter(Boolean).join('__');
    const regionGroupKey = isoBucket ? `${regionKey}__${isoBucket}` : regionKey;

    regionTotals[regionGroupKey] = (regionTotals[regionGroupKey] || 0) + 1;
    groupTotals[trackKey] = (groupTotals[trackKey] || 0) + 1;
  });

  const maxGroupCount = Math.max(...Object.values(groupTotals), 9);
  const indexPad = Math.max(2, maxGroupCount.toString().length);
  const groupTrack = {};

  items.forEach(item => {
    if (!item || item.skip || item.isSpecial || item.isInfo || !item.regionInfo) {
      indexMap.set(item, '');
      return;
    }
    const regionKey = item.regionInfo.id || item.regionInfo.name;
    const tag = item.airportTag || '';
    const prefix = item.proxy?._indexPrefix || (options.indexPrefixMap && options.indexPrefixMap[tag]) || '';
    const isoBucket = item.isolateBucket !== undefined ? item.isolateBucket : getIsolationBucket(item, options);
    const trackKey = [regionKey, prefix, isoBucket].filter(Boolean).join('__');
    const regionGroupKey = isoBucket ? `${regionKey}__${isoBucket}` : regionKey;

    groupTrack[trackKey] = (groupTrack[trackKey] || 0) + 1;
    const idx = groupTrack[trackKey];
    const regionTotal = regionTotals[regionGroupKey] || 1;

    let numStr = '';
    // 当该大区/该隔离轨道节点数 > 1，或指定了前缀时，生成规范格式的序号 (如 01, L01)
    if (regionTotal > 1 || prefix) {
      numStr = prefix ? `${prefix}${String(idx).padStart(indexPad, '0')}` : String(idx).padStart(indexPad, '0');
    }
    indexMap.set(item, numStr);
  });

  return indexMap;
}

/**
 * 渲染节点名称模板
 * @param {string|Function} template 字符串模板或自定义函数 (vars, proxy) => string
 * @param {object} vars 模板变量
 * @param {object} proxy 原始节点对象
 * @param {object} [cleaners] 正则清理器
 * @returns {string} 渲染并清理后的新节点名称
 */
function renderTemplate(template, vars, proxy, cleaners) {
  if (typeof template === 'function') {
    return template(vars, proxy);
  }

  if (typeof template !== 'string') {
    return proxy?.name || '';
  }

  let finalName = template.replace(
    /{(airport|tag|icon|region|index|features|protocol|city|line|in|multi|transport|ip_stack)}/g,
    (match, key) => vars[key] || ''
  );

  // 清理空括号后再处理边缘分隔符，避免留下悬空符号。
  finalName = finalName.replace(/\[\s*(?:[|/·,，、:：-]\s*)*\]|\(\s*(?:[|/·,，、:：-]\s*)*\)|【\s*(?:[|/·,，、:：-]\s*)*】|（\s*(?:[|/·,，、:：-]\s*)*）/g, '');
  const { regAdjacent, regEdge } = cleaners || createSeparatorCleaners();
  if (regAdjacent) finalName = finalName.replace(regAdjacent, '');
  if (regEdge) finalName = finalName.replace(regEdge, '');
  finalName = finalName.replace(/^[\s|/·,，、:：-]+|[\s|/·,，、:：-]+$/g, '');
  finalName = finalName.replace(/\s{2,}/g, ' ').trim();

  return finalName || (proxy?.name || '');
}

/**
 * 为已分类节点统一计算目标名称；保持计算阶段纯净，由调用方提交名称。
 */
function getRenameTier(item) {
  if (item?._preserveExistingName) return 1;
  if (item?.isSpecial || item?.keepName) return 1;
  if (item?.isInfo) return 2;
  if (!item?.regionInfo || item.regionInfo.isUnknown || item?.isUnknownRegion) return 3;
  return 4;
}

function buildRenamePlan(items = [], config = {}) {
  const plan = [];
  if (!Array.isArray(items)) return plan;
  const indexMap = computeNodeIndices(items, config);
  const catalogIcons = {};
  const catalogTexts = {};
  if (config.catalog && typeof config.catalog.getCoreMatchers === 'function') {
    config.catalog.getCoreMatchers().forEach(m => {
      if (m.uiIcon) catalogIcons[m.tag] = m.uiIcon;
      if (m.uiText) catalogTexts[m.tag] = m.uiText;
    });
  }
  const icons = { ...FEATURE_ICONS, ...catalogIcons };
  const texts = { ...FEATURE_TEXT_MAP, ...catalogTexts };
  const cleaners = createSeparatorCleaners(config.renameSeparators);

  for (const item of items) {
    if (!item || item.skip || !item.proxy) continue;
    const tier = getRenameTier(item);
    let intendedName = (item.isSpecial && item.specialTargetName)
      ? item.specialTargetName
      : (item.proxy.name || item.rawName || '');
    if (tier === 2 || tier === 3) intendedName = item.rawName || intendedName;
    if (tier === 4 && config.renameTemplate && config.enableNodeRename !== false) {
    let features = '';
    for (const tag of item.tags || []) {
      if (tag === 'ipv6' || tag === 'dualstack') continue;
      if (config.showFeatureIcon !== false) features += icons[tag] || '';
      else if (texts[tag]) features += (features ? '/' : '') + texts[tag];
    }
    const vars = {
      airport: item.airportTag || '',
      tag: item.airportTag || '',
      icon: item.regionInfo.icon || '',
      region: item.regionInfo.name || '',
      index: indexMap.get(item) || '',
      features,
      protocol: PROTOCOL_ICONS[item.protocol] || '',
      multi: item.attrs?.multiStr || '',
      in: item.attrs?.entryStr || '',
      city: item.destCity || '',
      line: item.attrs?.cleanLines || '',
      ip_stack: item.tags?.includes('dualstack') ? '双栈' : (item.tags?.includes('ipv6') ? 'IPv6' : ''),
      transport: item.transportTag || ''
    };
      const name = renderTemplate(config.renameTemplate, vars, item.proxy, cleaners);
      if (name) intendedName = name;
    }
    plan.push({ item, tier, intendedName });
  }
  return plan;
}

/**
 * Resolve every intended name before committing any mutation. Within each tier,
 * exact intended names are claimed before duplicate names receive suffixes, so
 * generated names cannot steal another node's original target.
 */
function applyRenamePlan(items = [], renamePlan = []) {
  const plans = Array.isArray(renamePlan) ? renamePlan : [];
  const byTier = new Map([[1, []], [2, []], [3, []], [4, []]]);
  for (const entry of plans) {
    if (entry?.item && byTier.has(entry.tier)) byTier.get(entry.tier).push(entry);
  }

  const claimed = new Set();
  const finalNames = new Map();
  for (const tier of [1, 2, 3, 4]) {
    const conflicts = [];
    for (const entry of byTier.get(tier)) {
      const base = String(entry.intendedName || entry.item.proxy?.name || entry.item.rawName || '');
      if (!claimed.has(base)) {
        claimed.add(base);
        finalNames.set(entry.item, base);
      } else {
        conflicts.push({ entry, base });
      }
    }
    for (const { entry, base } of conflicts) {
      let index = 2;
      let candidate = `${base} #${index}`;
      while (claimed.has(candidate)) candidate = `${base} #${++index}`;
      claimed.add(candidate);
      finalNames.set(entry.item, candidate);
    }
  }

  const renameMap = new Map();
  for (const item of items) {
    const oldName = item?.proxy?.name;
    const name = finalNames.get(item);
    if (name !== undefined && item?.proxy) {
      if (oldName && oldName !== name) {
        renameMap.set(oldName, name);
      }
      item.proxy.name = name;
    }
  }

  // 联动更新 dialer-proxy (链式代理依赖追踪：当被引用的前置节点重命名后，自动同步引用名)
  if (renameMap.size > 0) {
    for (const item of items) {
      const dp = item?.proxy?.['dialer-proxy'];
      if (dp && renameMap.has(dp)) {
        item.proxy['dialer-proxy'] = renameMap.get(dp);
      }
    }
  }

  return finalNames;
}

module.exports = {
  createSeparatorCleaners,
  computeNodeIndices,
  renderTemplate,
  buildRenamePlan,
  applyRenamePlan
};
