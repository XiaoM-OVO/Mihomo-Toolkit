/**
 * 隔离池（家宽 / 高倍率 / 实验）的特性门语义
 *
 * `enableIsolation` 是总开关：开 -> 启用三个内置隔离池（建组 + 成员从主力池剔除）；
 * 关 -> 不建组、不剔除，指向它的分流规则自动跳过（而不是留下悬空引用）。
 * 池名本身始终是合法路由目标，所以关掉隔离不需要去 routing 表里逐条注释。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildDefaultOutput } = require('../fixtures/default-output.scenario');
const { DEFAULT_ROUTING } = require('../../src/data/default-routing');

const BASE = DEFAULT_ROUTING.filter(entry => entry.preset !== 'final');

/** 构造「在 final 之前插一条指向隔离池的规则」的配置 */
function withRule(to, extra = {}) {
  return { ...extra, routing: [...BASE, { rule: 'DOMAIN-SUFFIX,iso.example', to }, { preset: 'final' }] };
}

const hasProbeRule = out => out.rules.some(rule => rule.includes('iso.example'));
const hasGroup = (out, name) => out['proxy-groups'].some(group => group.name.includes(name));

describe('【Pipeline】隔离池由 enableIsolation 门控（家宽 / 高倍率 / 实验）', () => {
  it('隔离关闭：不建组、规则自动跳过（池名仍是合法目标，不会报错）', () => {
    const out = buildDefaultOutput(withRule('实验节点'));
    assert.equal(hasGroup(out, '实验节点'), false);
    assert.equal(hasProbeRule(out), false);
  });

  it('隔离打开但没有合格节点：不建空组，规则同样跳过', () => {
    const out = buildDefaultOutput(withRule('实验节点', { enableIsolation: true }));
    assert.equal(hasGroup(out, '实验节点'), false);
    assert.equal(hasProbeRule(out), false);
  });

  it('隔离打开且有家宽节点：建组、规则保留', () => {
    const out = buildDefaultOutput(withRule('家宽优选', { enableIsolation: true }));
    const group = out['proxy-groups'].find(item => item.name.includes('家宽优选'));
    assert.ok(group, '家宽优选组应被建出来');
    assert.ok(group.proxies.length > 0, '家宽优选组应有成员');
    assert.equal(hasProbeRule(out), true);
  });

  it('`@pool:` 指向未启用的内置池时 fail-closed（显式要池就必须存在）', () => {
    assert.throws(
      () => buildDefaultOutput(withRule('@pool:实验节点')),
      /节点池「实验节点」未启用.*enableIsolation: true/
    );
  });

  it('拼错的组名仍然 fail-closed（条件合法不等于随便写）', () => {
    assert.throws(() => buildDefaultOutput(withRule('实验组')), /目标组「实验组」未声明或不存在/);
  });
});
