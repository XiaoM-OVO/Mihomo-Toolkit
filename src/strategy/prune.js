/**
 * DAG 级联空组清理机制
 *
 * 递归剔除无节点可用或被洗劫一空的策略组，级联清理殉葬的分流规则及孤儿 Rule-Providers，
 * 避免 Mihomo 内核因引用不存在的策略组而启动崩溃。
 */

const DEFAULT_EXEMPT_GROUPS = ['📍 手动选择', '🐟 漏网之鱼'];
const VALID_BUILTIN_TARGETS = ['DIRECT', 'REJECT', 'REJECT-DROP', 'COMPATIBLE', 'PASS'];

/**
 * 执行 DAG 拓扑级联清理
 * @param {object} params
 * @param {Array<object>} params.proxyGroups 策略组列表
 * @param {Array<object>} [params.proxies=[]] 物理节点列表
 * @param {Array<string>} [params.rules=[]] 路由分流规则列表
 * @param {object} [params.ruleProviders={}] 规则集资源提供者
 * @param {Array<string>} [params.exemptGroups] 豁免斩首的基础骨架组
 * @param {number} [params.maxIterations=50] 最大迭代轮数
 * @returns {object} { proxyGroups, rules, ruleProviders, removedGroups }
 */
function pruneEmptyGroups({
  proxyGroups = [],
  proxies = [],
  rules = [],
  ruleProviders = {},
  exemptGroups = DEFAULT_EXEMPT_GROUPS,
  maxIterations = 50
}) {
  const validBasics = new Set(VALID_BUILTIN_TARGETS);
  proxies.forEach(p => {
    if (p?.name) validBasics.add(p.name);
  });

  const exemptSet = new Set(exemptGroups);
  const removedGroups = new Set();
  let groups = proxyGroups.map(g => ({ ...g, proxies: Array.isArray(g.proxies) ? [...g.proxies] : [] }));
  let currentRules = Array.isArray(rules) ? [...rules] : [];
  const providers = { ...ruleProviders };

  let changed = true;
  let iterations = maxIterations;

  while (changed && iterations > 0) {
    iterations--;
    changed = false;
    const aliveGroups = new Set(groups.map(g => g.name));

    groups = groups.filter(group => {
      // 1. 过滤掉物理不存在或已被斩首的子节点/子策略组
      if (group.proxies) {
        group.proxies = group.proxies.filter(p => validBasics.has(p) || aliveGroups.has(p));
      }

      // 2. 检查当前组是否为空
      const isEmpty = !group.proxies || group.proxies.length === 0;
      const isExempt = exemptSet.has(group.name);

      // 3. 执行移除
      if (isEmpty && !isExempt) {
        removedGroups.add(group.name);
        aliveGroups.delete(group.name);
        changed = true;
        return false;
      }

      // 4. 骨架组若全军覆没，强行补入 DIRECT 防止内核崩溃
      if (isEmpty && isExempt) {
        group.proxies = ['DIRECT'];
      }
      return true;
    });
  }

  // 同步清理殉葬的分流规则
  if (removedGroups.size > 0 && currentRules.length > 0) {
    currentRules = currentRules.filter(rule => {
      if (typeof rule !== 'string') return true;
      const parts = rule.split(',');
      const target = parts[parts.length - 1] === 'no-resolve' ? parts[parts.length - 2] : parts[parts.length - 1];
      return !removedGroups.has(target);
    });
  }

  // 同步清理孤儿 Rule Providers
  if (removedGroups.size > 0 && Object.keys(providers).length > 0) {
    const usedProviders = new Set();
    currentRules.forEach(rule => {
      if (typeof rule === 'string' && rule.startsWith('RULE-SET,')) {
        usedProviders.add(rule.split(',')[1]);
      }
    });
    Object.keys(providers).forEach(key => {
      if (!usedProviders.has(key)) {
        delete providers[key];
      }
    });
  }

  return {
    proxyGroups: groups,
    rules: currentRules,
    ruleProviders: providers,
    removedGroups
  };
}

module.exports = {
  DEFAULT_EXEMPT_GROUPS,
  pruneEmptyGroups
};
