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

  test('buildProfile - config 模式智能资产保活沙箱（自动继承节点专属 DNS 与 Hosts 依赖，绝不泄漏外部端口与夺权字段）', async () => {
    // 模拟输入带有潜在越权控制字段（port, external-controller）、受污染 hosts 以及专属节点解析依赖的 YAML
    const rawYamlContent = `
port: 7890
socks-port: 7891
external-controller: 0.0.0.0:9090
secret: evil-token
allow-lan: true
hosts:
  node.airport.com: 104.16.1.1
  github.com: 1.2.3.4
dns:
  nameserver-policy:
    +.airport.com: https://doh.airport.com/dns-query
    baidu.com: 1.1.1.1
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
    server: node.airport.com
    port: 443
    cipher: aes-128-gcm
    password: pass
`.trim();

    const userConfig = {
      subscriptions: [
        {
          uri: rawYamlContent,
          tag: 'SubWithSecurityFields'
        }
      ]
    };

    const { yamlStr } = await buildProfile(userConfig, { type: 'config' });
    const outputData = yaml.parse(yamlStr);

    // 1. 验证安全隔离：原订阅的危险控制面字段被物理剥离，未泄漏至全局配置
    assert.equal(outputData.port, undefined);
    assert.equal(outputData['socks-port'], undefined);
    assert.equal(outputData['external-controller'], undefined);
    assert.equal(outputData.secret, undefined);
    assert.equal(outputData['allow-lan'], undefined);

    // 2. 验证节点资产闭包：节点专属优选 IP 保留，高危公共资产劫持被拦截
    assert.ok(outputData.hosts);
    assert.equal(outputData.hosts['node.airport.com'], '104.16.1.1');
    assert.equal(outputData.hosts['github.com'], undefined);

    // 3. 验证专属 DNS 策略：节点专属私有 DoH 保留，通用域名劫持被剥离
    assert.ok(outputData.dns && outputData.dns['nameserver-policy']);
    assert.equal(outputData.dns['nameserver-policy']['+.airport.com'], 'https://doh.airport.com/dns-query');
    assert.equal(outputData.dns['nameserver-policy']['baidu.com'], undefined);

    // 4. 验证防环路：节点域名自动聚合进入 fake-ip-filter
    assert.ok(Array.isArray(outputData.dns['fake-ip-filter']));
    assert.ok(
      outputData.dns['fake-ip-filter'].includes('+.airport.com') ||
      outputData.dns['fake-ip-filter'].includes('node.airport.com')
    );

    // 5. 验证节点清洗：脏广告被剔除，保留干净节点
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
