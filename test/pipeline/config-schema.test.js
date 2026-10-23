/**
 * 单一配置 schema 校验层（装载期）测试
 *
 * 目标：任何非法的 groups / routing 配置都在「装载后、装配前」按字段路径 fail-closed，
 * 包括此前会被静默跳过的 `disabled: true` 与方向不符条目。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { resolveConfig } = require('../../src/config');
const { createServiceRegistries } = require('../../src/strategy/registries');
const { validateConfigSchema } = require('../../src/pipeline/config-schema');
const { runStrategyPipeline } = require('../../src/pipeline/strategy');

/**
 * 走与流水线同源的装载 + 校验路径
 * @param {object} [overrides={}]
 */
function validate(overrides = {}) {
  const config = resolveConfig(overrides);
  const registries = createServiceRegistries(config);
  validateConfigSchema(config, registries, { disabledRefs: config.disabledGroupRefs });
}

describe('【Pipeline】单一配置 schema 校验层', () => {
  it('出厂默认配置通过校验', () => {
    assert.doesNotThrow(() => validate());
  });

  it('routing 条目出现未知字段时 fail-closed 并给出路径', () => {
    assert.throws(
      () => validate({ routing: [{ preset: 'final', too: 'DIRECT' }] }),
      /routing\[0\]: 未知字段「too」/
    );
  });

  it('preset / service / rule 同时出现时 fail-closed', () => {
    assert.throws(
      () => validate({ routing: [{ preset: 'final', service: 'netflix' }] }),
      /routing\[0\]: preset \/ service \/ rule 只能出现其一/
    );
  });

  it('disabled 条目同样校验预设与服务拼写（不再静默吞掉）', () => {
    assert.throws(
      () => validate({ routing: [{ preset: 'nope', disabled: true }] }),
      /routing\[0\]\.preset: 未知预设/
    );
    assert.throws(
      () => validate({ routing: [{ preset: 'final' }, { service: 'nepflix', disabled: true }] }),
      /routing\[1\]\.service: 未知服务/
    );
  });

  it('方向不符的条目同样校验，但目标按条目自身方向判定', () => {
    const groups = [
      { name: '回国专线', type: 'select', proxies: ['DIRECT'], direction: 'return' }
    ];
    // split 构建下，return 方向的条目仍然合法：to 用 return 方向的目标表解析
    assert.doesNotThrow(() => validate({
      trafficDirection: 'split',
      groups,
      routing: [{ rule: 'DOMAIN-SUFFIX,x.com', to: '回国专线', direction: 'return' }, { preset: 'final' }]
    }));
    // 同一方向下拼错服务仍然 fail-closed
    assert.throws(
      () => validate({
        trafficDirection: 'split',
        routing: [{ service: 'nepflix', direction: 'return' }, { preset: 'final' }]
      }),
      /routing\[0\]\.service: 未知服务/
    );
  });

  it('规则集简写缺少 `to` 时在装载期报错', () => {
    assert.throws(
      () => validate({ routing: [{ rule: 'geosite:google' }, { preset: 'final' }] }),
      /routing\[0\]: 规则集简写缺少目标 `to`/
    );
    // disabled 条目允许省略 `to`（仅关闭同键槽位，不产出规则）
    assert.doesNotThrow(() => validate({
      routing: [{ rule: 'geosite:google', disabled: true }, { preset: 'final' }]
    }));
  });

  it('`to` 目标不存在时报错带字段路径', () => {
    assert.throws(
      () => validate({ routing: [{ preset: 'final', to: '幽灵组' }] }),
      /routing\[0\]\.to: .*未声明或不存在/
    );
  });

  it('routing 非数组 / 空表都不再静默回退默认值', () => {
    assert.throws(
      () => validate({ routing: 'bad' }),
      /routing: 期望条目对象数组/
    );
    assert.throws(
      () => validate({ routing: [] }),
      /配置为空/
    );
  });

  it('流水线在装配前就因非法 routing 失败', () => {
    assert.throws(
      () => runStrategyPipeline({}, { routing: [{ preset: 'nope', disabled: true }, { preset: 'final' }] }),
      /routing\[0\]\.preset: 未知预设/
    );
  });

  it('流水线在装配前就因非法 groups 配方失败', () => {
    assert.throws(
      () => runStrategyPipeline({}, {
        groups: [{ name: '坏组', type: 'select', match: { nope: 1 } }]
      }),
      /未知匹配维度「nope」/
    );
  });
});
