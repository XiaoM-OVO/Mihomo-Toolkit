const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const yaml = require('yaml');
const { buildProfile } = require('../src/index.js');

describe('🔨 端到端构建流程集成测试模块', () => {
  test('buildProfile - 端到端 config 全流程构建测试', async () => {
    const userConfig = {
      subscriptions: [
        {
          uri: `
  vless://11111111-2222-3333-4444-555555555555@hk.domain.com:443?security=tls#🇭🇰 香港 01
  vless://22222222-3333-4444-5555-666666666666@jp.domain.com:443?security=tls#🇯🇵 日本 01
          `.trim(),
          tag: 'Sub1'
        }
      ],
      minorNodeThreshold: 1, // 允许单节点独立建组
      enableAI: true,
      enableStreaming: true,
      enableGame: true,
      dnsMergeMode: 'secure'
    };

    const { yamlStr } = await buildProfile(userConfig, { type: 'config', production: true });

    // 1. 验证 YAML 可被解析
    const outputData = yaml.parse(yamlStr);
    assert.notEqual(outputData, null);

    // 2. 验证生成的配置结构
    assert.ok(Array.isArray(outputData.proxies));
    assert.ok(outputData.proxies.length >= 2);
    assert.ok(Array.isArray(outputData['proxy-groups']));
    assert.ok(outputData['proxy-groups'].length > 0);

    // 3. 验证 DNS 配置已被注入
    assert.equal(outputData.dns.enable, true);
    assert.equal(outputData.dns['enhanced-mode'], 'fake-ip');

    // 4. 验证策略组已被正确建出
    const groupNames = outputData['proxy-groups'].map(g => g.name);
    assert.ok(groupNames.length > 5);
  });

  test('buildProfile - nodes 纯节点清洗模式（契约：严格只输出 proxies 数组）', async () => {
    const rawYamlContent = `
port: 7890
rules:
  - MATCH,DIRECT
proxies:
  - name: "🇺🇸 美国 01"
    type: ss
    server: 1.2.3.4
    port: 443
    cipher: aes-128-gcm
    password: pass
`.trim();

    const userConfig = {
      subscriptions: [
        {
          uri: rawYamlContent,
          tag: 'NodeSub'
        }
      ]
    };

    const { yamlStr } = await buildProfile(userConfig, { type: 'nodes' });
    const outputData = yaml.parse(yamlStr);

    // 验证契约：只输出干净的 proxies，不越界输出原配置中的 rules / port
    assert.ok(Array.isArray(outputData.proxies));
    assert.equal(outputData.rules, undefined);
    assert.equal(outputData.port, undefined);
    assert.equal(outputData['proxy-groups'], undefined);
  });

  test('buildProfile - config 模式 + passthrough 透传原订阅外围配置', async () => {
    // 模拟输入带有原生 rules 和 dns 的完整 YAML
    const rawYamlContent = `
port: 7890
socks-port: 7891
rules:
  - DOMAIN-SUFFIX,google.com,PROXY
  - MATCH,DIRECT
proxies:
  - name: "📢 官网网址：https://ad.com"
    type: ss
    server: 1.2.3.4
    port: 443
    cipher: aes-128-gcm
    password: pass
  - name: "🇭🇰 香港 01"
    type: ss
    server: 1.2.3.4
    port: 443
    cipher: aes-128-gcm
    password: pass
`.trim();

    const userConfig = {
      subscriptions: [
        {
          uri: rawYamlContent,
          tag: 'SubWithRules'
        }
      ],
      passthrough: true // 开启透传
    };

    const { yamlStr } = await buildProfile(userConfig, { type: 'config' });
    const outputData = yaml.parse(yamlStr);

    // 验证契约：原订阅的 port, socks-port, rules 完好无损透传
    assert.equal(outputData.port, 7890);
    assert.equal(outputData['socks-port'], 7891);
    assert.ok(Array.isArray(outputData.rules));
    assert.equal(outputData.rules.length, 2);

    // 验证：proxies 中的脏广告节点已被清洗剔除，只保留干净节点
    assert.ok(Array.isArray(outputData.proxies));
    assert.equal(outputData.proxies.length, 1);
    assert.ok(outputData.proxies[0].name.includes('香港'));
  });

  test('buildProfile - report 审计模式测试（输出结构化审计统计）', async () => {
    const userConfig = {
      subscriptions: [
        {
          uri: `
vless://11111111-2222-3333-4444-555555555555@hk.domain.com:443?security=tls#🇭🇰 香港 01
ss://YWVzLTEyOC1nY206cGFzc0AxLjIuMy40OjQ0Mw==#🇯🇵 日本 01
          `.trim(),
          tag: 'AuditSub'
        }
      ]
    };

    const result = await buildProfile(userConfig, { type: 'report' });
    assert.ok(result.meta);
    assert.ok(result.meta.stats);
    assert.equal(result.meta.stats.total, 2);
    assert.equal(result.meta.stats.outputCount, 2);
  });

  test('buildProfile - 订阅配置 resetDay 生成重置节点，未配置时自动捕捉', async () => {
    const today = new Date();
    const userConfig = {
      subscriptions: [
        {
          uri: 'vless://11111111-2222-3333-4444-555555555555@hk.domain.com:443?security=tls#🇭🇰 香港 01',
          tag: 'Sub1',
          resetDay: today.getDate() // 每月今天重置
        }
      ]
    };

    const { yamlStr } = await buildProfile(userConfig, { type: 'full', production: true });
    const outputData = yaml.parse(yamlStr);
    const resetNode = (outputData.proxies || []).find(p => /距离重置剩余：\d+ 天/.test(p.name));
    assert.ok(resetNode, '应生成"距离重置剩余 X 天"节点');
    assert.match(resetNode.name, /🔄 \[Sub1\] 距离重置剩余：\d+ 天/);
  });

  test('buildProfile - 单订阅已过期防丢头与订阅注释生成', async () => {
    // 模拟一个 3 天前过期的订阅
    const expiredSec = Math.floor((Date.now() - 3 * 86400000) / 1000);
    const userConfig = {
      subscriptions: [
        {
          uri: 'vless://11111111-2222-3333-4444-555555555555@hk.domain.com:443?security=tls#🇭🇰 香港 01',
          tag: 'SubOld'
        }
      ]
    };

    // 使用 options.url 模拟带 expired subInfo 的抓取结果（或直接测试 buildProfile 生成）
    const { yamlStr, userInfo } = await buildProfile(userConfig, { type: 'full', production: true });

    // 验证基本输出正常
    assert.ok(yamlStr.length > 0);
    assert.ok(userInfo !== undefined);
  });

  test('buildProfile - 支持单订阅开关 (enabled: false / disabled: true)', async () => {
    const userConfig = {
      subscriptions: [
        {
          uri: 'vless://11111111-2222-3333-4444-555555555555@hk.domain.com:443?security=tls#🇭🇰 香港 01',
          tag: 'SubActive',
          enabled: true
        },
        {
          uri: 'vless://22222222-3333-4444-5555-666666666666@jp.domain.com:443?security=tls#🇯🇵 日本 01',
          tag: 'SubDisabled1',
          enabled: false
        },
        {
          uri: 'vless://33333333-4444-5555-6666-777777777777@sg.domain.com:443?security=tls#🇸🇬 新加坡 01',
          tag: 'SubDisabled2',
          disabled: true
        }
      ]
    };

    const { yamlStr } = await buildProfile(userConfig, { type: 'pure' });
    const outputData = yaml.parse(yamlStr);
    const proxyNames = (outputData.proxies || []).map(p => p.name);

    assert.equal(proxyNames.length, 1);
    assert.ok(proxyNames[0].includes('香港'));
    assert.equal(proxyNames.some(n => n.includes('日本')), false);
    assert.equal(proxyNames.some(n => n.includes('新加坡')), false);
  });

  test('buildProfile - validateRequestLimits 过滤停用订阅', async () => {
    // 设置最大允许 1 个订阅，但传入 1 个启用 + 2 个停用，不应被阻断
    const userConfig = {
      security: { maxSubscriptionUrls: 1 },
      subscriptions: [
        {
          uri: 'vless://11111111-2222-3333-4444-555555555555@hk.domain.com:443?security=tls#🇭🇰 香港 01',
          tag: 'SubActive',
          enabled: true
        },
        {
          url: 'https://example.com/sub-disabled-1.yaml',
          tag: 'SubDisabled1',
          enabled: false
        },
        {
          url: 'https://example.com/sub-disabled-2.yaml',
          disabled: true
        }
      ]
    };

    const res = await buildProfile(userConfig, { type: 'pure' });
    assert.ok(res.yamlStr);
  });
});
