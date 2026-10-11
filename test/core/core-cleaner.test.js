const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeNodeName,
  extractNodeAttributes,
  checkNodeBlockReason,
  classifyNode
} = require('../../src/core/cleaner');

describe('【Core】节点清洗与属性提取 (cleaner)', () => {
  it('sanitizeNodeName - 基础字符与广告词过滤', () => {
    const dirty = '\u200B  🇭🇰 香港 01   \uFEFF';
    assert.equal(sanitizeNodeName(dirty), '🇭🇰 香港 01');

    const withAd = '🇭🇰 香港 01 官网: http://test.com 严禁BT';
    const sanitized = sanitizeNodeName(withAd);
    assert.ok(!sanitized.includes('http://test.com'));
    assert.ok(!sanitized.includes('严禁BT'));
  });

  it('extractNodeAttributes - 属性提取 (倍率 / 线路 / 入口)', () => {
    const { attrs, cleanName } = extractNodeAttributes('深-港 IEPL x2.0 电信 联通');
    assert.equal(attrs.multiNum, 2.0);
    assert.equal(attrs.multiStr, 'x2');
    assert.equal(attrs.entryStr, '深');
    assert.ok(attrs.cleanLines.includes('IEPL'));
    assert.ok(attrs.cleanLines.includes('电联'));
    assert.equal(attrs.bestLineWeight, 1); // IEPL 最高优先级
  });

  it('extractNodeAttributes - 属性提取回归 (入口连接符、倍字倍率与线路词)', () => {
    for (const name of ['深→港', '深 港', '深至港', '深=>港', '深~>港']) {
      assert.equal(extractNodeAttributes(name).attrs.entryStr, '深', name);
    }
    const multiplier = extractNodeAttributes('🇭🇰 香港 01 - 1.5倍');
    assert.equal(multiplier.attrs.multiNum, 1.5);
    assert.ok(!multiplier.cleanName.includes('1.5倍'));
    for (const name of ['中转', '隧道']) {
      assert.ok(extractNodeAttributes('🇭🇰 香港 ' + name).attrs.cleanLines.includes(name));
    }
  });

  it('checkNodeBlockReason - 阻断与垃圾拦截 (假IP / 假密码 / 广告词)', () => {
    const fakeIpProxy = { server: '127.0.0.1', port: 8080 };
    assert.equal(checkNodeBlockReason(fakeIpProxy, 'Test'), '假IP');

    const rfc1918Proxy = { server: '172.20.0.1', port: 443 };
    assert.equal(checkNodeBlockReason(rfc1918Proxy, 'Test'), '假IP');

    const cgnatProxy = { server: '100.64.1.1', port: 443 };
    assert.equal(checkNodeBlockReason(cgnatProxy, 'Test'), '假IP');

    const ipv6PrivateProxy = { server: '[fc00::1]', port: 443 };
    assert.equal(checkNodeBlockReason(ipv6PrivateProxy, 'Test'), '假IP');

    const dummyProxy = { server: '1.2.3.4', port: 443, password: 'password' };
    assert.equal(checkNodeBlockReason(dummyProxy, 'Test'), '假密码');

    const adProxy = { server: '1.2.3.4', port: 443 };
    assert.equal(checkNodeBlockReason(adProxy, '防失联地址发布页点击关注'), '广告词');
  });

  it('classifyNode - 用户黑名单拦截 (blockKeywords / blockServers 优先于白名单)', () => {
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

  it('classifyNode - 综合分类打标 (地区 / 业务标签 / 虚拟信息节点 / 白名单节点)', () => {
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

  it('classifyNode - protocol 与 isUnknownRegion 语义规范', () => {
    const proxy = {
      name: '火星直连节点 01',
      type: 'hysteria2',
      server: '1.2.3.4',
      port: 443
    };
    const result = classifyNode(proxy, {});
    assert.equal(result.protocol, 'hysteria2');
    assert.equal(result.isUnknownRegion, true);
    assert.equal(result.groupKey, 'unknown');
    assert.equal(result.pType, undefined);
    assert.equal(result.isGarbage, undefined);
  });

  it('checkNodeBlockReason - 拒绝按文本长度误杀正常英文/外区节点 (Czech / United States)', () => {
    const czechProxy = { name: 'Czech Republic Relay', server: '89.185.100.1', port: 443 };
    assert.equal(checkNodeBlockReason(czechProxy, czechProxy.name), '');
    const czechClassified = classifyNode(czechProxy);
    assert.equal(czechClassified.skip, undefined);

    const usLongProxy = { name: 'United States West Coast', server: '142.250.190.46', port: 443 };
    assert.equal(checkNodeBlockReason(usLongProxy, usLongProxy.name), '');
    const usClassified = classifyNode(usLongProxy);
    assert.equal(usClassified.skip, undefined);
    assert.equal(usClassified.groupKey, 'us');

    // 确凿的客观垃圾与显式广告仍应被拦截
    assert.equal(checkNodeBlockReason({ server: '127.0.0.1', port: 80 }, 'Normal Name'), '假IP');
    assert.equal(checkNodeBlockReason({ server: '1.2.3.4', port: 443, password: 'password' }, 'Normal Name'), '假密码');
    assert.equal(checkNodeBlockReason({ server: '1.2.3.4', port: 443 }, '防失联地址发布页'), '广告词');
  });

  it('classifyNode - 单字大区与连字符中转节点正确识别落地 (深-港 / 港 / 日 / 美)', () => {
    const hkTransit = classifyNode({ name: '深-港 IEPL x2.0', server: '1.2.3.4', port: 443 });
    assert.equal(hkTransit.skip, undefined);
    assert.equal(hkTransit.isUnknownRegion, false);
    assert.equal(hkTransit.groupKey, 'hk');
    assert.equal(hkTransit.regionInfo?.name, '香港');

    const singleCharNodes = [
      { name: '港 01', expected: 'hk' },
      { name: '日 01', expected: 'jp' },
      { name: '台 01', expected: 'tw' },
      { name: '美 01', expected: 'us' },
      { name: '沪-日 02', expected: 'jp' },
      { name: '京-美 03', expected: 'us' }
    ];

    for (const item of singleCharNodes) {
      const res = classifyNode({ name: item.name, server: '1.2.3.4', port: 443 });
      assert.equal(res.groupKey, item.expected, `节点「${item.name}」应归入「${item.expected}」，实际: ${res.groupKey}`);
    }
  });

  it('extractNodeAttributes - 属性提取增强 (CMIN2 / AS9929 / x64避让 / 多格式入口识别)', () => {
    // 1. CMIN2 完整识别且不被 CMI 截断
    const cmin2 = extractNodeAttributes('香港 CMIN2 01');
    assert.equal(cmin2.attrs.cleanLines, 'CMIN2');
    assert.equal(cmin2.attrs.bestLineWeight, 2);
    assert.ok(!cmin2.cleanName.includes('N2'));

    // 2. AS9929 规范识别
    const as9929 = extractNodeAttributes('美国 AS9929 01');
    assert.equal(as9929.attrs.cleanLines, '9929');

    // 3. x64 / x86 架构词不被误判为倍率
    const archX64 = extractNodeAttributes('测试节点 x64');
    assert.equal(archX64.attrs.multiNum, 1.0);
    assert.equal(archX64.attrs.multiStr, '');

    const archX86 = extractNodeAttributes('测试节点 linux-x86');
    assert.equal(archX86.attrs.multiNum, 1.0);
    assert.equal(archX86.attrs.multiStr, '');

    // 真实 64倍 仍应被支持 (带明确倍率语义)
    const realMulti = extractNodeAttributes('测试节点 64倍');
    assert.equal(realMulti.attrs.multiNum, 1.0); // > 50 被安全守护

    // 4. 双字及 IATA 入口城市精准提取
    const entries = [
      { name: '深圳-香港 01', expected: '深' },
      { name: '广州-香港 01', expected: '广' },
      { name: '北京-美国 01', expected: '京' },
      { name: 'SZX-HK 01', expected: '深' },
      { name: 'CAN-HK 01', expected: '广' },
      { name: '穗-港 01', expected: '广' },
      { name: '上海-日本 01', expected: '沪' }
    ];

    for (const e of entries) {
      const { attrs } = extractNodeAttributes(e.name);
      assert.equal(attrs.entryStr, e.expected, `入口「${e.name}」应识别为「${e.expected}」，实际: ${attrs.entryStr}`);
    }
  });
});
