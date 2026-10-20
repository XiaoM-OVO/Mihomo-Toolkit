/**
 * `routing` 表展开引擎的等价性与语义测试
 *
 * 第一组（等价）：默认 routing 表展开后，必须与旧实现 `buildRoutingRules`
 * 在多种配置下产出**逐条相等**的规则与 Provider —— 这是「机制迁移不改变产物」
 * 的可执行证明，也是 `DEFAULTS.md` 第三节 59 条顺序的守护。
 *
 * 第二组（语义）：`to` 覆写、`disabled`、`service`/`rule` 条目、失败路径。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { resolveConfig } = require('../../src/config');
const { createServiceRegistries } = require('../../src/strategy/registries');
const { buildRoutingRules } = require('../../src/strategy/rules');
const { expandRouting } = require('../../src/strategy/routing');

/**
 * 构造与流水线同源的 (config, registries) 组合
 * @param {object} [overrides={}]
 * @returns {{ config: object, registries: object }}
 */
function pair(overrides = {}) {
  const config = resolveConfig({ ...overrides });
  return { config, registries: createServiceRegistries(config) };
}

/**
 * 比较新旧两条装配路径的产物
 * @param {object} overrides 配置覆盖
 */
function assertEquivalent(overrides = {}) {
  const { config, registries } = pair(overrides);
  const legacy = buildRoutingRules(config, registries);
  const next = expandRouting(config, registries);
  assert.deepStrictEqual(next.rules, legacy.rules, `规则不一致（overrides=${JSON.stringify(overrides)}）`);
  assert.deepStrictEqual(next.providers, legacy.providers, `Provider 不一致（overrides=${JSON.stringify(overrides)}）`);
}

describe('routing 展开引擎：默认表等价于旧实现', () => {
  const variants = [
    ['出厂默认', {}],
    ['社交开启', { enableSocial: true }],
    ['国内分流开启', { enableDomesticGroup: true }],
    ['国内分流 + 代理优先', { enableDomesticGroup: true, proxyFirst: true }],
    ['代理优先', { proxyFirst: true }],
    ['IPv6 开启', { enableIPv6: true }],
    ['QUIC 拦截开启', { enableQUICReject: true }],
    ['QUIC + 国内分流', { enableQUICReject: true, enableDomesticGroup: true }],
    ['广告只开 AntiAD', { enableAdBlock: false, enableAntiAD: true }],
    ['广告全关', { enableAdBlock: false, enableAntiAD: false }],
    ['进程直连关闭', { enableProcessDirect: false }],
    ['流媒体关闭', { enableStreaming: false }],
    ['规则集用 MRS', { useMRS: true }],
    ['流量审计关闭', { enableTrafficAudit: false }],
    ['全平台进程规则', { osType: 'all' }]
  ];

  for (const [name, overrides] of variants) {
    it(`${name}：规则与 Provider 逐条相等`, () => {
      assertEquivalent(overrides);
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

  it('未知预设 / 未知服务 / 缺目标都是 fail-closed', () => {
    const { config, registries } = pair();
    assert.throws(() => expandRouting(config, registries, { routing: [{ preset: 'nope' }] }), /未知预设/);
    assert.throws(() => expandRouting(config, registries, { routing: [{ service: 'nope' }] }), /未知服务/);
    assert.throws(() => expandRouting(config, registries, { routing: [{ rule: 'DOMAIN,x.com' }] }), /缺少目标/);
    assert.throws(() => expandRouting(config, registries, { routing: [{ service: 'netflix', to: '' }] }), /缺少目标/);
  });
});
