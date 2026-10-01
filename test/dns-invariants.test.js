/**
 * -----------------------------------------------------------------------------
 * DNS 不变式与净化沙箱回归测试 (DNS Invariants)
 * -----------------------------------------------------------------------------
 * 覆盖历史缺陷：
 *   H-1  生产 DNS 路径不受 INV 约束：dns.listen 可被写成非回环（开放解析器），
 *        直连/主解析链与 nameserver-policy 完全未过净化沙箱
 *   保留  resolver-plan.js 的 INV 自检现已在 config 交付路径中实际执行
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { applyDnsOverlay, isLoopbackListenHost } = require('../src/strategy/dns');
const { checkInvariants } = require('../src/core/security/resolver-plan');
const { sanitizeDnsServerList, ROLES } = require('../src/core/security/dns-sanitizer');

describe('🛡️ DNS 监听面收敛 (INV-8)', () => {
  const cases = [
    ['0.0.0.0:1053', '127.0.0.1:1053'],
    ['[::]:1053', '127.0.0.1:1053'],
    ['::', '127.0.0.1:1053'],
    ['192.168.1.5:1053', '127.0.0.1:1053'],
    ['10.0.0.1:53', '127.0.0.1:53'],
    ['127.0.0.1:1053', '127.0.0.1:1053'],
    ['localhost:1053', 'localhost:1053'],
    ['[::1]:1053', '[::1]:1053'],
    ['0.0.0.0:abc', '127.0.0.1:1053'],
    ['127.0.0.1:99999', '127.0.0.1:1053']
  ];

  for (const [input, expected] of cases) {
    test(`dnsListen=${JSON.stringify(input)} ➔ ${expected}`, () => {
      const cfg = {};
      const res = applyDnsOverlay(cfg, { dnsListen: input });
      assert.equal(res.listen, expected);
      assert.equal(cfg.dns.listen, expected);
    });
  }

  test('非回环监听需显式 dnsAllowNonLoopback: true 才放行', () => {
    const cfg = {};
    const res = applyDnsOverlay(cfg, { dnsListen: '0.0.0.0:53', dnsAllowNonLoopback: true });
    assert.equal(res.listen, '0.0.0.0:53');
    assert.deepEqual(res.findings, [], '显式开启时不应再告警');
  });

  test('isLoopbackListenHost 判定矩阵', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) {
      assert.equal(isLoopbackListenHost(h), true, `${h} 应为回环`);
    }
    for (const h of ['0.0.0.0', '::', '[::]', '192.168.1.5', 'example.com', '', '999.1.1.1']) {
      assert.equal(isLoopbackListenHost(h), false, `${h} 不应为回环`);
    }
  });
});

describe('🧼 DNS 净化沙箱 (Modifier & Policy Sanitization)', () => {
  test('用户声明的解析链：剥离致命修饰符但保留出口/协议选择', () => {
    const cfg = {};
    const res = applyDnsOverlay(cfg, {
      dnsProxy: ['https://8.8.8.8/dns-query#proxy', 'https://1.1.1.1/dns-query#skip-cert-verify=true']
    });
    assert.deepEqual(cfg.dns.nameserver, ['https://8.8.8.8/dns-query#proxy', 'https://1.1.1.1/dns-query']);
    const tlsFinding = res.findings.find(f => f.id === 'DNS-TLS-BYPASS');
    assert.ok(tlsFinding);
    assert.equal(tlsFinding.stripped, true);
    const egressFinding = res.findings.find(f => f.id === 'DNS-EGRESS');
    assert.ok(egressFinding);
    assert.equal(egressFinding.stripped, false, '#proxy 属于用户显式出口选择，应保留并审计');
  });

  test('订阅来源（不可信）仍采用严格策略：剥离全部危险修饰符', () => {
    const { servers } = sanitizeDnsServerList(
      ['https://8.8.8.8/dns-query#proxy', 'https://1.1.1.1/dns-query#h3'],
      { role: ROLES.NAMESERVER }
    );
    assert.deepEqual(servers, ['https://8.8.8.8/dns-query', 'https://1.1.1.1/dns-query']);
  });

  test('私网与 fake-ip 解析器默认被拒绝（可显式 trust 放行）', () => {
    const { servers, rejected } = sanitizeDnsServerList(
      ['192.168.1.1', '198.18.0.1', '223.5.5.5'],
      { role: ROLES.NAMESERVER }
    );
    assert.deepEqual(servers, ['223.5.5.5']);
    assert.equal(rejected.length, 2);

    const trusted = sanitizeDnsServerList(['192.168.1.1'], {
      role: ROLES.NAMESERVER,
      allowPrivateLiteral: true,
      trustedPrivateCidrs: ['192.168.1.0/24']
    });
    assert.deepEqual(trusted.servers, ['192.168.1.1']);
  });

  test('nameserver-policy 保留键不可被用户配置覆盖', () => {
    const cfg = {};
    applyDnsOverlay(cfg, {
      nameserverPolicy: {
        'rule-set:cn-domain': 'https://evil.example.com/dns-query',
        'rule-set:non-cn': 'https://evil.example.com/dns-query'
      }
    });
    const policy = cfg.dns['nameserver-policy'];
    assert.ok(!JSON.stringify(policy['rule-set:cn-domain']).includes('evil.example.com'));
    assert.ok(!JSON.stringify(policy['rule-set:non-cn']).includes('evil.example.com'));
  });

  test('用户 hosts 消毒：受保护域名与内网重定向被拒绝', () => {
    const cfg = {};
    const res = applyDnsOverlay(cfg, {
      hosts: { 'github.com': '6.6.6.6', 'nas.lan': '192.168.1.10', 'node.airport.com': '104.16.1.1' }
    });
    assert.equal(cfg.hosts['github.com'], undefined);
    assert.equal(cfg.hosts['nas.lan'], undefined);
    assert.equal(cfg.hosts['node.airport.com'], '104.16.1.1');
    const ids = res.findings.map(f => f.id);
    assert.ok(ids.includes('HOSTS-PROTECTED-DOMAIN'));
    assert.ok(ids.includes('HOSTS-INTERNAL-REDIRECT'));
  });
});

describe('✅ INV 不变式自检 (生产配置)', () => {
  test('默认构建的 DNS 块满足全部不变式', () => {
    const cfg = { proxies: [{ name: 'x', type: 'ss', server: 'node.airport-a.com' }] };
    applyDnsOverlay(cfg, {});
    const violations = checkInvariants(cfg.dns, { proxies: cfg.proxies, fakeIpFilterNodes: 'smart' });
    assert.deepEqual(violations, [], `不应存在违规: ${JSON.stringify(violations)}`);
  });

  test('checkInvariants 能识别被破坏的 DNS 块（自检有效性）', () => {
    const bad = {
      enable: true,
      listen: '0.0.0.0:1053',
      'enhanced-mode': 'fake-ip',
      'fake-ip-range': '198.18.0.1/16',
      'default-nameserver': ['https://223.5.5.5/dns-query'],
      'proxy-server-nameserver': ['https://doh.example.com/dns-query'],
      'respect-rules': true,
      'fake-ip-filter': [],
      fallback: ['tls://9.9.9.9']
    };
    const ids = checkInvariants(bad, { proxies: [{ server: 'node.airport-a.com' }] }).map(v => v.id);
    assert.ok(ids.includes('INV-1'), 'INV-1 未检出');
    assert.ok(ids.includes('INV-3'), 'INV-3 未检出');
    assert.ok(ids.includes('INV-5'), 'INV-5 未检出');
    assert.ok(ids.includes('INV-7'), 'INV-7 未检出');
    assert.ok(ids.includes('INV-8'), 'INV-8 未检出');
  });
});
