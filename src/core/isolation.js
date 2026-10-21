/**
 * -----------------------------------------------------------------------------
 * Core Layer: 节点隔离分类策略 (Node Isolation Strategy)
 * -----------------------------------------------------------------------------
 * 职责：
 * 判定节点在指定配置下的隔离归属桶（家宽、高倍率、低倍率、实验性节点）。
 * 纯计算函数，零副作用。
 */

/**
 * 判定节点在当前配置下归属的隔离分类（家宽、高倍率、低倍率、实验）
 * 优先级顺序：家宽 (residential) > 高倍率 (highMulti) > 低倍率 (lowMulti) > 实验 (experimental)
 *
 * @param {object} item 包含 tags 与 attrs 的节点对象或分类结果
 * @param {object} [userConfig={}] 用户配置对象
 * @param {boolean} [userConfig.enableResidential] 是否开启家宽隔离
 * @param {boolean} [userConfig.isolateHighMulti] 是否开启高倍率隔离
 * @param {number} [userConfig.highMultiThreshold=2.5] 高倍率阈值
 * @param {boolean} [userConfig.isolateDownload] 是否开启低倍率节点隔离
 * @param {boolean} [userConfig.isolateExperimental] 是否开启实验性节点隔离
 * @returns {string} 'residential' | 'highMulti' | 'lowMulti' | 'experimental' | ''
 */
function getIsolationBucket(item, userConfig = {}) {
  if (!item || typeof item !== 'object') return '';
  const tags = item.tags || [];
  const multi = item.attrs?.multiNum ?? 1;
  const highMultiThreshold = userConfig.highMultiThreshold ?? 2.5;

  if (userConfig.enableResidential && tags.includes('residential')) {
    return 'residential';
  }
  if (userConfig.isolateHighMulti && multi > highMultiThreshold) {
    return 'highMulti';
  }
  if (userConfig.isolateDownload && tags.includes('lowMulti')) {
    return 'lowMulti';
  }
  if (userConfig.isolateExperimental && tags.includes('experimental')) {
    return 'experimental';
  }
  return '';
}

module.exports = {
  getIsolationBucket
};
