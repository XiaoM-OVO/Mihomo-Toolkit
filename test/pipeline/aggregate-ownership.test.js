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
  it('聚合归属由 target 决定：自定义服务声明 target 即并入聚合，未声明则保持自身组名', () => {
    const registries = buildServiceCatalog({
      customServices: {
        social: {
          threads: { name: 'Threads', rules: 'threads', target: '@combined' },
          solo: { name: 'Solo', rules: 'solo' }
        }
      }
    }).toRegistries();

    assert.ok(
      registries.groups['social-platform'].rules.includes('RULE-SET,threads,社交平台'),
      '声明 target: @combined 的服务，其规则必须并入「社交平台」聚合组'
    );
    assert.equal(registries.groups['social-platform'].providers.threads, 'geosite/threads');
    assert.ok(
      !registries.groups['social-platform'].rules.some(rule => rule.includes('Solo')),
      '未声明 target 的服务不得被推断进聚合组'
    );
    assert.deepEqual(registries.social.solo.rules, ['RULE-SET,solo,Solo']);
  });

  it('内置社交成员的规则在解析期就落成聚合组名（不再依赖成员清单事后改写）', () => {
    const registries = buildServiceCatalog({}).toRegistries();
    for (const key of ['facebook', 'instagram', 'discord']) {
      assert.deepEqual(
        registries.social[key].rules,
        [`RULE-SET,${key},社交平台`],
        `${key} 的规则目标必须在解析期就是聚合组名`
      );
    }
  });

  it('成员键报错指引取自规则目标：meta 不再被错误指引到 social-platform', () => {
    const hints = buildMemberHints(resolveConfig({}).registries);
    assert.equal(hints.facebook, 'social-platform');
    assert.equal(hints.steam, 'game-service');
    assert.equal(hints.meta, undefined, 'meta 的目标是自身组名 Meta，不属于任何聚合组');
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
