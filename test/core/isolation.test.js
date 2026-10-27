const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getIsolationBucket } = require('../../src/core/isolation');
const { sortNodes } = require('../../src/core/sort');
const { computeNodeIndices } = require('../../src/core/rename');

describe('【Core】节点隔离策略 (isolation)', () => {
  it('getIsolationBucket - 基础防御与空值安全', () => {
    assert.equal(getIsolationBucket(null), '');
    assert.equal(getIsolationBucket(undefined), '');
    assert.equal(getIsolationBucket('invalid string'), '');
    assert.equal(getIsolationBucket(123), '');
    assert.equal(getIsolationBucket({}), '');
    assert.equal(getIsolationBucket({ tags: [] }), '');
  });

  it('getIsolationBucket - 单一分类识别（enableIsolation 打开后四类都参与）', () => {
    const isolationOn = { enableIsolation: true };
    assert.equal(getIsolationBucket({ tags: ['residential'] }, isolationOn), 'residential');
    assert.equal(
      getIsolationBucket({ attrs: { multiNum: 3.0 } }, { enableIsolation: true, highMultiThreshold: 2.5 }),
      'highMulti'
    );
    assert.equal(getIsolationBucket({ tags: ['lowMulti'] }, isolationOn), 'lowMulti');
    assert.equal(getIsolationBucket({ tags: ['experimental'] }, isolationOn), 'experimental');
  });

  it('getIsolationBucket - 隔离总开关关闭时一律不分类', () => {
    assert.equal(getIsolationBucket({ tags: ['residential'] }, {}), '');
    assert.equal(getIsolationBucket({ tags: ['residential'] }, { enableIsolation: false }), '');
    assert.equal(getIsolationBucket({ attrs: { multiNum: 5.0 } }, {}), '');
    assert.equal(getIsolationBucket({ tags: ['lowMulti'] }, { enableIsolation: false }), '');
    assert.equal(getIsolationBucket({ tags: ['experimental'] }, {}), '');
  });

  it('getIsolationBucket - 优先级顺序严格判定: residential > highMulti > lowMulti > experimental', () => {
    const allEnabled = { enableIsolation: true, highMultiThreshold: 2.0 };

    // 家宽 + 高倍率 -> residential 优先
    assert.equal(
      getIsolationBucket({ tags: ['residential', 'lowMulti', 'experimental'], attrs: { multiNum: 3.0 } }, allEnabled),
      'residential'
    );

    // 高倍率 + 低倍率 + 实验 -> highMulti 优先
    assert.equal(
      getIsolationBucket({ tags: ['lowMulti', 'experimental'], attrs: { multiNum: 3.0 } }, allEnabled),
      'highMulti'
    );

    // 低倍率 + 实验 -> lowMulti 优先
    assert.equal(
      getIsolationBucket({ tags: ['lowMulti', 'experimental'], attrs: { multiNum: 1.0 } }, allEnabled),
      'lowMulti'
    );

    // 仅实验 -> experimental
    assert.equal(
      getIsolationBucket({ tags: ['experimental'], attrs: { multiNum: 1.0 } }, allEnabled),
      'experimental'
    );
  });

  it('getIsolationBucket - 高倍率阈值边界判定 (严格大于 highMultiThreshold)', () => {
    const cfg = { enableIsolation: true, highMultiThreshold: 2.5 };

    assert.equal(getIsolationBucket({ attrs: { multiNum: 2.5 } }, cfg), '');
    assert.equal(getIsolationBucket({ attrs: { multiNum: 2.49 } }, cfg), '');
    assert.equal(getIsolationBucket({ attrs: { multiNum: 2.51 } }, cfg), 'highMulti');

    // 默认阈值 (未传 highMultiThreshold 时默认为 2.5)
    assert.equal(getIsolationBucket({ attrs: { multiNum: 2.5 } }, { enableIsolation: true }), '');
    assert.equal(getIsolationBucket({ attrs: { multiNum: 2.6 } }, { enableIsolation: true }), 'highMulti');

    // 自定义阈值 1.5
    assert.equal(getIsolationBucket({ attrs: { multiNum: 1.6 } }, { enableIsolation: true, highMultiThreshold: 1.5 }), 'highMulti');
    assert.equal(getIsolationBucket({ attrs: { multiNum: 1.5 } }, { enableIsolation: true, highMultiThreshold: 1.5 }), '');
  });

  it('sort.js 集成验证 - 隔离分类通过 isolation.js 参与排序且优先级正确', () => {
    const cfg = { enableIsolation: true, highMultiThreshold: 2.0 };

    const nodeNormal = { rawName: '普通节点', tags: [], attrs: { multiNum: 1.0 } };
    const nodeHighMulti = { rawName: '高倍率节点', tags: [], attrs: { multiNum: 3.0 } };
    const nodeRes = { rawName: '家宽节点', tags: ['residential'], attrs: { multiNum: 1.0 } };
    const nodeLowMulti = { rawName: '下载节点', tags: ['lowMulti'], attrs: { multiNum: 1.0 } };

    // ISOLATION_SORT_ORDER: '' (标准节点): 0, residential: 1, lowMulti: 2, experimental: 3, highMulti: 4
    const sorted = sortNodes([nodeHighMulti, nodeNormal, nodeLowMulti, nodeRes], cfg);
    assert.equal(sorted[0].rawName, '普通节点');
    assert.equal(sorted[1].rawName, '家宽节点');
    assert.equal(sorted[2].rawName, '下载节点');
    assert.equal(sorted[3].rawName, '高倍率节点');
  });

  it('rename.js 集成验证 - computeNodeIndices 支持隔离桶独立轨道编号', () => {
    const items = [
      { rawName: 'Res Node 1', regionInfo: { id: 'hk', name: '香港' }, tags: ['residential'], attrs: { multiNum: 1.0 } },
      { rawName: 'Res Node 2', regionInfo: { id: 'hk', name: '香港' }, tags: ['residential'], attrs: { multiNum: 1.0 } },
      { rawName: 'Normal Node 1', regionInfo: { id: 'hk', name: '香港' }, tags: [], attrs: { multiNum: 1.0 } },
      { rawName: 'Normal Node 2', regionInfo: { id: 'hk', name: '香港' }, tags: [], attrs: { multiNum: 1.0 } }
    ];
    const indexMap = computeNodeIndices(items, { enableIsolation: true });
    // 普通节点与家宽节点分属不同 isoBucket 独立轨道，各自从 01 开始计数
    assert.equal(indexMap.get(items[0]), '01');
    assert.equal(indexMap.get(items[1]), '02');
    assert.equal(indexMap.get(items[2]), '01');
    assert.equal(indexMap.get(items[3]), '02');
  });
});
