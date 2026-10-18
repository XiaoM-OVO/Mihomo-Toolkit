/**
 * -----------------------------------------------------------------------------
 * Core Layer: 节点名称元数据只读旁路提取器 (Metadata Bypass Extractor)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 纯函数 extractMetadata(rawName)：不修改输入，不做链式 replace
 * 2. 复用项目现存的大区定义 (regions)、线路与运营商字典 (cleaner-rules)、
 *    倍率正则与业务特征词库 (cleaner-rules)
 * 3. 产出规范化的只读元数据契约（地区、线路、特征、倍率、完成度状态）
 * 4. 严格杜绝将 lineTier 写入元数据；线路质量权重属于后续策略层职责
 */

'use strict';

const {
  REGEX_TECH_LINE,
  LINE_MAP,
  CARRIER_SHORT_MAP,
  SORTED_CARRIER_COMBOS,
  ARCH_AVOID_SET,
  STATIC_FEATURE_RULES,
  STREAMING_FEATURE_REG,
  DOMESTIC_ENTRY_CITIES,
  REGEX_ENTRY_CITY
} = require('../data/cleaner-rules');

const { getEnhancedRegionDefs, getRegionFlagLookup, REGION_METADATA_MAP } = require('./shared/regions');
const { extractCity } = require('./geo');

// 模块级单例大区定义缓存，避免每次单节点提取产生高频克隆
const DEFAULT_ENHANCED_DEFS = getEnhancedRegionDefs();

/**
 * 运营商缩写合并 (纯函数)
 * @param {Array<string>} arr
 * @returns {Array<string>}
 */
function compressCarrierLines(arr) {
  const deduped = [...new Set(arr)];
  const carrierItems = [];
  const nonCarrierItems = [];
  const carrierAtoms = new Set(Object.values(CARRIER_SHORT_MAP));

  for (const item of deduped) {
    if (CARRIER_SHORT_MAP[item] || carrierAtoms.has(item)) {
      carrierItems.push(CARRIER_SHORT_MAP[item] || item);
    } else {
      nonCarrierItems.push(item);
    }
  }

  if (carrierItems.length === 0) return nonCarrierItems;

  const currentAtoms = new Set(carrierItems);
  for (const [comboName, atomGroup] of SORTED_CARRIER_COMBOS) {
    if (Array.from(atomGroup).every(atom => currentAtoms.has(atom))) {
      return [comboName, ...nonCarrierItems];
    }
  }
  return [...carrierItems, ...nonCarrierItems];
}

/**
 * 从名称中提取规范化线路与原始命中线路
 * @param {string} name
 * @returns {{ lines: string[], rawMatchedLines: string[], cleanLines: string|null }}
 */
function extractLines(name) {
  const rawMatchedLines = [];
  const normalizedLines = [];

  const matches = name.match(new RegExp(REGEX_TECH_LINE.source, 'gi'));
  if (matches) {
    for (const match of matches) {
      rawMatchedLines.push(match);
      let key = match.toUpperCase();
      if (key === 'AS9929') key = '9929';
      else if (key === 'AS4837') key = '4837';
      let short = LINE_MAP[key];
      if (!short) {
        const cnKey = Object.keys(CARRIER_SHORT_MAP).find(k => match.includes(k));
        if (cnKey) short = cnKey;
      }
      if (short) normalizedLines.push(short);
      else if (key.length >= 2) normalizedLines.push(key);
    }
  }

  const lines = compressCarrierLines(normalizedLines);
  const dedupedLines = [...new Set(lines)];
  const cleanLines = dedupedLines.length > 0 ? dedupedLines.join('/') : null;

  return {
    lines: dedupedLines,
    rawMatchedLines: [...new Set(rawMatchedLines)],
    cleanLines
  };
}

/**
 * 提取节点倍率信息 (纯函数，避让架构词与普通序号)
 * @param {string} name
 * @returns {{ value: number, hasExplicit: boolean }}
 */
