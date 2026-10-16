/**
 * -----------------------------------------------------------------------------
 * Core Layer: 节点多维排序算法 (Multi-Dimensional Node Sorting)
 * -----------------------------------------------------------------------------
 * 严格遵循洋葱模型 Core 层规范：
 * 1. 纯计算函数：输入已打标节点数组与配置选项，输出按多维规则排序后的新数组
 * 2. 零副作用：不修改原始入参数组
 * 3. 排序维度：
 *    - 看板/说明节点置顶 (Dashboard / Synthetic info)
 *    - 地理大区优先级 (基于 REGION_DEFS_RAW 自然地理顺序)
 *    - 订阅源归并 (同一大区内，同一机场/前缀聚拢)
 *    - 高倍率下沉 (multiNum > highMultiThreshold 自动沉底)
 *    - 线路质量梯队 (T1 IEPL/IPLC ➔ T2 CN2/GIA/9929 ➔ T3 专线/优化 ➔ T4 BGP/CMI ➔ T5 中转 ➔ T6 兜底)
 *    - 入口城市 (按拼音/自然字符归类，如 深、沪、京)
 *    - 线路名称 (按 cleanLines 归类)
 *    - 落地城市 (按 destCity 归类)
 *    - 倍率升序 (低倍率优先)
 *    - 节点名称/原名 (确定性终极兜底)
 */

const { getEnhancedRegionDefs } = require('./shared/regions');
const { getIsolationBucket } = require('./isolation');
const { ISOLATION_SORT_ORDER } = require('../data/cleaner-rules');
const { isTrustedSynthetic } = require('./node-trust');

let cachedRegionOrder = null;

/**
 * 获取或构建地区优先级索引映射表
 * @returns {Map<string, number>}
 */
function getRegionOrderMap() {
  if (!cachedRegionOrder) {
    cachedRegionOrder = new Map();
    const defs = getEnhancedRegionDefs();
    defs.forEach((r, idx) => {
      if (r.id) cachedRegionOrder.set(r.id.toLowerCase(), idx);
      if (r.name) cachedRegionOrder.set(r.name, idx);
    });
  }
  return cachedRegionOrder;
}

/**
 * 比较两个已打标节点项的排序先后 (纯比较函数)
 * @param {object} a
 * @param {object} b
 * @param {object} [options={}]
 * @returns {number}
 */
