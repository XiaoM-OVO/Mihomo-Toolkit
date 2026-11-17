'use strict';

/**
 * 节点命名语法矩阵（可执行契约）
 *
 * 目的：清洗引擎、识别器或词表重构时，用一组有代表性的「结构形态」快速发现
 * 识别率回归。这里只放少量夹具，不复制生产环境的节点清单；完整格式说明见
 * 根目录 NAMING_GRAMMAR.md。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { extractSemanticMetadata, extractNodeAttributes } = require('../../src/core/metadata');
const { recognizeRegion } = require('../../src/core/recognizer');
const { matchNodeRegion } = require('../../src/core/geo');

const OPTS = { lowMultiThreshold: 0.5 };

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function sorted(values) {
  return [...values].sort();
}

/**
 * @param {{ name: string, expect: object }} testCase
 */
function assertNamingCase({ name, expect }) {
  const meta = extractSemanticMetadata(name, OPTS);
  const attrs = extractNodeAttributes(name, OPTS);
  const geo = matchNodeRegion(name);

  if ('regionDef' in expect) {
    assert.equal(meta.regionDef?.name ?? null, expect.regionDef, `${name} → regionDef`);
  }
  if ('regionName' in expect) {
    assert.equal(meta.regionName, expect.regionName, `${name} → regionName`);
  }
  if ('groupKey' in expect) {
    assert.equal(meta.groupKey, expect.groupKey, `${name} → groupKey`);
  }
  if ('entryStr' in expect) {
    assert.equal(meta.entryStr, expect.entryStr, `${name} → entryStr`);
    assert.equal(attrs.attrs.entryStr, expect.entryStr, `${name} → attrs.entryStr`);
  }
  if ('transitStr' in expect) {
    assert.equal(meta.transitStr, expect.transitStr, `${name} → transitStr`);
    assert.equal(attrs.attrs.transitStr, expect.transitStr, `${name} → attrs.transitStr`);
  }
  if ('lines' in expect) {
    assert.deepEqual(sorted(meta.lines), sorted(expect.lines), `${name} → lines`);
  }
  if ('features' in expect) {
    assert.deepEqual(sorted(meta.features), sorted(expect.features), `${name} → features`);
  }
  if ('multiNum' in expect) {
    assert.equal(meta.multiNum, expect.multiNum, `${name} → multiNum`);
  }
  if ('hasExplicitMulti' in expect) {
    assert.equal(meta.hasExplicitMulti, expect.hasExplicitMulti, `${name} → hasExplicitMulti`);
  }
  if ('status' in expect) {
    assert.equal(meta.status, expect.status, `${name} → status`);
  }
  if ('hasRegionConflict' in expect) {
    assert.equal(meta.hasRegionConflict, expect.hasRegionConflict, `${name} → hasRegionConflict`);
  }
  if ('conflictReason' in expect) {
    assert.equal(
      recognizeRegion(name).conflictReason ?? null,
      expect.conflictReason,
      `${name} → conflictReason`
    );
  }
  if ('geoRegion' in expect) {
    assert.equal(geo?.name ?? null, expect.geoRegion, `${name} → geoRegion`);
  }
  if ('dynamic' in expect) {
    assert.equal(meta.regionDef?._isDynamic === true, expect.dynamic, `${name} → dynamic`);
  }
  if ('cleanName' in expect) {
    assert.equal(normalize(meta.cleanName), normalize(expect.cleanName), `${name} → cleanName`);
    assert.equal(normalize(attrs.cleanName), normalize(expect.cleanName), `${name} → attrs.cleanName`);
  }
}

