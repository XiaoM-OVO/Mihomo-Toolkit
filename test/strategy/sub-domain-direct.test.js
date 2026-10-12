const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { normalizeSubDomains, extractDomainOrIp, isIPv4, isIPv6 } = require('../../src/core/shared/ip');
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

    it('normalizeSubDomains - 列表去重、空白逗号拆分与回环地址剔除', () => {
      assert.deepEqual(normalizeSubDomains('sub.example.com'), ['sub.example.com']);
      assert.deepEqual(normalizeSubDomains(['sub.example.com', 'https://sub.example.com:3000']), ['sub.example.com']);
      assert.deepEqual(normalizeSubDomains('sub1.example.com, sub2.example.com'), ['sub1.example.com', 'sub2.example.com']);
      assert.deepEqual(normalizeSubDomains(['127.0.0.1', 'localhost', '::1', '0.0.0.0']), []);
      assert.deepEqual(normalizeSubDomains(['127.0.0.1:3000', 'sub.example.com']), ['sub.example.com']);
      assert.deepEqual(normalizeSubDomains(['198.51.100.1', '+.example.com']), ['198.51.100.1', '+.example.com']);
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

  describe('4. 服务端 Host / X-Forwarded-Host 自适应推导 (server)', () => {
    it('server - 收到带 Host 的订阅请求时自动注入直连规则', async () => {
      const localConfig = {
        subscriptions: [
          {
            uri: 'vless://4cff45d5-e95f-4f3c-9dc8-d2bcbd04ce8a@198.51.100.1:443?encryption=none&security=reality&sni=example.com#TestNode'
          }
        ],
        enableCache: false
      };

      const serverInstance = startServer({
        port: 0,
        host: '127.0.0.1',
        silent: true
      });

      // 覆盖 server 内部的 localConfig
      const serverPort = await new Promise(resolve => {
        serverInstance.listen(0, '127.0.0.1', () => {
          resolve(serverInstance.address().port);
        });
      });

      try {
        const body = await new Promise((resolve, reject) => {
          const req = http.request({
            hostname: '127.0.0.1',
            port: serverPort,
            path: '/sub',
            method: 'GET',
            headers: {
              'Host': 'sub.test-toolkit.com:443',
              'X-Forwarded-Host': 'sub.test-toolkit.com'
            }
          }, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve(data));
          });
          req.on('error', reject);
          req.end();
        });

        assert.ok(body.includes('DOMAIN,sub.test-toolkit.com,DIRECT'), '产物 rules 中必须包含推导出的直连规则');
        assert.ok(body.includes('sub.test-toolkit.com'), '产物 fake-ip-filter 中必须包含推导出的域名');
      } finally {
        await new Promise(resolve => serverInstance.close(resolve));
      }
    });
  });
});
