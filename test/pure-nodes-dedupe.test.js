const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { operator } = require('../src/pure-nodes.js');

describe('🧹 脏乱节点清洗与物理去重算法', () => {
  test('pure-nodes - 极度脏乱文本与广告节点过滤', async () => {
    const dirtyProxies = [
      // 纯文本引流/广告节点 (应被剔除)
      { name: '📢 官方网址：https://example.com 优惠码9折 点击加入Q群', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p' },
      { name: '⚠️ 节点定期更新，请关注 Telegram 频道 @example', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p' },
      // 订阅自带的信息说明节点 (removeInfoNodes=true 且非 synthetic 时应被剔除)
      { name: '剩余流量：999.50 GB | 到期时间：2026-12-31', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p' },
      // 正常节点 (带复杂花里胡哨的前缀与繁体修饰词)
      { name: '🇭🇰 [机场A] 香港專線 01 [家寬/BGP] 🚀 x1.5', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-256-gcm', password: 'pass1' },
      { name: '🇯🇵 日本东京01 | CTCU电信 | 0.5x倍率', type: 'ss', server: 'jp1.node.com', port: 443, cipher: 'aes-256-gcm', password: 'pass2' },
      { name: '🇺🇸 美國洛杉磯 01 [0.01x超低倍率]', type: 'ss', server: 'us1.node.com', port: 443, cipher: 'aes-256-gcm', password: 'pass3' },
      { name: '🇦🇷 阿根廷 01 落地节点', type: 'ss', server: 'ar1.node.com', port: 443, cipher: 'aes-256-gcm', password: 'pass4' }
    ];

    const config = {
      removeInfoNodes: true,
      enableDedupe: true,
      strictRegionMatch: false
    };

    const result = await operator(dirtyProxies, 'clash', config);
    const cleanProxies = Array.isArray(result) ? result : result.proxies;

    // 1. 验证广告与说明节点已被剔除
    assert.ok(!cleanProxies.some(p => p.name.includes('官方网址')));
    assert.ok(!cleanProxies.some(p => p.name.includes('Telegram')));
    assert.ok(!cleanProxies.some(p => p.name.includes('剩余流量')));

    // 2. 验证有效节点保留并被清洗命名
    assert.ok(cleanProxies.length >= 4);
  });

  test('pure-nodes - 物理去重逻辑 (enableDedupe)', async () => {
    const duplicateProxies = [
      { name: '🇭🇰 香港 01', type: 'ss', server: 'hk.domain.com', port: 8388, cipher: 'aes-256-gcm', password: 'samepassword' },
      { name: '🇭🇰 香港 01 克隆版', type: 'ss', server: 'hk.domain.com', port: 8388, cipher: 'aes-256-gcm', password: 'samepassword' }, // 物理参数完全相同
      { name: '🇯🇵 日本 01', type: 'ss', server: 'jp.domain.com', port: 8388, cipher: 'aes-256-gcm', password: 'samepassword' }
    ];

    const result = await operator(duplicateProxies, 'clash', { enableDedupe: true });
    const cleanProxies = Array.isArray(result) ? result : result.proxies;

    // 重复节点应只保留 1 个
    const hkNodes = cleanProxies.filter(p => p.server === 'hk.domain.com');
    assert.equal(hkNodes.length, 1);
  });
});
