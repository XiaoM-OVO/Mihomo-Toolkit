/**
 * 聚合归属与下载规则的数据化回归
 * -----------------------------------------------------------------------------
 * 锁住两条「取消特殊机制」的决策：
 *   1) 聚合组归属**只由规则目标（target）决定**——不再有成员清单、不再有多聚合仲裁；
 *      因此新增一个聚合成员 = 在服务定义里加 `target`，不需要改任何代码。
 *   2) BT / 下载类规则由**数据表**驱动——开关只切换目标，新增规则集只加一行数据。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { runStrategyPipeline: strategyMain } = require('../../src/pipeline/strategy');
const { buildServiceCatalog, buildMemberHints } = require('../../src/config/catalog');
const { resolveConfig } = require('../../src/config');

const NODES = [
  { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
  { name: '🇯🇵 日本 01', type: 'ss', server: 'jp1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' },
  // 低倍率节点：下载策略组只在此池非空时生成
  { name: '🇭🇰 香港 02 x0.2', type: 'ss', server: 'hk2.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p3' }
];

const withNodes = extra => ({ proxies: structuredClone(NODES), ...extra });

describe('【Pipeline】聚合归属与下载规则数据化 (aggregate-ownership)', () => {
  it('聚合归属由规则目标决定：自定义 game 服务声明 target:@service 即并入「游戏服务」', () => {
    const registries = buildServiceCatalog({
      customServices: {
        game: { mygame: { name: 'MyGame', rules: 'mygame', target: '@service' } }
      }
    }).toRegistries();

    assert.ok(
      registries.groups['game-service'].rules.includes('RULE-SET,mygame,游戏服务'),
      '声明 target: @service 的服务，其规则必须并入「游戏服务」聚合组'
    );
    assert.deepEqual(registries.game.mygame.rules, ['RULE-SET,mygame,游戏服务']);
  });

  it('社交服务一服务一组：规则目标即自身组名，且各自可被 groups 引用', () => {
    const registries = buildServiceCatalog({}).toRegistries();
    assert.equal(registries.groups['social-platform'], undefined, '社交聚合组已取消（一服务一组）');
    for (const [key, name] of [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['discord', 'Discord']]) {
      assert.deepEqual(registries.social[key].rules, [`RULE-SET,${key},${name}`], `${key} 的规则目标必须是自身组名`);
      assert.deepEqual(registries.social[key].proxies, ['@standardOptions', 'DIRECT'], `${key} 必须自带可引用配方`);
      assert.ok(registries.groups[key], `${key} 必须可被 groups 引用`);
    }
  });

  it('成员键报错指引只指向真正不可单独引用的聚合成员', () => {
    const hints = buildMemberHints(resolveConfig({}).registries);
    assert.equal(hints.steam, 'game-service');
    assert.equal(hints.facebook, undefined, 'facebook 现在可单独引用，不应再给聚合指引');
    assert.equal(hints.meta, undefined, 'meta 条目已删除');
  });

  it('BT / 下载规则由数据表驱动：process、bt、download 三段互不影响且都能改道', () => {
    const isDownload = rule => /^RULE-SET,(download-games|download-android),.*下载策略$/.test(rule);
    const { DEFAULT_ROUTING } = require('../../src/data/default-routing');
    const withoutProcess = DEFAULT_ROUTING.filter(entry => entry.preset !== 'process');
    const withoutBt = DEFAULT_ROUTING.filter(entry => entry.preset !== 'bt');
    const withoutDownload = DEFAULT_ROUTING.filter(entry => entry.preset !== 'download');

    const on = strategyMain(withNodes({}), {}).rules;
    assert.ok(on.includes('RULE-SET,bt-trackers-pt,DIRECT'), 'BT 追踪器应直连');
    assert.ok(on.includes('DOMAIN-KEYWORD,tracker,DIRECT'), 'tracker 关键字兜底应注入');
    assert.ok(on.some(isDownload), '下载规则集默认走下载策略');

    const offProcess = strategyMain(withNodes({}), { routing: withoutProcess }).rules;
    assert.ok(!offProcess.some(rule => rule.startsWith('PROCESS-NAME,qbittorrent')), '删掉 process 预设后直连进程规则应消失');
    assert.ok(offProcess.some(rule => /^RULE-SET,bt-trackers-pt,/.test(rule)), 'bt 预设独立于 process');

    const offBt = strategyMain(withNodes({}), { routing: withoutBt }).rules;
    assert.ok(!offBt.some(rule => /^RULE-SET,bt-trackers-pt,/.test(rule)), '删掉 bt 预设后追踪器规则应消失');
    assert.ok(!offBt.some(rule => /^DOMAIN-KEYWORD,(tracker|announce),/.test(rule)), '删掉 bt 预设后关键字兜底也应消失');
    assert.ok(offBt.some(isDownload), 'download 预设不受 bt 影响');

    const offDownload = strategyMain(withNodes({}), { routing: withoutDownload }).rules;
    assert.ok(!offDownload.some(isDownload), '删掉 download 预设后下载规则应消失');

    // 整段改道：to 对 bt / download 生效（ref 键解析为真实组名），不再静默忽略
    const rerouted = strategyMain(withNodes({}), {
      routing: [{ preset: 'bt', to: 'github' }, { preset: 'download', to: 'github' }]
    }).rules;
    assert.ok(rerouted.includes('RULE-SET,bt-trackers-pt,🐱 GitHub'), 'bt 预设的 to 必须生效');
    assert.ok(rerouted.includes('RULE-SET,download-games,🐱 GitHub'), 'download 预设的 to 必须生效');
  });

  it('低倍率池纯粹按倍率圈定节点，下载组与轮询出口直接按池展开', () => {
    const node = (name, server) => ({ name, type: 'ss', server, port: 443, cipher: 'aes-128-gcm', password: 'p' });
    const out = strategyMain({
      proxies: [
        node('🇭🇰 香港 01 x0.2', 'hk1.node.com'),
        node('🇭🇰 香港 02 x0.2 严禁BT', 'hk2.node.com'),
        node('🇯🇵 日本 01', 'jp1.node.com')
      ]
    }, {});

    const groups = out['proxy-groups'];
    const pool = groups.find(g => g.name === '低倍率节点');
    const policy = groups.find(g => g.name === '⏬ 下载策略');
    const exit = groups.find(g => g.name === '🔄 负载均衡-轮询');
    assert.ok(pool, '低倍率池非空时必须物化成隐藏组');
    assert.equal(pool.hidden, true, '低倍率节点组默认隐藏');
    assert.ok(pool.proxies.some(n => n.includes('香港 01')), '低倍率节点进入低倍率池');
    assert.ok(pool.proxies.some(n => n.includes('香港 02')), '严禁BT低倍率节点同样按倍率进入低倍率池');
    assert.ok(policy, '低倍率池非空时必须生成下载策略');
    assert.ok(exit, '低倍率池非空时必须生成轮询出口');
    assert.ok(policy.proxies.some(n => n.includes('香港 01')), '下载策略展开低倍率成员');
    assert.ok(policy.proxies.some(n => n.includes('香港 02')), '下载策略展开低倍率成员');
    assert.ok(exit.proxies.some(n => n.includes('香港 01')), '轮询出口展开低倍率成员');
    assert.ok(exit.proxies.some(n => n.includes('香港 02')), '轮询出口展开低倍率成员');
  });

  it('低倍率池为空时不生成下载组，指向它的下载规则同步剪除', () => {
    const node = (name, server) => ({ name, type: 'ss', server, port: 443, cipher: 'aes-128-gcm', password: 'p' });
    const out = strategyMain({ proxies: [node('🇯🇵 日本 01', 'jp1.node.com')] }, {});
    assert.equal(out['proxy-groups'].some(g => g.name === '⏬ 下载策略'), false, '空池不应生成空壳组');
    assert.equal(out.rules.some(r => r.includes('⏬ 下载策略')), false, '空组不该留下悬空规则');
  });
});
