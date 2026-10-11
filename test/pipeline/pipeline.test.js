const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runNodesPipeline } = require('../../src/pipeline/nodes');
const { runConfigPipeline } = require('../../src/pipeline/config');
const { runStrategyPipeline } = require('../../src/pipeline/strategy');
const { buildAuditReport } = require('../../src/pipeline/report');

describe('【Pipeline】核心流水线装配与交付形态 (pipeline)', () => {
  it('runNodesPipeline - 节点清洗与去重', async () => {
    const proxies = [
      { name: '🇭🇰 香港 01 BGP', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'u1' },
      { name: '防失联官网：http://test.com', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'u2' },
      { name: '🇭🇰 香港 01 BGP', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'u1' }
    ];

    const cleaned = await runNodesPipeline(proxies, { enableDedupe: true, removeInfoNodes: true });
    assert.equal(cleaned.length, 1);
    assert.ok(cleaned[0].name.includes('香港'));
  });

  it('runStrategyPipeline - 策略组拓扑与分流规则组装', () => {
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

  it('buildAuditReport - 结构化审计生成', () => {
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

  it('runConfigPipeline - 支持 sourceSkeleton 入参', () => {
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

  it('normalizeOutputMode - 仅做小写归一化 (不接受别名)', () => {
    const { normalizeOutputMode } = require('../../src/pipeline/engine');
    assert.equal(normalizeOutputMode('config'), 'config');
    assert.equal(normalizeOutputMode('nodes'), 'nodes');
    assert.equal(normalizeOutputMode('report'), 'report');
    assert.equal(normalizeOutputMode('NODES'), 'nodes');
    assert.equal(normalizeOutputMode(), 'config');
  });

  it('nodeIpVersion - 批量注入节点 IP 栈偏好策略 (dual / ipv6-prefer)', async () => {
    const sampleProxies = () => [
      { name: '🇭🇰 香港 01', server: 'hk.example.com', port: 443, type: 'vless', uuid: 'u1' },
      { name: '🇺🇸 美国 01', server: 'us.example.com', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p1' }
    ];

    // 1. 默认配置不注入
    const defCleaned = await runNodesPipeline(sampleProxies(), {});
    assert.equal(defCleaned[0]['ip-version'], undefined);
    assert.equal(defCleaned[1]['ip-version'], undefined);

    // 2. 注入 dual
    const dualCleaned = await runNodesPipeline(sampleProxies(), { nodeIpVersion: 'dual' });
    assert.equal(dualCleaned[0]['ip-version'], 'dual');
    assert.equal(dualCleaned[1]['ip-version'], 'dual');

    // 3. 注入 ipv6-prefer
    const v6Cleaned = await runNodesPipeline(sampleProxies(), { nodeIpVersion: 'IPv6-Prefer' });
    assert.equal(v6Cleaned[0]['ip-version'], 'ipv6-prefer');

    // 4. 非法值不注入
    const invalidCleaned = await runNodesPipeline(sampleProxies(), { nodeIpVersion: 'invalid-stack' });
    assert.equal(invalidCleaned[0]['ip-version'], undefined);
  });

  it('buildProfile - 订阅项 keepName 豁免假密码拦截并保留指定原名与 groups 注入', async () => {
    const { buildProfile } = require('../../src/pipeline/engine');
    const dummyUri = 'ss://YWVzLTEyOC1nY206cGFzc3dvcmQ=@my-host.com:443#Dummy';
    const cfg = {
      enableAI: true,
      subscriptions: [
        {
          uri: dummyUri,
          name: '🇯🇵 专线·我的直连节点',
          keepName: true,
          groups: ['🤖 ChatGPT', '我的独享专线']
        }
      ],
      minorNodeThreshold: 1
    };

    const res = await buildProfile(cfg, { mode: 'config', noCache: true });
    const proxies = res.outputData.proxies || [];
    const groups = res.outputData['proxy-groups'] || [];

    assert.equal(proxies.length, 1);
    assert.equal(proxies[0].name, '🇯🇵 专线·我的直连节点');
    assert.equal(proxies[0]._keepName, undefined);

    const gptGroup = groups.find(g => g.name.includes('ChatGPT'));
    assert.ok(gptGroup);
    assert.ok(gptGroup.proxies.includes('🇯🇵 专线·我的直连节点'));

    const customGroup = groups.find(g => g.name.includes('我的独享专线'));
    assert.ok(customGroup);
    assert.ok(customGroup.proxies.includes('🇯🇵 专线·我的直连节点'));
  });
});