function extractMultiplier(name) {
  // 1. 显式 "倍率: 2.5" 或 "倍率 2.5" 语法优先匹配，防被前面的序号串扰
  const prefixMatch = name.match(/倍率\s*[:：]?\s*(\d+(?:\.\d+)?)/i);
  if (prefixMatch) {
    const num = parseFloat(prefixMatch[1]);
    if (!isNaN(num) && num >= 0 && num <= 50) {
      return { value: num, hasExplicit: true };
    }
  }

  // 2. 显式前缀 "x0.5" / "X1.0" 匹配 (排除 x64 / x86 等架构词)
  const xPrefixMatch = name.match(/(?<![a-zA-Z0-9])[xX×]\s*(\d+(?:\.\d+)?)(?:\s*倍(?:率)?)?/i);
  if (xPrefixMatch) {
    const m = xPrefixMatch[1];
    if (!ARCH_AVOID_SET.has(m)) {
      const num = parseFloat(m);
      if (!isNaN(num) && num >= 0 && num <= 50) {
        return { value: num, hasExplicit: true };
      }
    }
  }

  // 3. 显式后缀 "1.5倍" / "2x" 匹配
  const suffixMatch = name.match(/(?<![a-zA-Z0-9])(\d+(?:\.\d+)?)\s*(?:[xX×]|倍(?:率)?)(?!\s*\d)/i);
  if (suffixMatch) {
    const m = suffixMatch[1];
    if (!ARCH_AVOID_SET.has(m)) {
      const num = parseFloat(m);
      if (!isNaN(num) && num >= 0 && num <= 50) {
        return { value: num, hasExplicit: true };
      }
    }
  }

  return {
    value: 1,
    hasExplicit: false
  };
}

/**
 * 提取业务特征列表 (纯函数，非互斥业务标签)
 * @param {string} name
 * @returns {Array<string>}
 */
function extractFeatures(name) {
  const features = new Set();

  for (const rule of STATIC_FEATURE_RULES) {
    if (rule.reg.test(name)) {
      features.add(rule.tag);
    }
  }

  if (STREAMING_FEATURE_REG.test(name)) {
    features.add('streaming');
  }

  return Array.from(features);
}

/**
 * 识别地区定义及是否存在未解决的冲突
 * @param {string} name
 * @param {Array<object>} [defs=DEFAULT_ENHANCED_DEFS]
 * @returns {{ regionDef: object|null, hasConflict: boolean }}
 */
