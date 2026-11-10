/**
 * 激活摘要收集器：组记录必须收敛为「最终态」，不能同时出现激活与剪枝
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createExplainTrace } = require('../../src/strategy/explain');

function groupRecords(trace) {
  return trace.records.filter(record => record.kind === 'group');
}

describe('createExplainTrace 组记录收敛', () => {
  it('剪枝淘汰覆盖此前的激活快照，且迟到的快照不得反向覆盖', () => {
    const trace = createExplainTrace(true);
    trace.add({ kind: 'group', id: 'ChatGPT', status: 'active', code: 'rule-referenced', members: 8 });
    trace.add({ kind: 'group', id: 'ChatGPT', status: 'pruned', code: 'unreachable', detail: '无路径' });
    trace.add({ kind: 'group', id: 'ChatGPT', status: 'active', code: 'rule-referenced', members: 8 });

    const records = groupRecords(trace);
    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'pruned');
    assert.equal(records[0].code, 'unreachable');
  });

  it('破环事件不把存活的组标成剪枝', () => {
    const trace = createExplainTrace(true);
    trace.add({ kind: 'group', id: 'A', status: 'active', code: 'rule-referenced' });
    trace.add({ kind: 'group', id: 'A', status: 'active', code: 'cycle-broken', detail: '剪断循环依赖' });

    const records = groupRecords(trace);
    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'active');
    assert.equal(records[0].code, 'cycle-broken');
  });

  it('骨架兜底后的成员数覆盖建组快照', () => {
    const trace = createExplainTrace(true);
    trace.add({ kind: 'group', id: '手动选择', status: 'active', code: 'rule-referenced', members: 4 });
    trace.add({ kind: 'group', id: '手动选择', status: 'active', code: 'rescue-direct', members: 1 });

    const records = groupRecords(trace);
    assert.equal(records.length, 1);
    assert.equal(records[0].code, 'rescue-direct');
    assert.equal(records[0].members, 1);
  });

  it('不同组之间互不干扰', () => {
    const trace = createExplainTrace(true);
    trace.add({ kind: 'group', id: 'A', status: 'active', code: 'rule-referenced' });
    trace.add({ kind: 'group', id: 'B', status: 'pruned', code: 'unreachable' });

    assert.equal(groupRecords(trace).length, 2);
  });
});
