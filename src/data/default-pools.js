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
 * 内置池的排序提示（只用于节点清单与看板的「归组」展示，不参与拓扑决策）。
 * 顺序即优先级：家宽 > 高倍率 > 低倍率 > 实验。
 */
const POOL_SORT_ORDER = Object.freeze([
  { bucket: 'residential', tag: 'residential', label: '🏠 家宽优选', reason: '家宽隔离' },
  { bucket: 'highMulti', multi: true, label: '🛑 高倍率节点', reason: '高倍率隔离' },
  { bucket: 'lowMulti', tag: 'lowMulti', label: '⏬ 下载策略', reason: '低倍率隔离' },
  { bucket: 'experimental', tag: 'experimental', label: '🧪 实验节点', reason: '实验节点隔离' }
]);

/**
 * 构建当前配置下的内置池定义
 *
 * - `enableIsolation: true` 时启用三个隔离池（家宽 / 高倍率 / 实验），
 *   其成员会从地区池与全量标准池中剔除；
 * - `低倍率节点` 池恒在（不隔离、默认隐藏），供下载策略与用户自定义规则引用。
 *
 * @param {object} [userConfig={}] 用户配置
 * @returns {Array<object>} 池定义列表
 */
function buildDefaultPools(userConfig = {}) {
  const threshold = userConfig.highMultiThreshold ?? 2.5;
  const pools = [];

  if (userConfig.enableIsolation === true) {
    pools.push(
      {
        name: POOL_NAMES.residential,
        match: { tags: ['residential'] },
        isolate: true,
        group: 'always',
        type: 'fallback',
        bucket: 'residential',
        builtin: true
      },
      {
        name: POOL_NAMES.highMulti,
        match: { multi: `> ${threshold}` },
        isolate: true,
        group: 'always',
        type: 'select',
        bucket: 'highMulti',
        builtin: true
      },
      {
        name: POOL_NAMES.experimental,
        match: { tags: ['experimental'] },
        isolate: true,
        group: 'always',
        type: 'select',
        bucket: 'experimental',
        builtin: true
      }
    );
  }

  pools.push({
    name: POOL_NAMES.lowMulti,
    match: { tags: ['lowMulti'] },
    isolate: false,
    group: 'onDemand',
    type: 'select',
    hidden: true,
    bucket: 'lowMulti',
    builtin: true
  });

  return pools;
}

module.exports = {
  POOL_NAMES,
  POOL_SORT_ORDER,
  buildDefaultPools
};