function compareNodes(a, b, options = {}) {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  // 1. 状态看板 / 虚拟说明节点置顶 (只有受信 synthetic 或已校验 info 才能置顶，外部伪造不可信)
  const isSynth = (item) => {
    if (!item) return false;
    if (isTrustedSynthetic(item) || isTrustedSynthetic(item.proxy)) return true;
    if (item.isInfo) return true;
    return false;
  };
  const isSynthA = isSynth(a);
  const isSynthB = isSynth(b);
  if (isSynthA !== isSynthB) {
    return isSynthA ? -1 : 1;
  }
  if (isSynthA && isSynthB) {
    return (a.rawName || a.proxy?.name || '').localeCompare(b.rawName || b.proxy?.name || '', 'zh-CN');
  }

  // 2. 地理大区优先级
  const regionOrder = getRegionOrderMap();
  const keyA = a.regionInfo ? (a.regionInfo.id || a.regionInfo.name) : null;
  const keyB = b.regionInfo ? (b.regionInfo.id || b.regionInfo.name) : null;
  const orderA = keyA ? (regionOrder.get(keyA.toLowerCase()) ?? regionOrder.get(keyA) ?? 9000) : 9999;
  const orderB = keyB ? (regionOrder.get(keyB.toLowerCase()) ?? regionOrder.get(keyB) ?? 9000) : 9999;
  if (orderA !== orderB) return orderA - orderB;

  // 2.5 隔离分类优先级 (同一大区内，标准节点在最前，隔离节点按业务类别整齐归拢)
  const isoA = a.isolateBucket !== undefined ? a.isolateBucket : getIsolationBucket(a, options);
  const isoB = b.isolateBucket !== undefined ? b.isolateBucket : getIsolationBucket(b, options);
  const isoWeightA = ISOLATION_SORT_ORDER[isoA] ?? 99;
  const isoWeightB = ISOLATION_SORT_ORDER[isoB] ?? 99;
  if (isoWeightA !== isoWeightB) {
    return isoWeightA - isoWeightB;
  }

  // 3. 同大区同隔离类别内：订阅源/机场与序号前缀聚拢 (airportTag / subTag / indexPrefix)
  const tagA = a.airportTag || a.proxy?._subTag || '';
  const tagB = b.airportTag || b.proxy?._subTag || '';
  if (tagA !== tagB) {
    const cmp = tagA.localeCompare(tagB, 'zh-CN');
    if (cmp !== 0) return cmp;
  }

  const prefixA = a.proxy?._indexPrefix || (options.indexPrefixMap && options.indexPrefixMap[tagA]) || '';
  const prefixB = b.proxy?._indexPrefix || (options.indexPrefixMap && options.indexPrefixMap[tagB]) || '';
  if (prefixA !== prefixB) {
    const cmp = prefixA.localeCompare(prefixB, 'zh-CN');
    if (cmp !== 0) return cmp;
  }

  // 4. 高倍率下沉 (超过 highMultiThreshold 阈值的节点下沉)
  const highMultiThreshold = options.highMultiThreshold ?? 2.5;
  const multiA = a.attrs?.multiNum ?? 1;
  const multiB = b.attrs?.multiNum ?? 1;
  const isHighA = multiA > highMultiThreshold;
  const isHighB = multiB > highMultiThreshold;
  if (isHighA !== isHighB) {
    return isHighA ? 1 : -1;
  }

  // 5. 线路质量梯队 (1: IEPL/IPLC -> 2: CN2/GIA/9929/CMIN2 -> 3: 优化/专线 -> 4: BGP/CMI -> 5: 中转 -> 6: 兜底)
  const weightA = a.attrs?.bestLineWeight ?? 6;
  const weightB = b.attrs?.bestLineWeight ?? 6;
  if (weightA !== weightB) {
    return weightA - weightB;
  }

  // 6. 入口城市归类 (深、沪、京等)
  const entryA = a.attrs?.entryStr || '';
  const entryB = b.attrs?.entryStr || '';
  if (entryA !== entryB) {
    const cmp = entryA.localeCompare(entryB, 'zh-CN');
    if (cmp !== 0) return cmp;
  }

  // 7. 线路名称自动归类 (cleanLines)
  const lineA = a.attrs?.cleanLines || '';
  const lineB = b.attrs?.cleanLines || '';
  if (lineA !== lineB) {
    const cmp = lineA.localeCompare(lineB, 'zh-CN');
    if (cmp !== 0) return cmp;
  }

  // 8. 落地城市归类 (destCity)
  const cityA = a.destCity || '';
  const cityB = b.destCity || '';
  if (cityA !== cityB) {
    const cmp = cityA.localeCompare(cityB, 'zh-CN');
    if (cmp !== 0) return cmp;
  }

  // 9. 倍率升序 (低倍率优先)
  if (multiA !== multiB) {
    return multiA - multiB;
  }

  // 10. 终极确定性兜底 (原始名称 / 代理名)
  const rawA = a.rawName || a.proxy?.name || '';
  const rawB = b.rawName || b.proxy?.name || '';
  return rawA.localeCompare(rawB, 'zh-CN');
}

/**
 * 纯函数：对已分类节点列表执行多维智能排序
 * @param {Array<object>} items 已通过 classifyNode 打标的节点对象数组
 * @param {object} [options={}] 配置项 (highMultiThreshold, enableNodeSort 等)
 * @returns {Array<object>} 排序后的新节点项数组
 */
function sortNodes(items = [], options = {}) {
  if (!Array.isArray(items) || items.length <= 1) {
    return Array.isArray(items) ? [...items] : [];
  }
  if (options.enableNodeSort === false) {
    return [...items];
  }

  return [...items].sort((a, b) => compareNodes(a, b, options));
}

module.exports = {
  sortNodes
};
