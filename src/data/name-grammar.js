/**
 * -----------------------------------------------------------------------------
 * Data Layer: 节点名称语法正则库 (Name Grammar Patterns)
 * -----------------------------------------------------------------------------
 * 节点名是一段自由文本，识别它需要一套**同一份**的词表与正则：
 *   - 入口城市（只认国内中转城市，不含香港/日本这类落地地区）
 *   - 落地地区与单字缩写的避让规则（防「日」「新」「美」被普通词误吞）
 *   - 国旗图标、倍率的三类语法
 *
 * 本文件是这些正则的**唯一产地**：`core/cleaner`、`core/metadata`、`core/geo`
 * 都从这里取，不允许各自再写一份等价正则（历史上 geo 与 metadata 各有一套
 * 地区判定，命名冲突时结论不一致）。
 *
 * 分层契约：只读词表 + 纯正则构造，不得 require 任何 core / config / io 模块。
 */

'use strict';

const {
  EXIT_REGIONS,
  SINGLE_EXIT_LOOKAHEAD,
  DOMESTIC_ENTRY_CITIES,
  escapeRegex
} = require('./cleaner-rules');

// 入口与落地之间的连接符（`深-港`、`SZX->HKG`、`上海 至 日本`）
const ENTRY_CONNECTORS = Object.freeze(['->', '=>', '~>', '→', '⇒', '-', '—', '=', '>', '至']);

// 国旗图标：两个 Regional Indicator 组成一面旗
const REGEX_FLAG = /\p{Regional_Indicator}{2}/u;
const REGEX_FLAGS = /\p{Regional_Indicator}{2}/gu;

// 未知国旗 + 紧随其后的地区文字（用于动态建区，不猜纯序号）
const REGEX_UNKNOWN_FLAG = /(\p{Regional_Indicator}{2})\s*([A-Za-z\u4e00-\u9fa5]+(?:[\s-][A-Za-z\u4e00-\u9fa5]+)*)/u;

/**
 * 按长度降序拼接正则分支：让「深圳」优先于「深」、「SZX」优先于「S」，
 * 避免单字分支先命中再回溯。
 */
function toAlternation(words) {
  return [...words].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
}

const ENTRY_PATTERN = toAlternation(DOMESTIC_ENTRY_CITIES);
const EXIT_PATTERN = EXIT_REGIONS.map(r => {
  const esc = escapeRegex(r);
  return SINGLE_EXIT_LOOKAHEAD[r] ? `${esc}${SINGLE_EXIT_LOOKAHEAD[r]}` : esc;
}).join('|');
const CONNECTOR_PATTERN = toAlternation(ENTRY_CONNECTORS);

/**
 * 入口城市：**只**认国内中转城市（DOMESTIC_ENTRY_CITIES），且其后必须跟随
 * 连接符或空白，再跟一个落地地区。
 *
 * 旧实现用 ENTRY_CITIES（含香港/日本/美国/新加坡…），于是「香港 日本 专线」
 * 会把香港当成入口、`日本 香港` 会把日本当成入口——那不是入口，是落地地区。
 */
const REGEX_ENTRY_CITY = new RegExp(
  `(${ENTRY_PATTERN})(?:\\s*(?:${CONNECTOR_PATTERN})\\s*|\\s+)?(?=${EXIT_PATTERN})`,
  'i'
);

/**
 * 倍率语法：前缀「倍率: 2.5」/ x 前缀「x0.5」/ 后缀「1.5倍」。
 * `core/metadata` 按顺序尝试，命中即止；架构词（x64 等）由 ARCH_AVOID_SET 避让。
 */
const MULTIPLIER_PATTERNS = Object.freeze([
  { kind: 'prefix', reg: /倍率\s*[:：]?\s*(\d+(?:\.\d+)?)/i },
  { kind: 'x', reg: /(?<![a-zA-Z0-9])[xX×]\s*(\d+(?:\.\d+)?)(?:\s*倍(?:率)?)?/i },
  { kind: 'suffix', reg: /(?<![a-zA-Z0-9])(\d+(?:\.\d+)?)\s*(?:[xX×]|倍(?:率)?)(?!\s*[:：\d])/i }
]);

/**
 * 地区字典条目的匹配正则：`matchReg` 优先，否则由 `reg`（含城市扩展）构造。
 * @param {object} def
 * @returns {RegExp|null}
 */
function buildRegionRegex(def) {
  if (!def) return null;
  if (def.matchReg) return def.matchReg;
  if (!def.reg) return null;
  const source = def.city ? `${def.reg.source}|${def.city}` : def.reg.source;
  return new RegExp(source, 'i');
}

module.exports = {
  ENTRY_CONNECTORS,
  REGEX_ENTRY_CITY,
  REGEX_FLAG,
  REGEX_FLAGS,
  REGEX_UNKNOWN_FLAG,
  MULTIPLIER_PATTERNS,
  buildRegionRegex
};
