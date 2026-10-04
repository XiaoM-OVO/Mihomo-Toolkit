/**
 * 控制面净化 / DNS 沙箱 回归测试
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { partitionControlPlane } = require('../src/core/security/control-plane');

const {
  sanitizeHosts,
  sanitizeDnsServer,
  sanitizeDnsServerList,
  sanitizeNameserverPolicy,
  parseDnsServer,
  ROLES
} = require('../src/core/security/dns-sanitizer');

const {
  checkInvariants,
  deriveFakeIpFilterAdditions
} = require('../src/core/security/resolver-plan');

// ── 控制面隔离 ───────────────────────────────────────────────────────────────

test('partitionControlPlane - 订阅被剥离全部控制面字段', () => {
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

  const { data, report } = partitionControlPlane(sub, { tag: 'evil-airport' });

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
    { tag: 'm' }
  );
  assert.strictEqual(data['some-future-kernel-key'], undefined);
  assert.ok(report.hostile.some(h => h.id === 'CP-UNKNOWN'));
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

test('sanitizeNameserverPolicy - 非可信来源无法指定专属解析器', () => {
  const { policy, dropped } = sanitizeNameserverPolicy({
    'paypal.com': 'https://1.1.1.1/dns-query',
    'rule-set:cn-domain': ['1.1.1.1']
  }, { trustedSource: false });
  assert.strictEqual(policy['paypal.com'], undefined);
  assert.strictEqual(policy['rule-set:cn-domain'], undefined);
  assert.strictEqual(dropped.length, 2);
});

test('sanitizeNameserverPolicy - 可信来源保留安全条目但剔除保留键', () => {
  const { policy } = sanitizeNameserverPolicy({
    'rule-set:cn-domain': ['1.1.1.1'],
    'corp.example': ['10.0.0.53'],
    'safe.example': 'https://223.5.5.5/dns-query'
  }, { trustedSource: true });
  assert.strictEqual(policy['rule-set:cn-domain'], undefined);
  assert.strictEqual(policy['corp.example'], undefined);
  assert.strictEqual(policy['safe.example'], 'https://223.5.5.5/dns-query');
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

test('deriveFakeIpFilterAdditions - 节点域名进入 fake-ip-filter (smart 聚合与 exact 模式)', () => {
  const proxies = [
    { server: 'node1.airport.example', sni: 'cdn.example' },
    { server: '1.2.3.4' },
    { server: 'node2.airport.example' }
  ];
  // 默认 smart 聚合：剔除 SNI 并折叠为主域
  const smartFilters = deriveFakeIpFilterAdditions(proxies);
  assert.ok(smartFilters.includes('+.airport.example'));
  assert.ok(!smartFilters.includes('cdn.example'), '默认不应将 SNI 伪装域名注入 fake-ip-filter');
  assert.ok(!smartFilters.includes('1.2.3.4'));

  // exact 模式：精确提取 server 域名
  const exactFilters = deriveFakeIpFilterAdditions(proxies, { mode: 'exact' });
  assert.ok(exactFilters.includes('node1.airport.example'));
  assert.ok(exactFilters.includes('node2.airport.example'));
  assert.ok(!exactFilters.includes('cdn.example'));

  // off 模式：返回空
  assert.deepStrictEqual(deriveFakeIpFilterAdditions(proxies, { mode: 'off' }), []);
});

// ── 深度评审缺陷修复专项回归测试 ──────────────────────────────────────────

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

// ── 深度安全沙箱修复专项测试 ────────────────────────────────────────────────

test('P0 - default-nameserver 严格纯 IP 化，拒绝加密 DNS 与 URL 形式 IP', () => {
  // 1. sanitizeDnsServer 拒绝 default 角色下的 DoH URL (即使 host 为 IP)
  const dohWithIp = sanitizeDnsServer('https://223.5.5.5/dns-query', { role: ROLES.DEFAULT });
  assert.strictEqual(dohWithIp.ok, false);
  assert.strictEqual(dohWithIp.reason, 'bootstrap-must-be-ip');

  // 2. checkInvariants INV-1 能捕获 default-nameserver 中的 URL 形式
  const violations = checkInvariants({
    'default-nameserver': ['https://223.5.5.5/dns-query']
  });
  assert.ok(violations.some(v => v.id === 'INV-1'));
});

test('P1 - external-controller-pipe 与 cors 纳入 critical 级夺权拦截', () => {
  const { report } = partitionControlPlane({
    'external-controller-pipe': '\\\\.\\pipe\\evil',
    'external-controller-cors': 'http://evil.com'
  }, { tag: 'sub-pipe' });

  assert.ok(report.stripped.includes('external-controller-pipe'));
  assert.ok(report.stripped.includes('external-controller-cors'));

  const pipeHostile = report.hostile.find(h => h.key === 'external-controller-pipe');
  assert.ok(pipeHostile);
  assert.strictEqual(pipeHostile.id, 'CP-EXT-CTRL');
  assert.strictEqual(pipeHostile.severity, 'critical');

  const corsHostile = report.hostile.find(h => h.key === 'external-controller-cors');
  assert.ok(corsHostile);
  assert.strictEqual(corsHostile.id, 'CP-EXT-CTRL');
  assert.strictEqual(corsHostile.severity, 'critical');
});

test('P2 - deriveFakeIpFilterAdditions 兼容数字开头合法域名并排除 IP 字面量', () => {
  const filters = deriveFakeIpFilterAdditions([
    { server: '123.example.com' },
    { server: '1password.com' },
    { server: '1.2.3.4' },
    { server: '8.8.8.8' },
    { server: '2400:3200::1' }
  ], { mode: 'exact' });

  assert.ok(filters.includes('123.example.com'), '应支持以数字开头的合法域名');
  assert.ok(filters.includes('1password.com'), '应支持以数字开头的合法域名');
  assert.ok(!filters.includes('1.2.3.4'), '应排除 IPv4 字面量');
  assert.ok(!filters.includes('8.8.8.8'), '应排除 IPv4 字面量');
  assert.ok(!filters.includes('2400:3200::1'), '应排除 IPv6 字面量');
});

test('P3 - fake-ip-filter 智能聚合与防伪装 SNI 污染专项测试', () => {
  const { getRootDomain } = require('../src/core/security/resolver-plan');
  assert.strictEqual(getRootDomain('aws-link1.lxyun.xyz'), 'lxyun.xyz');
  assert.strictEqual(getRootDomain('w1hwbf8-g04.jp01-nn-vm0.entry.fr0528.art'), 'fr0528.art');
  assert.strictEqual(getRootDomain('node1.airport.com.cn'), 'airport.com.cn');
  assert.strictEqual(getRootDomain('my-sub.workers.dev'), 'my-sub.workers.dev');

  const proxies = [
    { name: '1', server: 'aws-link1.lxyun.xyz', sni: 'fastcdn.hoyoverse.com' },
    { name: '2', server: 'aws-link2.lxyun.xyz', sni: 'www.apple.com' },
    { name: '3', server: 'jp1.7770006.xyz', sni: 'bilibili-jp.biliimg.com' },
    { name: '4', server: 'jp2.7770006.xyz', sni: 'dl.google.com' },
    { name: '5', server: 'node.airport.com.cn' }
  ];

  const smart = deriveFakeIpFilterAdditions(proxies);
  // 应聚合为 3 条主域泛化规则
  assert.deepStrictEqual(smart.slice().sort(), ['+.7770006.xyz', '+.airport.com.cn', '+.lxyun.xyz'].sort());
  // 伪装 SNI 绝不能进入
  assert.ok(!smart.includes('fastcdn.hoyoverse.com'));
  assert.ok(!smart.includes('www.apple.com'));
  assert.ok(!smart.includes('bilibili-jp.biliimg.com'));
  assert.ok(!smart.includes('dl.google.com'));
});

test('Extra - sanitizeHosts 阻断 FQDN 尾随点绕过与非法 IP 伪造', () => {
  const { hosts, dropped } = sanitizeHosts({
    'github.com.': '1.2.3.4',       // 尾随点试图绕过 protectedDomains
    'evil.com': '999.999.999.999'    // 非法 IPv4
  });

  assert.strictEqual(hosts['github.com.'], undefined);
  assert.strictEqual(hosts['evil.com'], undefined);
  assert.ok(dropped.some(d => d.key === 'github.com.' && d.reason === 'protected-domain'));
  assert.ok(dropped.some(d => d.key === 'evil.com' && d.reason === 'non-literal-value'));
});

test('Extra - parseDnsServer 支持纯无括号 IPv6 且非法输入不崩溃', () => {
  const v6 = parseDnsServer('2400:3200::1');
  assert.strictEqual(v6.kind, 'ip');
  assert.strictEqual(v6.isIpv6, true);
  assert.strictEqual(v6.host, '2400:3200::1');

  const invalid = parseDnsServer('invalid-@-server!!!');
  assert.strictEqual(invalid.kind, 'invalid');

  const sanitized = sanitizeDnsServer('invalid-@-server!!!');
  assert.strictEqual(sanitized.ok, false);
  assert.strictEqual(sanitized.reason, 'unparsable');
});
