/**
 * -----------------------------------------------------------------------------
 * Data Layer: 内置节点池定义 (Built-in Node Pools)
 * -----------------------------------------------------------------------------
 * 节点池 = 用 match 条件从节点集合里圈出的一组节点，本身不是策略组。
 * 池被 `@pool:<池名>` 或某条分流规则引用时才物化成真实策略组（引用即激活）。
 *
 * 这里只放数据；求值、隔离门禁与建组在 strategy 层（src/strategy/pools.js）。
 */

const POOL_NAMES = Object.freeze({
  residential: '家宽优选',
  highMulti: '高倍率优选',
  experimental: '实验节点',
  lowMulti: '低倍率节点'
});

/**
 * 内置池定义表（单一真相源）：池身份、圈选条件、物化规格与归组说明同表登记。
 *
 * - 数组顺序 = 产物建组顺序（家宽 → 低倍率 → 高倍率 → 实验）；
 * - `gated: true` 的池只在 `enableIsolation` 打开时启用；
 * - `tag` / `multi` 是隔离归组展示的判定条件（与 `match` 同源）；
 * - `isolationNote` 是节点「归组」调试行括号里的说明（如 `家宽隔离`），**不是组名**；
 *   展示名不在此重复，emoji 前缀由展示层统一附加。
 */
const BUILTIN_POOL_DEFS = Object.freeze([
  {
    name: POOL_NAMES.residential,
    bucket: 'residential',
    tag: 'residential',
    isolationNote: '家宽隔离',
    isolate: true,
    group: 'always',
    type: 'fallback',
    gated: true
  },
  {
    name: POOL_NAMES.lowMulti,
    bucket: 'lowMulti',
    tag: 'lowMulti',
    isolationNote: '低倍率隔离',
    isolate: false,
    group: 'always',
    type: 'select',
    hidden: true
  },
  {
    name: POOL_NAMES.highMulti,
    bucket: 'highMulti',
    multi: true,
    isolationNote: '高倍率隔离',
    isolate: true,
    group: 'always',
    type: 'select',
    gated: true
  },
  {
    name: POOL_NAMES.experimental,
    bucket: 'experimental',
    tag: 'experimental',
    isolationNote: '实验节点隔离',
    isolate: true,
    group: 'always',
    type: 'select',
    gated: true
  }
]);

/** 隔离归组判定优先级：家宽 > 高倍率 > 低倍率 > 实验（只影响「归组」展示，不参与拓扑决策） */
const ISOLATION_PRIORITY = Object.freeze(['residential', 'highMulti', 'lowMulti', 'experimental']);

/** 排序提示：由池定义表投影，标签与池名同源 */
const POOL_SORT_ORDER = Object.freeze(
  ISOLATION_PRIORITY.map(bucket => {
    const def = BUILTIN_POOL_DEFS.find(item => item.bucket === bucket);
    return Object.freeze({
      bucket: def.bucket,
      tag: def.tag,
      multi: def.multi,
      name: def.name,
      isolationNote: def.isolationNote
    });
  })
);

/**
 * 构建当前配置下的内置池定义
 *
 * - `enableIsolation: true` 时启用三个隔离池（家宽 / 高倍率 / 实验），
 *   其成员会从地区池与全量标准池中剔除；
 * - `低倍率节点` 池恒在（不隔离、默认隐藏），纯粹按倍率圈定合格节点。
 *
 * @param {object} [userConfig={}] 用户配置
 * @returns {Array<object>} 池定义列表
 */
function buildDefaultPools(userConfig = {}) {
  const threshold = userConfig.highMultiThreshold ?? 2.5;
  return BUILTIN_POOL_DEFS
    .filter(def => !def.gated || userConfig.enableIsolation === true)
    .map(def => ({
      name: def.name,
      bucket: def.bucket,
      isolate: def.isolate,
      group: def.group,
      type: def.type,
      ...(def.hidden === true ? { hidden: true } : {}),
      match: def.tag ? { tags: [def.tag] } : { multi: `> ${threshold}` },
      builtin: true
    }));
}

module.exports = {
  POOL_NAMES,
  POOL_SORT_ORDER,
  buildDefaultPools
};
