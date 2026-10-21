/**
 * -----------------------------------------------------------------------------
 * Core Layer: 节点名称元数据与语义提取器 (Node Semantic Metadata Extractor)
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 纯函数单点真实源 (SSOT)：统一节点倍率、线路、入口、落地、业务特征提取；
 * 2. 复用项目现存的大区定义 (regions)、线路与运营商字典 (cleaner-rules)、
 *    倍率正则与业务特征词库 (cleaner-rules)；
 * 3. 产出规范化只读语义契约，同时向 Envelope 提供只读旁路快照 (extractMetadata)，
 *    向 Cleaner / Nodes 流水线提供结构化属性契约 (extractNodeAttributes / extractSemanticMetadata)；
 * 4. 彻底消除 cleaner 与 metadata 之间的重复提取逻辑。
 */

'use strict';

const {
  REGEX_TECH_LINE,
  REGEX_FLUFF_LINE,
  LINE_MAP,
  CARRIER_SHORT_MAP,
  SORTED_CARRIER_COMBOS,
  ARCH_AVOID_SET,
  STATIC_FEATURE_RULES,
  STREAMING_FEATURE_REG,
  DOMESTIC_ENTRY_CITIES,
  REGEX_ENTRY_CITY,
  TAG_MAP,
  getLineQualityWeight
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
 * 提取入口城市
 * @param {string} name
 * @returns {{ entryStr: string, rawMatch: string|null }}
 */
function extractEntry(name) {
  if (!name || typeof name !== 'string') {
    return { entryStr: '', rawMatch: null };
  }
  const match = name.match(REGEX_ENTRY_CITY);
  if (match) {
    const rawMatch = match[0];
    const m = match[1].replace(/[-|>至=\s]/g, '');
    const entryStr = TAG_MAP[m.toUpperCase()] || TAG_MAP[m] || m;
    return { entryStr, rawMatch };
  }
  return { entryStr: '', rawMatch: null };
}

/**
 * 提取节点倍率信息 (纯函数，避让架构词与普通序号)
 * @param {string} name
 * @param {object} [options={}]
 * @param {number} [options.lowMultiThreshold]
 * @returns {{ value: number, hasExplicit: boolean, str: string, isLowMulti: boolean, rawMatch: string|null }}
 */
function extractMultiplier(name, options = {}) {
  if (!name || typeof name !== 'string') {
    return { value: 1, hasExplicit: false, str: '', isLowMulti: false, rawMatch: null };
  }

  // 1. 显式 "倍率: 2.5" 或 "倍率 2.5" 语法优先匹配，防被前面的序号串扰
  const prefixMatch = name.match(/倍率\s*[:：]?\s*(\d+(?:\.\d+)?)/i);
  if (prefixMatch) {
    const num = parseFloat(prefixMatch[1]);
    if (!isNaN(num) && num >= 0 && num <= 50) {
      const isLowMulti = Boolean(options.lowMultiThreshold > 0 && num <= options.lowMultiThreshold);
      const str = num !== 1 ? `x${num}` : '';
      return { value: num, hasExplicit: true, str, isLowMulti, rawMatch: prefixMatch[0] };
    }
  }

  // 2. 显式前缀 "x0.5" / "X1.0" 匹配 (排除 x64 / x86 等架构词)
  const xMatch = name.match(/(?<![a-zA-Z0-9])[xX×]\s*(\d+(?:\.\d+)?)(?:\s*倍(?:率)?)?/i);
  if (xMatch) {
    const m = xMatch[1];
    if (!ARCH_AVOID_SET.has(m)) {
      const num = parseFloat(m);
      if (!isNaN(num) && num >= 0 && num <= 50) {
        const isLowMulti = Boolean(options.lowMultiThreshold > 0 && num <= options.lowMultiThreshold);
        const str = num !== 1 ? `x${num}` : '';
        return { value: num, hasExplicit: true, str, isLowMulti, rawMatch: xMatch[0] };
      }
    }
  }

  // 3. 显式后缀 "1.5倍" / "0倍率" / "2x" 匹配
  const suffixMatch = name.match(/(?<![a-zA-Z0-9])(\d+(?:\.\d+)?)\s*(?:[xX×]|倍(?:率)?)(?!\s*[:：\d])/i);
  if (suffixMatch) {
    const m = suffixMatch[1];
    if (!ARCH_AVOID_SET.has(m)) {
      const num = parseFloat(m);
      if (!isNaN(num) && num >= 0 && num <= 50) {
        const isLowMulti = Boolean(options.lowMultiThreshold > 0 && num <= options.lowMultiThreshold);
        const str = num !== 1 ? `x${num}` : '';
        return { value: num, hasExplicit: true, str, isLowMulti, rawMatch: suffixMatch[0] };
      }
    }
  }

  return { value: 1, hasExplicit: false, str: '', isLowMulti: false, rawMatch: null };
}

/**
 * 从名称中提取规范化线路与原始命中线路，并计算质量权重
 * @param {string} name
 * @returns {{ lines: string[], rawMatchedLines: string[], cleanLines: string|null, bestLineWeight: number }}
 */
function extractLines(name) {
  if (!name || typeof name !== 'string') {
    return { lines: [], rawMatchedLines: [], cleanLines: null, bestLineWeight: 6 };
  }

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

  let fluffStr = '';
  const fluffMatches = name.match(new RegExp(REGEX_FLUFF_LINE.source, 'gi'));
  if (fluffMatches) {
    fluffStr = fluffMatches.map(m => m.toUpperCase()).join('');
  }
  const bestLineWeight = getLineQualityWeight((cleanLines || '') + fluffStr);

  return {
    lines: dedupedLines,
    rawMatchedLines: [...new Set(rawMatchedLines)],
    cleanLines,
    bestLineWeight
  };
}

/**
 * 提取业务特征列表 (纯函数，非互斥业务标签)
 * @param {string} name
 * @param {object} [options={}]
 * @param {Array<object>} [options.featureRules] 可选动态特征规则列表
 * @returns {Array<string>}
 */
function extractFeatures(name, options = {}) {
  if (!name || typeof name !== 'string') return [];
  const features = new Set();
  const rules = options.featureRules || STATIC_FEATURE_RULES;

  for (const rule of rules) {
    if (rule.reg && rule.reg.test(name)) {
      features.add(rule.tag);
    }
  }

  if (!options.featureRules && STREAMING_FEATURE_REG.test(name)) {
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
 * 剥离入口、倍率、线路等特征词生成干净名称 (供兜底地区匹配与重命名计划使用)
 * @param {string} name
 * @param {object} [matches={}]
 * @returns {string}
 */
function computeCleanName(name, { entryMatch, multiMatch } = {}) {
  let clean = name;
  if (entryMatch) clean = clean.replace(entryMatch, '');
  if (multiMatch) clean = clean.replace(multiMatch, '');
  clean = clean.replace(new RegExp(REGEX_TECH_LINE.source, 'gi'), '');
  clean = clean.replace(new RegExp(REGEX_FLUFF_LINE.source, 'gi'), '');
  return clean.trim();
}

/**
 * 提取全量语义元数据契约 (内部核心计算)
 * @param {string} rawName
 * @param {object} [options={}]
 * @returns {object}
 */
function extractSemanticMetadata(rawName, options = {}) {
  const safeName = typeof rawName === 'string' ? rawName : '';
  const multi = extractMultiplier(safeName, options);
  const linesInfo = extractLines(safeName);
  const entry = extractEntry(safeName);
  const features = extractFeatures(safeName, options);
  const { regionDef, hasConflict } = detectRegion(safeName, options.regionDefs);

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
  } else if (linesInfo.lines.length > 0 || multi.hasExplicit || features.length > 0) {
    status = 'partial';
  } else {
    status = 'unknown';
  }

  const cleanName = computeCleanName(safeName, {
    entryMatch: entry.rawMatch,
    multiMatch: multi.rawMatch
  });

  return {
    groupKey,
    regionName,
    countryCode,
    city,
    regionDef,
    hasRegionConflict: hasConflict,
    entryStr: entry.entryStr,
    entryMatch: entry.rawMatch,
    lines: linesInfo.lines,
    rawMatchedLines: linesInfo.rawMatchedLines,
    cleanLines: linesInfo.cleanLines || '',
    bestLineWeight: linesInfo.bestLineWeight,
    multiNum: multi.value,
    multiStr: multi.str,
    hasExplicitMulti: multi.hasExplicit,
    isLowMulti: multi.isLowMulti,
    features,
    status,
    cleanName
  };
}

/**
 * 提取节点属性 (给 Cleaner 模块和测试用例交付的契约)
 * @param {string} name
 * @param {object} [userConfig={}]
 * @returns {{ attrs: object, cleanName: string }}
 */
function extractNodeAttributes(name, userConfig = {}) {
  const meta = extractSemanticMetadata(name, {
    lowMultiThreshold: userConfig.lowMultiThreshold
  });

  const attrs = {
    multiNum: meta.multiNum,
    multiStr: meta.multiStr,
    entryStr: meta.entryStr,
    lineArr: meta.lines,
    cleanLines: meta.cleanLines,
    bestLineWeight: meta.bestLineWeight,
    isLowMulti: meta.isLowMulti
  };

  return { attrs, cleanName: meta.cleanName };
}

/**
 * 纯函数：从原始名称中提取只读旁路元数据 (供 Envelope 与报告消费)
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

  const meta = extractSemanticMetadata(safeName);

  const result = {
    groupKey: meta.groupKey,
    regionName: meta.regionName,
    countryCode: meta.countryCode,
    city: meta.city,
    lines: Object.freeze(meta.lines),
    rawMatchedLines: Object.freeze(meta.rawMatchedLines),
    cleanLines: meta.cleanLines ? meta.cleanLines : null,
    features: Object.freeze(meta.features),
    multiplier: Object.freeze({
      value: meta.multiNum,
      hasExplicit: meta.hasExplicitMulti
    }),
    status: meta.status
  };

  return Object.freeze(result);
}

module.exports = {
  compressCarrierLines,
  extractEntry,
  extractMultiplier,
  extractLines,
  extractFeatures,
  detectRegion,
  computeCleanName,
  extractSemanticMetadata,
  extractNodeAttributes,
  extractMetadata,
  REGION_METADATA_MAP
};
