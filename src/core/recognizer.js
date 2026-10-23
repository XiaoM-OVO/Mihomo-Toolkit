/**
 * -----------------------------------------------------------------------------
 * Core Layer: 地区与出入口识别器 (Region Recognizer) —— 单一事实源
 * -----------------------------------------------------------------------------
 * 历史问题：`core/geo.matchNodeRegion` 与 `core/metadata.detectRegion` 各写一套
 * 地区判定，同一名字会给出不同结论（`香港 日本 专线` 在 geo 里是日本、在 metadata
 * 里是冲突；`🇯🇵 香港` 同理）。本模块把「怎么从一个名字里读出入口与落地」收敛成
 * 一份实现，两边都只是包装：
 *
 *   - `core/geo.matchNodeRegion`           → recognizeRegion().regionDef
 *   - `core/metadata.detectRegion`         → { regionDef, hasConflict }
 *
 * 判定规则（按顺序）：
 *   1. 词表匹配：地区字典的 matchReg / reg / codeReg 全部命中项；
 *   2. 入口剔除：命中位置落在「国内入口城市」且位于落地之前的，不算落地候选，
 *      也不计入冲突（`上海 入口 香港` 不算「上海 vs 香港」冲突）；
 *   3. 落地 = **最后出现**的地区（`深-港` 取港，`香港 转 日本` 取日本）；
 *   4. 国旗：单旗反查地区；文案与国旗不一致 → 冲突标记（但仍给出落地）；
 *   5. 动态建区：未知国旗 + 紧随文字，仅在 strictRegionMatch=false 时兜底。
 */

'use strict';

const { REGEX_FLAGS, REGEX_UNKNOWN_FLAG, REGEX_ENTRY_CITY } = require('../data/name-grammar');
const { escapeRegex: escapePattern, DOMESTIC_ENTRY_CITIES } = require('../data/cleaner-rules');
const { getEnhancedRegionDefs, getRegionFlagLookup } = require('./shared/regions');

/**
 * 收集名字里所有地区命中项（每个字典条目取其第一个命中）。
 * @param {string} name
 * @param {Array<object>} defs
 * @returns {Array<{def: object, text: string, index: number, len: number}>}
 */
function collectMatches(name, defs) {
  const matches = [];
  for (const def of defs) {
    const regs = [
      def.matchReg || (def.reg ? new RegExp(def.city ? `${def.reg.source}|${def.city}` : def.reg.source, 'i') : null),
      def.codeReg || null
    ].filter(Boolean);

    for (const reg of regs) {
      const m = name.match(reg);
      if (m) {
        matches.push({ def, text: m[0], index: m.index, len: m[0].length });
        break;
      }
    }
  }
  return matches;
}

/**
 * 命中的文本是否只是「国内入口城市」（`上海 入口 香港` 的上海、`深-港` 的深）。
 * @param {{text: string}} match
 * @returns {boolean}
 */
function isEntryMatch(match) {
  return DOMESTIC_ENTRY_CITIES.has(match.text);
}

/**
 * 从名字里识别落地地区与冲突信息。
 * @param {string} name
 * @param {Array<object>} [regionDefs]
 * @param {object} [options]
 * @param {boolean} [options.strictRegionMatch=false] 禁止未知国旗动态建区
 * @param {Map<string, object>} [options.flagLookup] 国旗 → 地区 反查表
 * @returns {{ regionDef: object|null, matches: Array<object>, hasConflict: boolean, conflictReason: string|null, flagRegion: object|null }}
 */
function recognizeRegion(name, regionDefs, options = {}) {
  const empty = { regionDef: null, matches: [], hasConflict: false, conflictReason: null, flagRegion: null };
  if (!name || typeof name !== 'string') return empty;

  const defs = regionDefs || getEnhancedRegionDefs();
  const { strictRegionMatch = false, flagLookup } = options;

  const flags = name.match(REGEX_FLAGS) || [];
  const distinctFlags = [...new Set(flags)];
  const lookup = flagLookup || getRegionFlagLookup(defs);
  const flagRegion = distinctFlags.length === 1 ? (lookup.get(distinctFlags[0]) || null) : null;

  const matches = collectMatches(name, defs);

  // 入口城市出现在落地之前时，只是中转标签，不参与「落地」竞争。
  const entryMatch = name.match(REGEX_ENTRY_CITY);
  const entryIndex = entryMatch ? entryMatch.index : -1;
  const exitCandidates = matches.filter(m => !(isEntryMatch(m) && entryIndex >= 0 && m.index >= entryIndex));

  const exit = exitCandidates.reduce((best, cur) => {
    if (!best) return cur;
    if (cur.index !== best.index) return cur.index > best.index ? cur : best;
    return cur.len > best.len ? cur : best;
  }, null);

  let conflictReason = null;
  if (distinctFlags.length > 1) conflictReason = 'multi-flag';

  const distinctDefs = [];
  const seen = new Set();
  for (const item of exitCandidates) {
    if (!seen.has(item.def.name)) {
      seen.add(item.def.name);
      distinctDefs.push(item.def);
    }
  }
  if (distinctDefs.length > 1 && !conflictReason) conflictReason = 'multi-region';

  let regionDef = exit ? exit.def : null;
  if (!regionDef && flagRegion) regionDef = flagRegion;
  if (flagRegion && exit && exit.def.name !== flagRegion.name && !conflictReason) {
    conflictReason = 'flag-text';
  }

  // 未知国旗 + 紧随文字：仅在完全没有命中时动态建区，不猜纯序号。
  if (!regionDef && !strictRegionMatch) {
    const flagMatch = name.match(REGEX_UNKNOWN_FLAG);
    if (flagMatch) {
      const flagIcon = flagMatch[1];
      if (lookup.has(flagIcon)) {
        regionDef = lookup.get(flagIcon);
      } else {
        const dynamicName = flagMatch[2].trim();
        regionDef = {
          id: dynamicName.toLowerCase(),
          code: null,
          icon: flagIcon,
          iconFile: 'Global.png',
          name: dynamicName,
          groupName: `${dynamicName}节点`,
          continent: 'other',
          subGroup: 'other',
          foldGroup: 'other',
          _isDynamic: true,
          matchReg: new RegExp(escapePattern(dynamicName), 'i'),
          cityReg: null
        };
      }
    }
  }

  return {
    regionDef,
    matches,
    hasConflict: Boolean(conflictReason),
    conflictReason,
    flagRegion
  };
}

module.exports = {
  recognizeRegion,
  collectMatches
};
