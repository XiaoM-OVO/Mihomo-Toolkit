const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { applyDnsOverlay } = require('../../src/strategy/dns.js');
const { sanitizeDnsServer } = require('../../src/core/security/dns-sanitizer.js');
const { checkInvariants } = require('../../src/core/security/resolver-plan.js');

// 映射模式的最小资产闭包：一个节点域名对应一项订阅私有 DoH
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

describe('【Security】legacy 映射模式的 #RULES 出口标记', () => {
  test('裸 IP 与 IP:port 改写为显式 udp:// 协议形式', () => {
    const dns = overlay({ dnsProxy: ['223.5.5.5'], dnsDirect: ['8.8.8.8:53'] });
    assert.deepEqual(dns.nameserver, ['udp://223.5.5.5#RULES']);
    assert.deepEqual(dns['nameserver-policy']['rule-set:cn-domain'], ['udp://8.8.8.8:53#RULES']);
  });

  test('IPv6 字面量改写为带方括号的 udp:// 形式', () => {
    const dns = overlay({ dnsProxy: ['2400:3200::1'] });
    assert.deepEqual(dns.nameserver, ['udp://[2400:3200::1]#RULES']);
  });

  test('已有 URL 参数片段时以 & 追加，DoH 路径与 token 不受影响', () => {
    const dns = overlay({ dnsProxy: ['https://8.8.8.8/dns-query#h3=true'] });
    assert.deepEqual(dns.nameserver, ['https://8.8.8.8/dns-query#h3=true&RULES']);
  });

  test('显式出口标记保持幂等：不重复追加 #RULES，也不覆盖 #proxy / #DIRECT', () => {
    const rules = overlay({ dnsProxy: ['https://8.8.8.8/dns-query#RULES'] });
    assert.deepEqual(rules.nameserver, ['https://8.8.8.8/dns-query#RULES']);

    const direct = overlay({ dnsProxy: ['https://8.8.8.8/dns-query#DIRECT'] });
    assert.deepEqual(direct.nameserver, ['https://8.8.8.8/dns-query#DIRECT']);

    const proxy = overlay({ dnsProxy: ['https://8.8.8.8/dns-query#proxy'] });
    assert.deepEqual(proxy.nameserver, ['https://8.8.8.8/dns-query#proxy']);

    const iface = overlay({ dnsProxy: ['https://8.8.8.8/dns-query#interface'] });
    assert.deepEqual(iface.nameserver, ['https://8.8.8.8/dns-query#interface']);
  });

  test('未识别的无等号片段不被当作出口声明，仍追加 RULES', () => {
    // 内核会把 #h3 当作 proxyName（合法写法是 #h3=true），不能因此跳过 RULES。
    const dns = overlay({ dnsProxy: ['https://8.8.8.8/dns-query#h3'] });
    assert.deepEqual(dns.nameserver, ['https://8.8.8.8/dns-query#h3&RULES']);
  });

  test('结尾多余 # 归一化后再追加，不产生 ##RULES', () => {
    const dns = overlay({ dnsProxy: ['https://8.8.8.8/dns-query#'] });
    assert.deepEqual(dns.nameserver, ['https://8.8.8.8/dns-query#RULES']);
  });

  test('无特殊条目时映射正常生成：节点域名映射不带 #RULES，其余条目带标记', () => {
    const dns = overlay({ dnsProxy: ['https://8.8.8.8/dns-query'], dnsDirect: ['https://223.5.5.5/dns-query'] });
    assert.equal(dns['respect-rules'], false);
    assert.equal(dns['proxy-server-nameserver'], undefined);
    assert.deepEqual(dns['nameserver-policy']['hk.domain.com'], ['https://dns.airport-a.com/dns-query/token-a']);
    assert.ok(dns.nameserver.every(s => String(s).endsWith('#RULES')));
  });

  test('订阅与用户 nameserver-policy 同样补齐 #RULES', () => {
    const dnsAssets = {
      ...MAPPINGS,
      policies: { 'cdn.domain.com': ['https://dns.airport-a.com/dns-query/token-a'] }
    };
    const dns = overlay(
      { nameserverPolicy: { 'user.domain.com': ['https://1.2.3.4/dns-query'] } },
      dnsAssets
    );
    assert.equal(dns['nameserver-policy']['cdn.domain.com'], 'https://dns.airport-a.com/dns-query/token-a#RULES');
    assert.equal(dns['nameserver-policy']['user.domain.com'], 'https://1.2.3.4/dns-query#RULES');
  });

  test('system 出现时整体回退非映射模式，且不残留节点域名映射', () => {
    const logs = [];
    const dns = overlay({ dnsProxy: ['system'] }, MAPPINGS, makeLogger(logs));
    assert.equal(dns['respect-rules'], true);
    assert.deepEqual(dns['proxy-server-nameserver'], ['https://dns.airport-a.com/dns-query/token-a']);
    assert.equal(dns['nameserver-policy']['hk.domain.com'], undefined);
    assert.deepEqual(dns.nameserver, ['system']);
    assert.ok(logs.some(l => l.level === 'warn' && l.msg.includes('映射模式已禁用')), '首次回退必须 warn');
    assert.ok(!logs.some(l => l.msg.includes('token-a') || l.msg.includes('dns.airport-a.com')), '警告不得泄露解析器地址');
  });

  test('dhcp:// 出现时同样整体回退非映射模式', () => {
    const logs = [];
    const dns = overlay({ dnsDirect: ['dhcp://en0'] }, MAPPINGS, makeLogger(logs));
    assert.equal(dns['respect-rules'], true);
    assert.ok(Array.isArray(dns['proxy-server-nameserver']) && dns['proxy-server-nameserver'].length > 0);
    assert.equal(dns['nameserver-policy']['hk.domain.com'], undefined);
    assert.deepEqual(dns['nameserver-policy']['rule-set:cn-domain'], ['dhcp://en0']);
    assert.ok(logs.some(l => l.level === 'warn' && l.msg.includes('映射模式已禁用')));
  });
});

