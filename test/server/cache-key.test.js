/**
 * 缓存键覆盖率回归 (M-2)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildProfile, buildProfileCacheKey } = require('../../src/pipeline/engine');
const { profileCache } = require('../../src/io/cache');
const { createLogger } = require('../../src/core/logger');

const BASE_SUB = [{ url: 'https://sub.example.com/link?token=SUPER-SECRET-TOKEN' }];
const baseConfig = () => ({ subscriptions: JSON.parse(JSON.stringify(BASE_SUB)) });

describe('【Server】构建缓存键生成与防脏读 (cache-key)', () => {
  it('buildProfileCacheKey - 未登记配置项 (hosts / DNS / 安全开关) 变化必须改变键 [M-2]', () => {
    const baseline = buildProfileCacheKey(baseConfig(), { mode: 'config' });
    assert.ok(baseline, '基准缓存键应可计算');

    const mutations = {
      hosts: { 'my-dns.example.com': '9.9.9.9' },
      dnsServer: '1.1.1.1',
      dnsDefault: '223.5.5.5',
      dnsDirect: ['119.29.29.29'],
      dnsProxy: ['https://doh.example.com/dns-query'],
      dnsListen: '127.0.0.1:1053',
      dnsAllowNonLoopback: true,
      nameserverPolicy: { 'rule-set:cn-domain': ['223.5.5.5'] },
      allowPrivateDns: true,
      trustedPrivateCidrs: ['10.0.0.0/8'],
      trustedHostDomains: ['internal.example.com'],
      allowInternalHosts: true,
      assetClosure: 'strict',
      assetDomainAllowlist: ['example.com'],
      fakeIpFilterNodes: 'off',
      enablePipeline: false,
      redactLevel: 'full',
      someFutureSecurityKnob: { enabled: true }
    };

    for (const [key, value] of Object.entries(mutations)) {
      const mutated = { ...baseConfig(), [key]: value };
      const mutatedKey = buildProfileCacheKey(mutated, { mode: 'config' });
      assert.notEqual(mutatedKey, baseline, `配置项 ${key} 变化后缓存键必须改变`);
    }

    // 嵌套结构内部变化同样必须改变键
    const nested = baseConfig();
    nested.security = { maxTotalNodes: 10 };
    const nested2 = baseConfig();
    nested2.security = { maxTotalNodes: 20 };
    assert.notEqual(
      buildProfileCacheKey(nested, { mode: 'config' }),
      buildProfileCacheKey(nested2, { mode: 'config' })
    );
  });

  it('buildProfileCacheKey - 确定性、定长哈希与敏感信息不留痕', () => {
    const ordered = { subscriptions: BASE_SUB, hosts: { a: 1, b: 2 }, dnsListen: '127.0.0.1:1053' };
    const shuffled = { dnsListen: '127.0.0.1:1053', hosts: { b: 2, a: 1 }, subscriptions: BASE_SUB };

    const k1 = buildProfileCacheKey(ordered, { mode: 'config' });
    const k2 = buildProfileCacheKey(shuffled, { mode: 'config' });

    assert.equal(k1, k2, '键序不同但语义相同的配置必须得到同一缓存键');
    assert.match(k1, /^profile:v\d+:[0-9a-f]{64}$/);

    assert.ok(!k1.includes('SUPER-SECRET-TOKEN'), '缓存键不得包含订阅 Token 明文');
    assert.ok(!k1.includes('sub.example.com'), '缓存键不得包含订阅地址明文');
  });

  it('buildProfileCacheKey - 交付形态区分 (nodes / config)', () => {
    const cfg = baseConfig();

    const nodes = buildProfileCacheKey(cfg, { mode: 'nodes' });
    const config = buildProfileCacheKey(cfg, { mode: 'config' });

    assert.notEqual(nodes, config, '不同交付形态不得共用缓存');

    const viaOutputMode = buildProfileCacheKey({ ...cfg, outputMode: 'nodes' }, {});
    assert.equal(viaOutputMode, nodes, '未显式指定 mode 时应按 outputMode 归一化');

    const viaOptionsMode = buildProfileCacheKey(cfg, { mode: 'nodes' });
    assert.equal(viaOptionsMode, nodes, 'options.mode 应正确参与缓存键计算');
  });

  it('buildProfileCacheKey - 仅生效订阅参与，订阅拉取参数变化必须改变键', () => {
    const enabled = { subscriptions: [{ url: 'https://sub.example.com/a', retry: 1 }] };
    const retryChanged = { subscriptions: [{ url: 'https://sub.example.com/a', retry: 3 }] };
    const proxyChanged = { subscriptions: [{ url: 'https://sub.example.com/a', retry: 1, proxy: 'http://127.0.0.1:7890' }] };

    const k = buildProfileCacheKey(enabled, { mode: 'config' });
    assert.notEqual(buildProfileCacheKey(retryChanged, { mode: 'config' }), k, 'retry 变化必须改变键');
    assert.notEqual(buildProfileCacheKey(proxyChanged, { mode: 'config' }), k, 'proxy 变化必须改变键');

    const disabledA = {
      subscriptions: [{ url: 'https://sub.example.com/a', retry: 1 }, { url: 'https://off.example.com', enabled: false }]
    };
    const disabledB = {
      subscriptions: [{ url: 'https://sub.example.com/a', retry: 1 }, { url: 'https://off.example.com/changed', enabled: false }]
    };
    assert.equal(
      buildProfileCacheKey(disabledA, { mode: 'config' }),
      buildProfileCacheKey(disabledB, { mode: 'config' }),
      '已禁用订阅的变化不应破坏缓存'
    );
  });

  it('buildProfileCacheKey - 无法确定性序列化时放弃缓存防脏读', () => {
    const cyclic = baseConfig();
    cyclic.self = cyclic;
    assert.equal(buildProfileCacheKey(cyclic, { mode: 'config' }), null, '循环引用必须返回 null 以禁用缓存');

    assert.equal(typeof buildProfileCacheKey(null, {}), 'string');
    assert.equal(typeof buildProfileCacheKey(undefined, undefined), 'string');
    assert.equal(buildProfileCacheKey({ subscriptions: 'not-an-array' }, {}), null);
  });

  it('buildProfile - 端到端：安全相关配置变化不得命中旧产物', async () => {
    const uri = 'vless://11111111-2222-3333-4444-555555555555@example.com:443?security=tls#🇭🇰 香港 01';
    const sub = [{ uri }];
    const logs = [];
    const logger = createLogger({ tag: 'CACHE', level: 'info', colors: false, out: (msg) => logs.push(msg) });
    const hits = () => logs.filter(m => m.includes('命中本地内存缓存')).length;

    profileCache.clear();

    const r1 = await buildProfile(
      { subscriptions: sub, enableCache: true, hosts: { 'my-dns.example.com': '9.9.9.9' } },
      { mode: 'config', logger }
    );
    assert.equal(hits(), 0, '首次构建不应命中缓存');
    assert.ok(r1.yamlStr.includes('my-dns.example.com: 9.9.9.9'), '产物应包含用户声明的 hosts');

    // 同一份配置重复构建：缓存必须仍然生效
    await buildProfile(
      { subscriptions: sub, enableCache: true, hosts: { 'my-dns.example.com': '9.9.9.9' } },
      { mode: 'config', logger }
    );
    assert.equal(hits(), 1, '配置完全一致时必须命中缓存');

    // 仅 hosts 变化：必须重新构建并交付新产物
    const r3 = await buildProfile(
      { subscriptions: sub, enableCache: true, hosts: { 'my-dns.example.com': '8.8.4.4' } },
      { mode: 'config', logger }
    );
    assert.equal(hits(), 1, 'hosts 变化不得命中旧缓存');
    assert.ok(r3.yamlStr.includes('my-dns.example.com: 8.8.4.4'), '产物必须反映新的 hosts 值');
    assert.ok(!r3.yamlStr.includes('9.9.9.9'), '产物不得残留旧 hosts 值');

    profileCache.clear();
  });
});
