/**
 * 目标注册表（TargetRegistry）
 *
 * routing 的 `to` 四类写法与十余个目标来源收敛为一张表：
 * 解析、合法性判定与剪枝存活判定必须对同一份事实得出相同结论。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createTargetRegistry } = require('../../src/strategy/target-registry');

const build = (overrides = {}) => createTargetRegistry({ config: {}, registries: {}, ...overrides });

describe('【Strategy】目标注册表 (TargetRegistry)', () => {
  it('内核内置目标大小写归一，目录 ref 键解析为规范组名', () => {
    const registry = build({
      registries: { groups: { chatgpt: { name: 'ChatGPT' } } }
    });
    assert.equal(registry.resolve('direct'), 'DIRECT');
    assert.equal(registry.resolve('reject-drop'), 'REJECT-DROP');
    assert.equal(registry.resolve('chatgpt'), 'ChatGPT', 'ref 键 → 目录规范名');
  });

  it('禁用 ref 键 fail-closed，不再静默放行', () => {
    const registry = build({
      registries: { groups: { claude: { name: 'Claude' } } },
      disabledRefs: ['claude']
    });
    assert.throws(() => registry.resolve('claude'), /被禁用 \(disabled: true\)/);
    assert.throws(() => registry.resolve('Claude'), /被禁用 \(disabled: true\)/);
  });

  it('骨架组 / 地区组 / 大洲组名 / 派生哈希组均为合法目标', () => {
    const registry = build();
    assert.equal(registry.resolve('自动选择'), '自动选择');
    assert.equal(registry.resolve('香港节点'), '香港节点');
    assert.equal(registry.resolve('欧洲节点'), '欧洲节点', '大洲组名与大洲简称同源派生');
    assert.equal(registry.resolve('负载均衡-哈希 (香港)'), '负载均衡-哈希 (香港)');
  });

  it('`@pool:` 只接受当前生效的池；未启用的内置池与未知池分别给出提示', () => {
    const on = build({ config: { enableIsolation: true } });
    assert.equal(on.resolve('@pool:家宽优选'), '家宽优选');
    assert.throws(() => on.resolve('@pool:不存在'), /节点池「不存在」不存在/);

    const off = build({ config: {} });
    assert.throws(
      () => off.resolve('@pool:家宽优选'),
      /节点池「家宽优选」未启用.*enableIsolation: true/,
      '关闭隔离后该池不生效，且提示指向开关而不是报「不存在」'
    );
    assert.equal(off.resolve('家宽优选'), '家宽优选', '池名仍可作为目标，缺席由剪枝层按设计跳过');
  });

  it('池依赖组可被识别：池为空 / 未激活时规则按设计跳过', () => {
    const registry = build();
    assert.equal(registry.isPoolDependent('下载策略'), false, '下载策略不再依赖池，始终作为正常业务组存在');
    assert.equal(registry.isPoolDependent('高倍率优选'), true);
    assert.equal(registry.isPoolDependent('自动选择'), false);
    assert.equal(registry.isPoolDependent('DIRECT'), false);
  });

  it('用户组按流量方向过滤，未知目标 fail-closed', () => {
    const groups = [{ name: '仅回国组', direction: 'return' }];
    const split = build({ config: { groups }, direction: 'split' });
    const ret = build({ config: { groups }, direction: 'return' });
    assert.throws(() => split.resolve('仅回国组'), /未声明或不存在/);
    assert.equal(ret.resolve('仅回国组'), '仅回国组');
    assert.throws(() => ret.resolve('幽灵组'), /未声明或不存在/);
  });
});
