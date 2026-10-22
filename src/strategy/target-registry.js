/**
 * -----------------------------------------------------------------------------
 * 目标注册表 (TargetRegistry)
 * -----------------------------------------------------------------------------
 * `routing` 的 `to` 有四类写法（内核内置目标 / `@pool:<池名>` / 目录 `ref` 键 / 组名），
 * 合法目标又来自十余个来源（骨架组、池、派生哈希组、地区、大洲、用户组、组目录、服务键）。
 * 本模块把这些来源**收敛成一张表**，让解析（`resolve`）、合法性判定（`isValid`）
 * 与剪枝（`prune.js` 的存活 / 池依赖判定）消费同一份事实，新增一类目标只需在此登记。
 *
 * 登记顺序 = 判定优先级：先登记者先命中（与历史实现逐源判定的顺序一致）。
 * 条目字段：
 *   - `name`           规范目标名
 *   - `aliases`        可命中的写法（原始名 + 去装饰名，ref 键单独登记）
 *   - `refKey`         来自 `registries.groups` 的目录键（用于 `disabled` 结算），否则为 null
 *   - `source`         来源类别：builtin / skeleton / pool / hashLb / region / continent / user / directory / service
 *   - `materializable` 是否会被物化成真实策略组（内核内置目标为 false）
 *   - `skeleton`       是否骨架常驻组
 *   - `poolDependent`  池为空 / 未激活时不建组，指向它的规则按设计跳过
 */

'use strict';

const {
  getEnhancedRegionDefs,
  getHashLbGroupNames,
  CONTINENT_DEFS
} = require('../core/shared/regions');
const { POOL_NAMES } = require('../data/default-pools');
const {
  skeletonGroupNames,
  poolDependentGroupNames
} = require('../data/catalog/identity');
const { ADS_GROUPS } = require('../config/catalog');
const { filterGroupsByDirection } = require('../config/groups');
const { resolvePoolDefinitions } = require('./pools');
const { stripGroupDecoration } = require('./presentation');

/** 内核保留目标：`to` 可直接使用，不参与策略组物化与改名 */
const BUILTIN_TARGETS = Object.freeze([
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'COMPATIBLE',
  'MUTE',
  'GLOBAL'
]);

const POOL_PREFIX = '@pool:';

/**
 * 骨架常驻组：由拓扑按开关产出，`routing` 可直接引用（未产出时由剪枝层按设计跳过）。
 * 名单与顺序来自 `data/catalog/identity.js` 的单一身份表；`广告拦截` 不在此列——
 * 它由 ads 预设派生，存在性取决于分组声明。
 */
const SKELETON_GROUP_NAMES = Object.freeze(skeletonGroupNames());

/** 池依赖的骨架组：成员来自节点池，池为空 / 未激活时不建组 */
const POOL_DEPENDENT_GROUP_NAMES = Object.freeze(poolDependentGroupNames());

/** 服务注册表分类（与 `findService` 的查找范围同源） */
const SERVICE_CATEGORIES = Object.freeze(['ai', 'streaming', 'social', 'game', 'dev', 'system']);

function uniqueAliases(name) {
  return [...new Set([name, stripGroupDecoration(name)].filter(Boolean))];
}

/**
 * 构建目标注册表
 *
 * @param {object} [params]
 * @param {object} [params.config={}] 用户配置（池定义 / 用户组 / 方向）
 * @param {object} [params.registries={}] `ServiceCatalog#toRegistries()` 的投影
 * @param {string} [params.direction] split / return（缺省按 config.trafficDirection）
 * @param {Set<string>|string[]} [params.disabledRefs] 已关闭的目录 ref 键
 * @param {boolean} [params.strictPools=true] 池定义非法时是否抛错（剪枝层不重复报错）
 * @returns {object} 注册表查询接口
 */
