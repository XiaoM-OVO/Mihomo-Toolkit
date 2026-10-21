const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pruneEmptyGroups } = require('../../src/strategy/prune');

/**
 * 拓扑无环性验证器 (Kahn's Algorithm)
 * 验证最终产物严格为 DAG（无任何有向环），且每个策略组的子引用必须真实存在
 */
function assertIsDAG(proxyGroups, proxies = []) {
  const groupNames = new Set(proxyGroups.map(g => g.name));
  const validBasics = new Set([
    'DIRECT', 'REJECT', 'REJECT-DROP', 'COMPATIBLE', 'PASS', 'GLOBAL',
    ...proxies.map(p => p.name)
  ]);

  for (const group of proxyGroups) {
    assert.ok(Array.isArray(group.proxies) && group.proxies.length > 0, `策略组 ${group.name} 不能为空`);
    for (const target of group.proxies) {
      assert.ok(
        validBasics.has(target) || groupNames.has(target),
        `策略组 ${group.name} 的目标 ${target} 既非基础汇点也非存活组`
      );
    }
  }

  const inDegree = new Map();
  const adj = new Map();
  for (const name of groupNames) {
    inDegree.set(name, 0);
    adj.set(name, []);
  }

  for (const group of proxyGroups) {
    for (const target of group.proxies) {
      if (groupNames.has(target)) {
        adj.get(group.name).push(target);
        inDegree.set(target, inDegree.get(target) + 1);
      }
    }
  }

  const queue = [];
  for (const [name, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(name);
  }

  let head = 0;
  let visitedCount = 0;
  while (head < queue.length) {
    const u = queue[head++];
    visitedCount++;
    for (const v of adj.get(u)) {
      inDegree.set(v, inDegree.get(v) - 1);
      if (inDegree.get(v) === 0) {
        queue.push(v);
      }
    }
  }

  assert.equal(visitedCount, groupNames.size, '策略组图必须为严格 DAG (零环路)');
}

describe('【Pipeline】DAG 级联空组剪枝与级联清理 (strategy-prune)', () => {
  it('pruneEmptyGroups - DAG 级联空组清理、骨架组保活与孤儿规则提供者清理', () => {
    const proxyGroups = [
      { name: '🚀 基础代理', proxies: ['Node1'] },
      { name: 'ChildGroup', proxies: ['GhostNode'] }, // GhostNode 不存在 -> ChildGroup 变空
      { name: 'ParentGroup', proxies: ['ChildGroup'] }, // ChildGroup 变空 -> ParentGroup 级联变空
      { name: '📍 手动选择', proxies: ['GhostNode'] }   // 骨架组变空 -> 强行补 DIRECT
    ];
    const proxies = [
      { name: 'Node1', server: '1.2.3.4', port: 443 }
    ];
    const rules = [
      'RULE-SET, parent-rule , ParentGroup',
      'RULE-SET, base-rule, 🚀 基础代理',
      'GEOIP,CN,DIRECT'
    ];
    const ruleProviders = {
      'parent-rule': { type: 'http', url: 'https://example.com/parent.yaml' },
      'base-rule': { type: 'http', url: 'https://example.com/base.yaml' }
    };

    const result = pruneEmptyGroups({
      proxyGroups,
      proxies,
      rules,
      ruleProviders
    });

    const groupNames = result.proxyGroups.map(g => g.name);
    assert.ok(groupNames.includes('🚀 基础代理'));
    assert.ok(groupNames.includes('📍 手动选择'));
    assert.ok(!groupNames.includes('ChildGroup'));
    assert.ok(!groupNames.includes('ParentGroup'));

    // 骨架组保留并被 DIRECT 复苏
    const manualGroup = result.proxyGroups.find(g => g.name === '📍 手动选择');
    assert.deepEqual(manualGroup.proxies, ['DIRECT']);

    // 级联删除的组，其分流规则也被移除
    assert.equal(result.rules.length, 2);
    assert.ok(!result.rules.some(r => r.includes('ParentGroup')));

    // 孤儿 Rule-Provider 被清理
    assert.ok(!result.ruleProviders['parent-rule']);
    assert.ok(result.ruleProviders['base-rule']);

    assertIsDAG(result.proxyGroups, proxies);
  });

  it('pruneEmptyGroups - 规则目标必须真实存在：悬空目标整条跳过并汇总告警', () => {
    const warnings = [];
    const proxyGroups = [{ name: '🚀 基础代理', proxies: ['Node1'] }];
    const proxies = [{ name: 'Node1', server: '1.2.3.4', port: 443 }];
    const rules = [
      'DOMAIN-SUFFIX,keep.example,🚀 基础代理',
      'DOMAIN-SUFFIX,ghost.example,🧪 实验节点', // 隔离组开关关闭 -> 组不存在
      'DOMAIN-SUFFIX,node.example,Node1', // 直接指向物理节点，合法
      'MATCH,DIRECT'
    ];

    const result = pruneEmptyGroups({
      proxyGroups,
      proxies,
      rules,
      logger: { warn: msg => warnings.push(msg), debug: () => {} }
    });

    assert.deepEqual(result.rules, [
      'DOMAIN-SUFFIX,keep.example,🚀 基础代理',
      'DOMAIN-SUFFIX,node.example,Node1',
      'MATCH,DIRECT'
    ]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /已跳过 1 条分流规则/);
    assert.match(warnings[0], /🧪 实验节点/);
  });

  it('pruneEmptyGroups - 池依赖组缺席按设计跳过：不刷悬空引用告警', () => {
    const warnings = [];
    const debugs = [];
    const proxyGroups = [{ name: '🚀 基础代理', proxies: ['Node1'] }];
    const proxies = [{ name: 'Node1', server: '1.2.3.4', port: 443 }];
    const rules = [
      'DOMAIN-SUFFIX,keep.example,🚀 基础代理',
      'RULE-SET,download-games,⏬ 下载策略', // 低倍率池为空 -> 下载组不建，按设计跳过
      'DOMAIN-SUFFIX,ghost.example,🧪 实验节点', // 真悬空 -> 必须告警
      'MATCH,DIRECT'
    ];

    const result = pruneEmptyGroups({
      proxyGroups,
      proxies,
      rules,
      logger: { warn: msg => warnings.push(msg), debug: msg => debugs.push(msg) }
    });

    assert.deepEqual(result.rules, ['DOMAIN-SUFFIX,keep.example,🚀 基础代理', 'MATCH,DIRECT']);
    assert.equal(warnings.length, 1, '只有真悬空目标告警');
    assert.match(warnings[0], /已跳过 1 条分流规则/);
    assert.match(warnings[0], /🧪 实验节点/);
    assert.ok(!warnings.some(msg => msg.includes('下载策略')), '池依赖组不得进告警');
    assert.ok(debugs.some(msg => msg.includes('下载策略')), '池依赖组只记 debug');
  });

  it('pruneEmptyGroups - 内置目标 GLOBAL 作为有效代理目标不被剪枝', () => {
    const proxyGroups = [
      { name: 'MyGlobalProxy', proxies: ['GLOBAL'] }
    ];
    const result = pruneEmptyGroups({ proxyGroups });
    assert.equal(result.proxyGroups.length, 1);
    assert.deepEqual(result.proxyGroups[0].proxies, ['GLOBAL']);
    assertIsDAG(result.proxyGroups);
  });

  it('pruneEmptyGroups - 消除两节点无根死循环 (A -> B, B -> A) 且级联清理规则', () => {
    const proxyGroups = [
      { name: 'GroupA', proxies: ['GroupB'] },
      { name: 'GroupB', proxies: ['GroupA'] },
      { name: 'SurvivorGroup', proxies: ['Node1'] }
    ];
    const proxies = [{ name: 'Node1' }];
    const rules = [
      'MATCH,GroupA',
      'DOMAIN-SUFFIX,google.com,GroupB',
      'DOMAIN-KEYWORD,survivor,SurvivorGroup'
    ];

    const result = pruneEmptyGroups({ proxyGroups, proxies, rules });
    const remainingNames = result.proxyGroups.map(g => g.name);

    assert.deepEqual(remainingNames, ['SurvivorGroup']);
    assert.ok(result.removedGroups.has('GroupA'));
    assert.ok(result.removedGroups.has('GroupB'));

    // 规则同步清理
    assert.equal(result.rules.length, 1);
    assert.ok(result.rules[0].includes('SurvivorGroup'));

    assertIsDAG(result.proxyGroups, proxies);
  });

  it('pruneEmptyGroups - 消除多节点长环无根死循环 (A -> B -> C -> A)', () => {
    const proxyGroups = [
      { name: 'A', proxies: ['B'] },
      { name: 'B', proxies: ['C'] },
      { name: 'C', proxies: ['A'] }
    ];
    const result = pruneEmptyGroups({ proxyGroups });

    assert.equal(result.proxyGroups.length, 0);
    assert.ok(result.removedGroups.has('A'));
    assert.ok(result.removedGroups.has('B'));
    assert.ok(result.removedGroups.has('C'));
    assertIsDAG(result.proxyGroups);
  });

  it('pruneEmptyGroups - 过滤自环目标 (A -> A) 并防止递归溢出', () => {
    const proxyGroups = [
      { name: 'SelfLoopEmpty', proxies: ['SelfLoopEmpty'] },
      { name: 'SelfLoopValid', proxies: ['SelfLoopValid', 'RealNode'] }
    ];
    const proxies = [{ name: 'RealNode' }];

    const result = pruneEmptyGroups({ proxyGroups, proxies });
    const remainingNames = result.proxyGroups.map(g => g.name);

    assert.deepEqual(remainingNames, ['SelfLoopValid']);
    assert.deepEqual(result.proxyGroups[0].proxies, ['RealNode']);
    assert.ok(result.removedGroups.has('SelfLoopEmpty'));
    assertIsDAG(result.proxyGroups, proxies);
  });

  it('pruneEmptyGroups - 确定性 DFS 剪断恶性回边并记录 brokenEdges (A -> [Node1, B], B -> [A])', () => {
    // GroupA 拥有真实叶子 Node1，且引用 GroupB；GroupB 仅引用 GroupA（形成回边）
    const proxyGroups = [
      { name: 'GroupA', proxies: ['Node1', 'GroupB'] },
      { name: 'GroupB', proxies: ['GroupA'] }
    ];
    const proxies = [{ name: 'Node1' }];

    const result = pruneEmptyGroups({ proxyGroups, proxies });

    // 应当剪断回边，并记录到 brokenEdges
    assert.ok(result.brokenEdges.length >= 1);
    assert.ok(result.brokenEdges.some(e => e.from === 'GroupB' && e.to === 'GroupA'));

    // 破环后 GroupB 失去所有出口变空 -> 二次收敛将其级联剪枝淘汰
    const remainingNames = result.proxyGroups.map(g => g.name);
    assert.deepEqual(remainingNames, ['GroupA']);
    assert.deepEqual(result.proxyGroups[0].proxies, ['Node1']);
    assert.ok(result.removedGroups.has('GroupB'));

    assertIsDAG(result.proxyGroups, proxies);
  });

  it('pruneEmptyGroups - 双方均有真实物理叶子的交叉依赖成功破环且双方均保留', () => {
    // GroupA 拥有 Node1，GroupB 拥有 Node2，但两组互相交叉引用对方
    const proxyGroups = [
      { name: 'GroupA', proxies: ['Node1', 'GroupB'] },
      { name: 'GroupB', proxies: ['Node2', 'GroupA'] }
    ];
    const proxies = [{ name: 'Node1' }, { name: 'Node2' }];

    const result = pruneEmptyGroups({ proxyGroups, proxies });

    // 回边被剪断并记录
    assert.equal(result.brokenEdges.length, 1);
    assert.deepEqual(result.brokenEdges[0], { from: 'GroupB', to: 'GroupA' });

    // 双方均有真实节点因而均保留，且图转换为严格 DAG
    const remainingNames = result.proxyGroups.map(g => g.name);
    assert.deepEqual(remainingNames, ['GroupA', 'GroupB']);

    const groupA = result.proxyGroups.find(g => g.name === 'GroupA');
    const groupB = result.proxyGroups.find(g => g.name === 'GroupB');
    assert.deepEqual(groupA.proxies, ['Node1', 'GroupB']);
    assert.deepEqual(groupB.proxies, ['Node2']); // 回边 GroupB -> GroupA 被剔除

    assertIsDAG(result.proxyGroups, proxies);
  });

  it('pruneEmptyGroups - 输入顺序扰动不变性 (Permutation Invariance)', () => {
    const proxies = [{ name: 'Node1' }, { name: 'Node2' }];

    const order1 = [
      { name: 'GroupA', proxies: ['Node1', 'GroupB'] },
      { name: 'GroupB', proxies: ['Node2', 'GroupA'] }
    ];

    const order2 = [
      { name: 'GroupB', proxies: ['Node2', 'GroupA'] },
      { name: 'GroupA', proxies: ['Node1', 'GroupB'] }
    ];

    const res1 = pruneEmptyGroups({ proxyGroups: order1, proxies });
    const res2 = pruneEmptyGroups({ proxyGroups: order2, proxies });

    // 存活组集合必须严格一致
    const names1 = new Set(res1.proxyGroups.map(g => g.name));
    const names2 = new Set(res2.proxyGroups.map(g => g.name));
    assert.deepEqual(names1, names2);

    // 淘汰组必须严格一致
    assert.deepEqual(res1.removedGroups, res2.removedGroups);

    // 破环记录必须严格一致
    assert.deepEqual(res1.brokenEdges, res2.brokenEdges);

    assertIsDAG(res1.proxyGroups, proxies);
    assertIsDAG(res2.proxyGroups, proxies);
  });

  it('pruneEmptyGroups - 重名策略组抛出明确诊断错误 (拒绝静默覆盖)', () => {
    const proxyGroups = [
      { name: 'DuplicateGroup', proxies: ['Node1'] },
      { name: 'DuplicateGroup', proxies: ['Node2'] }
    ];
    const proxies = [{ name: 'Node1' }, { name: 'Node2' }];

    assert.throws(
      () => pruneEmptyGroups({ proxyGroups, proxies }),
      /\[Prune\] 重复定义的策略组名称: "DuplicateGroup"/
    );
  });

  it('pruneEmptyGroups - 策略组与物理代理同名抛出明确诊断错误 (严格消歧)', () => {
    const proxies = [{ name: 'ConflictName' }];
    const proxyGroups = [
      { name: 'ConflictName', proxies: ['DIRECT'] }
    ];

    assert.throws(
      () => pruneEmptyGroups({ proxyGroups, proxies }),
      /\[Prune\] 命名冲突: 策略组 "ConflictName" 与物理代理节点重名/
    );
  });

  it('pruneEmptyGroups - 策略组使用内核保留内置目标名称抛出明确诊断错误', () => {
    const proxyGroups = [
      { name: 'DIRECT', proxies: ['Node1'] }
    ];
    const proxies = [{ name: 'Node1' }];

    assert.throws(
      () => pruneEmptyGroups({ proxyGroups, proxies }),
      /\[Prune\] 命名冲突: 策略组 "DIRECT" 不得使用内核保留内置目标名称/
    );
  });

  it('pruneEmptyGroups - 复杂多层菱形继承与环路综合拓扑 DAG 验证', () => {
    const proxies = [{ name: 'Physical-1' }];
    const proxyGroups = [
      { name: 'Root', proxies: ['BranchA', 'BranchB'] },
      { name: 'BranchA', proxies: ['LeafA', 'BranchB'] }, // 菱形与横向依赖
      { name: 'BranchB', proxies: ['LeafB'] },
      { name: 'LeafA', proxies: ['Physical-1', 'CycleDeadEnd'] },
      { name: 'LeafB', proxies: ['Physical-1'] },
      { name: 'CycleDeadEnd', proxies: ['CycleDeadEndPeer'] }, // 死环链
      { name: 'CycleDeadEndPeer', proxies: ['CycleDeadEnd'] },
      { name: 'BackCycle', proxies: ['Root', 'BranchA'] }     // 倒挂回边
    ];

    const result = pruneEmptyGroups({ proxyGroups, proxies });
    const remainingNames = new Set(result.proxyGroups.map(g => g.name));

    // 死环链必须被清理
    assert.ok(!remainingNames.has('CycleDeadEnd'));
    assert.ok(!remainingNames.has('CycleDeadEndPeer'));

    // 主干必须完好保留
    assert.ok(remainingNames.has('Root'));
    assert.ok(remainingNames.has('BranchA'));
    assert.ok(remainingNames.has('BranchB'));
    assert.ok(remainingNames.has('LeafA'));
    assert.ok(remainingNames.has('LeafB'));

    // 全局产物严格符合 DAG
    assertIsDAG(result.proxyGroups, proxies);
  });

  it('pruneEmptyGroups - 豁免组兜底保活追溯性记录 (rescuedGroups 准确记录 lostProxies)', () => {
    const proxyGroups = [
      { name: '📍 手动选择', proxies: ['🇭🇰 香港节点', '🇯🇵 日本节点'] }
    ];
    // 物理节点中没有香港和日本节点 -> 骨架组变空触发保活
    const result = pruneEmptyGroups({ proxyGroups, proxies: [] });

    assert.equal(result.proxyGroups.length, 1);
    assert.deepEqual(result.proxyGroups[0].proxies, ['DIRECT']); // 运行时只输出安全 DIRECT

    // rescuedGroups 记录兜底保活前丢失的原成员
    assert.equal(result.rescuedGroups.length, 1);
    assert.equal(result.rescuedGroups[0].name, '📍 手动选择');
    assert.deepEqual(result.rescuedGroups[0].lostProxies, ['🇭🇰 香港节点', '🇯🇵 日本节点']);
    assert.deepEqual(result.rescuedGroups[0].fallback, ['DIRECT']);
  });

  it('pruneEmptyGroups - 保护用户显式声明的 customRuleProviders 不被作为孤儿误删', () => {
    const proxyGroups = [{ name: 'Group1', proxies: ['Node1', 'DIRECT'] }];
    const proxies = [{ name: 'Node1' }];
    const rules = ['RULE-SET,auto-rule,Group1'];
    const ruleProviders = {
      'auto-rule': { type: 'http' },
      'orphan-auto': { type: 'http' },
      'my-custom-provider': { type: 'http', url: 'https://example.com/custom.yaml' }
    };
    const userConfig = {
      customRuleProviders: {
        'my-custom-provider': { type: 'http', url: 'https://example.com/custom.yaml' }
      }
    };

    const result = pruneEmptyGroups({
      proxyGroups,
      proxies,
      rules,
      ruleProviders,
      userConfig
    });

    // auto-rule 正在被规则使用，保留
    assert.ok(result.ruleProviders['auto-rule']);
    // orphan-auto 未被规则使用且非用户显式声明，被清理
    assert.ok(!result.ruleProviders['orphan-auto']);
    // my-custom-provider 虽然未被任何规则引用，但是用户显式声明的，予以保留！
    assert.ok(result.ruleProviders['my-custom-provider']);
  });

  it('pruneEmptyGroups - 非豁免普通应用组仅含 DIRECT 时被剪枝淘汰 (避免空组残留)', () => {
    const proxyGroups = [
      { name: '📍 手动选择', proxies: ['DIRECT'] },                         // 骨架豁免组
      { name: '🤖 ChatGPT', proxies: ['📍 手动选择', 'DIRECT'] },             // 普通应用组，无真实物理代理
      { name: '▶️ YouTube', proxies: ['DIRECT'] },                          // 普通应用组，无真实物理代理
      { name: '🚫 广告拦截', proxies: ['REJECT-DROP', 'REJECT', 'DIRECT'] }, // 安全拦截组，具备生产性动作
      { name: '🐟 漏网之鱼', proxies: ['📍 手动选择', 'DIRECT'] }              // 骨架豁免组
    ];
    // 物理代理为空 proxies: []
    const rules = [
      'RULE-SET,chatgpt,🤖 ChatGPT',
      'RULE-SET,youtube,▶️ YouTube',
      'RULE-SET,adblock,🚫 广告拦截',
      'MATCH,🐟 漏网之鱼'
    ];

    const result = pruneEmptyGroups({
      proxyGroups,
      proxies: [],
      rules
    });

    const survivingNames = result.proxyGroups.map(g => g.name);

    // 骨架组与拦截组保留
    assert.ok(survivingNames.includes('📍 手动选择'));
    assert.ok(survivingNames.includes('🐟 漏网之鱼'));
    assert.ok(survivingNames.includes('🚫 广告拦截'));

    // 无真实节点、只通向 DIRECT 的纯占位应用组被淘汰
    assert.ok(!survivingNames.includes('🤖 ChatGPT'));
    assert.ok(!survivingNames.includes('▶️ YouTube'));

    // 对应规则随之注销清理
    assert.ok(!result.rules.some(r => r.includes('🤖 ChatGPT')));
    assert.ok(!result.rules.some(r => r.includes('▶️ YouTube')));
    assert.ok(result.rules.some(r => r.includes('🚫 广告拦截')));
    assert.ok(result.rules.some(r => r.includes('🐟 漏网之鱼')));

    assertIsDAG(result.proxyGroups, []);
  });
});
