const test = require('node:test');
const assert = require('node:assert/strict');

const { pruneEmptyGroups } = require('../src/strategy/prune');

test('🧩 策略模块单元测试 - DAG 级联空组清理与规则殉葬', () => {
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
    'RULE-SET,parent-rule,ParentGroup',
    'RULE-SET,base-rule,🚀 基础代理',
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
});
