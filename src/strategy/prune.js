/**
 * DAG 级联空组清理与拓扑环路破除机制
 *
 * 基于汇点反向可达性推导 (Sink-to-Source Reverse Reachability) 与三色标记 DFS 破环，
 * 递归剔除无节点可用或被洗劫一空的策略组，切断恶性循环依赖，级联清理殉葬的分流规则及孤儿 Rule-Providers，
 * 避免 Mihomo 内核因引用不存在的策略组或循环依赖 (circular reference) 而启动崩溃。
 */

const { SKELETON_EXEMPT_GROUPS, effectiveExemptGroups } = require('../data');

const DEFAULT_EXEMPT_GROUPS = [...SKELETON_EXEMPT_GROUPS];
const VALID_BUILTIN_TARGETS = ['DIRECT', 'REJECT', 'REJECT-DROP', 'COMPATIBLE', 'PASS', 'GLOBAL'];
// 能够证明策略组具备真实代理能力或安全拦截动作的终点（纯 DIRECT 无法证明具备代理能力）
const PRODUCTIVE_BUILTIN_SINKS = new Set(['GLOBAL', 'REJECT', 'REJECT-DROP', 'COMPATIBLE', 'PASS']);
const MAX_DFS_DEPTH = 1000;

/**
 * 执行 DAG 拓扑级联清理与破环
 * @param {object} params
 * @param {Array<object>} params.proxyGroups 策略组列表
 * @param {Array<object>} [params.proxies=[]] 物理节点列表
 * @param {Array<string>} [params.rules=[]] 路由分流规则列表
 * @param {object} [params.ruleProviders={}] 规则集资源提供者
 * @param {Array<string>} [params.exemptGroups] 豁免斩首的基础骨架组
 * @param {object} [params.userConfig=null] 用户上下文配置（用于保护 customRuleProviders 等显式声明）
 * @param {object} [params.logger=null] 分级日志记录器
 * @returns {object} { proxyGroups, rules, ruleProviders, removedGroups, brokenEdges, rescuedGroups }
 */
