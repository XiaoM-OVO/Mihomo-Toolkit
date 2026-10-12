'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applyRenamePlan } = require('../../src/core/rename');
const { runNodesPipeline } = require('../../src/pipeline/nodes');
const { runStrategyPipeline } = require('../../src/pipeline/strategy');

function item(name, tier, extra = {}) {
  const proxy = { name, type: 'ss', server: 'test.example.com', port: 443, cipher: 'aes-128-gcm', password: 'p' };
  return { proxy, rawName: name, ...extra, _tier: tier };
}

describe('【Pipeline】命名计划与节点身份闭环 (rename-closure)', () => {
  it('同级先认领所有原目标名，重复项不得抢占原生 #2 目标', () => {
    const a = item('香港 01', 4);
    const b = item('香港 01', 4);
    const c = item('香港 01 #2', 4);
    applyRenamePlan([a, b, c], [a, b, c].map(x => ({ item: x, tier: x._tier, intendedName: x.proxy.name })));
    assert.deepEqual([a.proxy.name, b.proxy.name, c.proxy.name], ['香港 01', '香港 01 #3', '香港 01 #2']);
  });

  it('高优先级冲突先于低优先级名称仲裁', () => {
    const s1 = item('Pinned', 1);
    const s2 = item('Pinned', 1);
    const notice = item('Pinned #2', 2);
    const entries = [s1, s2, notice].map(x => ({ item: x, tier: x._tier, intendedName: x.proxy.name }));
    applyRenamePlan([s1, s2, notice], entries);
    assert.deepEqual([s1.proxy.name, s2.proxy.name, notice.proxy.name], ['Pinned', 'Pinned #2', 'Pinned #2 #2']);
  });

  it('同名 special 保留输入顺序优先，普通节点不能抢占 special 名称', () => {
    const normal = item('Pinned', 4);
    const special = item('Pinned', 1);
    applyRenamePlan([normal, special], [
      { item: normal, tier: 4, intendedName: 'Pinned' },
      { item: special, tier: 1, intendedName: 'Pinned' }
    ]);
    assert.equal(special.proxy.name, 'Pinned');
    assert.equal(normal.proxy.name, 'Pinned #2');
  });

  it('混合批次保留同进程已清洗节点名称，仍处理新节点并执行黑名单', async () => {
    const [cleaned] = await runNodesPipeline([
      { name: '🇭🇰 香港 01', type: 'ss', server: 'clean.example.com', port: 443, cipher: 'aes-128-gcm', password: 'p' }
    ], { enableNodeRename: false });
    const lockedName = cleaned.name;
    const skeleton = { proxies: [
      cleaned,
      { name: lockedName, type: 'ss', server: 'new.example.com', port: 443, cipher: 'aes-128-gcm', password: 'p' },
      { name: 'Blocked Hong Kong', type: 'ss', server: 'blocked.example.com', port: 443, cipher: 'aes-128-gcm', password: 'p', _cleaned: true }
    ] };
    const result = runStrategyPipeline(skeleton, { enableNodeRename: false, blockKeywords: ['Blocked'] });
    assert.equal(result.proxies.length, 2);
    assert.equal(result.proxies[0].name, lockedName);
    assert.equal(result.proxies[1].name, `${lockedName} #2`);
    assert.equal(result.proxies.some(p => p.name.includes('Blocked')), false);
  });

  it('重复运行节点清洗与策略构建保持最终名称稳定', async () => {
    const raw = [
      { name: '🇭🇰 香港 01 IEPL', type: 'ss', server: 'hk-a.example.com', port: 443, cipher: 'aes-128-gcm', password: 'p' },
      { name: '🇯🇵 日本 01', type: 'ss', server: 'jp-a.example.com', port: 443, cipher: 'aes-128-gcm', password: 'p' }
    ];
    const config = { enableNodeRename: true, renameTemplate: '{icon} {region} {index}', minorNodeThreshold: 1 };
    const firstNodes = await runNodesPipeline(raw, config);
    const firstNames = firstNodes.map(p => p.name);
    const secondNodes = await runNodesPipeline(firstNodes, config);
    assert.deepEqual(secondNodes.map(p => p.name), firstNames);

    const skeleton = { proxies: secondNodes };
    const firstBuild = runStrategyPipeline(skeleton, config);
    const firstSnapshot = JSON.stringify({ proxies: firstBuild.proxies, groups: firstBuild['proxy-groups'] });
    const secondBuild = runStrategyPipeline(firstBuild, config);
    assert.equal(JSON.stringify({ proxies: secondBuild.proxies, groups: secondBuild['proxy-groups'] }), firstSnapshot);
  });

  it('最终策略组引用都能解析到内核常量、存活策略组或代理节点', () => {
    const result = runStrategyPipeline({ proxies: [
      { name: '🇭🇰 香港 01', type: 'ss', server: 'hk-ref.example.com', port: 443, cipher: 'aes-128-gcm', password: 'p' },
      { name: '🇯🇵 日本 01', type: 'ss', server: 'jp-ref.example.com', port: 443, cipher: 'aes-128-gcm', password: 'p' }
    ] }, { enableNodeRename: false, minorNodeThreshold: 1 });
    const valid = new Set([
      'DIRECT', 'REJECT', 'REJECT-DROP', 'COMPATIBLE', 'PASS',
      ...result.proxies.map(p => p.name),
      ...result['proxy-groups'].map(g => g.name)
    ]);
    assert.equal(result.proxies.length, new Set(result.proxies.map(p => p.name)).size);
    for (const group of result['proxy-groups']) {
      assert.equal(group.proxies.length, new Set(group.proxies).size, `${group.name} 组内成员必须唯一`);
      for (const target of group.proxies) assert.ok(valid.has(target), `${group.name} 引用了悬空目标 ${target}`);
    }
  });

  it('重名冲突发生时，诊断日志准确输出冲突解决后的最终名称 (如 #2)', async () => {
    const raw = [
      { name: '🇭🇰 香港 A', type: 'ss', server: 'hk-a.example.com', port: 443, cipher: 'aes-128-gcm', password: 'p' },
      { name: '🇭🇰 香港 B', type: 'ss', server: 'hk-b.example.com', port: 443, cipher: 'aes-128-gcm', password: 'p' }
    ];
    const logs = [];
    const logger = {
      debug: msg => logs.push(msg)
    };
    const nodes = await runNodesPipeline(raw, {
      logger,
      enableNodeRename: true,
      renameTemplate: '{icon} {region}'
    });
    assert.equal(nodes[0].name, '🇭🇰 香港');
    assert.equal(nodes[1].name, '🇭🇰 香港 #2');
    assert.ok(logs.some(l => l.includes('「🇭🇰 香港 A」 → 「🇭🇰 香港」')), '日志应记录首个节点目标名称');
    assert.ok(logs.some(l => l.includes('「🇭🇰 香港 B」 → 「🇭🇰 香港 #2」')), '日志应准确记录发生碰撞仲裁后的 #2 目标名称');
  });
});
