/**
 * DAG 级联空组清理与拓扑环路破除机制
 *
 * 基于汇点反向可达性推导 (Sink-to-Source Reverse Reachability) 与三色标记 DFS 破环，
 * 递归剔除无可用节点的策略组，切断循环依赖，级联清理关联的分流规则及孤儿 Rule-Providers，
 * 避免 Mihomo 内核因引用不存在的策略组或循环依赖 (circular reference) 而启动崩溃。
 */

const { SKELETON_EXEMPT_GROUPS, effectiveExemptGroups } = require('../data');
const { stripGroupDecoration } = require('./presentation');
const { ruleTargetOf } = require('./routing');
const { createTargetRegistry } = require('./target-registry');

const DEFAULT_EXEMPT_GROUPS = [...SKELETON_EXEMPT_GROUPS];
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
 * @param {Array<string>} [params.exemptGroups] 豁免剪枝的基础骨架组
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
  logger = null,
  trace = null
}) {
  // 1. 构建命名空间：严格区分物理代理、内置目标与策略组，防止静默覆盖与命名歧义
  //    目标口径与 routing 共用同一张注册表（内核内置目标 / 池依赖组判定）
  const targets = createTargetRegistry({ config: userConfig || {}, strictPools: false });
  const builtinTargets = new Set(targets.builtinNames);
  const physicalNodeNames = new Set();
  if (Array.isArray(proxies)) {
    for (const p of proxies) {
      if (p?.name && typeof p.name === 'string' && !builtinTargets.has(p.name)) {
        physicalNodeNames.add(p.name);
      }
    }
  }

  const exemptList = effectiveExemptGroups(exemptGroups);
  const exemptExactSet = new Set(exemptList);
  const exemptStrippedSet = new Set(exemptList.map(stripGroupDecoration));
  const isExempt = (name) => {
    if (!name || typeof name !== 'string') return false;
    return exemptExactSet.has(name) || exemptStrippedSet.has(stripGroupDecoration(name));
  };

  // 深度复制策略组并建立映射，严格校验同名冲突，防止静默覆盖
  const groupMap = new Map();
  const originalOrder = new Map();
  // 保持只读快照以支撑豁免组保活可追溯性（防止后续维护意外污染原始输入事实）
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

  const groupStrippedMap = new Map();
  for (const name of groupMap.keys()) {
    const stripped = stripGroupDecoration(name).toLowerCase();
    if (!groupStrippedMap.has(stripped)) {
      groupStrippedMap.set(stripped, name);
    }
  }

  // 合法目标判定与归一化：物理节点、内核内置目标或当前策略组均属于语法合法目标（非 Ghost 目标）
  function resolveValidTarget(target) {
    if (typeof target !== 'string') return null;
    if (builtinTargets.has(target) || physicalNodeNames.has(target) || groupMap.has(target)) {
      return target;
    }
    const stripped = stripGroupDecoration(target).toLowerCase();
    if (groupStrippedMap.has(stripped)) {
      return groupStrippedMap.get(stripped);
    }
    return null;
  }

  // 生产性汇点判定：能证明具备真实代理能力或安全拦截动作的终点（纯 DIRECT 不作为生产性终点）
  function isProductiveSink(target) {
    return physicalNodeNames.has(target) || PRODUCTIVE_BUILTIN_SINKS.has(target);
  }

  // 预清理：剔除自环（A -> A）以及虚空目标（Ghost targets），并归一化策略组引用
  for (const group of groupMap.values()) {
    const nextProxies = [];
    for (const target of group.proxies) {
      const resolved = resolveValidTarget(target);
      if (!resolved) continue;
      if (resolved === group.name || stripGroupDecoration(resolved) === stripGroupDecoration(group.name)) continue;
      nextProxies.push(resolved);
    }
    group.proxies = [...new Set(nextProxies)];
  }

  const removedGroups = new Set();
  const brokenEdges = [];
  const rescuedGroupsMap = new Map();

  /**
   * 剪枝决策写入激活摘要（仅 --explain 时存在 trace，其余情况零成本）
   * @param {string} name 被淘汰的策略组名称
   * @param {string} code 原因码：unreachable | post-cycle
   * @param {Array<string>} [lostProxies] 剪枝前的成员快照（供追溯「为什么它没生效」）
   */
  function recordPrunedGroup(name, code, lostProxies = []) {
    if (!trace) return;
    const lost = Array.isArray(lostProxies) ? lostProxies.filter(Boolean) : [];
    const memberText = lost.length > 0 ? `（原成员: ${lost.join(', ')}）` : '（无成员）';
    trace.add({
      kind: 'group',
      id: name,
      status: 'pruned',
      code,
      detail: code === 'unreachable'
        ? `无路径抵达真实节点或拦截目标${memberText}`
        : `破环后失去唯一通路${memberText}`
    });
  }

  /**
   * 豁免组保活复苏辅助函数 (DRY & 可追溯性)
   * 清理失效节点引用（防内核崩溃），并记录兜底前丢失的原成员供审计调试
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
        logger.warn(`🛡️ 骨架组 [${name}] 无可用节点，已注入 DIRECT 兜底保活${lostInfo}`);
      }
      if (trace) {
        trace.add({
          kind: 'group',
          id: name,
          status: 'active',
          code: 'rescue-direct',
          members: 1,
          detail: lost.length > 0
            ? `骨架组无可用节点，已注入 DIRECT 兜底（原成员: ${lost.join(', ')}）`
            : '骨架组无可用节点，已注入 DIRECT 兜底'
        });
      }
    }
    group.proxies = ['DIRECT'];
  }

  /**
   * 自底向上生产性可达集合推导 (Sink-to-Source Reverse Reachability)
   * 仅以真实物理节点或控制拦截终点（REJECT/GLOBAL）作为有效汇点反向染色。
   * 若普通非豁免组最终只能到达 DIRECT，说明无可用代理节点，按规则予以剪枝淘汰。
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

  // 阶段 1：豁免组保活与第一轮可达性收敛
  // 1.1 先行推导当前可达性
  const reachable = computeReachableGroups(groupMap);

  // 1.2 保护豁免组：若骨架组无法通过自身路径抵达任何生产性汇点，强制注入 DIRECT 保证自持
  for (const [name, group] of groupMap.entries()) {
    if (isExempt(name) && !reachable.has(name)) {
      rescueExemptGroup(name, group);
    }
  }

  // 1.3 豁免组保活后，普通组若无法通达生产性汇点（即使包含 DIRECT），视为空组予以剪枝淘汰
  for (const name of Array.from(groupMap.keys())) {
    if (!reachable.has(name)) {
      if (!isExempt(name)) {
        recordPrunedGroup(name, 'unreachable', initialProxiesMap.get(name) || []);
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
        if (trace) {
          trace.add({
            kind: 'group',
            id: nodeName,
            status: 'pruned',
            code: 'cycle',
            detail: `剪断循环依赖 ${nodeName} ➔ ${target}`
          });
        }
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
  const postReachable = computeReachableGroups(groupMap);

  for (const name of Array.from(groupMap.keys())) {
    const group = groupMap.get(name);
    const hasExit = postReachable.has(name) && group.proxies.length > 0;
    if (!hasExit) {
      if (!isExempt(name)) {
        recordPrunedGroup(name, 'post-cycle', initialProxiesMap.get(name) || []);
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

  // 3.1 终末收敛：清理存活组中指向已被剔除组的残余引用；骨架组若为空则注入 DIRECT 保活
  for (const group of groupMap.values()) {
    group.proxies = group.proxies.filter(target => isProductiveSink(target) || target === 'DIRECT' || groupMap.has(target));
    if (group.proxies.length === 0 && isExempt(group.name)) {
      rescueExemptGroup(group.name, group);
    }
  }

  // 阶段 4：规则与 Rule-Providers 级联注销
  //
  // 口径是「规则目标必须真实存在」，而不只是「目标组刚刚被淘汰」：
  // 隔离组（家宽 / 高倍率 / 实验）由开关决定是否生成，开关关闭、桶为空或被剪枝时，
  // 指向它们的规则会变成悬空引用（内核侧 proxy not found）。统一在这里拦截并汇总告警，
  // 这样用户把条目留在分流表里、只翻开关即可，不必逐条注释。
  let currentRules = Array.isArray(rules) ? [...rules] : [];
  const providers = { ...ruleProviders };

  if (currentRules.length > 0) {
    const knownTargets = new Set([...builtinTargets, ...physicalNodeNames, ...groupMap.keys()]);
    const orphanTargets = new Map();
    const expectedAbsent = new Map();
    currentRules = currentRules.filter(rule => {
      if (typeof rule !== 'string') return true;
      const target = ruleTargetOf(rule);
      if (!target) return true;
      if (knownTargets.has(target) || knownTargets.has(stripGroupDecoration(target))) return true;
      // 池依赖组的缺席是设计内状态（池为空 / 池未激活时不建组），按 debug 记录，不打扰用户
      if (targets.isPoolDependent(target)) {
        expectedAbsent.set(target, (expectedAbsent.get(target) || 0) + 1);
        return false;
      }
      orphanTargets.set(target, (orphanTargets.get(target) || 0) + 1);
      return false;
    });
    if (expectedAbsent.size > 0 && logger && typeof logger.debug === 'function') {
      const detail = [...expectedAbsent.entries()].map(([target, count]) => `「${target}」×${count}`).join('、');
      logger.debug(`🪣 节点池为空或未激活，依赖该池的规则按设计跳过：${detail}`);
    }
    const orphanCount = [...orphanTargets.values()].reduce((sum, n) => sum + n, 0);
    if (orphanCount > 0 && logger && typeof logger.warn === 'function') {
      const detail = [...orphanTargets.entries()].map(([target, count]) => `「${target}」×${count}`).join('、');
      logger.warn(`⚠️ 规则目标不存在，已跳过 ${orphanCount} 条分流规则：${detail}`);
    }
    // 被跳过的规则按目标聚合写入摘要：日志里只有一句汇总，排查时需要知道「哪些目标、各几条」
    if (trace) {
      for (const [target, count] of expectedAbsent) {
        trace.add({
          kind: 'rule',
          id: target,
          status: 'skipped',
          code: 'pool-dependent',
          detail: `${count} 条规则指向该池依赖组（池为空或未激活）`
        });
      }
      for (const [target, count] of orphanTargets) {
        trace.add({
          kind: 'rule',
          id: target,
          status: 'skipped',
          code: 'orphan-target',
          detail: `${count} 条规则的目标组不存在`
        });
      }
    }
  }

  // 清理孤儿 Rule Providers：
  // 尊重用户声明，用户显式声明的 customRuleProviders 受保护，不作为孤儿规则集清理
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
        if (trace) {
          trace.add({
            kind: 'provider',
            id: key,
            status: 'pruned',
            code: 'unused',
            detail: '未被任何规则引用，且非用户显式声明'
          });
        }
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
