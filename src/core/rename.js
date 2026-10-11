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
    const trackKey = prefix ? `${regionKey}__${prefix}` : regionKey;

    regionTotals[regionKey] = (regionTotals[regionKey] || 0) + 1;
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
    const trackKey = prefix ? `${regionKey}__${prefix}` : regionKey;

    groupTrack[trackKey] = (groupTrack[trackKey] || 0) + 1;
    const idx = groupTrack[trackKey];
    const regionTotal = regionTotals[regionKey] || 1;

    let numStr = '';
    // 当该大区节点数 > 1，或指定了前缀时，生成规范格式的序号 (如 01, L01)
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
    /{(airport|icon|region|index|features|protocol|city|line|in|multi|transport|ip_stack)}/g,
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
 * 末端名称碰撞守护 (Collision Guard)
 * 纯函数：检查节点列表并消除同名冲突，为同名节点安全追加序号 (#2, #3...)
 * 确保提交给 Mihomo/Clash 内核的节点名称 100% 互斥唯一
 * @param {Array<object>} proxies 节点对象数组
 * @returns {Array<object>} 原数组 (名称碰撞已就地修正)
 */
function resolveNameCollisions(proxies = []) {
  if (!Array.isArray(proxies) || proxies.length <= 1) return proxies;
  const seen = new Set();
  const taken = new Set();
  for (const p of proxies) {
    if (p?.name) taken.add(p.name);
  }

  for (const p of proxies) {
    if (!p) continue;
    const originalName = p.name || '';
    if (!seen.has(originalName)) {
      seen.add(originalName);
      continue;
    }

    let idx = 2;
    let candidate = `${originalName} #${idx}`;
    while (taken.has(candidate)) {
      idx++;
      candidate = `${originalName} #${idx}`;
    }
    p.name = candidate;
    taken.add(candidate);
    seen.add(candidate);
  }

  return proxies;
}

/**
 * 为已分类节点统一计算目标名称；保持计算阶段纯净，由调用方提交名称。
 */
function buildRenamePlan(items = [], config = {}) {
  const plan = new Map();
  if (!Array.isArray(items) || !config.renameTemplate || config.enableNodeRename === false) return plan;
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
    if (!item || item.skip || item.isSpecial || item.isInfo || item.keepName || !item.regionInfo) continue;
    let features = '';
    for (const tag of item.tags || []) {
      if (tag === 'ipv6' || tag === 'dualstack') continue;
      if (config.showFeatureIcon !== false) features += icons[tag] || '';
      else if (texts[tag]) features += (features ? '/' : '') + texts[tag];
    }
    const vars = {
      airport: item.airportTag || '',
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
    if (name) plan.set(item, name);
  }
  return plan;
}

module.exports = {
  createSeparatorCleaners,
  computeNodeIndices,
  renderTemplate,
  buildRenamePlan,
  resolveNameCollisions
};
