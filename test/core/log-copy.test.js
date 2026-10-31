const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ICONS, TERMS, formatBackoffDetail, buildSubscriptionStateLine } = require('../../src/core/log-copy');

describe('【Core】日志词表与行构造器 (log-copy)', () => {
  it('formatBackoffDetail 统一退避明细句式，缺省字段自动省略', () => {
    const sixHours = 6 * 3600 * 1000;
    assert.strictEqual(
      formatBackoffDetail({ failures: 1, delayMs: sixHours, remainingMs: sixHours }),
      '第 1 次失败 · 退避 6h · 剩余 6h'
    );
    assert.strictEqual(formatBackoffDetail(), '');
    assert.strictEqual(formatBackoffDetail({ failures: 2 }), '第 2 次失败');
  });

  it('瞬时退避与终态长冷却必须使用不同措辞', () => {
    const transient = buildSubscriptionStateLine({
      tag: 'Sub', skipped: true, backoffFailures: 1, backoffTotalSec: 30, retryInSec: 30
    });
    assert.ok(transient.includes(TERMS.BACKOFF_SKIP));
    assert.ok(!transient.includes(TERMS.TERMINAL));

    const terminal = buildSubscriptionStateLine({
      tag: 'Sub', terminal: true, failReason: 'HTTP 401', backoffFailures: 1,
      backoffTotalSec: 6 * 3600, retryInSec: 6 * 3600
    });
    assert.ok(terminal.includes(TERMS.TERMINAL));
    assert.ok(terminal.includes(`${TERMS.LONG_COOLDOWN} 6h`));
  });

  it('退避跳过不得被描述为拉取失败', () => {
    const line = buildSubscriptionStateLine({
      tag: 'Sub', skipped: true, backoffFailures: 1, backoffTotalSec: 60, retryInSec: 60
    });
    assert.ok(line.includes(ICONS.BACKOFF));
    assert.ok(!line.includes(TERMS.FETCH_FAILED));
  });
});
