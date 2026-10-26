const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { generateInfoNodes, buildGlobalDashboardNodes } = require('../../src/strategy/dashboard');

const DAY_MS = 24 * 60 * 60 * 1000;

function expireIn(offsetMs) {
  return Math.floor((Date.now() + offsetMs) / 1000);
}

describe('【Dashboard】到期剩余天数展示语义', () => {
  test('剩余不足 2 天时按完整天数展示为 1 天，不再向上取整成 2 天', () => {
    const { nodes } = generateInfoNodes(`expire=${expireIn(1.9 * DAY_MS)}`, '机场A');
    const expireNode = nodes.find(n => n.name.includes('即将到期'));
    assert.ok(expireNode);
    assert.match(expireNode.name, /仅剩 1 天/);
    assert.doesNotMatch(expireNode.name, /仅剩 2 天/);
  });

  test('尚未过期但不足 1 天时提示「不足 1 天」，不得误报已失效', () => {
    const { nodes } = generateInfoNodes(`expire=${expireIn(0.4 * DAY_MS)}`, '机场A');
    const expireNode = nodes.find(n => n.name.includes('即将到期'));
    assert.ok(expireNode);
    assert.match(expireNode.name, /不足 1 天/);
    assert.doesNotMatch(expireNode.name, /已失效/);
  });

  test('已过期时按完整天数展示已失效天数', () => {
    const { nodes } = generateInfoNodes(`expire=${expireIn(-1.5 * DAY_MS)}`, '机场A');
    const expireNode = nodes.find(n => n.name.includes('已失效'));
    assert.ok(expireNode);
    assert.match(expireNode.name, /已失效 1 天/);
  });

  test('全局看板与单订阅看板使用一致的向下取整语义', () => {
    const nearNode = buildGlobalDashboardNodes({
      globalUpload: 0,
      globalDownload: 0,
      globalTotal: 0,
      globalExpire: expireIn(1.9 * DAY_MS)
    }).find(n => n.name.includes('[全局]'));
    assert.ok(nearNode);
    assert.match(nearNode.name, /仅剩 1 天/);

    const sameDayNode = buildGlobalDashboardNodes({
      globalUpload: 0,
      globalDownload: 0,
      globalTotal: 0,
      globalExpire: expireIn(0.4 * DAY_MS)
    }).find(n => n.name.includes('[全局]'));
    assert.ok(sameDayNode);
    assert.match(sameDayNode.name, /不足 1 天/);
    assert.doesNotMatch(sameDayNode.name, /已失效/);
  });
});
