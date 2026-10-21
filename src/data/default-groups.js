/**
 * -----------------------------------------------------------------------------
 * Data Layer: 出厂声明式策略组 (Built-in Declarative Groups)
 * -----------------------------------------------------------------------------
 * 骨架组的数据化产地：能从 `groups` DSL 表达清楚的出厂策略组，一律写成声明，
 * 由 topology 决定「什么时候装配」（例如池非空才装配），而不是在 topology 里手写成员。
 *
 * 约定：
 *   - 组只声明成员与呈现，不声明规则；哪些流量进哪个组由 `routing` 决定。
 *   - `@pool:<池名>` 在 proxies 中展开为该池的成员（load-balance 需要节点而非组）。
 *   - 依赖的组/池缺席时，由 topology 决定是否装配整组，避免空壳组。
 */

/**
 * 下载类策略组：
 *   - `负载均衡-轮询` 是纯出口（轮询低倍率节点），隐藏；
 *   - `下载策略` 是用户可见入口，按「直连 → 轮询出口 → 自动选择 → 低倍率节点」排序。
 * 低倍率节点池已在池定义里排除「禁止下载」，因此这两个组不再各自过滤。
 */
const DOWNLOAD_GROUPS = Object.freeze([
  {
    name: '下载策略',
    type: 'select',
    hidden: false,
    proxies: ['DIRECT', '负载均衡-轮询', '自动选择', '低倍率节点']
  },
  {
    name: '负载均衡-轮询',
    type: 'load-balance',
    strategy: 'round-robin',
    interval: 300,
    lazy: true,
    hidden: true,
    proxies: ['@pool:低倍率节点']
  }
]);

module.exports = {
  DOWNLOAD_GROUPS
};
