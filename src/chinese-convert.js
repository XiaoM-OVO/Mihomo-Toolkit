/**
 * 中文简繁转换模块
 * 依赖 opencc-js，未安装时降级为空函数
 */

let _t2s = null;
let _s2t = null;
let _loaded = false;

function ensureLoaded() {
  if (_loaded) return;
  _loaded = true;
  try {
    const OpenCC = require('opencc-js');
    _t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });
    _s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });
  } catch (e) {
    // opencc-js 未安装，保持 null
  }
}

function toSimplified(text) {
  if (!text) return text;
  ensureLoaded();
  return _t2s ? _t2s(text) : text;
}

function toTraditional(text) {
  if (!text) return text;
  ensureLoaded();
  return _s2t ? _s2t(text) : text;
}

/**
 * 递归转换对象中的所有字符串值（繁→简或简→繁）
 * 仅转换中文字符，URL、路径、正则等非中文内容不受影响
 */
function deepConvertStrings(obj, convertFn) {
  if (typeof obj === 'string') return convertFn(obj);
  if (Array.isArray(obj)) return obj.map(item => deepConvertStrings(item, convertFn));
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      // 键和值都转换（customNodeGroups 等配置的 key 是匹配关键词，也必须转）
      result[convertFn(key)] = deepConvertStrings(value, convertFn);
    }
    return result;
  }
  return obj;
}

function isAvailable() {
  ensureLoaded();
  return _t2s !== null && _s2t !== null;
}

module.exports = { toSimplified, toTraditional, deepConvertStrings, isAvailable };