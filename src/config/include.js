/**
 * -----------------------------------------------------------------------------
 * Config Layer: 通用配置片段挂载 (Config Includes)
 * -----------------------------------------------------------------------------
 * 让 `config.yaml` 用 `include: ["./a.yaml", "./b.yaml"]` 拆成多个片段，
 * 片段与主文件**共用同一份 schema**（任何配置项都能放进片段），不额外发明「层」的概念。
 *
 * 已定稿的四条语义：
 *   1. **优先级**：合并顺序 = `include[0] ⊕ include[1] ⊕ … ⊕ 主文件自身`，
 *      越靠后优先级越高，主文件最高。
 *   2. **数组合并**：并集去重（保留先出现的顺序，后出现的重复项丢弃）。
 *   3. **对象合并**：深度递归合并。
 *   4. **递归 include**：片段内可再 include，相对路径以**该片段所在目录**为基准；
 *      必须做环路检测与深度上限，越界即显式抛错。
 *
 * 失败姿态：片段文件缺失 / 扩展名不支持 / 解析失败 → 复用 `readMountFile` 显式抛错（fail-closed）。
 */

'use strict';

const path = require('path');
const { resolveMountPath, absolutizeMountPaths, readMountFile } = require('./mounts');

/** 允许的最大 include 嵌套深度（主文件为第 0 层，片段内再 include 逐层递增） */
const MAX_INCLUDE_DEPTH = 10;

/** 判定是否为「可做深度合并的普通对象」（排除数组 / null / RegExp 等） */
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp);
}

/** 数组并集去重时用于判定「同一项」的稳定键 */
function itemToken(item) {
  if (item && typeof item === 'object') {
    try {
      return JSON.stringify(item);
    } catch (err) {
      return String(item);
    }
  }
  return `${typeof item}:${String(item)}`;
}

/**
 * 按「高优先级覆盖低优先级」合并两个值。
 * 数组 → 并集去重（低优先项在前）；对象 → 深度递归合并；标量 → 高优先级覆盖。
 * @param {*} low 低优先级值
 * @param {*} high 高优先级值
 * @returns {*}
 */
function mergeValues(low, high) {
  if (Array.isArray(low) && Array.isArray(high)) {
    const out = [];
    const seen = new Set();
    for (const item of [...low, ...high]) {
      const token = itemToken(item);
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(item);
    }
    return out;
  }
  if (isPlainObject(low) && isPlainObject(high)) {
    const out = { ...low };
    for (const [key, value] of Object.entries(high)) {
      out[key] = key in out ? mergeValues(out[key], value) : value;
    }
    return out;
  }
  return high;
}

/**
 * 合并两个配置对象（`high` 覆盖 `low`）。
 * @param {object} low
 * @param {object} high
 * @returns {object}
 */
function mergeConfig(low, high) {
  const out = { ...low };
  for (const [key, value] of Object.entries(high)) {
    out[key] = key in out ? mergeValues(out[key], value) : value;
  }
  return out;
}

/**
 * 展开配置中的 `include` 片段，返回合并后的新配置对象（不修改入参）。
 *
 * @param {object} userConfig 原始配置对象
 * @param {string} [baseDir] 基准目录（相对路径解析起点；应为该配置文件所在目录）
 * @param {string[]} [_stack] 内部：当前解析路径的文件栈（用于环路检测）
 * @param {number} [_depth] 内部：当前嵌套深度
 * @returns {object} 展开后的新配置对象
 * @throws {Error} 环路 / 深度超限 / 片段缺失 / 扩展名不支持 / 解析失败
 */
function expandIncludes(userConfig, baseDir, _stack, _depth) {
  const cfg = isPlainObject(userConfig) ? userConfig : {};
  const stack = _stack || [];
  const depth = _depth || 0;
  const list = Array.isArray(cfg.include) ? cfg.include : [];

  let merged = {};
  for (const entry of list) {
    const fullPath = resolveMountPath(entry, baseDir);
    if (!fullPath) continue; // 空串 / 非字符串项跳过

    if (depth >= MAX_INCLUDE_DEPTH) {
      throw new Error(
        `Config include depth limit (${MAX_INCLUDE_DEPTH}) exceeded: ${[...stack, fullPath].join(' -> ')}`
      );
    }
    if (stack.includes(fullPath)) {
      throw new Error(
        `Circular config include detected: ${[...stack, fullPath].join(' -> ')}`
      );
    }

    const fragment = readMountFile(fullPath);
    if (!isPlainObject(fragment)) {
      throw new Error(`Config include fragment must be a mapping: ${fullPath}`);
    }

    const dir = path.dirname(fullPath);
    // 片段内部路径型字段（含更深的 include）一律以该片段所在目录为基准
    const absolutized = absolutizeMountPaths(fragment, dir);
    const expanded = expandIncludes(absolutized, dir, [...stack, fullPath], depth + 1);
    delete expanded.include; // 片段的 include 已被消费，不进入合并结果

    merged = mergeConfig(merged, expanded);
  }

  // 主对象最后覆盖，且其 `include` 键保留到结果里（与 servicesConfigFile 保留行为一致）
  return mergeConfig(merged, cfg);
}

module.exports = {
  MAX_INCLUDE_DEPTH,
  mergeValues,
  mergeConfig,
  expandIncludes
};
