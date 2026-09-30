/**
 * 控制面净化 / DNS 沙箱 / 解析链规划 回归测试
 */

const { test } = require('node:test');
const assert = require('node:assert');

const {
  partitionControlPlane,
  mergeSubscriptionConfigs
} = require('../src/core/security/control-plane');

const {
  sanitizeHosts,
  sanitizeDnsServer,
  sanitizeDnsServerList,
  sanitizeNameserverPolicy,
  parseDnsServer,
  ROLES
} = require('../src/core/security/dns-sanitizer');

const {
  planResolverChain,
  checkInvariants,
  deriveFakeIpFilterAdditions
} = require('../src/core/security/resolver-plan');

// ── 控制面隔离 ───────────────────────────────────────────────────────────────

test('partitionControlPlane - 非 master 订阅被剥离全部控制面字段', () => {
  const sub = {
    proxies: [{ name: 'n1', type: 'ss' }],
    dns: { nameserver: ['https://evil.example/dns-query'] },
    hosts: { 'github.com': '1.2.3.4' },
    tun: { enable: true, stack: 'gvisor' },
    rules: ['MATCH,EVIL'],
    'external-controller': '0.0.0.0:9090',
    secret: 'pwned',
    'allow-lan': true,
    'geox-url': { geoip: 'https://evil.example/geoip.dat' }
  };

  const { data, report } = partitionControlPlane(sub, { isMaster: false, tag: 'evil-airport' });

  assert.deepStrictEqual(Object.keys(data), ['proxies']);
  assert.strictEqual(data.proxies.length, 1);
  assert.ok(report.stripped.includes('dns'));
  assert.ok(report.stripped.includes('hosts'));
  assert.ok(report.stripped.includes('external-controller'));

  const hostileIds = report.hostile.map(h => h.id);
  assert.ok(hostileIds.includes('CP-EXT-CTRL'));
  assert.ok(hostileIds.includes('CP-SECRET'));
  assert.ok(hostileIds.includes('CP-LAN'));
  assert.ok(hostileIds.includes('CP-GEOX'));
  assert.ok(report.hostile.every(h => h.severity !== 'low'));
});

test('partitionControlPlane - 未登记字段 fail-closed', () => {
  const { data, report } = partitionControlPlane(
    { proxies: [], 'some-future-kernel-key': 'x' },
    { isMaster: true, tag: 'm' }
  );
  assert.strictEqual(data['some-future-kernel-key'], undefined);
  assert.ok(report.hostile.some(h => h.id === 'CP-UNKNOWN'));
});

test('mergeSubscriptionConfigs - 数据面并集且与抓取完成顺序无关', () => {
  const sources = [
    { tag: 'A', isMaster: false, config: { proxies: [{ name: 'a' }], dns: { nameserver: ['10.0.0.1'] }, hosts: { 'github.com': '1.1.1.1' } } },
    { tag: 'B', isMaster: false, config: { proxies: [{ name: 'b' }] } }
  ];
  const r1 = mergeSubscriptionConfigs(sources, {});
  const r2 = mergeSubscriptionConfigs([...sources].reverse(), {});
  assert.deepStrictEqual(r1.merged.proxies.map(p => p.name).sort(), ['a', 'b']);
  assert.deepStrictEqual(r2.merged.proxies.map(p => p.name).sort(), ['a', 'b']);
  assert.strictEqual(r1.merged.dns, undefined);
  assert.strictEqual(r1.merged.hosts, undefined);
});

test('mergeSubscriptionConfigs - 多 master 直接抛错', () => {
  assert.throws(() => mergeSubscriptionConfigs([
    { tag: 'A', isMaster: true, config: { proxies: [] } },
    { tag: 'B', isMaster: true, config: { proxies: [] } }
  ], {}), /master/);
});

test('mergeSubscriptionConfigs - 用户本地声明具备最终否决权', () => {
  const { merged } = mergeSubscriptionConfigs([
    { tag: 'A', isMaster: true, config: { proxies: [], mode: 'global' } }
  ], { mode: 'rule' });
  assert.strictEqual(merged.mode, 'rule');
});

// ── DNS 条目解析与净化 ───────────────────────────────────────────────────────

