const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runCleanerPipeline,
  runProfilePipeline,
  runFullPipeline,
  runNodePipeline,
  runStrategyPipeline
} = require('../src/pipeline');

test('🚀 流水线单元测试 - runCleanerPipeline 节点清洗', async () => {
  const proxies = [
    { name: '🇭🇰 香港 01 BGP', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'u1' },
    { name: '防失联官网：http://test.com', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'u2' }, // 广告 -> 被剔除
    { name: '🇭🇰 香港 01 BGP', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'u1' } // 重复 -> 去重
  ];

  const cleaned = await runCleanerPipeline(proxies, { enableDedupe: true, removeInfoNodes: true });
  assert.equal(cleaned.length, 1);
  assert.ok(cleaned[0].name.includes('香港'));

  // 验证别名一致性
  const aliasCleaned = await runNodePipeline(proxies, { enableDedupe: true, removeInfoNodes: true });
  assert.equal(aliasCleaned.length, 1);
});

test('🚀 流水线单元测试 - runProfilePipeline 全流程配置构建', () => {
  const config = {
    proxies: [
      { name: '🇭🇰 香港 01 BGP', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'u1' },
      { name: '🇯🇵 日本 01 IPLC', server: '1.2.3.5', port: 443, type: 'vless', uuid: 'u2' }
    ]
  };

  const finalConfig = runProfilePipeline(config);
  assert.ok(finalConfig['proxy-groups']);
  assert.ok(finalConfig['rules']);
  assert.ok(finalConfig['rule-providers']);
  assert.ok(finalConfig['dns']);
  assert.ok(finalConfig['tun']);
  assert.ok(finalConfig['sniffer']);

  const groupNames = finalConfig['proxy-groups'].map(g => g.name);
  assert.ok(groupNames.includes('🚀 自动选择'));
  assert.ok(groupNames.includes('📍 手动选择'));
  assert.ok(groupNames.includes('🇭🇰 香港节点'));
  assert.ok(groupNames.includes('🇯🇵 日本节点'));

  // 验证别名一致性
  const aliasConfig = runStrategyPipeline(config);
  assert.equal(aliasConfig['proxy-groups'].length, finalConfig['proxy-groups'].length);
});
