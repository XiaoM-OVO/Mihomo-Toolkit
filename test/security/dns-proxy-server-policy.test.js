const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyDnsOverlay } = require('../../src/strategy/dns.js');
const { checkInvariants } = require('../../src/core/security/resolver-plan.js');
const { DEFAULT_PROXY_SERVER_DNS } = require('../../src/data');

// 映射模式的最小资产闭包：一个节点域名对应一项订阅专有解析器
const MAPPINGS = {
  resolverPolicies: { 'hk.domain.com': ['https://dns.airport-a.com/dns-query/token-a'] },
  hasResolverCandidates: true,
  proxyResolvers: ['https://dns.airport-a.com/dns-query/token-a'],
  policies: {}
};

function overlay(userConfig = {}, dnsAssets = MAPPINGS, logger) {
  const config = { proxies: [] };
  applyDnsOverlay(config, userConfig, { logger, dnsAssets });
  return config.dns;
}

function makeLogger(logs) {
  const logger = {
    debug: (msg) => logs.push({ level: 'debug', msg }),
    info: (msg) => logs.push({ level: 'info', msg }),
    warn: (msg) => logs.push({ level: 'warn', msg }),
    error: (msg) => logs.push({ level: 'error', msg }),
    isLevelEnabled: () => true,
    child: () => logger
  };
  return logger;
}

describe('【Security】节点域名解析器走内核原生 proxy-server-nameserver-policy', () => {
  test('映射生效：respect-rules 保持开启，映射写入独立字段', () => {
    const dns = overlay();
    assert.equal(dns['respect-rules'], true);
    assert.deepEqual(dns['proxy-server-nameserver'], DEFAULT_PROXY_SERVER_DNS);
    assert.deepEqual(
      dns['proxy-server-nameserver-policy']['hk.domain.com'],
      ['https://dns.airport-a.com/dns-query/token-a']
    );
    // nameserver 链保持原样，不再追加任何出口标记
    assert.deepEqual(dns.nameserver, ['https://8.8.8.8/dns-query', 'https://1.1.1.1/dns-query']);
    assert.ok(!JSON.stringify(dns.nameserver).includes('#RULES'));
  });

  test('无订阅映射时不写入 proxy-server-nameserver-policy', () => {
    const dns = overlay({}, { resolverPolicies: {}, hasResolverCandidates: false, proxyResolvers: [], policies: {} });
    assert.equal(dns['proxy-server-nameserver-policy'], undefined);
    assert.deepEqual(dns['proxy-server-nameserver'], DEFAULT_PROXY_SERVER_DNS);
    assert.equal(dns['respect-rules'], true);
  });

  test('用户显式 dnsServer 优先：不生成订阅映射', () => {
    const dns = overlay({ dnsServer: ['9.9.9.9'] });
    assert.deepEqual(dns['proxy-server-nameserver'], ['9.9.9.9']);
    assert.equal(dns['proxy-server-nameserver-policy'], undefined);
    assert.equal(dns['respect-rules'], true);
  });

  test('system 不再触发回退：映射照常生效', () => {
    const logs = [];
    const dns = overlay({ dnsProxy: ['system'] }, MAPPINGS, makeLogger(logs));
    assert.equal(dns['respect-rules'], true);
    assert.deepEqual(dns.nameserver, ['system']);
    assert.deepEqual(dns['proxy-server-nameserver'], DEFAULT_PROXY_SERVER_DNS);
    assert.deepEqual(
      dns['proxy-server-nameserver-policy']['hk.domain.com'],
      ['https://dns.airport-a.com/dns-query/token-a']
    );
    assert.ok(!logs.some(l => l.msg.includes('映射模式已禁用')));
  });

  test('dhcp:// 不再触发回退：映射照常生效', () => {
    const dns = overlay({ dnsDirect: ['dhcp://en0'] });
    assert.equal(dns['respect-rules'], true);
    assert.deepEqual(dns['proxy-server-nameserver'], DEFAULT_PROXY_SERVER_DNS);
    assert.deepEqual(dns['proxy-server-nameserver-policy']['hk.domain.com'], ['https://dns.airport-a.com/dns-query/token-a']);
    assert.deepEqual(dns['nameserver-policy']['rule-set:cn-domain'], ['dhcp://en0']);
  });

  test('订阅自身 nameserver-policy 与节点映射同域名时以 debug 透明化', () => {
    const logs = [];
    const dnsAssets = {
      ...MAPPINGS,
      policies: { 'hk.domain.com': ['https://dns.airport-b.com/dns-query/token-b'] }
    };
    const dns = overlay({}, dnsAssets, makeLogger(logs));
    const declared = dns['nameserver-policy']['hk.domain.com'];
    assert.deepEqual(Array.isArray(declared) ? declared : [declared], ['https://dns.airport-b.com/dns-query/token-b']);
    assert.deepEqual(
      dns['proxy-server-nameserver-policy']['hk.domain.com'],
      ['https://dns.airport-a.com/dns-query/token-a']
    );
    assert.ok(logs.some(l => l.level === 'debug' && l.msg.includes('被节点解析器映射覆盖')));
  });
});

describe('【Security】proxy-server-nameserver-policy 的不变式校验', () => {
  test('INV-4：respect-rules=true 且节点解析器为空即违规', () => {
    const violated = checkInvariants({ 'respect-rules': true, 'proxy-server-nameserver': [] });
    assert.ok(violated.some(i => i.id === 'INV-4'));

    const ok = checkInvariants({ 'respect-rules': true, 'proxy-server-nameserver': ['223.5.5.5'] });
    assert.ok(!ok.some(i => i.id === 'INV-4'));
  });

  test('INV-3：映射值必须是加密 DNS，且由纯 IP 引导', () => {
    const base = { 'default-nameserver': ['223.5.5.5'] };

    const plaintext = checkInvariants({
      ...base,
      'proxy-server-nameserver-policy': { 'hk.domain.com': ['dns.airport-a.com'] }
    });
    assert.ok(plaintext.some(i => i.id === 'INV-3'), '明文域名解析器应触发 INV-3');

    const encrypted = checkInvariants({
      ...base,
      'proxy-server-nameserver-policy': { 'hk.domain.com': ['https://dns.airport-a.com/dns-query'] }
    });
    assert.ok(!encrypted.some(i => i.id === 'INV-3'), '加密 DoH + 纯 IP 引导不得误报');

    const badBootstrap = checkInvariants({
      'default-nameserver': ['https://223.5.5.5/dns-query'],
      'proxy-server-nameserver-policy': { 'hk.domain.com': ['https://dns.airport-a.com/dns-query'] }
    });
    assert.ok(badBootstrap.some(i => i.id === 'INV-3'), '非纯 IP 引导应触发 INV-3');

    const ipResolver = checkInvariants({
      ...base,
      'proxy-server-nameserver-policy': { 'hk.domain.com': ['https://1.2.3.4/dns-query'] }
    });
    assert.ok(!ipResolver.some(i => i.id === 'INV-3'), 'IP 字面量解析器无需引导校验');
  });
});