test('parseDnsServer - 覆盖 IP / IPv6 / URL / 特殊关键字', () => {
  assert.strictEqual(parseDnsServer('223.5.5.5').kind, 'ip');
  assert.strictEqual(parseDnsServer('223.5.5.5:5353').port, '5353');
  assert.strictEqual(parseDnsServer('[2400:3200::1]:53').isIpv6, true);
  assert.strictEqual(parseDnsServer('https://223.5.5.5/dns-query').kind, 'url');
  assert.strictEqual(parseDnsServer('https://223.5.5.5/dns-query').isIpLiteral, true);
  assert.strictEqual(parseDnsServer('https://dns.evil.example/dns-query').isIpLiteral, false);
  assert.strictEqual(parseDnsServer('system').kind, 'special');
  const withMod = parseDnsServer('https://8.8.8.8/dns-query#proxy&skip-cert-verify=true');
  assert.deepStrictEqual(withMod.modifiers, ['proxy', 'skip-cert-verify=true']);
});

test('sanitizeDnsServer - default 角色拒绝域名形式（防死锁）', () => {
  const r = sanitizeDnsServer('https://doh.pub/dns-query', { role: ROLES.DEFAULT });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'bootstrap-must-be-ip');
});

test('sanitizeDnsServer - 拒绝 fake-ip 网段（防自环）', () => {
  for (const ip of ['198.18.0.1', '198.18.255.254', '198.19.0.1']) {
    const r = sanitizeDnsServer(ip, { role: ROLES.PROXY_SERVER, allowPrivateLiteral: true });
    assert.strictEqual(r.ok, false, `${ip} 应被拒绝`);
    assert.strictEqual(r.reason, 'fakeip-selfloop');
  }
});

test('sanitizeDnsServer - 默认拒绝私网解析器', () => {
  for (const ip of ['127.0.0.1', '10.0.0.2', '172.16.5.5', '192.168.1.1', '169.254.169.254', '100.64.0.1']) {
    const r = sanitizeDnsServer(ip, { role: ROLES.PROXY_SERVER });
    assert.strictEqual(r.ok, false, `${ip} 应被拒绝`);
    assert.strictEqual(r.reason, 'private-resolver');
  }
});

test('sanitizeDnsServer - 受信私网仅在显式 trust 时放行（企业内网）', () => {
  const denied = sanitizeDnsServer('10.10.0.53', { role: ROLES.DEFAULT, allowPrivateLiteral: true });
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.reason, 'private-not-trusted');

  const allowed = sanitizeDnsServer('10.10.0.53', {
    role: ROLES.DEFAULT,
    allowPrivateLiteral: true,
    trustedPrivateCidrs: ['10.10.0.0/16']
  });
  assert.strictEqual(allowed.ok, true);
  assert.strictEqual(allowed.value, '10.10.0.53');
});

test('sanitizeDnsServer - 剥离 skip-cert-verify 修饰符', () => {
  const r = sanitizeDnsServer('https://8.8.8.8/dns-query#proxy&skip-cert-verify=true&ecs=1.1.1.1/24', {
    role: ROLES.NAMESERVER
  });
  assert.strictEqual(r.ok, true);
  assert.ok(!r.value.includes('skip-cert-verify'), `不应保留 skip-cert-verify: ${r.value}`);
  assert.ok(!r.value.includes('#proxy'), `不应保留 proxy 出口修饰符: ${r.value}`);
  assert.ok(r.findings.some(f => f.id === 'DNS-TLS-BYPASS'));
});

test('sanitizeDnsServerList - 去重并统计拒绝原因', () => {
  const r = sanitizeDnsServerList(
    ['223.5.5.5', '223.5.5.5', '198.18.0.1', 'https://doh.pub/dns-query'],
    { role: ROLES.DEFAULT }
  );
  assert.deepStrictEqual(r.servers, ['223.5.5.5']);
  assert.strictEqual(r.rejected.length, 2);
});

// ── hosts 消毒 ──────────────────────────────────────────────────────────────

test('sanitizeHosts - 拒绝受保护域名与内网重定向', () => {
  const { hosts, findings, dropped } = sanitizeHosts({
    'github.com': ['1.1.1.1'],
    'www.paypal.com': '10.0.0.5',
    'internal.corp': '192.168.1.10',
    'cdn.example.com': '203.0.113.9',
    'cname.example.com': 'evil.example.com'
  });

  assert.strictEqual(hosts['github.com'], undefined);
  assert.strictEqual(hosts['www.paypal.com'], undefined);
  assert.strictEqual(hosts['internal.corp'], undefined);
  assert.strictEqual(hosts['cname.example.com'], undefined);
  // TEST-NET-3 属于非路由保留段，默认剥离
  assert.strictEqual(hosts['cdn.example.com'], undefined);

  const ids = findings.map(f => f.id);
  assert.ok(ids.includes('HOSTS-PROTECTED-DOMAIN'));
  assert.ok(ids.includes('HOSTS-INTERNAL-REDIRECT'));
  assert.ok(ids.includes('HOSTS-CNAME-REJECTED'));
  assert.ok(ids.includes('HOSTS-NONROUTABLE'));
  assert.strictEqual(dropped.length, 5);
});

