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
  { name: '🇯🇵 日本 01', type: 'ss', server: 'jp1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' }
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

  it('BT / 下载规则由数据表驱动：进程直连开关只切换目标，不增删代码分支', () => {
    const isDownload = rule => /^RULE-SET,(download-games|download-android),.*下载策略$/.test(rule);

    const on = strategyMain(withNodes({}), { enableProcessDirect: true }).rules;
    assert.ok(on.includes('RULE-SET,bt-trackers-pt,DIRECT'), '开启时应直连追踪器');
    assert.ok(on.includes('DOMAIN-KEYWORD,tracker,DIRECT'), '开启时应注入 tracker 关键字兜底');
    assert.ok(on.some(isDownload));

    const off = strategyMain(withNodes({}), { enableProcessDirect: false }).rules;
    assert.ok(off.some(rule => /^RULE-SET,bt-trackers-pt,.*下载策略$/.test(rule)), '关闭时应交给下载策略组');
    assert.ok(!off.some(rule => /^DOMAIN-KEYWORD,(tracker|announce),/.test(rule)), '关闭时不得注入关键字兜底');
    assert.ok(off.some(isDownload));
  });
});
