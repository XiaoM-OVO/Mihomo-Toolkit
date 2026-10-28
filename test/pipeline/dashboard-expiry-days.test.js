const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { generateInfoNodes, buildGlobalDashboardNodes, sortDashboardNodes } = require('../../src/strategy/dashboard');
const { markTrustedSynthetic } = require('../../src/core/node-trust');

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

  test('已过期时只标记「已失效」，不再计算失效天数', () => {
    const { nodes } = generateInfoNodes(`expire=${expireIn(-1.5 * DAY_MS)}`, '机场A');
    const expireNode = nodes.find(n => n.name.includes('已失效'));
    assert.ok(expireNode);
    assert.match(expireNode.name, /\(已失效\)/);
    assert.doesNotMatch(expireNode.name, /已失效 \d+ 天/);
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

  test('提前截断：到期前 24 小时内渲染「已停用」，不再展示流量或即将到期', () => {
    const { nodes } = generateInfoNodes(
      `upload=1; download=1; total=1000; expire=${expireIn(0.4 * DAY_MS)}`,
      '机场A',
      { cutoffHours: 24 }
    );
    const expireNode = nodes.find(n => n.name.includes('到期日'));
    assert.ok(expireNode, '应生成到期看板');
    assert.match(expireNode.name, /已停用/);
    assert.doesNotMatch(expireNode.name, /即将到期|已失效/);
    assert.ok(!nodes.some(n => n.name.includes('剩余流量')), '已停用订阅不得再展示流量');
  });

  test('expireCutoffHours=0：关闭提前截断，同一响应仍提示「不足 1 天」', () => {
    const { nodes } = generateInfoNodes(
      `expire=${expireIn(0.4 * DAY_MS)}`,
      '机场A',
      { cutoffHours: 0 }
    );
    const expireNode = nodes.find(n => n.name.includes('即将到期'));
    assert.ok(expireNode);
    assert.match(expireNode.name, /不足 1 天/);
    assert.doesNotMatch(expireNode.name, /已停用/);
  });

  test('全局看板同样按 cutoff 渲染「已停用」', () => {
    const node = buildGlobalDashboardNodes({
      globalUpload: 0,
      globalDownload: 0,
      globalTotal: 0,
      globalExpire: expireIn(0.4 * DAY_MS),
      cutoffHours: 24
    }).find(n => n.name.includes('[全局]'));
    assert.ok(node);
    assert.match(node.name, /已停用/);
    assert.doesNotMatch(node.name, /不足 1 天|已失效/);
  });

  test('全局看板真过期时同样只标记「已失效」', () => {
    const node = buildGlobalDashboardNodes({
      globalUpload: 0,
      globalDownload: 0,
      globalTotal: 0,
      globalExpire: expireIn(-2.5 * DAY_MS)
    }).find(n => n.name.includes('[全局]'));
    assert.ok(node);
    assert.match(node.name, /到期日/);
    assert.match(node.name, /\(已失效\)/);
    assert.doesNotMatch(node.name, /已失效 \d+ 天/);
  });

  test('timezone：日期按指定时区显示，凌晨到期不再被 UTC 截断到前一天', () => {
    // 2026-11-01 00:30 (UTC+8) == 2026-10-31 16:30 UTC
    const expire = Math.floor(new Date('2026-10-31T16:30:00Z').getTime() / 1000);
    // 到期文案随剩余天数切换「到期日 / 即将到期」，断言不应依赖运行日期
    const findExpireNode = nodes => nodes.find(n => /到期日|即将到期/.test(n.name));
    const utcNode = findExpireNode(generateInfoNodes(`expire=${expire}`, 'T', { timeZone: 'UTC' }).nodes);
    const shNode = findExpireNode(generateInfoNodes(`expire=${expire}`, 'T', { timeZone: 'Asia/Shanghai' }).nodes);
    assert.ok(utcNode && shNode, '应生成到期看板');
    assert.match(utcNode.name, /2026-10-31/);
    assert.match(shNode.name, /2026-11-01/);
  });

  test('看板节点按「到期 + 流量」成对排列，状态类节点统一置底', () => {
    const active = generateInfoNodes(
      `upload=0; download=0; total=10737418240; expire=${expireIn(60 * DAY_MS)}`,
      'IK'
    ).nodes;
    const expired = generateInfoNodes(`expire=${expireIn(-2 * DAY_MS)}`, 'LX').nodes;
    const reset = markTrustedSynthetic({
      name: '🔄 [FN] 距离重置剩余：4 天',
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    });
    const realNode = { name: 'DIRECT', type: 'direct', server: '1.0.0.1', port: 80 };

    const names = sortDashboardNodes([...expired, reset, ...active, realNode]).map(n => n.name);
    assert.match(names[0], /到期日/, '第一列应为到期时间');
    assert.match(names[1], /剩余流量/, '第二列应为剩余流量');
    assert.match(names[2], /已失效/, '失效订阅应置底');
    assert.match(names[3], /距离重置/, '重置倒计时应置底');
    assert.equal(names[4], 'DIRECT', '真实节点保持在最后');
  });
});
