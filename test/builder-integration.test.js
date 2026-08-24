const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const yaml = require('yaml');
const { buildProfile } = require('../src/builder.js');

describe('🔨 端到端构建流程集成测试模块', () => {
  test('buildProfile - 端到端 full 全流程构建测试', async () => {
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

    const { yamlStr } = await buildProfile(userConfig, { type: 'full', production: true });

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

  test('buildProfile - pure 模式测试（仅清洗节点，不建策略组）', async () => {
    const userConfig = {
      subscriptions: [
        {
          uri: 'trojan://password@us.domain.com:443#🇺🇸 美国 01',
          tag: 'PureSub'
        }
      ]
    };

    const { yamlStr } = await buildProfile(userConfig, { type: 'pure' });
    const outputData = yaml.parse(yamlStr);

    assert.ok(Array.isArray(outputData.proxies));
    assert.equal(outputData['proxy-groups'], undefined);
  });
});