test('sanitizeHosts - 正常公网映射被保留', () => {
  const { hosts } = sanitizeHosts({
    'cdn.example.com': ['104.18.32.7'],
    'tracker.example.net': '93.184.216.34'
  });
  assert.deepStrictEqual(hosts['cdn.example.com'], '104.18.32.7');
  assert.deepStrictEqual(hosts['tracker.example.net'], '93.184.216.34');
});

test('sanitizeHosts - allowInternal 仅在用户显式开启时放行内网映射', () => {
  const { hosts } = sanitizeHosts({ 'nas.lan': '192.168.1.5' }, { allowInternal: true });
  assert.deepStrictEqual(hosts['nas.lan'], '192.168.1.5');
});

// ── nameserver-policy 净化 ──────────────────────────────────────────────────

test('sanitizeNameserverPolicy - 非 master 无法指定专属解析器', () => {
  const { policy, dropped } = sanitizeNameserverPolicy({
    'paypal.com': 'https://1.1.1.1/dns-query',
    'rule-set:cn-domain': ['1.1.1.1']
  }, { isMaster: false });
  assert.strictEqual(policy['paypal.com'], undefined);
  assert.strictEqual(policy['rule-set:cn-domain'], undefined);
  assert.strictEqual(dropped.length, 2);
});

test('sanitizeNameserverPolicy - master 保留安全条目但剔除保留键', () => {
  const { policy } = sanitizeNameserverPolicy({
    'rule-set:cn-domain': ['1.1.1.1'],
    'corp.example': ['10.0.0.53'],
    'safe.example': 'https://223.5.5.5/dns-query'
  }, { isMaster: true });
  assert.strictEqual(policy['rule-set:cn-domain'], undefined);
  assert.strictEqual(policy['corp.example'], undefined);
  assert.strictEqual(policy['safe.example'], 'https://223.5.5.5/dns-query');
});

// ── 解析链规划 ──────────────────────────────────────────────────────────────

test('planResolverChain - 家庭环境产出满足全部不变式的解析链', () => {
  const plan = planResolverChain({ env: { kind: 'home', ipv4: true, ipv6: false } });

  assert.deepStrictEqual(plan.violations, []);
  assert.strictEqual(plan.dns['use-system-hosts'], false);
  assert.strictEqual(plan.dns['use-hosts'], true);
  assert.strictEqual(plan.dns['respect-rules'], true);
  assert.ok(plan.dns['proxy-server-nameserver'].length > 0);
  assert.ok(plan.dns['fallback-filter'], 'fallback 必须带显式 fallback-filter');
  assert.ok(plan.dns['fallback-filter'].ipcidr.includes('100.64.0.0/10'));
  assert.ok(plan.dns['fallback-filter'].ipcidr.includes('127.0.0.0/8'));
  assert.ok(plan.dns.listen.startsWith('127.0.0.1:'));
  assert.strictEqual(plan.dns['prefer-h3'], false);
});

test('planResolverChain - 企业内网使用本地解析器且不误杀', () => {
  const plan = planResolverChain({
    env: {
      kind: 'enterprise',
      ipv4: true,
      ipv6: false,
      dnsEgressAllowed: false,
      localResolvers: ['10.10.0.53', '10.10.0.54'],
      trustedPrivateCidrs: ['10.10.0.0/16'],
      privateZones: ['corp', 'internal']
    }
  });

  assert.deepStrictEqual(plan.violations, []);
  assert.ok(plan.dns['default-nameserver'].includes('10.10.0.53'));
  assert.ok(plan.dns['proxy-server-nameserver'].includes('10.10.0.53'));
  assert.deepStrictEqual(plan.dns['nameserver-policy']['+.corp'], ['10.10.0.53', '10.10.0.54']);
  assert.strictEqual(plan.capabilities.splitHorizon, true);
  assert.strictEqual(plan.warnings.length, 0);
});

test('planResolverChain - 未受信 localResolvers 被拒绝并告警', () => {
  const plan = planResolverChain({
    env: { kind: 'enterprise', localResolvers: ['10.99.0.53'], trustedPrivateCidrs: [] }
  });
  assert.ok(plan.warnings.some(w => /trustedPrivateCidrs/.test(w)));
  assert.ok(!plan.dns['default-nameserver'].includes('10.99.0.53'));
});

