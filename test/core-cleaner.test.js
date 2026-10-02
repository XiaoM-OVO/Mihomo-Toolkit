const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeNodeName,
  extractNodeAttributes,
  checkNodeBlockReason,
  classifyNode
} = require('../src/core/cleaner');

test('🧹 节点清洗模块测试 - 基础字符与广告词过滤 (sanitize)', () => {
  const dirty = '\u200B  🇭🇰 香港 01   \uFEFF';
  assert.equal(sanitizeNodeName(dirty), '🇭🇰 香港 01');

  const withAd = '🇭🇰 香港 01 官网: http://test.com 严禁BT';
  const sanitized = sanitizeNodeName(withAd);
  assert.ok(!sanitized.includes('http://test.com'));
  assert.ok(!sanitized.includes('严禁BT'));
});

test('🧹 节点清洗模块测试 - 属性提取 (倍率 / 线路 / 入口)', () => {
  const { attrs, cleanName } = extractNodeAttributes('深-港 IEPL x2.0 电信 联通');
  assert.equal(attrs.multiNum, 2.0);
  assert.equal(attrs.multiStr, 'x2');
  assert.equal(attrs.entryStr, '深');
  assert.ok(attrs.cleanLines.includes('IEPL'));
  assert.ok(attrs.cleanLines.includes('电联'));
  assert.equal(attrs.bestLineWeight, 1); // IEPL 最高优先级
});

test('🧹 节点清洗模块测试 - 阻断与垃圾拦截 (blockReason)', () => {
  const fakeIpProxy = { server: '127.0.0.1', port: 8080 };
  assert.equal(checkNodeBlockReason(fakeIpProxy, 'Test'), '假IP');

  const dummyProxy = { server: '1.2.3.4', port: 443, password: 'password' };
  assert.equal(checkNodeBlockReason(dummyProxy, 'Test'), '假密码');

  const adProxy = { server: '1.2.3.4', port: 443 };
  assert.equal(checkNodeBlockReason(adProxy, '防失联地址发布页点击关注'), '广告词');
});

test('🧹 节点清洗模块测试 - 用户黑名单拦截 (blockKeywords / blockServers)', () => {
  const cfg = { blockKeywords: ['免费领取'], blockServers: ['bad.example.com'] };

  const byName = classifyNode({ name: '🇭🇰 香港01 免费领取', server: '1.2.3.4', port: 443 }, cfg);
  assert.ok(byName.skip);
  assert.equal(byName.blockReason, '黑名单关键词');

  const byServer = classifyNode({ name: '🇭🇰 香港01', server: 'bad.example.com', port: 443 }, cfg);
  assert.ok(byServer.skip);
  assert.equal(byServer.blockReason, '黑名单服务器');

  // 黑名单优先于白名单：同时命中时以拦截为准
  const both = classifyNode(
    { name: 'x-ray 节点', server: '1.2.3.4', port: 443 },
    { whitelistKeywords: ['x-ray'], blockKeywords: ['x-ray'] }
  );
  assert.ok(both.skip);
  assert.equal(both.blockReason, '黑名单关键词');
});

test('🧹 节点清洗模块测试 - 综合分类打标 (classifyNode)', () => {
  const hkProxy = {
    name: '🇭🇰 香港 01 BGP 4K流媒体',
    server: '1.2.3.4',
    port: 443,
    type: 'vless',
    uuid: 'uuid-1'
  };
  const result = classifyNode(hkProxy);
  assert.ok(!result.skip);
  assert.ok(result.regionInfo);
  assert.equal(result.groupKey, 'hk');
  assert.ok(result.tags.includes('streaming'));

  // 虚拟信息节点
  const infoProxy = {
    name: '剩余流量：100G',
    server: '1.0.0.1',
    port: 80,
    isSyntheticInfo: true
  };
  const infoResult = classifyNode(infoProxy);
  assert.equal(infoResult.isInfo, true);
  assert.equal(infoResult.groupKey, 'info');

  // 白名单节点
  const specialProxy = {
    name: '我的专用自建节点',
    server: '1.2.3.4',
    port: 443
  };
  const specialResult = classifyNode(specialProxy, { whitelistKeywords: ['自建'] });
  assert.equal(specialResult.isSpecial, true);
  assert.equal(specialResult.groupKey, 'special');
});
