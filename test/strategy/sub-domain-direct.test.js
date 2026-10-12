const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  normalizeSubDomains,
  extractDomainOrIp,
  isIPv4,
  isIPv6,
  isValidDomain,
  isLoopbackOrUnspecified
} = require('../../src/core/shared/ip');
const { buildRoutingRules } = require('../../src/strategy/rules');
const { applyDnsOverlay } = require('../../src/strategy/dns');
const { createServiceRegistries } = require('../../src/strategy/registries');
const { DEFAULT_CONFIG } = require('../../src/config');
const { startServer } = require('../../src/targets/server');

describe('【Strategy】订阅服务域名与 IP 直连注入 (subDomain)', () => {
  describe('1. 规范化与提取纯函数 (ip / domains)', () => {
    it('extractDomainOrIp - 协议头、端口号、路径剥离', () => {
      assert.equal(extractDomainOrIp('sub.example.com'), 'sub.example.com');
      assert.equal(extractDomainOrIp('https://sub.example.com:8443/sub?token=123'), 'sub.example.com');
      assert.equal(extractDomainOrIp('http://198.51.100.1:3000/sub'), '198.51.100.1');
      assert.equal(extractDomainOrIp('198.51.100.1:8080'), '198.51.100.1');
      assert.equal(extractDomainOrIp('[2001:db8::1]:8080'), '2001:db8::1');
      assert.equal(extractDomainOrIp('2001:db8::1'), '2001:db8::1');
      assert.equal(extractDomainOrIp(''), null);
      assert.equal(extractDomainOrIp(null), null);
    });

    it('isValidDomain - 域名格式与合法 FQDN 校验', () => {
      assert.equal(isValidDomain('sub.example.com'), true);
      assert.equal(isValidDomain('sub-service.internal.io'), true);
      assert.equal(isValidDomain('+.example.com'), true);
      assert.equal(isValidDomain('*.example.com'), true);
      assert.equal(isValidDomain('invalid..com'), false);
      assert.equal(isValidDomain('bad domain.com'), false);
      assert.equal(isValidDomain('domain-without-tld'), false);
      assert.equal(isValidDomain('198.51.100.1'), false);
      assert.equal(isValidDomain(''), false);
    });

    it('isLoopbackOrUnspecified - 回环段与未指定地址全量拦截', () => {
      assert.equal(isLoopbackOrUnspecified('localhost'), true);
      assert.equal(isLoopbackOrUnspecified('sub.localhost'), true);
      assert.equal(isLoopbackOrUnspecified('127.0.0.1'), true);
      assert.equal(isLoopbackOrUnspecified('127.0.0.2'), true);
      assert.equal(isLoopbackOrUnspecified('127.255.255.255'), true);
      assert.equal(isLoopbackOrUnspecified('::1'), true);
      assert.equal(isLoopbackOrUnspecified('[::1]'), true);
      assert.equal(isLoopbackOrUnspecified('0.0.0.0'), true);
      assert.equal(isLoopbackOrUnspecified('::'), true);
      assert.equal(isLoopbackOrUnspecified('198.51.100.1'), false);
      assert.equal(isLoopbackOrUnspecified('sub.example.com'), false);
    });

    it('normalizeSubDomains - 列表去重、空白逗号拆分、回环剔除与非法字符过滤', () => {
      assert.deepEqual(normalizeSubDomains('sub.example.com'), ['sub.example.com']);
      assert.deepEqual(normalizeSubDomains(['sub.example.com', 'https://sub.example.com:3000']), ['sub.example.com']);
      assert.deepEqual(normalizeSubDomains('sub1.example.com, sub2.example.com'), ['sub1.example.com', 'sub2.example.com']);
      assert.deepEqual(normalizeSubDomains(['127.0.0.1', '127.0.0.8', 'localhost', '::1', '0.0.0.0', '::']), []);
      assert.deepEqual(normalizeSubDomains(['127.0.0.1:3000', 'sub.example.com']), ['sub.example.com']);
      assert.deepEqual(normalizeSubDomains(['198.51.100.1', '+.example.com']), ['198.51.100.1', '+.example.com']);
      assert.deepEqual(normalizeSubDomains(['invalid..com', 'bad domain.com', 'http:///bad']), []);
    });

    it('isIPv4 & isIPv6 - 地址字面量准确识别', () => {
      assert.equal(isIPv4('198.51.100.1'), true);
      assert.equal(isIPv4('sub.example.com'), false);
      assert.equal(isIPv6('2001:db8::1'), true);
      assert.equal(isIPv6('[2001:db8::1]'), true);
      assert.equal(isIPv6('198.51.100.1'), false);
      assert.equal(isIPv6('sub.example.com'), false);
    });
  });

  describe('2. 路由分流层注入 (rules)', () => {
    it('buildRoutingRules - 域名注入 DOMAIN,xxx,DIRECT 并置于前列', () => {
      const userConfig = { ...DEFAULT_CONFIG, subDomain: 'sub.example.com' };
      const registries = createServiceRegistries(userConfig);
      const { rules } = buildRoutingRules(userConfig, registries);

      const subRuleIdx = rules.indexOf('DOMAIN,sub.example.com,DIRECT');
      const lanRuleIdx = rules.indexOf('RULE-SET,lan-ip,DIRECT,no-resolve');
      const adsRuleIdx = rules.indexOf('RULE-SET,ads,广告拦截');

      assert.ok(subRuleIdx > -1, '必须生成 DOMAIN 直连规则');
      assert.ok(subRuleIdx > lanRuleIdx, '必须在 LAN 规则之后');
      assert.ok(subRuleIdx < adsRuleIdx, '必须在广告及外部规则集之前');
    });

    it('buildRoutingRules - IPv4、IPv6 与泛域名注入匹配规则', () => {
      const userConfig = {
        ...DEFAULT_CONFIG,
        subDomain: [
          '198.51.100.1',
          '2001:db8::1',
          '+.example.com'
        ]
      };
      const registries = createServiceRegistries(userConfig);
      const { rules } = buildRoutingRules(userConfig, registries);

      assert.ok(rules.includes('IP-CIDR,198.51.100.1/32,DIRECT,no-resolve'));
      assert.ok(rules.includes('IP-CIDR6,2001:db8::1/128,DIRECT,no-resolve'));
      assert.ok(rules.includes('DOMAIN-SUFFIX,example.com,DIRECT'));
    });
  });

  describe('3. DNS 防自环层注入 (dns.fake-ip-filter)', () => {
    it('applyDnsOverlay - 域名自动注入 fake-ip-filter，IP 地址不注入', () => {
      const config = { proxies: [] };
      const userConfig = {
        ...DEFAULT_CONFIG,
        subDomain: ['sub.example.com', '198.51.100.1', '+.example.com']
      };
      applyDnsOverlay(config, userConfig);

      assert.ok(config.dns);
      const filters = config.dns['fake-ip-filter'];
      assert.ok(Array.isArray(filters));
      assert.ok(filters.includes('sub.example.com'), '域名必须进入 fake-ip-filter');
      assert.ok(filters.includes('+.example.com'), '通配域名必须进入 fake-ip-filter');
      assert.ok(!filters.includes('198.51.100.1'), 'IP 字面量不得进入 fake-ip-filter');
    });
  });

  describe('4. 服务端 Host 自适应推导与防伪造隔离 (server)', () => {
    it('server - 严格只依据标准 Host 注入直连规则，拒绝不可信 X-Forwarded-Host', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtk-subdomain-test-'));
      const subFile = path.join(tmpDir, 'nodes.yaml');
      fs.writeFileSync(
        subFile,
        'proxies:\n  - name: TestNode\n    type: vless\n    server: 198.51.100.1\n    port: 443\n    uuid: 4cff45d5-e95f-4f3c-9dc8-d2bcbd04ce8a\n',
        'utf-8'
      );
      const configFile = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(
        configFile,
        `logLevel: silent\nenableCache: false\nsubscriptions:\n  - url: ${JSON.stringify(subFile)}\n    tag: LOCAL\n`,
        'utf-8'
      );

      const server = startServer({
        port: 0,
        host: '127.0.0.1',
        configPath: configFile,
        silent: true
      });

      if (!server.listening) {
        await new Promise((resolve, reject) => {
          server.once('listening', resolve);
          server.once('error', reject);
        });
      }
      const port = server.address().port;

      try {
        const body = await new Promise((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: '/sub',
            method: 'GET',
            headers: {
              'Host': 'sub.test-toolkit.com:443',
              // 模拟恶意客户端试图注入外部不可信域名
              'X-Forwarded-Host': 'evil-attacker.com'
            }
          }, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve(data));
          });
          req.on('error', reject);
          req.end();
        });

        // 1. 标准 Host 被清洗并注入直连规则与 fake-ip-filter
        assert.ok(body.includes('DOMAIN,sub.test-toolkit.com,DIRECT'), '产物 rules 中必须包含推导出的 Host 直连规则');
        assert.ok(body.includes('sub.test-toolkit.com'), '产物 fake-ip-filter 中必须包含推导出的 Host 域名');

        // 2. 不可信的 X-Forwarded-Host 绝不被注入
        assert.ok(!body.includes('evil-attacker.com'), '绝对不可采信不可信的 X-Forwarded-Host 请求头');
      } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
