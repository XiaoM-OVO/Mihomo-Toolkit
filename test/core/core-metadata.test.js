'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractMetadata, REGION_METADATA_MAP } = require('../../src/core/metadata');
const { getEnhancedRegionDefs } = require('../../src/core/shared/regions');

describe('【Core】节点名称元数据只读旁路提取 (metadata)', () => {
  it('已知地区映射到正确的小写 groupKey、国家代码和显示名称', () => {
    const cases = [
      { name: '🇭🇰 香港 01', expectedGroup: 'hk', expectedName: '香港', expectedCode: 'HK' },
      { name: '🇹🇼 台湾 01', expectedGroup: 'tw', expectedName: '台湾', expectedCode: 'TW' },
      { name: '🇯🇵 日本 01', expectedGroup: 'jp', expectedName: '日本', expectedCode: 'JP' },
      { name: '🇸🇬 新加坡 01', expectedGroup: 'sg', expectedName: '新加坡', expectedCode: 'SG' },
      { name: '🇺🇸 美国 01', expectedGroup: 'us', expectedName: '美国', expectedCode: 'US' },
      { name: '🇰🇷 韩国 01', expectedGroup: 'kr', expectedName: '韩国', expectedCode: 'KR' },
      { name: '🇬🇧 英国 伦敦 01', expectedGroup: 'uk', expectedName: '英国', expectedCode: 'GB', expectedCity: '伦敦' },
      { name: '🇩🇪 德国 法兰克福 01', expectedGroup: 'de', expectedName: '德国', expectedCode: 'DE', expectedCity: '法兰克福' }
    ];

    for (const c of cases) {
      const meta = extractMetadata(c.name);
      assert.equal(meta.groupKey, c.expectedGroup, `大区 groupKey 应为 ${c.expectedGroup}`);
      assert.equal(meta.regionName, c.expectedName, `地区名称应为 ${c.expectedName}`);
      assert.equal(meta.countryCode, c.expectedCode, `国家代码应为 ${c.expectedCode}`);
      if (c.expectedCity) {
        assert.equal(meta.city, c.expectedCity, `城市应为 ${c.expectedCity}`);
      }
      assert.equal(meta.status, 'complete', `有效大区单跳节点状态应为 complete`);
    }
  });

  it('已知地区且无冲突时为 complete，即使没有线路或显式倍率', () => {
    const meta = extractMetadata('香港 01');
    assert.equal(meta.status, 'complete');
    assert.equal(meta.groupKey, 'hk');
    assert.equal(meta.regionName, '香港');
    assert.equal(meta.countryCode, 'HK');
    assert.equal(meta.city, null);
    assert.deepEqual(meta.lines, []);
    assert.deepEqual(meta.rawMatchedLines, []);
    assert.equal(meta.cleanLines, null);
    assert.deepEqual(meta.features, []);
    assert.deepEqual(meta.multiplier, { value: 1, hasExplicit: false });
  });

  it('无地区但有白名单线路时为 partial', () => {
    const meta = extractMetadata('IEPL 专线 01');
    assert.equal(meta.status, 'partial');
    assert.equal(meta.groupKey, 'unknown');
    assert.equal(meta.regionName, null);
    assert.equal(meta.countryCode, null);
    assert.ok(meta.lines.includes('IEPL'));
    assert.ok(meta.lines.includes('专线'));
    assert.ok(meta.rawMatchedLines.includes('IEPL'));
    assert.ok(meta.rawMatchedLines.includes('专线'));
    assert.ok(meta.cleanLines.includes('IEPL'));
  });

  it('完全无匹配时为 unknown', () => {
    const meta = extractMetadata('Node-A-102');
    assert.equal(meta.status, 'unknown');
    assert.equal(meta.groupKey, 'unknown');
    assert.equal(meta.regionName, null);
    assert.equal(meta.countryCode, null);
    assert.equal(meta.city, null);
    assert.deepEqual(meta.lines, []);
    assert.deepEqual(meta.rawMatchedLines, []);
    assert.equal(meta.cleanLines, null);
    assert.deepEqual(meta.features, []);
    assert.deepEqual(meta.multiplier, { value: 1, hasExplicit: false });
  });

  it('倍率值提取正确，未显式倍率与显式 x1.0 必须可区分', () => {
    // 1. 未标倍率
    const noMulti = extractMetadata('香港 01');
    assert.deepEqual(noMulti.multiplier, { value: 1, hasExplicit: false });

    // 2. 显式 x1.0
    const explicitOne = extractMetadata('香港 01 x1.0');
    assert.deepEqual(explicitOne.multiplier, { value: 1, hasExplicit: true });
    assert.notDeepEqual(noMulti.multiplier, explicitOne.multiplier, '未显式倍率与显式 x1.0 必须可区分');

    // 3. 显式 x0.5 小数倍率
    const halfMulti = extractMetadata('香港 01 x0.5');
    assert.deepEqual(halfMulti.multiplier, { value: 0.5, hasExplicit: true });

    // 4. 其他合法语法: 2x, 1.5倍, 倍率: 2.5
    assert.deepEqual(extractMetadata('香港 01 2x').multiplier, { value: 2, hasExplicit: true });
    assert.deepEqual(extractMetadata('香港 01 1.5倍').multiplier, { value: 1.5, hasExplicit: true });
    assert.deepEqual(extractMetadata('香港 01 倍率: 2.5').multiplier, { value: 2.5, hasExplicit: true });
  });

  it('多个业务特征可同时出现，且倍率不混入 features', () => {
    const meta = extractMetadata('香港 01 x0.5 家宽 流媒体 IPv6 游戏');
    assert.ok(meta.features.includes('residential'), '应包含 residential 特征');
    assert.ok(meta.features.includes('streaming'), '应包含 streaming 特征');
    assert.ok(meta.features.includes('ipv6'), '应包含 ipv6 特征');
    assert.ok(meta.features.includes('game'), '应包含 game 特征');
    assert.ok(!meta.features.includes('x0.5'), '倍率不混入 features');
    assert.deepEqual(meta.multiplier, { value: 0.5, hasExplicit: true });
  });

  it('真实线路文本、版本号、普通数字、架构词与倍率文本之间不发生明显串扰', () => {
    // 版本号 v1.0 / v2.0 不得误判为倍率
    const verNode = extractMetadata('Node v1.0');
    assert.deepEqual(verNode.multiplier, { value: 1, hasExplicit: false });

    // 架构词 x64 / x86 不得误判为倍率
    const archNode = extractMetadata('香港 x64');
    assert.deepEqual(archNode.multiplier, { value: 1, hasExplicit: false });

    // 线路 AS9929 01 中的数字与线路干净隔离
    const lineNode = extractMetadata('香港 AS9929 01');
    assert.ok(lineNode.lines.includes('9929'));
    assert.deepEqual(lineNode.multiplier, { value: 1, hasExplicit: false });

    // 普通编号 102 不得误判为倍率
    const numNode = extractMetadata('日本 102');
    assert.deepEqual(numNode.multiplier, { value: 1, hasExplicit: false });
    assert.equal(numNode.groupKey, 'jp');

    // v6.0 版本号不得误判为 IPv6
    const ver6Node = extractMetadata('Node v6.0');
    assert.ok(!ver6Node.features.includes('ipv6'));
  });

  it('地区冲突正确降级为 partial 且 groupKey 为 unknown', () => {
    // 国旗与文字冲突 (🇯🇵 图标却紧跟 香港)
    const flagConflict = extractMetadata('🇯🇵 香港 01');
    assert.equal(flagConflict.status, 'partial');
    assert.equal(flagConflict.groupKey, 'unknown');
    assert.equal(flagConflict.regionName, null);

    // 两个不同落地大区并列冲突
    const multiRegionConflict = extractMetadata('香港 日本 专线 01');
    assert.equal(multiRegionConflict.status, 'partial');
    assert.equal(multiRegionConflict.groupKey, 'unknown');
    assert.equal(multiRegionConflict.regionName, null);
    assert.ok(multiRegionConflict.lines.includes('专线'));
  });

  it('中转节点正常识别落地大区，入口城市不触发冲突', () => {
    const transit = extractMetadata('深-港 IEPL x2.0 电信 联通');
    assert.equal(transit.status, 'complete');
    assert.equal(transit.groupKey, 'hk');
    assert.equal(transit.regionName, '香港');
    assert.equal(transit.countryCode, 'HK');
    assert.ok(transit.lines.includes('IEPL'));
    assert.ok(transit.lines.includes('电联'));
    assert.deepEqual(transit.multiplier, { value: 2, hasExplicit: true });
  });

  it('输入字符串不被修改，且输出元数据对象已被冻结', () => {
    const original = '  🇭🇰 香港 01 x0.5 家宽  ';
    const snapshot = original;
    const meta = extractMetadata(original);

    assert.equal(original, snapshot, '输入字符串不得被修改');
    assert.ok(Object.isFrozen(meta), 'metadata 主对象必须被冻结');
    assert.ok(Object.isFrozen(meta.lines), 'metadata.lines 数组必须被冻结');
    assert.ok(Object.isFrozen(meta.rawMatchedLines), 'metadata.rawMatchedLines 必须被冻结');
    assert.ok(Object.isFrozen(meta.features), 'metadata.features 数组必须被冻结');
    assert.ok(Object.isFrozen(meta.multiplier), 'metadata.multiplier 对象必须被冻结');

    // 非法入参安全防御
    const nullMeta = extractMetadata(null);
    assert.equal(nullMeta.status, 'unknown');
    assert.ok(Object.isFrozen(nullMeta));

    const emptyMeta = extractMetadata('');
    assert.equal(emptyMeta.status, 'unknown');
    assert.ok(Object.isFrozen(emptyMeta));
  });

  it('REGION_METADATA_MAP 权威单一事实源：对象已冻结且与 regions.js 全量对齐', () => {
    assert.ok(Object.isFrozen(REGION_METADATA_MAP), 'REGION_METADATA_MAP 必须被深度冻结');
    const regionDefs = getEnhancedRegionDefs();
    for (const r of regionDefs) {
      const meta = REGION_METADATA_MAP[r.name];
      assert.ok(meta, `REGION_METADATA_MAP 必须包含定义 ${r.name}`);
      assert.equal(meta.regionName, r.name);
      assert.ok(meta.groupKey, `${r.name} 必须包含有效 groupKey`);
      assert.ok(meta.countryCode, `${r.name} 必须包含有效 ISO 国家代码`);
      assert.ok(Object.isFrozen(meta), `${r.name} 元数据项必须已冻结`);
    }
  });
});
