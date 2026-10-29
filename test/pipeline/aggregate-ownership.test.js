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
      registries.aggregates['游戏服务'].rules.includes('RULE-SET,mygame,游戏服务'),
      '声明 target: @service 的服务，其规则必须并入「游戏服务」聚合组'
    );
    assert.deepEqual(registries.game.mygame.rules, ['RULE-SET,mygame,游戏服务']);
  });

  it('社交服务一服务一组：规则目标即自身组名，且各自可被 groups 引用', () => {
    const registries = buildServiceCatalog({}).toRegistries();
    for (const [key, name] of [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['discord', 'Discord']]) {
      assert.deepEqual(registries.social[key].rules, [`RULE-SET,${key},${name}`], `${key} 的规则目标必须是自身组名`);
      assert.deepEqual(registries.social[key].proxies, ['@standardOptions', 'DIRECT'], `${key} 必须自带可引用配方`);
      assert.ok(registries.groups[key], `${key} 必须可被 groups 引用`);
    }
  });

  it('成员键报错指引只指向真正不可单独引用的聚合成员', () => {
    const hints = buildMemberHints(resolveConfig({}).registries);
    assert.equal(hints.steam, 'game-service');
  });

  it('BT / 下载规则由数据表驱动：bt、download 两段归属清晰且都能整段改道', () => {
    const isDownload = rule => /^RULE-SET,(download-games|download-android),.*下载策略$/.test(rule);
    const isDownloadProcess = rule => /^PROCESS-NAME,(IDMan|fdm)\.exe,.*下载策略$/.test(rule);
    const { DEFAULT_ROUTING } = require('../../src/data/default-routing');
    const withoutBt = DEFAULT_ROUTING.filter(entry => entry.preset !== 'bt');
    const withoutDownload = DEFAULT_ROUTING.filter(entry => entry.preset !== 'download');

    const on = strategyMain(withNodes({}), {}).rules;
    assert.ok(on.includes('RULE-SET,bt-trackers-pt,DIRECT'), 'BT 追踪器应直连');
    assert.ok(on.includes('DOMAIN-KEYWORD,tracker,DIRECT'), 'tracker 关键字兜底应注入');
    assert.ok(on.includes('PROCESS-NAME,qBittorrent.exe,DIRECT'), 'BT 客户端进程应归 bt 段并直连');
    assert.ok(on.some(isDownloadProcess), '下载软件进程默认走下载策略');
    assert.ok(on.some(isDownload), '下载规则集默认走下载策略');

    const offBt = strategyMain(withNodes({}), { routing: withoutBt }).rules;
    assert.ok(!offBt.some(rule => /^RULE-SET,bt-trackers-pt,/.test(rule)), '删掉 bt 预设后追踪器规则应消失');
    assert.ok(!offBt.some(rule => /^DOMAIN-KEYWORD,(tracker|announce),/.test(rule)), '删掉 bt 预设后关键字兜底也应消失');
    assert.ok(!offBt.some(rule => /^PROCESS-NAME,qBittorrent/.test(rule)), '删掉 bt 预设后 BT 客户端规则应消失');
    assert.ok(offBt.some(isDownloadProcess), 'download 预设不受 bt 影响');

    const offDownload = strategyMain(withNodes({}), { routing: withoutDownload }).rules;
    assert.ok(!offDownload.some(isDownload), '删掉 download 预设后下载规则集应消失');
    assert.ok(!offDownload.some(isDownloadProcess), '删掉 download 预设后下载软件进程规则应消失');
    assert.ok(offDownload.includes('PROCESS-NAME,qBittorrent.exe,DIRECT'), 'bt 预设不受 download 影响');

    // 整段改道：to 对 bt / download 生效（ref 键解析为真实组名），不再静默忽略
    const rerouted = strategyMain(withNodes({}), {
      routing: [{ preset: 'bt', to: 'github' }, { preset: 'download', to: 'github' }]
    }).rules;
    assert.ok(rerouted.includes('RULE-SET,bt-trackers-pt,🐱 GitHub'), 'bt 预设的 to 必须作用于追踪器');
    assert.ok(rerouted.includes('PROCESS-NAME,qBittorrent.exe,🐱 GitHub'), 'bt 预设的 to 必须作用于 BT 客户端进程');
    assert.ok(rerouted.includes('RULE-SET,download-games,🐱 GitHub'), 'download 预设的 to 必须作用于下载规则集');
    assert.ok(rerouted.includes('PROCESS-NAME,IDMan.exe,🐱 GitHub'), 'download 预设的 to 必须作用于下载软件进程');
  });

  it('process 预设的 to 生效：自定义进程名单可整段改道', () => {
    const rules = strategyMain(withNodes({}), {
      customProcessWin: ['CustomApp'],
      routing: [{ preset: 'process', to: 'github' }]
    }).rules;
    assert.ok(rules.includes('PROCESS-NAME,CustomApp.exe,🐱 GitHub'), 'process 预设的 to 不得被静默忽略');
  });

  it('低倍率池纯粹按倍率圈定节点，轮询出口排除禁止下载，下载策略作为正常业务组引用轮询出口', () => {
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
    assert.ok(policy.proxies.includes('DIRECT'), '下载策略首位为 DIRECT 直连');
    assert.ok(policy.proxies.includes('🔄 负载均衡-轮询'), '下载策略引用轮询出口');
    assert.ok(exit.proxies.some(n => n.includes('香港 01')), '轮询出口展开可用低倍率成员');
    assert.equal(exit.proxies.some(n => n.includes('香港 02')), false, '轮询出口按正则排除严禁BT低倍率节点');
  });

  it('低倍率池为空时依然生成下载策略，指向它的下载规则保留，但轮询出口被裁剪', () => {
    const node = (name, server) => ({ name, type: 'ss', server, port: 443, cipher: 'aes-128-gcm', password: 'p' });
    const out = strategyMain({ proxies: [node('🇯🇵 日本 01', 'jp1.node.com')] }, {});
    assert.equal(out['proxy-groups'].some(g => g.name === '⏬ 下载策略'), true, '下载策略作为正常业务组应保留');
    assert.equal(out['proxy-groups'].some(g => g.name === '🔄 负载均衡-轮询'), false, '空轮询组应被剪除');
    assert.equal(out.rules.some(r => r.includes('⏬ 下载策略')), true, '下载策略保留时规则不得被剪除');
  });
});
