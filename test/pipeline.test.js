const test = require('node:test');
const assert = require('node:assert/strict');

const { runNodesPipeline } = require('../src/pipeline/nodes');
const { runConfigPipeline } = require('../src/pipeline/config');
const { runStrategyPipeline } = require('../src/pipeline/strategy');
const { buildAuditReport } = require('../src/pipeline/report');

test('🚀 流水线单元测试 - runNodesPipeline 纯节点清洗与去重', async () => {
  const proxies = [
    { name: '🇭🇰 香港 01 BGP', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'u1' },
    { name: '防失联官网：http://test.com', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'u2' }, // 广告 -> 被剔除
    { name: '🇭🇰 香港 01 BGP', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'u1' } // 重复 -> 去重
  ];

  const cleaned = await runNodesPipeline(proxies, { enableDedupe: true, removeInfoNodes: true });
  assert.equal(cleaned.length, 1);
  assert.ok(cleaned[0].name.includes('香港'));
});

test('🚀 流水线单元测试 - runStrategyPipeline 策略组拓扑与分流规则', () => {
  const config = {
    proxies: [
      { name: '🇭🇰 香港 01 BGP', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'u1' },
      { name: '🇯🇵 日本 01 IPLC', server: '1.2.3.5', port: 443, type: 'vless', uuid: 'u2' }
    ]
  };

  const finalConfig = runStrategyPipeline(config);
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
});

test('🚀 流水线单元测试 - buildAuditReport 结构化审计生成', () => {
  const meta = {
    stats: {
      total: 10,
      outputCount: 8,
      dedupeCount: 1,
      discardedCount: 1,
      infoCount: 0,
      unknownCount: 0,
      fissionCount: 2
    }
  };

  const report = buildAuditReport(meta, []);
  assert.equal(report.service, 'mihomo-toolkit');
  assert.equal(report.summary.totalInput, 10);
  assert.equal(report.summary.cleanOutput, 8);
  assert.equal(report.summary.fissionCreated, 2);
});

test('🚀 流水线单元测试 - runConfigPipeline 支持 sourceSkeleton 入参', () => {
  const skeleton = {
    proxies: [{ name: 'Test', type: 'ss', server: '1.1.1.1', port: 8388, cipher: 'aes-128-gcm', password: 'pwd' }]
  };
  const { outputData } = runConfigPipeline({
    sourceSkeleton: skeleton,
    cleanProxies: skeleton.proxies,
    userConfig: { enablePipeline: false }
  });
  assert.ok(Array.isArray(outputData.proxies));
});

test('🚀 交付形态解析 - normalizeOutputMode 仅做小写归一化（不接受别名）', () => {
  const { normalizeOutputMode } = require('../src/pipeline/engine');
  assert.equal(normalizeOutputMode('config'), 'config');
  assert.equal(normalizeOutputMode('nodes'), 'nodes');
  assert.equal(normalizeOutputMode('report'), 'report');
  assert.equal(normalizeOutputMode('NODES'), 'nodes');
  assert.equal(normalizeOutputMode(), 'config');
});

test('🚀 流水线单元测试 - nodeIpVersion 批量注入节点 IP 栈偏好策略', async () => {
  const sampleProxies = () => [
    { name: '🇭🇰 香港 01', server: 'hk.example.com', port: 443, type: 'vless', uuid: 'u1' },
    { name: '🇺🇸 美国 01', server: 'us.example.com', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p1' }
  ];

  // 1. 默认配置（缺省/空串）不注入 ip-version
  const defCleaned = await runNodesPipeline(sampleProxies(), {});
  assert.equal(defCleaned[0]['ip-version'], undefined);
  assert.equal(defCleaned[1]['ip-version'], undefined);

  // 2. 注入 dual（双栈并发 Happy Eyeballs）
  const dualCleaned = await runNodesPipeline(sampleProxies(), { nodeIpVersion: 'dual' });
  assert.equal(dualCleaned[0]['ip-version'], 'dual');
  assert.equal(dualCleaned[1]['ip-version'], 'dual');

  // 3. 注入 ipv6-prefer，且支持大小写归一化
  const v6Cleaned = await runNodesPipeline(sampleProxies(), { nodeIpVersion: 'IPv6-Prefer' });
  assert.equal(v6Cleaned[0]['ip-version'], 'ipv6-prefer');

  // 4. 非法值不注入
  const invalidCleaned = await runNodesPipeline(sampleProxies(), { nodeIpVersion: 'invalid-stack' });
  assert.equal(invalidCleaned[0]['ip-version'], undefined);
});