test('planResolverChain - IPv6-only 单栈环境选用 v6 引导地址', () => {
  const plan = planResolverChain({ env: { kind: 'ipv6-only', ipv4: false, ipv6: true } });
  assert.deepStrictEqual(plan.violations, []);
  assert.strictEqual(plan.capabilities.family, 'v6');
  const joined = [...plan.dns['default-nameserver'], ...plan.dns['proxy-server-nameserver']].join(' ');
  assert.ok(/\[2400:3200::1\]|\[2606:4700:4700::1111\]|\[2001:4860:4860::8888\]|\[2402:4e00::\]|\[2620:fe::fe\]/.test(joined),
    `IPv6-only 应使用 v6 引导地址: ${joined}`);
  assert.ok(!/\b223\.5\.5\.5\b|\b119\.29\.29\.29\b/.test(joined), '不应混入纯 v4 地址');
});

test('planResolverChain - 拒绝非回环监听并降级', () => {
  const plan = planResolverChain({ env: { kind: 'home' }, options: { listenHost: '0.0.0.0' } });
  assert.strictEqual(plan.dns.listen, '127.0.0.1:1053');
  assert.ok(plan.findings.some(f => f.id === 'DNS-OPEN-RESOLVER'));
});

test('checkInvariants - 能检出各类危险配置', () => {
  const bad = {
    'default-nameserver': ['https://doh.pub/dns-query'],
    'proxy-server-nameserver': ['198.18.0.1', 'dns.evil.example'],
    'direct-nameserver-follow-policy': true,
    'direct-nameserver': [],
    'respect-rules': true,
    'prefer-h3': true,
    fallback: ['tls://8.8.4.4'],
    listen: '0.0.0.0:1053'
  };
  const v = checkInvariants(bad).map(x => x.id);
  for (const id of ['INV-1', 'INV-2', 'INV-3', 'INV-5', 'INV-6', 'INV-8', 'INV-9']) {
    assert.ok(v.includes(id), `应检出 ${id}，实际: ${v.join(',')}`);
  }
});

test('deriveFakeIpFilterAdditions - 节点域名进入 fake-ip-filter', () => {
  const extras = deriveFakeIpFilterAdditions([
    { server: 'node1.airport.example', sni: 'cdn.example' },
    { server: '1.2.3.4' },
    { server: 'node2.airport.example' }
  ]);
  assert.ok(extras.includes('node1.airport.example'));
  assert.ok(extras.includes('node2.airport.example'));
  assert.ok(extras.includes('cdn.example'));
  assert.ok(!extras.includes('1.2.3.4'));
});

// ── 深度评审缺陷修复专项回归测试 ──────────────────────────────────────────

test('mergeSubscriptionConfigs - 未登记未知字段严格 fail-closed，杜绝穿透漏洞 (Blocker 1)', () => {
  const sources = [
    {
      tag: 'master-sub',
      isMaster: true,
      config: {
        proxies: [{ name: 'm-node' }],
        'unknown-future-kernel-key': 'attacker-payload',
        'another-unrecognized-control': { evil: true }
      }
    }
  ];
  // 即使是 master，未登记字段也坚决不能合并进最终配置
  const { merged, audits } = mergeSubscriptionConfigs(sources, {});
  assert.strictEqual(merged['unknown-future-kernel-key'], undefined);
  assert.strictEqual(merged['another-unrecognized-control'], undefined);
  assert.strictEqual(merged.proxies.length, 1);
  assert.ok(audits[0].hostile.some(h => h.id === 'CP-UNKNOWN'));
});

test('mergeSubscriptionConfigs - proxy-providers 深度合并与冲突上报', () => {
  const sources = [
    { tag: 'A', isMaster: false, config: { proxies: [], 'proxy-providers': { p1: { url: 'http://a.com' } } } },
    { tag: 'B', isMaster: false, config: { proxies: [], 'proxy-providers': { p2: { url: 'http://b.com' } } } },
    { tag: 'C', isMaster: false, config: { proxies: [], 'proxy-providers': { p1: { url: 'http://conflict.com' } } } }
  ];
  const { merged, conflicts } = mergeSubscriptionConfigs(sources, {});
  assert.ok(merged['proxy-providers'].p1);
  assert.ok(merged['proxy-providers'].p2);
  assert.strictEqual(merged['proxy-providers'].p1.url, 'http://a.com');
  assert.ok(conflicts.some(c => c.key === 'proxy-providers.p1'));
});

