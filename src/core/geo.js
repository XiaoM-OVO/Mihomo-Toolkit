/**
 * 智能地区与落地城市识别
 *
 * 地区判定收敛在 `core/recognizer`（与 metadata 共用同一实现），本模块只提供
 * 面向调用方的薄包装与城市提取。
 */

const { recognizeRegion } = require('./recognizer');

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 智能匹配节点所属地区
 * @param {string} name 节点名称
 * @param {Array<object>} [regionDefs] 预增强的地区字典列表
 * @param {object} [options]
 * @param {boolean} [options.strictRegionMatch=false] 是否启用严格匹配（为 true 则不通过未知国旗动态建区）
 * @param {Map<string, object>} [options.flagLookup] 国旗图标到地区对象的反查字典
 * @returns {object|null} 匹配到的地区对象
 */
function matchNodeRegion(name, regionDefs, options = {}) {
  return recognizeRegion(name, regionDefs, options).regionDef;
}

/**
 * 从节点名称中提取落地城市
 * @param {string} name
 * @param {object} regionDef
 * @returns {string} 提取到的城市名称，未匹配返回空字符串
 */
function extractCity(name, regionDef) {
  if (!name || !regionDef) return '';
  const cityReg = regionDef.cityReg || (regionDef.city ? new RegExp(regionDef.city, 'i') : null);
  if (!cityReg) return '';
  const match = name.match(cityReg);
  return match ? match[0] : '';
}

module.exports = {
  escapeRegex,
  matchNodeRegion,
  extractCity
};
