/**
 * -----------------------------------------------------------------------------
 * Strategy Layer: 节点池求值 (Node Pool Resolution)
 * -----------------------------------------------------------------------------
 * 把「内置池数据表 + 用户 pools 声明」归一成一组定义，并提供节点命中判定。
 * 池只描述「哪些节点属于它」，建组与隔离门禁由 topology 决定。
 */

const { createNodePredicate, validateRecipe } = require('./matcher');
const { buildDefaultPools } = require('../data/default-pools');

const CUSTOM_POOL_KEYS = new Set(['name', 'match', 'exclude', 'isolate', 'hidden', 'group', 'type']);
const GROUP_MODES = new Set(['always', 'onDemand']);
const POOL_TYPES = new Set(['select', 'fallback']);

/**
 * 校验并归一单条用户池声明
 * @param {any} raw 原始声明
 * @param {number} index 声明下标
 * @returns {object} 归一后的池定义
 */
function normalizeCustomPool(raw, index) {
  const label = `pools[${index}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`pools: ${label} 必须是普通对象`);
  }

  for (const key of Object.keys(raw)) {
    if (!CUSTOM_POOL_KEYS.has(key)) {
      throw new Error(`pools: ${label} 未知字段「${key}」，支持: ${[...CUSTOM_POOL_KEYS].join(', ')}`);
    }
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) {
    throw new Error(`pools: ${label} 缺少 name（池名）`);
  }

  if (raw.match === undefined || raw.match === null) {
    throw new Error(`pools: 池「${name}」缺少 match 条件（节点池必须能圈出一批节点）`);
  }

  try {
    validateRecipe(raw.match, `${name}.match`);
    if (raw.exclude !== undefined && raw.exclude !== null) {
      validateRecipe(raw.exclude, `${name}.exclude`);
    }
  } catch (err) {
    throw new Error(String(err && err.message ? err.message : err).replace(/\[groups\]/g, '[pools]'));
  }

  if (raw.group !== undefined && !GROUP_MODES.has(raw.group)) {
    throw new Error(`pools: 池「${name}」的 group 只能是 ${[...GROUP_MODES].join(' / ')}`);
  }

  if (raw.type !== undefined && !POOL_TYPES.has(raw.type)) {
    throw new Error(`pools: 池「${name}」的 type 只能是 ${[...POOL_TYPES].join(' / ')}`);
  }

  return {
    name,
    match: raw.match,
    exclude: raw.exclude,
    isolate: raw.isolate === true,
    hidden: raw.hidden === true,
    // 用户池默认按需物化：被规则或组引用时才建组，避免无意义空组
    group: raw.group || 'onDemand',
    type: raw.type || 'select',
    bucket: `pool:${name}`,
    builtin: false
  };
}

/**
 * 解析当前配置下生效的池定义（内置在前，用户池在后）
 * @param {object} [userConfig={}] 用户配置
 * @returns {Array<object>} 池定义列表
 */
function resolvePoolDefinitions(userConfig = {}) {
  const custom = Array.isArray(userConfig.pools) ? userConfig.pools : [];
  const defs = [];
  const seen = new Set();

  const push = (def) => {
    if (seen.has(def.name)) {
      throw new Error(`pools: 池名「${def.name}」重复（内置池与自定义池共用一个命名空间）`);
    }
    seen.add(def.name);
    defs.push(def);
  };

  buildDefaultPools(userConfig).forEach(push);
  custom.forEach((raw, index) => push(normalizeCustomPool(raw, index)));

  return defs;
}

/**
 * 为每个池编译节点命中谓词
 * @param {Array<object>} poolDefs 池定义列表
 * @returns {Array<{ def: object, test: (item: object) => boolean }>}
 */
function createPoolMatchers(poolDefs) {
  return (Array.isArray(poolDefs) ? poolDefs : []).map(def => ({
    def,
    test: createNodePredicate({ match: def.match, exclude: def.exclude })
  }));
}

module.exports = {
  resolvePoolDefinitions,
  createPoolMatchers
};
