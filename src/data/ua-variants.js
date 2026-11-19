/**
 * -----------------------------------------------------------------------------
 * Data Layer: 客户端 UA 变体基线 (Single Source of Truth)
 * -----------------------------------------------------------------------------
 * 服务器模式按请求 User-Agent 识别移动端客户端，命中即以 `osType: 'none'`
 * 下发「无进程规则」变体——PROCESS-NAME 在移动端不可用（iOS 内核不支持、
 * Android 普通权限拿不到其他 App 进程名），保留它们只会产出死规则。
 *
 * 设计边界：
 *   - 匹配是**启发式**：识别失败一律回落配置默认变体（fail-closed），
 *     最坏后果只是移动端拿到若干永不命中的进程规则，不炸不漏；
 *   - 本表只声明「哪些 UA 子串算哪个变体」，字符串善变（客户端改名 / 升级 /
 *   新 App），因此允许 `uaVariantPatterns` 按变体键覆写；变体语义
 *   （命中 → osType=none）固定在代码内，用户配置不出危险变体。
 */

'use strict';

/** 内置 UA 匹配表：小写子串匹配；用户可用 `uaVariantPatterns` 按键覆写 */
const UA_VARIANT_PATTERN_DEFAULTS = Object.freeze({
  ios: Object.freeze(['stash/', 'shadowrocket/', 'sfi/', 'loon/', 'surge ios/']),
  android: Object.freeze(['clashmetaforandroid', 'sfa/', 'nekobox'])
});

/** 变体合法键（同时是匹配优先级顺序） */
const UA_VARIANT_KEYS = Object.freeze(['ios', 'android']);

/** UA 变体 → osType 映射：移动端变体统一落到「无进程规则」 */
const UA_VARIANT_OS = Object.freeze({ ios: 'none', android: 'none' });

/** `?os=` 显式参数合法值（ios/android 是移动端变体别名，其余直接覆写 osType） */
const UA_OS_PARAM_VALUES = Object.freeze(['windows', 'mac', 'linux', 'all', 'ios', 'android']);

/** `?os=` 参数值 → osType 覆写值的映射（派生表，勿手写） */
const UA_OS_PARAM_TO_OSTYPE = Object.freeze(Object.fromEntries(
  UA_OS_PARAM_VALUES.map(v => [v, UA_VARIANT_OS[v] || v])
));

module.exports = {
  UA_VARIANT_PATTERN_DEFAULTS,
  UA_VARIANT_KEYS,
  UA_VARIANT_OS,
  UA_OS_PARAM_VALUES,
  UA_OS_PARAM_TO_OSTYPE
};