test('sanitizeDnsServer - DoT 协议严禁错误拼接 /dns-query 路径 (Blocker 2)', () => {
  const dotV4 = sanitizeDnsServer('tls://223.5.5.5', { role: ROLES.PROXY_SERVER });
  assert.strictEqual(dotV4.ok, true);
  assert.strictEqual(dotV4.value, 'tls://223.5.5.5');
  assert.ok(!dotV4.value.includes('/dns-query'), 'DoT 绝不能包含 /dns-query');

  const dotV6 = sanitizeDnsServer('tls://[2400:3200::1]', { role: ROLES.PROXY_SERVER });
  assert.strictEqual(dotV6.ok, true);
  assert.strictEqual(dotV6.value, 'tls://[2400:3200::1]');
  assert.ok(!dotV6.value.includes('/dns-query'));

  const doh = sanitizeDnsServer('https://223.5.5.5', { role: ROLES.PROXY_SERVER });
  assert.strictEqual(doh.ok, true);
  assert.strictEqual(doh.value, 'https://223.5.5.5/dns-query', 'DoH 缺少 path 时应补齐 /dns-query');
});

test('sanitizeDnsServer - IPv6 私网 DNS 支持 trustedPrivateCidrs 校验 (Blocker 4)', () => {
  // fd00::/8 内网 DNS
  const untrusted = sanitizeDnsServer('[fd00::1]', {
    role: ROLES.PROXY_SERVER,
    allowPrivateLiteral: true,
    trustedPrivateCidrs: ['10.0.0.0/8'] // 只有 v4 白名单
  });
  assert.strictEqual(untrusted.ok, false);
  assert.strictEqual(untrusted.reason, 'private-not-trusted');

  const trusted = sanitizeDnsServer('[fd00::1]', {
    role: ROLES.PROXY_SERVER,
    allowPrivateLiteral: true,
    trustedPrivateCidrs: ['fd00::/8'] // 包含 v6 白名单
  });
  assert.strictEqual(trusted.ok, true);
  assert.strictEqual(trusted.value, '[fd00::1]');
});

test('parseDnsServer - 非法 IPv4 数值不被识别为合法 IP', () => {
  const r = parseDnsServer('256.256.256.256');
  assert.strictEqual(r.isIpLiteral, false);
  assert.strictEqual(r.kind, 'url'); // 按裸域名回退处理，而不会作为合法 IP 放行
});

test('parseDnsServer - 裸域名带端口干净拆分 host 与 port', () => {
  const r = parseDnsServer('dns.example.com:53');
  assert.strictEqual(r.host, 'dns.example.com');
  assert.strictEqual(r.port, '53');
});

test('planResolverChain - 自动为节点域名生成 fake-ip-filter 并通过 INV-7 检查 (Blocker 3 & INV-7)', () => {
  const plan = planResolverChain({
    env: { kind: 'home' },
    inputs: {
      proxies: [
        { name: 'Node1', server: 'hk.node.airport.com' },
        { name: 'Node2', server: 'us.node.airport.com', sni: 'cdn.fast.net' }
      ]
    }
  });

  assert.ok(plan.dns['fake-ip-filter'].includes('hk.node.airport.com'));
  assert.ok(plan.dns['fake-ip-filter'].includes('us.node.airport.com'));
  assert.ok(plan.dns['fake-ip-filter'].includes('cdn.fast.net'));

  // 验证 checkInvariants INV-7 自检无违规
  const violations = checkInvariants(plan.dns, {
    proxies: [{ server: 'hk.node.airport.com' }]
  });
  assert.ok(!violations.some(v => v.id === 'INV-7'));

  // 验证人为缺失节点域名时，INV-7 能够准确告警
  const badDns = { ...plan.dns, 'fake-ip-filter': ['baidu.com'] };
  const badViolations = checkInvariants(badDns, {
    proxies: [{ server: 'unfiltered.node.com' }]
  });
  assert.ok(badViolations.some(v => v.id === 'INV-7'));
});

test('planResolverChain - IPv6 回环地址 listenHost 正确规范化为 [::1]', () => {
  const plan = planResolverChain({
    env: { kind: 'home' },
    options: { listenHost: '::1', listenPort: 5353 }
  });
  assert.strictEqual(plan.dns.listen, '[::1]:5353');
});

test('sanitizeHosts - userTrustedDomains 允许用户显式豁免受保护域名', () => {
  const raw = {
    'alibaba.com': '1.2.3.4',
    'github.com': '5.6.7.8'
  };

  // 默认两项均被拦截
  const r1 = sanitizeHosts(raw);
  assert.strictEqual(r1.hosts['alibaba.com'], undefined);
  assert.strictEqual(r1.hosts['github.com'], undefined);

  // 用户白名单显式放行 alibaba.com
  const r2 = sanitizeHosts(raw, { userTrustedDomains: ['alibaba.com'] });
  assert.strictEqual(r2.hosts['alibaba.com'], '1.2.3.4');
  assert.strictEqual(r2.hosts['github.com'], undefined);
});
