/**
 * `routing` 表展开引擎的等价性与语义测试
 *
 * 第一组（等价）：默认 routing 表展开后，必须与**冻结基线**
 * `test/fixtures/routing-baseline.json`（批次 3 之前由旧实现产出的逐条快照）
 * 在多种配置下产出**逐条相等**的规则与 Provider —— 这是「机制迁移不改变产物」
 * 的可执行证明，也是 `DEFAULTS.md` 第三节 59 条顺序的守护。
 *
 * 第二组（语义）：`to` 覆写、`disabled`、`service`/`rule` 条目、失败路径。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { resolveConfig } = require('../../src/config');
const { createServiceRegistries } = require('../../src/strategy/registries');
const { expandRouting } = require('../../src/strategy/routing');
const BASELINE = require('../fixtures/routing-baseline.json');

/**
 * 构造与流水线同源的 (config, registries) 组合
 * @param {object} [overrides={}]
 * @returns {{ config: object, registries: object }}
 */
function pair(overrides = {}) {
  const config = resolveConfig({ ...overrides });
  return { config, registries: createServiceRegistries(config) };
}

describe('routing 展开引擎：默认表等价于冻结基线', () => {
  for (const { name, overrides, rules, providers } of BASELINE.cases) {
    it(`${name}：规则与 Provider 逐条相等`, () => {
      const { config, registries } = pair(overrides);
      const next = expandRouting(config, registries);
      assert.deepStrictEqual(next.rules, rules, `规则不一致（overrides=${JSON.stringify(overrides)}）`);
      assert.deepStrictEqual(next.providers, providers, `Provider 不一致（overrides=${JSON.stringify(overrides)}）`);
    });
  }

  it('默认表覆盖 59 条规则（DEFAULTS.md 第三节）', () => {
    const { config, registries } = pair();
    const { rules } = expandRouting(config, registries);
    assert.strictEqual(rules.length, 59);
    assert.strictEqual(rules[0], 'RULE-SET,lan-domain,DIRECT');
    assert.strictEqual(rules[2], 'RULE-SET,ads,广告拦截');
    assert.strictEqual(rules[rules.length - 1], 'MATCH,漏网之鱼');
  });
});

describe('routing 展开引擎：条目语义', () => {
  it('service 条目 + to 覆写目标，且仍注册 Provider', () => {
    const { config, registries } = pair();
    const { rules, providers } = expandRouting(config, registries, {
      routing: [{ preset: 'subscription' }, { service: 'netflix', to: 'DIRECT' }, { preset: 'final' }]
    });
    assert.ok(rules.includes('RULE-SET,netflix,DIRECT'));
    assert.strictEqual(providers.netflix.url.includes('geosite/netflix'), true);
  });

  it('preset + to 覆写整段目标（含三段式规则的 no-resolve 保留）', () => {
    const { config, registries } = pair();
    const { rules } = expandRouting(config, registries, {
      routing: [{ preset: 'game', to: '游戏专线' }]
    });
    assert.ok(rules.includes('RULE-SET,steam,游戏专线'));
    assert.ok(rules.includes('DOMAIN-SUFFIX,steamcontent.com,游戏专线'));
  });

  it('disabled 条目整段不展开', () => {
    const { config, registries } = pair();
    const { rules } = expandRouting(config, registries, {
      routing: [{ preset: 'subscription' }, { preset: 'ads', disabled: true }, { preset: 'final' }]
    });
    assert.strictEqual(rules.some(r => r.startsWith('RULE-SET,ads,')), false);
  });

  it('rule 条目按 to 定目标（两段式补目标、三段式替换目标）', () => {
    const { config, registries } = pair();
    const { rules } = expandRouting(config, registries, {
      routing: [
        { rule: 'DOMAIN-KEYWORD,foo', to: 'DIRECT' },
        { rule: 'DOMAIN-SUFFIX,bar.com,REJECT' },
        { rule: 'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve' }
      ]
    });
    assert.deepStrictEqual(rules, [
      'DOMAIN-KEYWORD,foo,DIRECT',
      'DOMAIN-SUFFIX,bar.com,REJECT',
      'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve'
    ]);
  });

  it('to 支持 ref 键解析为组名（改名不断链）', () => {
    const { config, registries } = pair();
    const { rules } = expandRouting(config, registries, {
      routing: [{ service: 'twitter', to: 'chatgpt' }]
    });
    assert.ok(rules.includes('RULE-SET,twitter,ChatGPT'));
  });

  it('customRules 仍排在 QUIC 拦截之前（旧优先级不变）', () => {
    const { config, registries } = pair({
      enableQUICReject: true,
      customRules: ['DOMAIN-SUFFIX,corp.example,DIRECT']
    });
    const { rules } = expandRouting(config, registries, {
      routing: [{ preset: 'subscription' }, { preset: 'quic' }, { preset: 'final' }]
    });
    const customAt = rules.indexOf('DOMAIN-SUFFIX,corp.example,DIRECT');
    const quicAt = rules.findIndex(r => r.startsWith('AND,((NETWORK,UDP)'));
    assert.ok(customAt >= 0, '自定义规则必须展开');
    assert.ok(quicAt > customAt, 'QUIC 拦截必须排在 customRules 之后');
  });

  it('未知预设 / 未知服务 / 缺目标都是 fail-closed', () => {
    const { config, registries } = pair();
    assert.throws(() => expandRouting(config, registries, { routing: [{ preset: 'nope' }] }), /未知预设/);
    assert.throws(() => expandRouting(config, registries, { routing: [{ service: 'nope' }] }), /未知服务/);
    assert.throws(() => expandRouting(config, registries, { routing: [{ rule: 'DOMAIN,x.com' }] }), /缺少目标/);
    assert.throws(() => expandRouting(config, registries, { routing: [{ service: 'netflix', to: '' }] }), /缺少目标/);
  });
});
