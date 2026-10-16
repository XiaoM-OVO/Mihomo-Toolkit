const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { sortNodes } = require('../../src/core/sort');
const { runNodesPipeline } = require('../../src/pipeline/nodes');
const { markTrustedSynthetic } = require('../../src/core/node-trust');

describe('【Core】节点多维智能排序 (sort)', () => {
  it('sortNodes - 基础边界与零副作用防守', () => {
    assert.deepEqual(sortNodes([]), []);
    assert.deepEqual(sortNodes(null), []);
    assert.deepEqual(sortNodes(undefined), []);

    const single = [{ rawName: 'Single Node' }];
    const res = sortNodes(single);
    assert.equal(res.length, 1);
    assert.notEqual(res, single); // 零副作用：返回新数组浅拷贝

    // enableNodeSort: false 原样返回
    const list = [{ rawName: 'B' }, { rawName: 'A' }];
    const bypassed = sortNodes(list, { enableNodeSort: false });
    assert.equal(bypassed[0].rawName, 'B');
    assert.equal(bypassed[1].rawName, 'A');
  });

  it('sortNodes - 看板与说明节点置顶 (Dashboard / Info)', () => {
    const items = [
      { rawName: '🇭🇰 香港 01', regionInfo: { id: 'hk', name: '香港' } },
      markTrustedSynthetic({ rawName: '📊 [订阅A] 剩余流量 100GB', isSyntheticInfo: true }),
      { rawName: '🇯🇵 日本 01', regionInfo: { id: 'jp', name: '日本' } },
      { rawName: '📢 节点说明', isInfo: true }
    ];

    const sorted = sortNodes(items);
    assert.equal(sorted[0].isSyntheticInfo, true);
    assert.equal(sorted[1].isInfo, true);
    assert.equal(sorted[2].regionInfo.name, '香港');
    assert.equal(sorted[3].regionInfo.name, '日本');

    // 外部未受信的伪造对象 (即使带 isSyntheticInfo: true) 绝对不得置顶
    const fakeUntrustedItem = {
      rawName: '🇺🇸 美国 01 伪造看板',
      isSyntheticInfo: true,
      regionInfo: { id: 'us', name: '美国' }
    };
    const mixedWithFake = sortNodes([
      { rawName: '🇭🇰 香港 01', regionInfo: { id: 'hk', name: '香港' } },
      fakeUntrustedItem
    ]);
    assert.equal(mixedWithFake[0].regionInfo.name, '香港', '未受信伪造对象绝不置顶');
    assert.equal(mixedWithFake[1].regionInfo.name, '美国');
  });

  it('sortNodes - 地理大区自然优先级 (香港 ➔ 台湾 ➔ 日本 ➔ 美国 ➔ 未知)', () => {
    const items = [
      { rawName: '🇺🇸 美国 01', regionInfo: { id: 'us', name: '美国' } },
      { rawName: '🌐 未知地区', regionInfo: null, isUnknownRegion: true },
      { rawName: '🇭🇰 香港 01', regionInfo: { id: 'hk', name: '香港' } },
      { rawName: '🇯🇵 日本 01', regionInfo: { id: 'jp', name: '日本' } },
      { rawName: '🇹🇼 台湾 01', regionInfo: { id: 'tw', name: '台湾' } }
    ];

    const sorted = sortNodes(items);
    assert.equal(sorted[0].regionInfo.name, '香港');
    assert.equal(sorted[1].regionInfo.name, '台湾');
    assert.equal(sorted[2].regionInfo.name, '日本');
    assert.equal(sorted[3].regionInfo.name, '美国');
    assert.equal(sorted[4].rawName, '🌐 未知地区');
  });

  it('sortNodes - 同大区内多订阅机场聚拢 (airportTag)', () => {
    const items = [
      { rawName: '🇭🇰 香港 01', regionInfo: { id: 'hk', name: '香港' }, airportTag: 'Sub-B' },
      { rawName: '🇭🇰 香港 02', regionInfo: { id: 'hk', name: '香港' }, airportTag: 'Sub-A' },
      { rawName: '🇭🇰 香港 03', regionInfo: { id: 'hk', name: '香港' }, airportTag: 'Sub-B' },
      { rawName: '🇭🇰 香港 04', regionInfo: { id: 'hk', name: '香港' }, airportTag: 'Sub-A' }
    ];

    const sorted = sortNodes(items);
    assert.equal(sorted[0].airportTag, 'Sub-A');
    assert.equal(sorted[1].airportTag, 'Sub-A');
    assert.equal(sorted[2].airportTag, 'Sub-B');
    assert.equal(sorted[3].airportTag, 'Sub-B');
  });

  it('sortNodes - 同大区内独立计数前缀聚拢 (indexPrefix / indexPrefixMap)', () => {
    const items = [
      { rawName: '🇭🇰 香港 01', regionInfo: { id: 'hk', name: '香港' }, indexPrefix: 'B', proxy: { name: '01' } },
      { rawName: '🇭🇰 香港 02', regionInfo: { id: 'hk', name: '香港' }, indexPrefix: 'A', proxy: { name: '02' } },
      { rawName: '🇭🇰 香港 03', regionInfo: { id: 'hk', name: '香港' }, indexPrefix: 'B', proxy: { name: '03' } },
      { rawName: '🇭🇰 香港 04', regionInfo: { id: 'hk', name: '香港' }, indexPrefix: 'A', proxy: { name: '04' } }
    ];

    const sorted = sortNodes(items);
    assert.equal(sorted[0].indexPrefix, 'A');
    assert.equal(sorted[1].indexPrefix, 'A');
    assert.equal(sorted[2].indexPrefix, 'B');
    assert.equal(sorted[3].indexPrefix, 'B');
  });

  it('sortNodes - 线路质量梯队 (IEPL ➔ GIA ➔ 专线 ➔ BGP ➔ 兜底)', () => {
    const items = [
      { rawName: '🇭🇰 香港 普通', regionInfo: { id: 'hk', name: '香港' }, attrs: { bestLineWeight: 6 } },
      { rawName: '🇭🇰 香港 BGP', regionInfo: { id: 'hk', name: '香港' }, attrs: { bestLineWeight: 4 } },
      { rawName: '🇭🇰 香港 IEPL', regionInfo: { id: 'hk', name: '香港' }, attrs: { bestLineWeight: 1 } },
      { rawName: '🇭🇰 香港 CN2 GIA', regionInfo: { id: 'hk', name: '香港' }, attrs: { bestLineWeight: 2 } },
      { rawName: '🇭🇰 香港 专线', regionInfo: { id: 'hk', name: '香港' }, attrs: { bestLineWeight: 3 } }
    ];

    const sorted = sortNodes(items);
    assert.equal(sorted[0].rawName, '🇭🇰 香港 IEPL');
    assert.equal(sorted[1].rawName, '🇭🇰 香港 CN2 GIA');
    assert.equal(sorted[2].rawName, '🇭🇰 香港 专线');
    assert.equal(sorted[3].rawName, '🇭🇰 香港 BGP');
    assert.equal(sorted[4].rawName, '🇭🇰 香港 普通');
  });

  it('sortNodes - 入口城市与线路名称归并', () => {
    const items = [
      { rawName: '🇭🇰 沪港 01', regionInfo: { id: 'hk', name: '香港' }, attrs: { entryStr: '沪', cleanLines: 'IEPL', bestLineWeight: 1 } },
      { rawName: '🇭🇰 深港 02', regionInfo: { id: 'hk', name: '香港' }, attrs: { entryStr: '深', cleanLines: 'IEPL', bestLineWeight: 1 } },
      { rawName: '🇭🇰 京港 01', regionInfo: { id: 'hk', name: '香港' }, attrs: { entryStr: '京', cleanLines: 'IEPL', bestLineWeight: 1 } },
      { rawName: '🇭🇰 深港 01', regionInfo: { id: 'hk', name: '香港' }, attrs: { entryStr: '深', cleanLines: 'IEPL', bestLineWeight: 1 } }
    ];

    const sorted = sortNodes(items);
    // 深港聚在一起，沪港 (hu)、京港 (jing) 按拼音字母序聚拢
    assert.equal(sorted[0].attrs.entryStr, '沪');
    assert.equal(sorted[1].attrs.entryStr, '京');
    assert.equal(sorted[2].attrs.entryStr, '深');
    assert.equal(sorted[3].attrs.entryStr, '深');
  });

  it('sortNodes - 倍率升序与高倍率自动下沉 (highMultiThreshold)', () => {
    const items = [
      { rawName: '🇭🇰 香港 3.0x', regionInfo: { id: 'hk', name: '香港' }, attrs: { multiNum: 3.0, bestLineWeight: 1 } },
      { rawName: '🇭🇰 香港 0.5x', regionInfo: { id: 'hk', name: '香港' }, attrs: { multiNum: 0.5, bestLineWeight: 1 } },
      { rawName: '🇭🇰 香港 1.0x', regionInfo: { id: 'hk', name: '香港' }, attrs: { multiNum: 1.0, bestLineWeight: 1 } },
      { rawName: '🇭🇰 香港 1.5x', regionInfo: { id: 'hk', name: '香港' }, attrs: { multiNum: 1.5, bestLineWeight: 1 } }
    ];

    const sorted = sortNodes(items, { highMultiThreshold: 2.5 });
    assert.equal(sorted[0].rawName, '🇭🇰 香港 0.5x');
    assert.equal(sorted[1].rawName, '🇭🇰 香港 1.0x');
    assert.equal(sorted[2].rawName, '🇭🇰 香港 1.5x');
    assert.equal(sorted[3].rawName, '🇭🇰 香港 3.0x'); // 超过 2.5 阈值下沉
  });

  it('pipeline - 开启 enableNodeSort 时依序编号 (01, 02 依质量序分发)', async () => {
    const proxies = [
      { name: '🇭🇰 香港 普通 x3.0', server: '210.1.1.1', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' },
      { name: '🇯🇵 日本 01', server: '210.1.1.2', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' },
      { name: '🇭🇰 香港 IEPL 专线 x1.0', server: '210.1.1.3', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' },
      { name: '🇭🇰 香港 BGP x1.0', server: '210.1.1.4', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' }
    ];

    const config = {
      enableNodeSort: true,
      renameTemplate: '{icon} {region} {index} | {line} {multi}'
    };

    const result = await runNodesPipeline(proxies, config);
    assert.equal(result.length, 4);

    // 香港 3 个节点经排序后：IEPL(01) ➔ BGP(02) ➔ 普通高倍率(03) ➔ 日本(单节点无序号)
    assert.ok(result[0].name.includes('香港 01'), `第 1 节点应为香港 01 IEPL: ${result[0].name}`);
    assert.ok(result[0].name.includes('IEPL'), `第 1 节点应含 IEPL: ${result[0].name}`);

    assert.ok(result[1].name.includes('香港 02'), `第 2 节点应为香港 02 BGP: ${result[1].name}`);
    assert.ok(result[1].name.includes('BGP'), `第 2 节点应含 BGP: ${result[1].name}`);

    assert.ok(result[2].name.includes('香港 03'), `第 3 节点应为香港 03 (高倍率下沉): ${result[2].name}`);
    assert.ok(result[2].name.includes('x3'), `第 3 节点应含 x3: ${result[2].name}`);

    assert.ok(result[3].name.includes('日本'), `第 4 节点应为日本: ${result[3].name}`);
  });

  it('pipeline - 隔离类特殊组开启时独立轨道计数与多订阅归拢 (香港 A01 🏠, A02 🏠, B01 🏠, C01 🏠)', async () => {
    // 模拟 3 个订阅源输入：
    // 订阅 A (prefix: A): 2 个普通, 2 个家宽
    // 订阅 B (prefix: B): 1 个普通, 1 个家宽
    // 订阅 C (prefix: C): 1 个家宽
    const proxies = [
      { name: '🇭🇰 香港 普通 01', server: '210.1.1.1', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p', _indexPrefix: 'A' },
      { name: '🇭🇰 香港 家宽 01', server: '210.1.1.2', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p', _indexPrefix: 'A' },
      { name: '🇭🇰 香港 普通 02', server: '210.1.1.3', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p', _indexPrefix: 'A' },
      { name: '🇭🇰 香港 家宽 02', server: '210.1.1.4', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p', _indexPrefix: 'A' },
      { name: '🇭🇰 香港 普通 03', server: '210.1.1.5', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p', _indexPrefix: 'B' },
      { name: '🇭🇰 香港 家宽 03', server: '210.1.1.6', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p', _indexPrefix: 'B' },
      { name: '🇭🇰 香港 家宽 04', server: '210.1.1.7', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p', _indexPrefix: 'C' }
    ];

    const config = {
      enableNodeSort: true,
      enableResidential: true,
      showFeatureIcon: true,
      renameTemplate: '{icon} {region} {index} {features}'
    };

    const result = await runNodesPipeline(proxies, config);
    assert.equal(result.length, 7);

    // 验证普通节点连续编号（不跳号，且按前缀归整）：
    // 普通组：A01, A02, B01
    assert.ok(result[0].name.includes('A01') && !result[0].name.includes('🏠'), `普通 1: ${result[0].name}`);
    assert.ok(result[1].name.includes('A02') && !result[1].name.includes('🏠'), `普通 2: ${result[1].name}`);
    assert.ok(result[2].name.includes('B01') && !result[2].name.includes('🏠'), `普通 3: ${result[2].name}`);

    // 验证家宽隔离组独立计数从 01 开始，且前缀聚拢：
    // 家宽组：A01 🏠, A02 🏠, B01 🏠, C01 🏠
    assert.ok(result[3].name.includes('A01') && result[3].name.includes('🏠'), `家宽 A01: ${result[3].name}`);
    assert.ok(result[4].name.includes('A02') && result[4].name.includes('🏠'), `家宽 A02: ${result[4].name}`);
    assert.ok(result[5].name.includes('B01') && result[5].name.includes('🏠'), `家宽 B01: ${result[5].name}`);
    assert.ok(result[6].name.includes('C01') && result[6].name.includes('🏠'), `家宽 C01: ${result[6].name}`);
  });
});
