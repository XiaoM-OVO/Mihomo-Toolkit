const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { generateInfoNodes, buildGlobalDashboardNodes, sortDashboardNodes, createResetNode } = require('../../src/strategy/dashboard');
const { markTrustedSynthetic } = require('../../src/core/node-trust');
const { runNodesPipeline } = require('../../src/pipeline/nodes');

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

  test('四层排序契约：全局(1) ➔ 常规成对(2) ➔ 纯流量(3) ➔ 状态垫底(4)', () => {
    // 1. 全局节点 (Tier 1)
    const globalNodes = buildGlobalDashboardNodes({
      globalUpload: 1024,
      globalDownload: 1024,
      globalTotal: 100 * 1024 * 1024 * 1024,
      globalExpire: expireIn(30 * DAY_MS)
    });

    // 2. 常规时限订阅 (Tier 2: [到期, 流量])
    const timedSub = generateInfoNodes(
      `upload=0; download=0; total=${50 * 1024 * 1024 * 1024}; expire=${expireIn(45 * DAY_MS)}`,
      '常规机场'
    ).nodes;

    // 3. 纯流量订阅 (Tier 3: 仅流量，无 expire)
    const trafficOnlySub1 = generateInfoNodes(
      'upload=0; download=0; total=200000000000',
      '纯流量A'
    ).nodes;
    const trafficOnlySub2 = generateInfoNodes(
      'upload=0; download=0; total=100000000000',
      '纯流量B'
    ).nodes;

    // 4. 状态类节点 (Tier 4: 重置、降级、失效)
    const resetNode = markTrustedSynthetic({
      name: '🔄 [常规机场] 距离重置剩余：15 天',
      type: 'direct',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    });
    const expiredSub = generateInfoNodes(`expire=${expireIn(-5 * DAY_MS)}`, '过期机场').nodes;

    const realProxy = { name: '🇭🇰 香港 01', type: 'ss', server: '1.2.3.4', port: 443 };

    // 乱序输入进排序器
    const shuffled = [
      ...expiredSub,
      ...trafficOnlySub2,
      resetNode,
      ...timedSub,
      realProxy,
      ...globalNodes,
      ...trafficOnlySub1
    ];

    const sorted = sortDashboardNodes(shuffled);
    const names = sorted.map(n => n.name);

    // 验证 Tier 1 (全局总盘在最前，成对到期在左，流量在右)
    assert.match(names[0], /\[全局\] 最早到期/);
    assert.match(names[1], /\[全局\] 剩余流量/);

    // 验证 Tier 2 (常规订阅成对紧随其后)
    assert.match(names[2], /\[常规机场\]\s*到期日/);
    assert.match(names[3], /\[常规机场\]\s*剩余流量/);

    // 验证 Tier 3 (纯流量订阅同类并排集中在第三层)
    assert.ok(names.slice(4, 6).some(n => n.includes('[纯流量A]')), '纯流量A应在第三层');
    assert.ok(names.slice(4, 6).some(n => n.includes('[纯流量B]')), '纯流量B应在第三层');

    // 验证 Tier 4 (状态与异常类统一垫底)
    assert.match(names[6], /\[过期机场\]\s*到期日.*已失效/);
    assert.match(names[7], /\[常规机场\]\s*距离重置剩余/);

    // 真实代理节点保持在末尾
    assert.equal(names[8], '🇭🇰 香港 01');
  });

  test('端到端：管线排序不得用字母序覆盖看板梯队顺序', async () => {
    const buildInput = () => {
      const globalNodes = buildGlobalDashboardNodes({
        globalUpload: 0,
        globalDownload: 0,
        globalTotal: 100 * 1024 * 1024 * 1024,
        globalExpire: expireIn(60 * DAY_MS)
      });
      const timed = generateInfoNodes(
        `upload=0; download=0; total=${10 * 1024 * 1024 * 1024}; expire=${expireIn(60 * DAY_MS)}`,
        'IK'
      ).nodes;
      const expired = generateInfoNodes(`expire=${expireIn(-2 * DAY_MS)}`, 'LX').nodes;
      const reset = createResetNode('FN', '距离重置剩余：4 天');
      const real = { name: 'HK 01', type: 'ss', server: '1.2.3.4', port: 443, cipher: 'aes-256-gcm', password: 'p' };
      return [...globalNodes, ...timed, ...expired, reset, real];
    };

    for (const enableNodeSort of [false, true]) {
      const output = await runNodesPipeline(buildInput(), {
        enableDashboard: true,
        enableNodeSort,
        enableNodeRename: false
      });
      const names = output.map(n => n.name);

      assert.match(names[0], /\[全局\] 最早到期/, `enableNodeSort=${enableNodeSort}`);
      assert.match(names[1], /\[全局\] 剩余流量/, `enableNodeSort=${enableNodeSort}`);
      assert.match(names[2], /\[IK\]\s*到期日/, `enableNodeSort=${enableNodeSort}`);
      assert.match(names[3], /\[IK\]\s*剩余流量/, `enableNodeSort=${enableNodeSort}`);
      assert.match(names[4], /\[LX\]\s*到期日.*已失效/, `enableNodeSort=${enableNodeSort}`);
      assert.match(names[5], /\[FN\]\s*距离重置剩余/, `enableNodeSort=${enableNodeSort}`);
      assert.equal(names[6], 'HK 01', `enableNodeSort=${enableNodeSort}`);
    }
  });
});
