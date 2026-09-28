/**
 * 智能地区与落地城市识别
 *
 * 基于地区字典与 Unicode 国旗正则，识别节点落地国家、地区与城市（支持最长优先与落地优先）。
 */

const { getEnhancedRegionDefs } = require('./shared/regions');

// 匹配 Unicode 国旗 + 紧随其后的地区名称
const REGEX_UNKNOWN_FLAG = /(\p{Regional_Indicator}{2})\s*([A-Za-z\u4e00-\u9fa5]+(?:[\s-][A-Za-z\u4e00-\u9fa5]+)*)/u;

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
  if (!name || typeof name !== 'string') return null;
  const defs = regionDefs || getEnhancedRegionDefs();
  const { strictRegionMatch = false, flagLookup } = options;

  const matchedRegions = defs
    .map(r => {
      const reg = r._matchReg || (r.reg ? new RegExp(r.city ? `${r.reg.source}|${r.city}` : r.reg.source, 'i') : null);
      if (!reg) return null;
      const m = name.match(reg);
      return m ? { def: r, len: m[0].length, index: m.index } : null;
    })
    .filter(Boolean);

  if (matchedRegions.length > 0) {
    // 优先匹配长度最长的，长度相同匹配最靠后的 (比如 "深港"，以落地 "港" 为准)
    const bestMatch = matchedRegions.reduce((prev, curr) => {
      if (curr.len !== prev.len) return curr.len > prev.len ? curr : prev;
      return curr.index > prev.index ? curr : prev;
    }, matchedRegions[0]);
    return bestMatch?.def || null;
  }

  // 宽松模式：通过 Unicode 国旗尝试反查或动态识别
  if (!strictRegionMatch) {
    const flagMatch = name.match(REGEX_UNKNOWN_FLAG);
    if (flagMatch) {
      const flagIcon = flagMatch[1];
      if (flagLookup && flagLookup.has(flagIcon)) {
        return flagLookup.get(flagIcon);
      }
      const dynamicName = flagMatch[2].trim();
      return {
        id: dynamicName,
        icon: flagIcon,
        name: dynamicName,
        _isDynamic: true,
        _cleanReg: new RegExp(escapeRegex(dynamicName), 'ig'),
        _matchReg: new RegExp(escapeRegex(dynamicName), 'i'),
        _cityReg: null
      };
    }
  }

  return null;
}

/**
 * 从节点名称中提取落地城市
 * @param {string} name
 * @param {object} regionDef
 * @returns {string} 提取到的城市名称，未匹配返回空字符串
 */
function extractCity(name, regionDef) {
  if (!name || !regionDef) return '';
  const cityReg = regionDef._cityReg || (regionDef.city ? new RegExp(regionDef.city, 'i') : null);
  if (!cityReg) return '';
  const match = name.match(cityReg);
  return match ? match[0] : '';
}

module.exports = {
  REGEX_UNKNOWN_FLAG,
  escapeRegex,
  matchNodeRegion,
  extractCity
};
