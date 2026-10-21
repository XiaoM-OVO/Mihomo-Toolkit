/**
 * 节点池（pools）核心行为
 *
 * 池 = 用 match 条件圈出的一组节点；池名是合法路由目标，被引用时才物化成策略组。
 * 内置池：enableIsolation 门控的三个隔离池 + 恒在的「低倍率节点」（默认隐藏）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildDefaultPools, POOL_NAMES } = require('../../src/data/default-pools');
const { resolvePoolDefinitions } = require('../../src/strategy/pools');
const { buildDefaultOutput } = require('../fixtures/default-output.scenario');
const { DEFAULT_ROUTING } = require('../../src/data/default-routing');

const BASE = DEFAULT_ROUTING.filter(entry => entry.preset !== 'final');
const hasGroup = (out, name) => out['proxy-groups'].some(group => group.name.includes(name));
const hasProbe = out => out.rules.some(rule => rule.includes('pool.example'));

describe('【Strategy】节点池 (pools) 定义与物化', () => {
  it('内置池：隔离关闭时只有「低倍率节点」（默认隐藏），打开后多出三个隔离池', () => {
    const off = buildDefaultPools({});
    assert.deepEqual(off.map(def => def.name), [POOL_NAMES.lowMulti]);
    assert.equal(off[0].hidden, true);
    assert.equal(off[0].isolate, false);

    const on = buildDefaultPools({ enableIsolation: true });
    assert.deepEqual(on.map(def => def.name), [
      POOL_NAMES.residential,
      POOL_NAMES.lowMulti,
      POOL_NAMES.highMulti,
      POOL_NAMES.experimental
    ], '声明顺序即建组顺序');
    assert.ok(
      on.filter(def => def.name !== POOL_NAMES.lowMulti).every(def => def.isolate === true && def.group === 'always')
    );
  });

  it('自定义池：默认按需物化、select、不隔离，且可以用 match 圈节点', () => {
    const defs = resolvePoolDefinitions({
      pools: [{ name: '低延迟节点', match: { region: ['hk', 'jp'] } }]
    });
    const custom = defs.find(def => def.name === '低延迟节点');
    assert.ok(custom, '自定义池应进入池定义列表');
    assert.equal(custom.group, 'onDemand');
    assert.equal(custom.type, 'select');
    assert.equal(custom.isolate, false);
    assert.equal(custom.builtin, false);
  });

  it('自定义池校验：未知字段 / 重名 / 非法适配器都 fail-closed', () => {
    assert.throws(
      () => resolvePoolDefinitions({ pools: [{ name: 'x', match: { tags: ['lowMulti'] }, rules: [] }] }),
      /未知字段「rules」/
    );
    assert.throws(
      () => resolvePoolDefinitions({ pools: [{ name: POOL_NAMES.lowMulti, match: { tags: ['lowMulti'] } }] }),
      /池名「低倍率节点」重复/
    );
    assert.throws(
      () => resolvePoolDefinitions({ pools: [{ name: 'x', match: { tags: ['lowMulti'] }, type: 'url-test' }] }),
      /type 只能是/
    );
    assert.throws(() => resolvePoolDefinitions({ pools: [{ name: 'x' }] }), /缺少 match 条件/);
  });

  it('自定义池被规则引用时才物化；未引用不建组', () => {
    const pools = [{ name: '低延迟节点', match: { region: ['hk', 'jp'] } }];
    const unused = buildDefaultOutput({ pools });
    assert.equal(hasGroup(unused, '低延迟节点'), false, '按需池未被引用时不应建组');

    const used = buildDefaultOutput({
      pools,
      routing: [...BASE, { rule: 'DOMAIN-SUFFIX,pool.example', to: '低延迟节点' }, { preset: 'final' }]
    });
    const group = used['proxy-groups'].find(item => item.name === '低延迟节点');
    assert.ok(group, '被引用的按需池应物化成组');
    assert.ok(group.proxies.length > 0, '池组应有成员');
    assert.equal(hasProbe(used), true, '指向池的规则应保留');
  });

  it('`@pool:<池名>` 求值为组名，可直接当 routing 目标', () => {
    const pools = [{ name: '低延迟节点', match: { region: ['hk', 'jp'] } }];
    const out = buildDefaultOutput({
      pools,
      routing: [...BASE, { rule: 'DOMAIN-SUFFIX,pool.example', to: '@pool:低延迟节点' }, { preset: 'final' }]
    });
    assert.ok(out['proxy-groups'].some(group => group.name === '低延迟节点'));
    assert.ok(out.rules.some(rule => rule === 'DOMAIN-SUFFIX,pool.example,低延迟节点'));
  });

  it('`isolate: true` 的池成员从地区池中剔除（自定义隔离池）', () => {
    const plain = buildDefaultOutput({});
    const jpPlain = plain['proxy-groups'].find(group => group.name.includes('日本'));
    assert.ok(jpPlain && jpPlain.proxies.length > 0, '未隔离时日本组应保留节点');
    const jpNodes = [...jpPlain.proxies];

    const marked = buildDefaultOutput({
      pools: [{ name: '专用线路', match: { region: ['jp'] }, isolate: true }]
    });
    const leaked = marked['proxy-groups']
      .filter(group => group.name.includes('日本'))
      .flatMap(group => group.proxies)
      .filter(name => jpNodes.includes(name));
    assert.deepEqual(leaked, [], '日本节点应被隔离出地区池');
  });
});
