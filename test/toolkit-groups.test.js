const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { main: toolkitMain } = require('../src/mihomo-toolkit.js');

describe('📦 策略组构建模块 (mihomo-toolkit)', () => {
  test('toolkitMain - AI / 流媒体 / 社交策略组生成与节点注入测试', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword1' },
        { name: '🇯🇵 日本 01', type: 'ss', server: 'jp.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword2' },
        { name: '🇺🇸 美国 01', type: 'ss', server: 'us.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword3' },
        { name: '🇸🇬 新加坡 01', type: 'ss', server: 'sg.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword4' }
      ]
    };

    const userConfig = {
      enableAI: true,
      enableStreaming: true,
      enableSocial: true,
      minorNodeThreshold: 1
    };

    const result = toolkitMain(rawConfig, userConfig);
    const groups = result['proxy-groups'];
    const groupNames = groups.map(g => g.name);

    // 1. 验证基础与应用策略组已被生成
    assert.ok(groupNames.includes('📍 手动选择'));
    assert.ok(groupNames.includes('🚀 自动选择'));
    assert.ok(groupNames.includes('🤖 ChatGPT'));
    assert.ok(groupNames.includes('▶️ YouTube'));
    assert.ok(groupNames.includes('✈️ Telegram'));

    // 2. 验证地区策略组已生成
    assert.ok(groupNames.includes('🇭🇰 香港节点'));
    assert.ok(groupNames.includes('🇯🇵 日本节点'));
    assert.ok(groupNames.includes('🇺🇸 美国节点'));
    assert.ok(groupNames.includes('🇸🇬 新加坡节点'));
  });

  test('toolkitMain - 高倍率隔离分组逻辑 (isolateHighMulti)', () => {
    const rawConfig = {
      proxies: [
        { name: '🇯🇵 日本 01 🚀 x3.0', type: 'ss', server: 'jp1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword1' },
        { name: '🇯🇵 日本 02 [0.5x]', type: 'ss', server: 'jp2.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword2' }
      ]
    };

    const userConfig = {
      isolateHighMulti: true,
      highMultiThreshold: 1.5,
      minorNodeThreshold: 1
    };

    const result = toolkitMain(rawConfig, userConfig);
    const groups = result['proxy-groups'];
    const highMultiGroup = groups.find(g => g.name.includes('高倍'));

    // 验证生成了高倍率独立组，且节点被归入该组
    assert.ok(highMultiGroup !== undefined, '应生成高倍率独立策略组');
    assert.ok(highMultiGroup.proxies.length > 0, '高倍率组应包含节点');
  });

  test('toolkitMain - 自定义分组 (customNodeGroups) 注入测试', () => {
    const rawConfig = {
      proxies: [
        { name: '自建专线-Xray', type: 'ss', server: 'xray.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword1' },
        { name: '🇭🇰 普通香港', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword2' }
      ]
    };

    const userConfig = {
      whitelistKeywords: ['Xray'],
      customNodeGroups: {
        'Xray': ['🤖 ChatGPT', '🐱 GitHub']
      },
      enableAI: true,
      minorNodeThreshold: 1
    };

    const result = toolkitMain(rawConfig, userConfig);
    const groups = result['proxy-groups'];
    const chatGptGroup = groups.find(g => g.name === '🤖 ChatGPT');

    // 验证自建节点被注入到目标策略组
    assert.ok(chatGptGroup !== undefined);
    assert.ok(chatGptGroup.proxies.includes('自建专线-Xray'));
  });
});