function detectRegion(name, defs = DEFAULT_ENHANCED_DEFS) {
  if (!name || typeof name !== 'string') {
    return { regionDef: null, hasConflict: false };
  }

  // 1. Unicode 国旗图标与多国旗冲突检查
  const flags = name.match(/\p{Regional_Indicator}{2}/gu);
  if (flags && flags.length > 1) {
    const distinctFlags = [...new Set(flags)];
    if (distinctFlags.length > 1) {
      return { regionDef: null, hasConflict: true };
    }
  }

  const singleFlag = flags ? flags[0] : null;
  const flagLookup = getRegionFlagLookup(defs);
  const flagRegion = singleFlag ? flagLookup.get(singleFlag) : null;

  // 2. 识别中转入口城市（避免将国内入口城市误判为出口冲突地区）
  let entryCityMatch = null;
  const entryM = name.match(REGEX_ENTRY_CITY);
  if (entryM && DOMESTIC_ENTRY_CITIES.has(entryM[1])) {
    entryCityMatch = entryM[1];
  }

  // 3. 收集所有匹配的地区定义
  const matchedDefs = [];
  for (const r of defs) {
    const regs = [
      r.matchReg || (r.reg ? new RegExp(r.city ? r.reg.source + '|' + r.city : r.reg.source, 'i') : null),
      r.codeReg || null
    ].filter(Boolean);

    for (const reg of regs) {
      const m = name.match(reg);
      if (m) {
        // 若命中仅为国内中转入口城市部分，不作为落地目的地区
        if (entryCityMatch && m[0] === entryCityMatch && m.index === entryM.index) {
          continue;
        }
        matchedDefs.push({ def: r, match: m[0], index: m.index, len: m[0].length });
        break;
      }
    }
  }

  // 按地区标准化名称去重
  const uniqueDefs = [];
  const seenNames = new Set();
  for (const item of matchedDefs) {
    if (!seenNames.has(item.def.name)) {
      seenNames.add(item.def.name);
      uniqueDefs.push(item);
    }
  }

  // 国旗与文本冲突检查 (例如 🇯🇵 图标却出现 香港)
  if (flagRegion && uniqueDefs.length > 0) {
    const hasFlagConflict = uniqueDefs.some(u => u.def.name !== flagRegion.name);
    if (hasFlagConflict) {
      return { regionDef: null, hasConflict: true };
    }
  }

  // 多个不同落地地区直接冲突 (例如 香港 日本 专线)
  if (uniqueDefs.length > 1) {
    return { regionDef: null, hasConflict: true };
  }

  if (uniqueDefs.length === 1) {
    return { regionDef: uniqueDefs[0].def, hasConflict: false };
  }

  if (flagRegion) {
    return { regionDef: flagRegion, hasConflict: false };
  }

  return { regionDef: null, hasConflict: false };
}

/**
 * 纯函数：从原始名称中提取白名单元数据
 * @param {string} rawName 原始节点名称
 * @returns {object} 冻结的元数据对象
 */
function extractMetadata(rawName) {
  const safeName = typeof rawName === 'string' ? rawName : '';

  if (!safeName) {
    const emptyMeta = {
      groupKey: 'unknown',
      regionName: null,
      countryCode: null,
      city: null,
      lines: Object.freeze([]),
      rawMatchedLines: Object.freeze([]),
      cleanLines: null,
      features: Object.freeze([]),
      multiplier: Object.freeze({
        value: 1,
        hasExplicit: false
      }),
      status: 'unknown'
    };
    return Object.freeze(emptyMeta);
  }

  // 1. 线路提取
  const { lines, rawMatchedLines, cleanLines } = extractLines(safeName);

  // 2. 业务特征提取
  const features = extractFeatures(safeName);

  // 3. 倍率提取
  const multiplier = extractMultiplier(safeName);

  // 4. 地区与冲突识别
  const { regionDef, hasConflict } = detectRegion(safeName);

  let groupKey = 'unknown';
  let regionName = null;
  let countryCode = null;
  let city = null;
  let status = 'unknown';

  if (hasConflict) {
    status = 'partial';
  } else if (regionDef) {
    const metaMapping = REGION_METADATA_MAP[regionDef.name] || {
      groupKey: regionDef.id || 'unknown',
      countryCode: regionDef.code || (regionDef.id && regionDef.id.length === 2 ? regionDef.id.toUpperCase() : null),
      regionName: regionDef.name || null
    };
    groupKey = metaMapping.groupKey;
    regionName = metaMapping.regionName;
    countryCode = metaMapping.countryCode;

    const cityStr = extractCity(safeName, regionDef);
    city = cityStr || null;

    status = 'complete';
  } else if (lines.length > 0 || multiplier.hasExplicit || features.length > 0) {
    status = 'partial';
  } else {
    status = 'unknown';
  }

  const result = {
    groupKey,
    regionName,
    countryCode,
    city,
    lines: Object.freeze(lines),
    rawMatchedLines: Object.freeze(rawMatchedLines),
    cleanLines,
    features: Object.freeze(features),
    multiplier: Object.freeze(multiplier),
    status
  };

  return Object.freeze(result);
}

module.exports = {
  extractMetadata,
  REGION_METADATA_MAP,
  compressCarrierLines
};
