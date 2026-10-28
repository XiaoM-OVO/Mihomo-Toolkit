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
  it('direction 条目只在对应方向生成，缺省方向双向生效', () => {
    const routing = [
      { preset: 'subscription' },
      { rule: 'DOMAIN-SUFFIX,same.com', to: 'DIRECT', direction: 'split' },
      { rule: 'DOMAIN-SUFFIX,same.com', to: 'REJECT', direction: 'return' },
      { rule: 'DOMAIN-SUFFIX,both.com', to: 'DIRECT' },
      { preset: 'final' }
    ];

    const split = pair();
    const splitRules = expandRouting(split.config, split.registries, { routing }).rules;
    assert.ok(splitRules.includes('DOMAIN-SUFFIX,same.com,DIRECT'), 'split 方向只生成 split 条目');
    assert.equal(splitRules.some(r => r.startsWith('DOMAIN-SUFFIX,same.com,REJECT')), false);
    assert.ok(splitRules.includes('DOMAIN-SUFFIX,both.com,DIRECT'), '缺省方向条目双向生效');

    const ret = pair({ trafficDirection: 'return' });
    const returnRules = expandRouting(ret.config, ret.registries, { routing }).rules;
    assert.ok(returnRules.includes('DOMAIN-SUFFIX,same.com,REJECT'), 'return 方向只生成 return 条目');
    assert.equal(returnRules.some(r => r.startsWith('DOMAIN-SUFFIX,same.com,DIRECT')), false);
    assert.ok(returnRules.includes('DOMAIN-SUFFIX,both.com,DIRECT'), '缺省方向条目双向生效');
  });

  it('direction 组：指向未生效方向的组时 fail-closed', () => {
    const groups = [{ name: '回国专线', type: 'select', proxies: ['DIRECT'], direction: 'return' }];

    const split = pair();
    split.config.groups = groups;
    assert.throws(
      () => expandRouting(split.config, split.registries, {
        routing: [{ rule: 'DOMAIN-SUFFIX,x.com', to: '回国专线' }]
      }),
      /未声明或不存在/
    );

    const ret = pair({ trafficDirection: 'return' });
    ret.config.groups = groups;
    const rules = expandRouting(ret.config, ret.registries, {
      routing: [{ rule: 'DOMAIN-SUFFIX,x.com', to: '回国专线' }]
    }).rules;
    assert.ok(rules.includes('DOMAIN-SUFFIX,x.com,回国专线'));
  });

  it('direction 取值非法时 fail-closed', () => {
    const { config, registries } = pair();
    assert.throws(
      () => expandRouting(config, registries, {
        routing: [{ rule: 'DOMAIN-SUFFIX,x.com', to: 'DIRECT', direction: 'retrun' }]
      }),
      /routing\[0\]\.direction: 仅支持 split \/ return/
    );
  });

  it('service 条目 + to 覆写目标，且仍注册 Provider', () => {
    const { config, registries } = pair();
    const { rules, providers } = expandRouting(config, registries, {
      routing: [{ preset: 'subscription' }, { service: 'netflix', to: 'DIRECT' }, { preset: 'final' }]
    });
    assert.ok(rules.includes('RULE-SET,netflix,DIRECT'));
    assert.strictEqual(providers.netflix.url.includes('geosite/netflix'), true);
  });

  it('preset + to 覆写整段目标（含三段式规则的 no-resolve 保留）', () => {
    const { config, registries } = pair({ groups: [{ name: '游戏专线', proxies: ['DIRECT'] }] });
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

  it('disabled 在合并后按同键结算：主文件靠后的关闭可覆盖片段条目', () => {
    const { config, registries } = pair();
    // include 并集：片段条目在前，主文件条目在后
    const routing = [
      { preset: 'subscription' },
      { preset: 'ads' },
      { preset: 'final' },
      { preset: 'ads', disabled: true }
    ];
    const { rules } = expandRouting(config, registries, { routing });
    assert.strictEqual(
      rules.some(r => r.startsWith('RULE-SET,ads,')),
      false,
      '同键 disabled 必须关闭片段中残留的启用条目'
    );
    assert.ok(rules.at(-1).startsWith('MATCH,'), '其余条目不受影响');
  });

  it('disabled 后同键再次声明可重新启用（位置靠后者胜）', () => {
    const { config, registries } = pair();
    const { rules } = expandRouting(config, registries, {
      routing: [{ preset: 'ads', disabled: true }, { preset: 'ads' }, { preset: 'final' }]
    });
    assert.ok(rules.some(r => r.startsWith('RULE-SET,ads,')));
  });

  it('direction 参与关闭键，split / return 同名规则互不误伤', () => {
    const routing = [
      { rule: 'DOMAIN-SUFFIX,direction-key.test', to: 'DIRECT', direction: 'split' },
      { rule: 'DOMAIN-SUFFIX,direction-key.test', to: 'REJECT', direction: 'return' },
      { rule: 'DOMAIN-SUFFIX,direction-key.test', disabled: true, direction: 'split' },
      { preset: 'final' }
    ];
    const split = pair();
    assert.strictEqual(
      expandRouting(split.config, split.registries, { routing }).rules
        .some(r => r.includes('direction-key.test')),
      false,
      'split 方向的同键条目应被关闭'
    );
    const ret = pair({ trafficDirection: 'return' });
    assert.ok(
      expandRouting(ret.config, ret.registries, { routing }).rules
        .includes('DOMAIN-SUFFIX,direction-key.test,REJECT'),
      'return 方向的同键条目不得被 split 的 disabled 误伤'
    );
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

  it('rule 条目按表内位置决定优先级（不再有隐式注入锚点）', () => {
    const { config, registries } = pair();
    const before = expandRouting(config, registries, {
      routing: [
        { preset: 'subscription' },
        { rule: 'DOMAIN-SUFFIX,corp.example', to: 'DIRECT' },
        { preset: 'quic' },
        { preset: 'final' }
      ]
    }).rules;
    const after = expandRouting(config, registries, {
      routing: [
        { preset: 'subscription' },
        { preset: 'quic' },
        { rule: 'DOMAIN-SUFFIX,corp.example', to: 'DIRECT' },
        { preset: 'final' }
      ]
    }).rules;
    const quicIndex = list => list.findIndex(r => r.startsWith('AND,((NETWORK,UDP)'));
    assert.ok(before.indexOf('DOMAIN-SUFFIX,corp.example,DIRECT') < quicIndex(before), '写在 quic 之前就先匹配');
    assert.ok(after.indexOf('DOMAIN-SUFFIX,corp.example,DIRECT') > quicIndex(after), '写在 quic 之后就后匹配');
  });

  it('AND / OR 逻辑规则的 to 覆写只替换末尾目标，不破坏括号结构', () => {
    const { config, registries } = pair();
    const { rules, targets } = expandRouting(config, registries, {
      routing: [
        { rule: 'AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,geolocation-!cn)),REJECT-DROP', to: 'DIRECT' },
        { rule: 'OR,((DOMAIN,a.example),(DOMAIN,b.example)),REJECT', to: '中国分流' }
      ]
    });
    assert.ok(
      rules.includes('AND,((NETWORK,UDP),(DST-PORT,443),(GEOSITE,geolocation-!cn)),DIRECT'),
      'AND 规则改道后子表达式必须完整保留'
    );
    assert.ok(
      rules.includes('OR,((DOMAIN,a.example),(DOMAIN,b.example)),中国分流'),
      'OR 规则改道后子表达式必须完整保留'
    );
    assert.ok(targets.includes('中国分流'), '逻辑规则的目标应被收集');
    assert.ok(!targets.includes('DIRECT'), '内置目标不得被当作组收集');
  });

  it('AND 规则缺少目标且未提供 to 时 fail-closed', () => {
    const { config, registries } = pair();
    assert.throws(
      () => expandRouting(config, registries, {
        routing: [{ rule: 'AND,((NETWORK,UDP),(DST-PORT,443))' }]
      }),
      /缺少目标/
    );
  });

  it('未知预设 / 未知服务 / 缺目标都是 fail-closed', () => {
    const { config, registries } = pair();
    assert.throws(() => expandRouting(config, registries, { routing: [{ preset: 'nope' }] }), /未知预设/);
    assert.throws(() => expandRouting(config, registries, { routing: [{ service: 'nope' }] }), /未知服务/);
    assert.throws(() => expandRouting(config, registries, { routing: [{ rule: 'DOMAIN,x.com' }] }), /缺少目标/);
    assert.throws(() => expandRouting(config, registries, { routing: [{ service: 'netflix', to: '' }] }), /缺少目标/);
  });
});

describe('routing 展开引擎：流量方向与国内侧目标', () => {
  const domesticOnly = [{ preset: 'domestic' }];

  it('split（默认）：海外走代理，国内直连', () => {
    const { config, registries } = pair({ trafficDirection: 'split' });
    const { rules } = expandRouting(config, registries, { routing: domesticOnly });
    assert.deepStrictEqual(rules, [
      'RULE-SET,non-cn,自动选择',
      'RULE-SET,cn-domain,DIRECT',
      'RULE-SET,cn-ip,DIRECT,no-resolve'
    ]);
  });

  it('return：国内走代理，海外直连', () => {
    const { config, registries } = pair({ trafficDirection: 'return' });
    const { rules } = expandRouting(config, registries, { routing: domesticOnly });
    assert.deepStrictEqual(rules, [
      'RULE-SET,non-cn,DIRECT',
      'RULE-SET,cn-domain,自动选择',
      'RULE-SET,cn-ip,自动选择,no-resolve'
    ]);
  });

  it('domestic + to：国内侧改指「中国分流」，并被目标收集器记下', () => {
    const { config, registries } = pair();
    const { rules, targets } = expandRouting(config, registries, {
      routing: [{ preset: 'domestic', to: '中国分流' }]
    });
    assert.deepStrictEqual(rules, [
      'RULE-SET,non-cn,自动选择',
      'RULE-SET,cn-domain,中国分流',
      'RULE-SET,cn-ip,中国分流,no-resolve'
    ]);
    assert.ok(targets.includes('中国分流'), '规则引用到的组必须出现在 targets 里');
  });

  it('return + to：`to` 作用于海外侧', () => {
    const { config, registries } = pair({ trafficDirection: 'return' });
    const { rules } = expandRouting(config, registries, {
      routing: [{ preset: 'domestic', to: 'DIRECT' }]
    });
    assert.deepStrictEqual(rules, [
      'RULE-SET,non-cn,DIRECT',
      'RULE-SET,cn-domain,自动选择',
      'RULE-SET,cn-ip,自动选择,no-resolve'
    ]);
  });
});
