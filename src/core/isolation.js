/**
 * -----------------------------------------------------------------------------
 * Core Layer: 节点隔离分类策略 (Node Isolation Strategy)
 * -----------------------------------------------------------------------------
 * 职责：
 * 判定节点在指定配置下的隔离归属桶（家宽、高倍率、低倍率、实验性节点）。
 * 纯计算函数，零副作用。
 *
 * 口径（批次 4 节点池）：隔离由 `enableIsolation` 总开关打开，
 * 打开后三个内置隔离池（家宽 / 高倍率 / 实验）按 POOL_SORT_ORDER 的顺序判定；
 * 池本身的事实源在 `src/data/default-pools.js`，此处只做展示/排序用的归类提示。
 */

const { POOL_SORT_ORDER } = require('../data/default-pools');

/**
 * 判定节点在当前配置下归属的隔离分类（家宽、高倍率、实验）
 * 优先级顺序：家宽 (residential) > 高倍率 (highMulti) > 低倍率 (lowMulti) > 实验 (experimental)
 *
 * @param {object} item 包含 tags 与 attrs 的节点对象或分类结果
 * @param {object} [userConfig={}] 用户配置对象
 * @param {boolean} [userConfig.enableIsolation] 是否开启隔离机制
 * @param {number} [userConfig.highMultiThreshold=2.5] 高倍率阈值
 * @returns {string} 'residential' | 'highMulti' | 'lowMulti' | 'experimental' | ''
 */
function getIsolationBucket(item, userConfig = {}) {
  if (!item || typeof item !== 'object') return '';
  if (userConfig.enableIsolation !== true) return '';

  const tags = Array.isArray(item.tags) ? item.tags : [];
  const multi = item.attrs?.multiNum ?? 1;
  const highMultiThreshold = userConfig.highMultiThreshold ?? 2.5;

  for (const def of POOL_SORT_ORDER) {
    if (def.tag && tags.includes(def.tag)) return def.bucket;
    if (def.multi && multi > highMultiThreshold) return def.bucket;
  }

  return '';
}

module.exports = {
  getIsolationBucket
};
