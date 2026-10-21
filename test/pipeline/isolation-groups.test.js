/**
 * 隔离组（家宽 / 高倍率 / 实验）的开关语义
 *
 * 开关是「特性门」：开 -> 建组 + 把匹配节点从主力池剔除；关 -> 不建组、不剔除，
 * 指向它的分流规则自动跳过（而不是留下悬空引用）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildDefaultOutput } = require('../fixtures/default-output.scenario');
const { DEFAULT_ROUTING } = require('../../src/data/default-routing');

const BASE = DEFAULT_ROUTING.filter(entry => entry.preset !== 'final');

/** 构造「在 final 之前插一条指向隔离组的规则」的配置 */
function withRule(to, extra = {}) {
  return { ...extra, routing: [...BASE, { rule: 'DOMAIN-SUFFIX,iso.example', to }, { preset: 'final' }] };
}

const hasProbeRule = out => out.rules.some(rule => rule.includes('iso.example'));
const hasGroup = (out, name) => out['proxy-groups'].some(group => group.name.includes(name));

describe('【Pipeline】隔离组由开关门控（家宽 / 高倍率 / 实验）', () => {
  it('开关关闭：不建组、规则自动跳过（条目留在表里不会变成悬空引用）', () => {
    const out = buildDefaultOutput(withRule('实验节点'));
    assert.equal(hasGroup(out, '实验节点'), false);
    assert.equal(hasProbeRule(out), false);
  });

  it('开关打开但没有合格节点：不建空组，规则同样跳过', () => {
    const out = buildDefaultOutput(withRule('实验节点', { isolateExperimental: true }));
    assert.equal(hasGroup(out, '实验节点'), false);
    assert.equal(hasProbeRule(out), false);
  });

  it('开关打开且有家宽节点：建组、规则保留', () => {
    const out = buildDefaultOutput(withRule('家宽优选', { enableResidential: true }));
    const group = out['proxy-groups'].find(item => item.name.includes('家宽优选'));
    assert.ok(group, '家宽优选组应被建出来');
    assert.ok(group.proxies.length > 0, '家宽优选组应有成员');
    assert.equal(hasProbeRule(out), true);
  });

  it('拼错的组名仍然 fail-closed（条件合法不等于随便写）', () => {
    assert.throws(() => buildDefaultOutput(withRule('实验组')), /目标组「实验组」未声明或不存在/);
  });
});
