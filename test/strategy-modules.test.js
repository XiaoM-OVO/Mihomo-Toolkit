const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_CONFIG, resolveConfig } = require('../src/config');
const { applyDnsOverlay } = require('../src/strategy/dns');
const { applyTunOverlay, applySnifferOverlay, applyCoreOptimize } = require('../src/strategy/kernel');
const { createServiceRegistries } = require('../src/strategy/registries');
const { buildRoutingRules } = require('../src/strategy/rules');

test('🧩 策略模块单元测试 - 配置解析器 (config)', () => {
  const resolved = resolveConfig({ logLevel: 'debug', enableIPv6: true });
  assert.equal(resolved.logLevel, 'debug');
  assert.equal(resolved.enableIPv6, true);
  assert.equal(resolved.enableScript, true);
  assert.ok(Array.isArray(resolved.whitelistKeywords));
});

test('🧩 策略模块单元测试 - 六维服务注册表 (registries)', () => {
  const registries = createServiceRegistries(DEFAULT_CONFIG);
  assert.ok(registries.ai.chatgpt);
  assert.ok(registries.streaming.netflix);
  assert.ok(registries.game.steam);
  assert.ok(registries.system.google);
  assert.equal(registries.ai.chatgpt.name, '🤖 ChatGPT');
});

test('🧩 策略模块单元测试 - DNS 覆写注入 (dns)', () => {
  const config = { dns: { listen: '0.0.0.0:53' } };
  applyDnsOverlay(config, DEFAULT_CONFIG);
  assert.ok(config.dns);
  assert.equal(config.dns.enable, true);
  assert.equal(config.dns['enhanced-mode'], 'fake-ip');
  assert.ok(config.dns.listen.includes(':'));
  assert.ok(Array.isArray(config.dns['fake-ip-filter']));
});

test('🧩 策略模块单元测试 - 内核调优与 TUN/Sniffer (kernel)', () => {
  const config = {
    proxies: [
      { name: 'Node1', type: 'vless', server: 'example.com', port: 443, tls: true }
    ]
  };
  applyTunOverlay(config, DEFAULT_CONFIG);
  assert.equal(config.tun.enable, undefined);
  assert.equal(config.tun.stack, 'system');
  assert.equal(config.tun.device, 'Mihomo');

  applySnifferOverlay(config, DEFAULT_CONFIG);
  assert.equal(config.sniffer.enable, true);

  applyCoreOptimize(config, DEFAULT_CONFIG);
  assert.equal(config['unified-delay'], true);
  assert.equal(config['tcp-concurrent'], true);
  assert.equal(config.proxies[0]['client-fingerprint'], 'chrome');
  assert.equal(config.proxies[0].udp, true);
});

test('🧩 策略模块单元测试 - 路由分流与规则集组装 (rules)', () => {
  const registries = createServiceRegistries(DEFAULT_CONFIG);
  const { rules, providers } = buildRoutingRules(DEFAULT_CONFIG, registries);
  assert.ok(rules.length > 10);
  assert.ok(rules.includes('RULE-SET,ads,🚫 广告拦截'));
  assert.ok(rules.includes('MATCH,🐟 漏网之鱼'));
  assert.ok(providers['ads']);
  assert.equal(providers['ads'].behavior, 'domain');
});