describe('【Security】#RULES 标记的沙箱可解析性与 INV-4 口径', () => {
  test('sanitizer 能解析并原样保留显式协议标记形式', () => {
    const samples = [
      'udp://223.5.5.5#RULES',
      'udp://223.5.5.5:53#RULES',
      'udp://[2400:3200::1]#RULES',
      'udp://dns.example.com#RULES'
    ];
    for (const sample of samples) {
      const r = sanitizeDnsServer(sample);
      assert.equal(r.ok, true, `${sample} 应可被沙箱解析`);
      assert.equal(r.value, sample, `${sample} 应原样保留`);
    }
  });

  test('INV-4 以 v1.19.13 内核校验为准：respect-rules=true 且节点解析器为空即违规', () => {
    const violated = checkInvariants({ 'respect-rules': true, 'proxy-server-nameserver': [] });
    assert.ok(violated.some(i => i.id === 'INV-4'));

    const mappingMode = checkInvariants({ 'respect-rules': false, 'proxy-server-nameserver': [] });
    assert.ok(!mappingMode.some(i => i.id === 'INV-4'));
  });

  test('INV-3：节点域名精确同名策略项必须是加密 DNS，大小写不敏感', () => {
    const proxies = [{ name: 'HK', server: 'hk.domain.com' }];

    const plaintext = checkInvariants({
      'default-nameserver': ['223.5.5.5'],
      'nameserver-policy': { 'hk.domain.com': ['dns.airport-a.com'] }
    }, { proxies });
    assert.ok(plaintext.some(i => i.id === 'INV-3'), '明文域名解析器应触发 INV-3');

    const encrypted = checkInvariants({
      'default-nameserver': ['223.5.5.5'],
      'nameserver-policy': { 'HK.DOMAIN.COM': ['https://dns.airport-a.com/dns-query'] }
    }, { proxies });
    assert.ok(!encrypted.some(i => i.id === 'INV-3'), '加密 DoH 且键大小写不同时不得误报');
  });

  test('INV-3：`+.` / `.` / `*.` 按内核 trie 语义参与校验，动态匹配器跳过', () => {
    const base = { 'default-nameserver': ['223.5.5.5'] };
    const has = (policy, nodeDomain = 'hk.domain.com') => checkInvariants(
      { ...base, 'nameserver-policy': policy },
      { proxies: [{ name: 'HK', server: nodeDomain }] }
    ).some(i => i.id === 'INV-3');

    assert.ok(has({ '+.domain.com': ['dns.airport-a.com'] }), '`+.` 覆盖裸域与任意层级子域');
    assert.ok(has({ '.domain.com': ['dns.airport-a.com'] }), '`.` 覆盖任意层级子域');
    assert.ok(has({ '*.domain.com': ['dns.airport-a.com'] }), '`*.` 覆盖严格单层子域');
    assert.ok(!has({ '+.other.com': ['dns.airport-a.com'] }), '无关后缀不得误报');
    assert.ok(
      !has({ '*.domain.com': ['dns.airport-a.com'] }, 'a.b.domain.com'),
      '`*.` 不覆盖多层子域'
    );
    assert.ok(
      !has({ 'rule-set:cn-domain': ['dns.airport-a.com'] }),
      '动态匹配器无法静态判定，跳过'
    );
  });
});
