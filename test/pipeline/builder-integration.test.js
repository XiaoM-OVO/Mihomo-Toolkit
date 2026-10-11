const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const yaml = require('yaml');
const { buildProfile } = require('../../src/index.js');

describe('【Pipeline】端到端构建流程集成测试 (builder-integration)', () => {
  it('buildProfile - 端到端 config 全流程构建 (YAML结构 / 策略组 / DNS / 节点装配)', async () => {
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
      enableGame: true
    };

    const { yamlStr } = await buildProfile(userConfig, { mode: 'config', production: true });

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

  it('buildProfile - nodes 纯节点清洗模式契约 (严格只输出 proxies 数组)', async () => {
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

    const { yamlStr } = await buildProfile(userConfig, { mode: 'nodes' });
    const outputData = yaml.parse(yamlStr);

    // 验证契约：只输出干净的 proxies，不越界输出原配置中的 rules / port
    assert.ok(Array.isArray(outputData.proxies));
    assert.equal(outputData.rules, undefined);
    assert.equal(outputData.port, undefined);
    assert.equal(outputData['proxy-groups'], undefined);
  });

  it('buildProfile - config 模式智能资产保活沙箱 (继承节点专属 DNS/Hosts，阻断外部夺权与公网劫持)', async () => {
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

    const { yamlStr } = await buildProfile(userConfig, { mode: 'config' });
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

  it('buildProfile - report 审计模式 (结构化统计与完整性)', async () => {
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

    const result = await buildProfile(userConfig, { mode: 'report' });
    assert.ok(result.meta);
    assert.ok(result.meta.stats);
    assert.equal(result.meta.stats.total, 2);
    assert.equal(result.meta.stats.outputCount, 2);
  });

  it('buildProfile - 订阅配置 resetDay 生成重置节点，未配置时自动捕捉', async () => {
    const today = new Date();
    const userConfig = {
      subscriptions: [
        {
          uri: 'vless://11111111-2222-3333-4444-555555555555@hk.domain.com:443?security=tls#🇭🇰 香港 01',
          tag: 'Sub1',
          resetDay: today.getDate()
        }
      ]
    };

    const { yamlStr } = await buildProfile(userConfig, { mode: 'config', production: true });
    const outputData = yaml.parse(yamlStr);
    const resetNode = (outputData.proxies || []).find(p => /距离重置剩余：\d+ 天/.test(p.name));
    assert.ok(resetNode, '应生成"距离重置剩余 X 天"节点');
    assert.match(resetNode.name, /🔄 \[Sub1\] 距离重置剩余：\d+ 天/);
  });

  it('buildProfile - 单订阅已过期防丢头与订阅注释生成', async () => {
    const userConfig = {
      subscriptions: [
        {
          uri: 'vless://11111111-2222-3333-4444-555555555555@hk.domain.com:443?security=tls#🇭🇰 香港 01',
          tag: 'SubOld'
        }
      ]
    };

    const { yamlStr, userInfo } = await buildProfile(userConfig, { mode: 'config', production: true });
    assert.ok(yamlStr.length > 0);
    assert.ok(userInfo !== undefined);
  });

  it('buildProfile - 支持单订阅开关 (enabled: true / enabled: false)', async () => {
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
          enabled: false
        }
      ]
    };

    const { yamlStr } = await buildProfile(userConfig, { mode: 'nodes' });
    const outputData = yaml.parse(yamlStr);
    const proxyNames = (outputData.proxies || []).map(p => p.name);

    assert.equal(proxyNames.length, 1);
    assert.ok(proxyNames[0].includes('香港'));
    assert.equal(proxyNames.some(n => n.includes('日本')), false);
    assert.equal(proxyNames.some(n => n.includes('新加坡')), false);
  });

  it('buildProfile - validateRequestLimits 过滤停用订阅', async () => {
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
          enabled: false
        }
      ]
    };

    const res = await buildProfile(userConfig, { mode: 'nodes' });
    assert.ok(res.yamlStr);
  });
});
