/**
 * -----------------------------------------------------------------------------
 * Config: 客户端 UA 变体解析（纯函数，无 I/O）
 * -----------------------------------------------------------------------------
 * 回答两个问题：
 *   1. `resolveUaVariantPatterns` —— 用户 `uaVariantPatterns` 如何与内置默认表合并，
 *      非法条目如何处置（丢弃 + 回传告警，不静默吞掉用户意图）；
 *   2. `matchUaVariant` —— 一个 User-Agent 命中哪个移动端变体。
 *
 * 匹配语义固定：大小写不敏感的子串匹配，`UA_VARIANT_KEYS` 顺序裁决（一个 UA
 * 理论上只会命中一个变体，实际同时命中时取靠前的键，结果仍是有界枚举）。
 */

'use strict';

const { UA_VARIANT_PATTERN_DEFAULTS, UA_VARIANT_KEYS } = require('../data/ua-variants');

/**
 * 归一化 UA 匹配表：内置默认 ∪ 用户覆写（键级替换，deepMerge 同语义）
 *
 * 用户条目非法时不静默：逐条丢弃并回传告警文案，由调用方决定日志出口。
 * 最坏情形是某变体退回内置默认表——回落方向本身就是安全方向。
 *
 * @param {unknown} raw 用户配置里的 uaVariantPatterns 原始值
 * @returns {{ patterns: Record<string, string[]>, warnings: string[] }}
 */
function resolveUaVariantPatterns(raw) {
  const patterns = {};
  const warnings = [];
  for (const key of UA_VARIANT_KEYS) {
    patterns[key] = [...UA_VARIANT_PATTERN_DEFAULTS[key]];
  }
  if (raw == null) return { patterns, warnings };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`uaVariantPatterns 必须是对象（键: ${UA_VARIANT_KEYS.join(' / ')}），已忽略整段配置并沿用内置默认表`);
    return { patterns, warnings };
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!UA_VARIANT_KEYS.includes(key)) {
      warnings.push(`uaVariantPatterns 含未知变体键 "${key}"（合法键: ${UA_VARIANT_KEYS.join(' / ')}），已忽略`);
      continue;
    }
    if (!Array.isArray(value)) {
      warnings.push(`uaVariantPatterns.${key} 必须是字符串数组，已忽略并沿用内置默认表`);
      continue;
    }
    const valid = [];
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        valid.push(item.trim());
      } else {
        warnings.push(`uaVariantPatterns.${key} 含非字符串或空白条目，已忽略：${String(item)}`);
      }
    }
    patterns[key] = [...new Set(valid)];
  }
  return { patterns, warnings };
}

/**
 * UA → 移动端变体匹配
 * @param {unknown} userAgent 请求 User-Agent
 * @param {Record<string, string[]>} patterns 已归一化的匹配表（小写子串）
 * @returns {string|null} 'ios' | 'android' | null（未命中＝桌面/未知，落默认变体）
 */
function matchUaVariant(userAgent, patterns) {
  const ua = String(userAgent || '').toLowerCase();
  if (!ua || ua === 'unknown') return null;
  for (const key of UA_VARIANT_KEYS) {
    for (const needle of patterns[key] || []) {
      if (ua.includes(needle.toLowerCase())) return key;
    }
  }
  return null;
}

module.exports = { resolveUaVariantPatterns, matchUaVariant };
