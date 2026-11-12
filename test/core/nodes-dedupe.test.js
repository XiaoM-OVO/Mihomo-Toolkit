const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runNodesPipeline } = require('../../src/pipeline/nodes.js');

describe('【Core】脏乱节点清洗与物理去重 (dedupe)', () => {
  it('filter - 极度脏乱文本与广告节点过滤', async () => {
    const dirtyProxies = [
      // 纯文本引流/广告节点 (应被剔除)
      { name: '📢 官方网址：https://example.com 优惠码9折 点击加入Q群', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p' },
      { name: '⚠️ 节点定期更新，请关注 Telegram 频道 @example', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p' },
      // 订阅自带的信息说明节点 (原生说明节点应被默认剔除)
      { name: '剩余流量：999.50 GB | 到期时间：2026-12-31', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p' },
      // 正常节点 (带复杂花里胡哨的前缀与繁体修饰词)
      { name: '🇭🇰 [机场A] 香港專線 01 [家寬/BGP] 🚀 x1.5', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-256-gcm', password: 'pass1' },
      { name: '🇯🇵 日本东京01 | CTCU电信 | 0.5x倍率', type: 'ss', server: 'jp1.node.com', port: 443, cipher: 'aes-256-gcm', password: 'pass2' },
      { name: '🇺🇸 美國洛杉磯 01 [0.01x超低倍率]', type: 'ss', server: 'us1.node.com', port: 443, cipher: 'aes-256-gcm', password: 'pass3' },
      { name: '🇦🇷 阿根廷 01 落地节点', type: 'ss', server: 'ar1.node.com', port: 443, cipher: 'aes-256-gcm', password: 'pass4' }
    ];

    const config = {
      enableDashboard: true,
      enableDedupe: true,
      removeInfoNodes: true,
      strictRegionMatch: false
    };

    const cleanProxies = await runNodesPipeline(dirtyProxies, config);

    // 1. 验证广告与说明节点已被剔除
    assert.ok(!cleanProxies.some(p => p.name.includes('官方网址')));
    assert.ok(!cleanProxies.some(p => p.name.includes('Telegram')));
    assert.ok(!cleanProxies.some(p => p.name.includes('剩余流量')));

    // 2. 验证有效节点保留并被清洗命名
    assert.ok(cleanProxies.length >= 4);
  });

  it('dedupe - 物理参数完全相同的节点物理去重 (enableDedupe)', async () => {
    const duplicateProxies = [
      { name: '🇭🇰 香港 01', type: 'ss', server: 'hk.domain.com', port: 8388, cipher: 'aes-256-gcm', password: 'samepassword' },
      { name: '🇭🇰 香港 01 克隆版', type: 'ss', server: 'hk.domain.com', port: 8388, cipher: 'aes-256-gcm', password: 'samepassword' }, // 物理参数完全相同
      { name: '🇯🇵 日本 01', type: 'ss', server: 'jp.domain.com', port: 8388, cipher: 'aes-256-gcm', password: 'samepassword' }
    ];

    const cleanProxies = await runNodesPipeline(duplicateProxies, { enableDedupe: true });

    // 重复节点应只保留 1 个
    const hkNodes = cleanProxies.filter(p => p.server === 'hk.domain.com');
    assert.equal(hkNodes.length, 1);
  });

  it('info-nodes - removeInfoNodes: false 显式保留原生说明节点', async () => {
    const rawProxies = [
      { name: '剩余流量：500 GB', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p' },
      { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-256-gcm', password: 'p' }
    ];

    const proxies = await runNodesPipeline(rawProxies, { removeInfoNodes: false });
    assert.equal(proxies.length, 2);
    assert.ok(proxies.some(p => p.name.includes('剩余流量')));
  });

  it('dedupe-priority - 显式公告节点不得抢走同指纹真实节点的保留位', async () => {
    const shared = {
      type: 'ss',
      server: '202.50.253.99',
      port: 19999,
      cipher: 'aes-256-gcm',
      password: 'samepassword'
    };
    const notice = { ...shared, name: '[压测订阅] 更新时间18:33' };
    const real = { ...shared, name: '意大利 - Milan - 8' };

    // 公告在前：旧实现会让公告赢下去重，真实节点被剔除
    const noticeFirst = await runNodesPipeline([notice, real], { enableDedupe: true });
    assert.equal(noticeFirst.length, 1);
    assert.ok(noticeFirst[0].name.includes('意大利'), '同指纹时应保留真实节点');
    assert.ok(!noticeFirst.some(p => p.name.includes('新加坡')), '公告节点不得被识别为新加坡并混入产物');

    // 顺序反转也必须保留真实节点
    const realFirst = await runNodesPipeline([real, notice], { enableDedupe: true });
    assert.equal(realFirst.length, 1);
    assert.ok(realFirst[0].name.includes('意大利'));
  });

  it('dedupe-priority - 仅公告节点时仍按 removeInfoNodes 开关保留', async () => {
    const noticeOnly = [{
      name: '流量剩余 ≫ 888.01 PB',
      type: 'ss',
      server: '129.151.64.169',
      port: 31867,
      cipher: 'aes-256-gcm',
      password: 'p'
    }];

    const kept = await runNodesPipeline(noticeOnly, { enableDedupe: true, removeInfoNodes: false });
    assert.equal(kept.length, 1);

    const dropped = await runNodesPipeline(noticeOnly, { enableDedupe: true, removeInfoNodes: true });
    assert.equal(dropped.length, 0);
  });

  it('admission - 无法识别地区的节点默认丢弃，特殊节点豁免', async () => {
    const unknown = {
      name: '节点来自互联网，请自行判断',
      type: 'ss',
      server: '104.28.1.1',
      port: 443,
      cipher: 'aes-256-gcm',
      password: 'p'
    };
    const real = {
      name: '🇭🇰 香港 01',
      type: 'ss',
      server: 'hk.node.com',
      port: 443,
      cipher: 'aes-256-gcm',
      password: 'p'
    };

    const strict = await runNodesPipeline([unknown, real], { enableDedupe: false });
    assert.equal(strict.length, 1, '未识别地区节点应被准入拒绝');
    assert.ok(strict[0].name.includes('香港'));

    const loose = await runNodesPipeline([unknown, real], { enableDedupe: false, keepUnknownNodes: true });
    assert.equal(loose.length, 2, 'keepUnknownNodes 开启后未识别节点应保留');

    const special = await runNodesPipeline([unknown], {
      enableDedupe: false,
      keepUnknownNodes: false,
      specialNodeRules: [{ reg: /节点来自/, targetName: '自建节点' }]
    });
    assert.equal(special.length, 1, '特殊/白名单节点必须豁免准入丢弃');
  });
});