describe('【Core】节点命名语法矩阵 (name grammar matrix)', () => {
  describe('纯地区 / 别名 / 国旗', () => {
    const cases = [
      {
        name: '香港 01',
        expect: {
          regionDef: '香港', regionName: '香港', groupKey: 'hk', entryStr: '', transitStr: '',
          lines: [], multiNum: 1, hasExplicitMulti: false, status: 'complete',
          hasRegionConflict: false, geoRegion: '香港', cleanName: '香港 01'
        }
      },
      {
        name: '🇸🇬 新加坡 01',
        expect: {
          regionDef: '新加坡', regionName: '新加坡', groupKey: 'sg', status: 'complete',
          hasRegionConflict: false, geoRegion: '新加坡'
        }
      },
      {
        name: '🇸🇬新 01',
        expect: {
          regionDef: '新加坡', regionName: '新加坡', groupKey: 'sg', status: 'complete',
          hasRegionConflict: false, geoRegion: '新加坡'
        }
      },
      {
        name: '🇳🇪 尼日尔 01',
        expect: {
          regionDef: '尼日尔', regionName: '尼日尔', groupKey: 'ne', status: 'complete',
          hasRegionConflict: false, geoRegion: '尼日尔'
        }
      }
    ];
    for (const c of cases) it(c.name, () => assertNamingCase(c));
  });

  describe('地区 + 线路 / 倍率 / 特征', () => {
    const cases = [
      {
        name: '新加坡 IEPL 2x',
        expect: {
          regionDef: '新加坡', groupKey: 'sg', lines: ['IEPL'], multiNum: 2,
          hasExplicitMulti: true, status: 'complete', cleanName: '新加坡'
        }
      },
      {
        name: '香港 1.5倍',
        expect: {
          regionDef: '香港', multiNum: 1.5, hasExplicitMulti: true, status: 'complete',
          cleanName: '香港'
        }
      },
      {
        name: '香港 倍率: 2.5',
        expect: {
          regionDef: '香港', multiNum: 2.5, hasExplicitMulti: true, status: 'complete',
          cleanName: '香港'
        }
      },
      {
        name: '香港 x0.5',
        expect: {
          regionDef: '香港', multiNum: 0.5, hasExplicitMulti: true, status: 'complete',
          cleanName: '香港'
        }
      },
      {
        name: '香港 01 家宽 流媒体 IPv6 游戏',
        expect: {
          regionDef: '香港', features: ['residential', 'streaming', 'ipv6', 'game'],
          multiNum: 1, hasExplicitMulti: false, status: 'complete',
          cleanName: '香港 01 家宽 流媒体 IPv6 游戏'
        }
      },
      {
        name: '深-港 IEPL x2.0 电信 联通',
        expect: {
          regionDef: '香港', entryStr: '深', lines: ['IEPL', '电联'], multiNum: 2,
          hasExplicitMulti: true, status: 'complete', cleanName: '港'
        }
      }
    ];
    for (const c of cases) it(c.name, () => assertNamingCase(c));
  });

  describe('入口 + 落地（两段）', () => {
    const cases = [
      {
        name: '深-港 IEPL 01',
        expect: {
          regionDef: '香港', regionName: '香港', groupKey: 'hk', entryStr: '深',
          transitStr: '', lines: ['IEPL'], status: 'complete', hasRegionConflict: false,
          geoRegion: '香港', cleanName: '港 01'
        }
      },
      {
        name: 'SZX-HK 01',
        expect: {
          regionDef: '香港', regionName: '香港', groupKey: 'hk', entryStr: '深',
          transitStr: '', status: 'complete', hasRegionConflict: false,
          geoRegion: '香港', cleanName: 'HK 01'
        }
      },
      {
        name: '上海-日本 2x',
        expect: {
          regionDef: '日本', regionName: '日本', groupKey: 'jp', entryStr: '沪',
          transitStr: '', lines: [], multiNum: 2, hasExplicitMulti: true,
          status: 'complete', hasRegionConflict: false, geoRegion: '日本', cleanName: '日本'
        }
      },
      {
        name: '深港专线',
        expect: {
          regionDef: '香港', regionName: '香港', groupKey: 'hk', entryStr: '深',
          transitStr: '', lines: ['专线'], status: 'complete', hasRegionConflict: false,
          geoRegion: '香港', cleanName: '港'
        }
      }
    ];
    for (const c of cases) it(c.name, () => assertNamingCase(c));
  });

  describe('入口 + 枢纽 + 独立落地（三段）', () => {
    const cases = [
      {
        name: '新加坡 沪港 2x',
        expect: {
          regionDef: '新加坡', regionName: '新加坡', groupKey: 'sg', entryStr: '沪',
          transitStr: '沪港', lines: ['沪港'], multiNum: 2, hasExplicitMulti: true,
          status: 'complete', hasRegionConflict: false, geoRegion: '新加坡',
          cleanName: '新加坡'
        }
      },
      {
        name: '东京 沪港 2x',
        expect: {
          regionDef: '日本', regionName: '日本', groupKey: 'jp', entryStr: '沪',
          transitStr: '沪港', lines: ['沪港'], multiNum: 2, hasExplicitMulti: true,
          status: 'complete', hasRegionConflict: false, geoRegion: '日本', cleanName: '东京'
        }
      },
      {
        name: '新加坡 深-港 2x',
        expect: {
          regionDef: '新加坡', regionName: '新加坡', groupKey: 'sg', entryStr: '深',
          transitStr: '深-港', lines: ['深-港'], multiNum: 2, hasExplicitMulti: true,
          status: 'complete', hasRegionConflict: false, geoRegion: '新加坡',
          cleanName: '新加坡'
        }
      },
      {
        name: '新加坡 沪港 2x 家宽 IPV6',
        expect: {
          regionDef: '新加坡', groupKey: 'sg', entryStr: '沪', transitStr: '沪港',
          lines: ['沪港'], features: ['residential', 'ipv6'], multiNum: 2,
          hasExplicitMulti: true, status: 'complete', hasRegionConflict: false,
          cleanName: '新加坡 家宽 IPV6'
        }
      }
    ];
    for (const c of cases) it(c.name, () => assertNamingCase(c));
  });

  describe('冲突 / 不确定 / 噪声防护', () => {
    const cases = [
      {
        name: '香港 日本 专线 01',
        expect: {
          regionDef: '日本', regionName: null, groupKey: 'unknown', lines: ['专线'],
          status: 'partial', hasRegionConflict: true, conflictReason: 'multi-region',
          geoRegion: '日本'
        }
      },
      {
        name: '🇯🇵 香港 01',
        expect: {
          regionDef: '香港', regionName: null, groupKey: 'unknown', status: 'partial',
          hasRegionConflict: true, conflictReason: 'flag-text', geoRegion: '香港'
        }
      },
      {
        name: '🇭🇰🇯🇵 01',
        expect: {
          regionDef: null, regionName: null, groupKey: 'unknown', status: 'partial',
          hasRegionConflict: true, conflictReason: 'multi-flag', geoRegion: null
        }
      },
      {
        name: 'Node-A-102',
        expect: {
          regionDef: null, regionName: null, groupKey: 'unknown', status: 'unknown',
          hasRegionConflict: false, geoRegion: null
        }
      },
      {
        name: '[压测订阅] 更新时间18:33',
        expect: {
          regionDef: null, status: 'unknown', hasRegionConflict: false, geoRegion: null
        }
      },
      {
        name: '每天更新，请加电报群防止失联',
        expect: {
          regionDef: null, status: 'unknown', hasRegionConflict: false, geoRegion: null
        }
      }
    ];
    for (const c of cases) it(c.name, () => assertNamingCase(c));
  });

  describe('动态建区', () => {
    const cases = [
      {
        name: '🇦🇦 测试地 01',
        expect: {
          regionDef: '测试地', regionName: '测试地', groupKey: '测试地', dynamic: true,
          status: 'complete', hasRegionConflict: false, geoRegion: '测试地'
        }
      }
    ];
    for (const c of cases) it(c.name, () => assertNamingCase(c));
  });
});
