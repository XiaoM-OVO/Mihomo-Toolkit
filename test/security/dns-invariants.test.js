/**
 * DNS 不变式与净化沙箱回归测试 (DNS Invariants)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applyDnsOverlay, isLoopbackListenHost } = require('../../src/strategy/dns');
const { checkInvariants } = require('../../src/core/security/resolver-plan');
const { sanitizeDnsServerList, ROLES } = require('../../src/core/security/dns-sanitizer');

describe('【Security】DNS 不变式与净化沙箱 (dns-invariants)', () => {
  describe('listen - DNS 监听面收敛 [INV-8]', () => {
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
      it(`applyDnsOverlay - dnsListen=${JSON.stringify(input)} 收敛至 ${expected}`, () => {
        const cfg = {};
        const res = applyDnsOverlay(cfg, { dnsListen: input });
        assert.equal(res.listen, expected);
        assert.equal(cfg.dns.listen, expected);
      });
    }

    it('applyDnsOverlay - 非回环监听需显式 dnsAllowNonLoopback 放行', () => {
      const cfg = {};
      const res = applyDnsOverlay(cfg, { dnsListen: '0.0.0.0:53', dnsAllowNonLoopback: true });
      assert.equal(res.listen, '0.0.0.0:53');
      assert.deepEqual(res.findings, [], '显式开启时不应再告警');
    });

    it('isLoopbackListenHost - 回环与非回环地址判定矩阵', () => {
      for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) {
        assert.equal(isLoopbackListenHost(h), true, `${h} 应为回环`);
      }
      for (const h of ['0.0.0.0', '::', '[::]', '192.168.1.5', 'example.com', '', '999.1.1.1']) {
        assert.equal(isLoopbackListenHost(h), false, `${h} 不应为回环`);
      }
    });
  });

  describe('sanitizer - 修饰符剥离与策略净化沙箱', () => {
    it('applyDnsOverlay - 剥离致命修饰符但保留出口选择 (#proxy)', () => {
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

    it('sanitizeDnsServerList - 订阅不可信来源剥离全部危险修饰符', () => {
      const { servers } = sanitizeDnsServerList(
        ['https://8.8.8.8/dns-query#proxy', 'https://1.1.1.1/dns-query#h3'],
        { role: ROLES.NAMESERVER }
      );
      assert.deepEqual(servers, ['https://8.8.8.8/dns-query', 'https://1.1.1.1/dns-query']);
    });

    it('sanitizeDnsServerList - 私网与 fake-ip 解析器默认拒绝与显式放行', () => {
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

    it('applyDnsOverlay - nameserver-policy 保留键不可被用户配置覆盖', () => {
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

    it('applyDnsOverlay - 用户 hosts 消毒：受保护域名与内网重定向被拒绝', () => {
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

  describe('invariants - 生产配置不变式校验矩阵', () => {
    it('checkInvariants - 默认构建的 DNS 块满足全部不变式', () => {
      const cfg = { proxies: [{ name: 'x', type: 'ss', server: 'node.airport-a.com' }] };
      applyDnsOverlay(cfg, {});
      const violations = checkInvariants(cfg.dns, { proxies: cfg.proxies, fakeIpFilterNodes: 'smart' });
      assert.deepEqual(violations, [], `不应存在违规: ${JSON.stringify(violations)}`);
    });

    it('checkInvariants - 能识别被破坏的 DNS 块 (自检有效性)', () => {
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

    it('checkInvariants - 显式开启 dnsAllowNonLoopback 时不产生违规告警 [INV-8]', () => {
      const dns = { enable: true, listen: '0.0.0.0:1053' };
      const violations = checkInvariants(dns, { dnsAllowNonLoopback: true });
      assert.ok(!violations.some(v => v.id === 'INV-8'), '显式开启时不应报警 INV-8');
    });

    it('checkInvariants - 引导层严格纯 IP，包含 system 关键字应触发违规 [INV-1]', () => {
      const dns = { enable: true, 'default-nameserver': ['system', '223.5.5.5'] };
      const violations = checkInvariants(dns);
      assert.ok(violations.some(v => v.id === 'INV-1'), 'INV-1 必须拦截 system 关键字');
    });
  });
});