function pruneEmptyGroups({
  proxyGroups = [],
  proxies = [],
  rules = [],
  ruleProviders = {},
  exemptGroups = DEFAULT_EXEMPT_GROUPS,
  userConfig = null,
  logger = null
}) {
  // 1. 构建命名空间：严格区分物理代理、内置目标与策略组，杜绝静默覆盖与命名歧义
  const builtinTargets = new Set(VALID_BUILTIN_TARGETS);
  const physicalNodeNames = new Set();
  if (Array.isArray(proxies)) {
    for (const p of proxies) {
      if (p?.name && typeof p.name === 'string' && !builtinTargets.has(p.name)) {
        physicalNodeNames.add(p.name);
      }
    }
  }

  const exemptSet = new Set(effectiveExemptGroups(exemptGroups));

  // 深度复制策略组并建立映射，严格校验同名冲突，杜绝静默覆盖
  const groupMap = new Map();
  const originalOrder = new Map();
  // 保持只读快照以支撑豁免组注血可追溯性（防止后续维护意外污染原始输入事实）
  const initialProxiesMap = new Map();

  if (Array.isArray(proxyGroups)) {
    proxyGroups.forEach((g, idx) => {
      if (!g || typeof g.name !== 'string') return;
      if (groupMap.has(g.name)) {
        const firstIdx = (originalOrder.get(g.name) ?? idx) + 1;
        throw new Error(`[Prune] 重复定义的策略组名称: "${g.name}" (第 ${firstIdx} 项与第 ${idx + 1} 项冲突)`);
      }
      if (builtinTargets.has(g.name)) {
        throw new Error(`[Prune] 命名冲突: 策略组 "${g.name}" 不得使用内核保留内置目标名称`);
      }
      if (physicalNodeNames.has(g.name)) {
        throw new Error(`[Prune] 命名冲突: 策略组 "${g.name}" 与物理代理节点重名，导致目标引用歧义`);
      }
      originalOrder.set(g.name, idx);
      const snapshot = Object.freeze(Array.isArray(g.proxies) ? [...g.proxies] : []);
      initialProxiesMap.set(g.name, snapshot);
      groupMap.set(g.name, {
        ...g,
        proxies: [...snapshot]
      });
    });
  }

  // 合法目标判定：物理节点、内核内置目标或当前策略组均属于语法合法目标（非 Ghost 目标）
  function isValidTarget(target) {
    return builtinTargets.has(target) || physicalNodeNames.has(target) || groupMap.has(target);
  }

  // 生产性汇点判定：能证明具备真实代理能力或安全拦截动作的终点（纯 DIRECT 不作为生产性终点）
  function isProductiveSink(target) {
    return physicalNodeNames.has(target) || PRODUCTIVE_BUILTIN_SINKS.has(target);
  }

  // 预清理：剔除自环（A -> A）以及虚空目标（Ghost targets）
  for (const group of groupMap.values()) {
    group.proxies = group.proxies.filter(target => {
      if (typeof target !== 'string') return false;
      if (target === group.name) return false; // 阻断自环
      return isValidTarget(target);
    });
  }

  const removedGroups = new Set();
  const brokenEdges = [];
  const rescuedGroupsMap = new Map();

  /**
   * 豁免组保活复苏辅助函数 (DRY & 可追溯性)
   * 严禁保留死节点（防内核崩溃），但忠实记录注血前丢失的原成员供审计调试
   * @param {string} name 策略组名称
   * @param {object} group 策略组对象
   */
  function rescueExemptGroup(name, group) {
    if (!rescuedGroupsMap.has(name)) {
      const lost = initialProxiesMap.get(name) || [];
      rescuedGroupsMap.set(name, {
        name,
        lostProxies: lost,
        fallback: ['DIRECT']
      });
      if (logger && typeof logger.warn === 'function') {
        const lostInfo = lost.length > 0 ? ` (原成员: ${lost.join(', ')})` : '';
        logger.warn(`🛡️ 骨架组 [${name}] 节点全军覆没，已注入 DIRECT 兜底保活${lostInfo}`);
      }
    }
    group.proxies = ['DIRECT'];
  }

  /**
   * 自底向上生产性可达集合推导 (Sink-to-Source Reverse Reachability)
   * 仅以真实物理节点或控制拦截终点（REJECT/GLOBAL）作为有效汇点反向染色。
   * 若一个普通非豁免组最终只能到达 DIRECT，说明已被洗劫一空，不具备代理价值，予以淘汰。
   * @param {Map<string, object>} activeGroups 当前活跃的策略组集合
   * @returns {Set<string>} 能连通到生产性汇点的组名称集合
   */
  function computeReachableGroups(activeGroups) {
    const reverseAdj = new Map();
    for (const group of activeGroups.values()) {
      for (const target of group.proxies) {
        if (!reverseAdj.has(target)) {
          reverseAdj.set(target, new Set());
        }
        reverseAdj.get(target).add(group.name);
      }
    }

    const reachable = new Set();
    const queue = [];
    let head = 0;

    // 种子队列：所有在拓扑中被实际引用的生产性汇点 (Productive Sinks)
    for (const target of reverseAdj.keys()) {
      if (isProductiveSink(target)) {
        queue.push(target);
      }
    }

    // 递增游标遍历队列，消除 shift() 的 O(N) 搬移开销，实现严格 O(V + E)
    while (head < queue.length) {
      const curr = queue[head++];
      const parents = reverseAdj.get(curr);
      if (!parents) continue;
      for (const parent of parents) {
        if (!reachable.has(parent) && activeGroups.has(parent)) {
          reachable.add(parent);
          queue.push(parent);
        }
      }
    }

    return reachable;
  }

  // 阶段 1：豁免组前置注血与第一轮可达性收敛
  // 1.1 先行推导当前可达性
  let reachable = computeReachableGroups(groupMap);

  // 1.2 保护豁免组：若骨架组无法通过自身路径抵达任何生产性汇点，强制注入 DIRECT 保证自持
  for (const [name, group] of groupMap.entries()) {
    if (exemptSet.has(name) && !reachable.has(name)) {
      rescueExemptGroup(name, group);
    }
  }

  // 1.3 骨架组注血后，普通组若无法通达生产性汇点（即使包含 DIRECT），一律视为空壳予以剪枝淘汰
  for (const name of Array.from(groupMap.keys())) {
    if (!reachable.has(name)) {
      if (!exemptSet.has(name)) {
        removedGroups.add(name);
        groupMap.delete(name);
        if (logger && typeof logger.debug === 'function') {
          logger.debug(`🍂 剪枝淘汰空策略组: [${name}]`);
        }
      } else {
        rescueExemptGroup(name, groupMap.get(name));
      }
    }
  }

  // 1.4 清理存活组中指向已剔除组的悬空引用
  for (const group of groupMap.values()) {
    group.proxies = group.proxies.filter(target => isProductiveSink(target) || target === 'DIRECT' || groupMap.has(target));
  }

  // 阶段 2：确定性 DFS 环路检测与破环 (Cycle Breaking)
  // 为确保破环行为绝对确定，按组名字典序稳定升序作为 DFS 探索入口
  const sortedGroupNames = Array.from(groupMap.keys()).sort();
  const UNVISITED = 0;
  const VISITING = 1;
  const VISITED = 2;
  const visitState = new Map();

  function dfsBreakCycles(nodeName, depth = 0) {
    if (depth > MAX_DFS_DEPTH) {
      throw new Error(`[Prune] 策略组嵌套深度超过安全上限 (${MAX_DFS_DEPTH})，阻断潜在调用栈溢出`);
    }

    visitState.set(nodeName, VISITING);
    const group = groupMap.get(nodeName);
    if (!group) {
      visitState.set(nodeName, VISITED);
      return;
    }

    const nextProxies = [];
    for (const target of group.proxies) {
      if (isProductiveSink(target) || target === 'DIRECT') {
        nextProxies.push(target);
        continue;
      }

      if (!groupMap.has(target)) {
        continue;
      }

      const targetState = visitState.get(target) || UNVISITED;
      if (targetState === VISITING) {
        // 捕获回边 (Back-Edge)：记录破环轨迹并剪断该引用
        brokenEdges.push({ from: nodeName, to: target });
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`✂️ 拓扑破环: 检测到策略组循环依赖 [${nodeName}] ➔ [${target}]，已剪断该回边`);
        }
        continue;
      }

      if (targetState === UNVISITED) {
        dfsBreakCycles(target, depth + 1);
      }

      // DFS 阶段仅检测并切断回边（不删点）；保留 groupMap.has 防御性判断以支持未来拓扑演化
      if (groupMap.has(target)) {
        nextProxies.push(target);
      }
    }

    group.proxies = nextProxies;
    visitState.set(nodeName, VISITED);
  }

  for (const name of sortedGroupNames) {
    if ((visitState.get(name) || UNVISITED) === UNVISITED) {
      dfsBreakCycles(name, 0);
    }
  }

  // 若破环发生，输出全局聚合诊断摘要
  if (brokenEdges.length > 0 && logger && typeof logger.warn === 'function') {
    const summary = brokenEdges.map(e => `${e.from}➔${e.to}`).join(', ');
    logger.warn(`✂️ 拓扑破环总结: 共斩断 ${brokenEdges.length} 处循环依赖边 [${summary}]`);
  }

  // 阶段 3：破环后二次可达性收敛 (Post-Break Reachability)
  // 剪断回边后，某些普通组可能失去了通向生产性汇点的唯一通路变成死路
  let postReachable = computeReachableGroups(groupMap);

  for (const name of Array.from(groupMap.keys())) {
    const group = groupMap.get(name);
    const hasExit = postReachable.has(name) && group.proxies.length > 0;
    if (!hasExit) {
      if (!exemptSet.has(name)) {
        removedGroups.add(name);
        groupMap.delete(name);
        if (logger && typeof logger.debug === 'function') {
          logger.debug(`🍂 剪枝淘汰空策略组: [${name}]`);
        }
      } else {
        rescueExemptGroup(name, group);
      }
    }
  }

  // 3.1 终末收敛：清理存活组中指向已被剔除组的残余引用；骨架组若遭洗劫强制注血 DIRECT
  for (const group of groupMap.values()) {
    group.proxies = group.proxies.filter(target => isProductiveSink(target) || target === 'DIRECT' || groupMap.has(target));
    if (group.proxies.length === 0 && exemptSet.has(group.name)) {
      rescueExemptGroup(group.name, group);
    }
  }

  // 阶段 4：规则与 Rule-Providers 级联殉葬
  let currentRules = Array.isArray(rules) ? [...rules] : [];
  const providers = { ...ruleProviders };

  if (removedGroups.size > 0 && currentRules.length > 0) {
    const originalRuleCount = currentRules.length;
    currentRules = currentRules.filter(rule => {
      if (typeof rule !== 'string') return true;
      const parts = rule.split(',').map(s => s.trim());
      const last = parts[parts.length - 1] ? parts[parts.length - 1].toLowerCase() : '';
      const target = last === 'no-resolve' ? parts[parts.length - 2] : parts[parts.length - 1];
      return !removedGroups.has(target);
    });
    const droppedRulesCount = originalRuleCount - currentRules.length;
    if (droppedRulesCount > 0 && logger && typeof logger.debug === 'function') {
      logger.debug(`🕊️ 规则殉葬: 目标策略组已淘汰，注销 ${droppedRulesCount} 条分流规则`);
    }
  }

  // 清理孤儿 Rule Providers：
  // 尊重用户主权，用户显式声明的 customRuleProviders 享有免死金牌，绝不作为孤儿误删
  const userCustomProviders = new Set(
    userConfig?.customRuleProviders && typeof userConfig.customRuleProviders === 'object'
      ? Object.keys(userConfig.customRuleProviders)
      : []
  );

  if (Object.keys(providers).length > 0) {
    const usedProviders = new Set();
    currentRules.forEach(rule => {
      if (typeof rule === 'string' && rule.trim().toUpperCase().startsWith('RULE-SET,')) {
        const parts = rule.split(',').map(s => s.trim());
        if (parts[1]) usedProviders.add(parts[1]);
      }
    });

    Object.keys(providers).forEach(key => {
      // 仅当该提供者未被任何规则引用且非用户显式声明时，才作为工具生成的孤儿清理
      if (!usedProviders.has(key) && !userCustomProviders.has(key)) {
        delete providers[key];
        if (logger && typeof logger.debug === 'function') {
          logger.debug(`🧹 孤儿清理: 剔除未被引用的规则集提供者 [${key}]`);
        }
      }
    });
  }

  // 恢复输入时原始相对顺序输出，保证交付一致性
  const finalGroups = Array.from(groupMap.values()).sort((a, b) => {
    const orderA = originalOrder.has(a.name) ? originalOrder.get(a.name) : 999999;
    const orderB = originalOrder.has(b.name) ? originalOrder.get(b.name) : 999999;
    return orderA - orderB;
  });

  return {
    proxyGroups: finalGroups,
    rules: currentRules,
    ruleProviders: providers,
    removedGroups,
    brokenEdges,
    rescuedGroups: Array.from(rescuedGroupsMap.values())
  };
}

module.exports = {
  pruneEmptyGroups
};