function createTargetRegistry({
  config = {},
  registries = {},
  direction,
  disabledRefs,
  strictPools = true
} = {}) {
  const dir = direction === 'return' ? 'return' : 'split';
  const disabled = disabledRefs instanceof Set
    ? disabledRefs
    : new Set(Array.isArray(disabledRefs) ? disabledRefs : []);

  const entries = [];
  const refIndex = new Map();
  const seen = new Set();

  function register(name, source, flags = {}) {
    if (!name || typeof name !== 'string') return null;
    const key = flags.refKey || `${source}:${name}`;
    if (!flags.refKey && seen.has(key)) return null;
    seen.add(key);
    const entry = {
      name,
      aliases: uniqueAliases(name),
      refKey: flags.refKey || null,
      source,
      materializable: flags.materializable !== false,
      skeleton: flags.skeleton === true,
      poolDependent: flags.poolDependent === true
    };
    entries.push(entry);
    if (entry.refKey) refIndex.set(entry.refKey, entry);
    return entry;
  }

  for (const name of BUILTIN_TARGETS) {
    register(name, 'builtin', { materializable: false });
  }

  for (const name of SKELETON_GROUP_NAMES) {
    register(name, 'skeleton', {
      skeleton: true,
      poolDependent: POOL_DEPENDENT_GROUP_NAMES.includes(name)
    });
  }

  // 池：解析失败时退回内置池名，避免在剪枝阶段重复抛出配置期错误
  let poolDefs = [];
  try {
    poolDefs = resolvePoolDefinitions(config);
  } catch (err) {
    if (strictPools) throw err;
  }
  for (const def of poolDefs) {
    register(def.name, 'pool', { poolDependent: true });
  }
  for (const name of Object.values(POOL_NAMES)) {
    register(name, 'pool', { poolDependent: true });
  }

  for (const name of getHashLbGroupNames()) {
    register(name, 'hashLb');
  }

  for (const region of getEnhancedRegionDefs()) {
    if (region.groupName) register(region.groupName, 'region');
    if (region.name) register(region.name, 'region');
  }

  for (const continent of CONTINENT_DEFS) {
    if (continent.groupName) register(continent.groupName, 'continent');
    if (continent.name) register(continent.name, 'continent');
  }

  for (const group of filterGroupsByDirection(config.groups, dir)) {
    if (group && typeof group === 'object' && group.name) register(group.name, 'user');
  }

  for (const [refKey, group] of Object.entries(registries.groups || {})) {
    if (!group) continue;
    register(group.name || refKey, 'directory', { refKey });
    const entry = refIndex.get(refKey);
    if (entry && refKey !== entry.name) entry.aliases.push(refKey);
  }

  // 服务键：逐分类键、专项、聚合组与广告拦截（与 findService 的查找口径一致）
  for (const category of SERVICE_CATEGORIES) {
    for (const key of Object.keys(registries[category] || {})) register(key, 'service');
  }
  for (const key of Object.keys(registries.specialized || {})) register(key, 'service');
  for (const item of Object.values(registries.aggregates || {})) {
    if (item) register(item.refKey || item.key, 'service');
  }
  for (const key of Object.keys(ADS_GROUPS)) register(key, 'service');

  /**
   * 按登记顺序查找目标（原始名或去装饰名任一命中）
   * @param {string} value 目标写法
   * @returns {object|null}
   */
  function lookup(value) {
    const clean = stripGroupDecoration(value);
    for (const entry of entries) {
      if (entry.aliases.includes(value) || entry.aliases.includes(clean)) return entry;
    }
    return null;
  }

  function ensureEnabled(entry, raw) {
    if (entry && entry.refKey && disabled.has(entry.refKey)) {
      throw new Error(`routing: 目标组「${raw}」已在 groups 中被禁用 (disabled: true)`);
    }
  }

  /**
   * 解析 `to` 为目标名
   * @param {string} raw 原始写法
   * @returns {string}
   */
  function resolve(raw) {
    const value = String(raw).trim();
    const upper = value.toUpperCase();
    if (BUILTIN_TARGETS.includes(upper)) return upper;

    if (value.startsWith(POOL_PREFIX)) {
      const poolName = value.slice(POOL_PREFIX.length).trim();
      if (!poolName) {
        throw new Error('routing: `@pool:` 后缺少池名');
      }
      const def = poolDefs.find(item => item.name === poolName);
      if (!def) {
        const builtin = poolDefs.filter(item => item.builtin).map(item => item.name);
        throw new Error(`routing: 节点池「${poolName}」不存在（当前可用内置池: ${builtin.join(' / ') || '无'}；自定义池见 pools）`);
      }
      return def.name;
    }

    // 目录 ref 键优先：解析为组的规范名（改名不断链）
    const refEntry = refIndex.get(value);
    if (refEntry) {
      ensureEnabled(refEntry, value);
      return refEntry.name;
    }

    if (isValid(value)) return value;

    throw new Error(`routing: 目标组「${value}」未声明或不存在（可用内置目标: DIRECT / REJECT 等，或现有策略组/地区组名）`);
  }

  /**
   * 判定目标写法是否合法（不合法返回 false，已禁用则 fail-closed 抛错）
   * @param {string} value 目标写法
   * @returns {boolean}
   */
  function isValid(value) {
    const entry = lookup(value);
    if (!entry) return false;
    ensureEnabled(entry, value);
    return true;
  }

  /**
   * 目标是否属于「池依赖组」（池为空 / 未激活时允许缺席）
   * @param {string} value 目标写法
   * @returns {boolean}
   */
  function isPoolDependent(value) {
    const entry = lookup(value);
    return Boolean(entry && entry.poolDependent);
  }

  return {
    builtinNames: BUILTIN_TARGETS,
    resolve,
    isValid,
    isPoolDependent
  };
}

module.exports = {
  createTargetRegistry,
  BUILTIN_TARGETS,
  SKELETON_GROUP_NAMES,
  POOL_PREFIX
};
