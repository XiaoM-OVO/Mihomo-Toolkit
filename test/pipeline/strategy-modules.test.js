const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_CONFIG, resolveConfig } = require('../../src/config');
const { applyDnsOverlay } = require('../../src/strategy/dns');
const { applyTunOverlay, applySnifferOverlay, applyCoreOptimize } = require('../../src/strategy/kernel');
const { createServiceRegistries } = require('../../src/strategy/registries');
const {
  buildRoutingRules,
  createHttpRuleProvider,
  BASE_PROVIDER_ROUTES,
  SPECIAL_SERVICES,
  assembleServiceCategory
} = require('../../src/strategy/rules');
const { runStrategyPipeline } = require('../../src/pipeline/strategy');

describe('【Pipeline】策略模块与规则生成 (strategy-modules)', () => {
  it('config - 配置解析器与默认值补全 (resolveConfig)', () => {
    const resolved = resolveConfig({ logLevel: 'debug', enableIPv6: true });
    assert.equal(resolved.logLevel, 'debug');
    assert.equal(resolved.enableIPv6, true);
    assert.equal(resolved.enablePipeline, true);
    assert.ok(Array.isArray(resolved.whitelistKeywords));
  });

  it('registries - 六维服务注册表组装 (createServiceRegistries)', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    assert.ok(registries.ai.chatgpt);
    assert.ok(registries.streaming.netflix);
    assert.ok(registries.game.steam);
    assert.ok(registries.system.google);
    assert.equal(registries.ai.chatgpt.name, 'ChatGPT');
    assert.equal(registries.ai.chatgpt.fullName, '🤖 ChatGPT');
  });

  it('dns - DNS 覆写注入与 fake-ip 配置', () => {
    const config = { dns: { listen: '0.0.0.0:53' } };
    applyDnsOverlay(config, DEFAULT_CONFIG);
    assert.ok(config.dns);
    assert.equal(config.dns.enable, true);
    assert.equal(config.dns['enhanced-mode'], 'fake-ip');
    assert.ok(config.dns.listen.includes(':'));
    assert.ok(Array.isArray(config.dns['fake-ip-filter']));
  });

  it('kernel - 内核调优与 TUN/Sniffer/指纹优化', () => {
    const config = {
      proxies: [
        { name: 'Node1', type: 'vless', server: 'example.com', port: 443, tls: true }
      ]
    };
    applyTunOverlay(config, DEFAULT_CONFIG);
    assert.equal(config.tun.enable, undefined);
    assert.equal(config.tun.stack, 'system');
    assert.equal(config.tun.device, 'Mihomo');
    assert.deepStrictEqual(config.tun['dns-hijack'], ['any:53', 'tcp://any:53']);
    assert.deepStrictEqual(config.tun['route-exclude-address'], [
      '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', 'fc00::/7', 'fe80::/10'
    ]);

    applySnifferOverlay(config, DEFAULT_CONFIG);
    assert.equal(config.sniffer.enable, true);

    applyCoreOptimize(config, DEFAULT_CONFIG);
    assert.equal(config['unified-delay'], true);
    assert.equal(config['tcp-concurrent'], true);
    assert.equal(config.proxies[0]['client-fingerprint'], 'chrome');
    assert.equal(config.proxies[0].udp, true);

    // 纯函数零副作用：被优化的原代理节点对象不得被就地篡改
    const frozenTrojan = Object.freeze({ name: 'Trojan Node', type: 'trojan', tls: true, server: 't.example.com', port: 443 });
    const cfgWithFrozen = { proxies: [frozenTrojan] };
    applyCoreOptimize(cfgWithFrozen, DEFAULT_CONFIG);
    assert.equal(cfgWithFrozen.proxies[0]['client-fingerprint'], 'chrome');
    assert.equal(cfgWithFrozen.proxies[0].udp, true);
    assert.equal(frozenTrojan['client-fingerprint'], undefined, '不得篡改原冻结对象属性');
  });

  it('rules - 路由分流与规则集组装 (buildRoutingRules)', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const { rules, providers } = buildRoutingRules(DEFAULT_CONFIG, registries);
    assert.ok(rules.length > 10);
    assert.ok(rules.includes('RULE-SET,ads,广告拦截'));
    assert.ok(rules.includes('MATCH,漏网之鱼'));
    assert.ok(providers['ads']);
    assert.equal(providers['ads'].behavior, 'domain');
  });

  it('rules - customRules 优先级提前：置于基础网络之后、业务分流规则集之前', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const testConfig = {
      ...DEFAULT_CONFIG,
      subDomain: ['sub.example.com'],
      customRules: [
        'DOMAIN,my-private-domain.com,DIRECT',
        'DOMAIN-SUFFIX,custom-proxy.com,节点选择'
      ]
    };
    const { rules } = buildRoutingRules(testConfig, registries);

    const lanIndex = rules.indexOf('RULE-SET,lan-domain,DIRECT');
    const subDomainIndex = rules.indexOf('DOMAIN,sub.example.com,DIRECT');
    const customRule1Index = rules.indexOf('DOMAIN,my-private-domain.com,DIRECT');
    const customRule2Index = rules.indexOf('DOMAIN-SUFFIX,custom-proxy.com,节点选择');
    const adsIndex = rules.indexOf('RULE-SET,ads,广告拦截');
    const matchIndex = rules.indexOf('MATCH,漏网之鱼');

    assert.ok(lanIndex >= 0, '必须包含 LAN 规则');
    assert.ok(subDomainIndex > lanIndex, 'subDomain 应在 LAN 之后');
    assert.ok(customRule1Index > subDomainIndex, 'customRules 应在 subDomain 之后');
    assert.ok(customRule2Index > customRule1Index, 'customRules 内部保持顺序');
    assert.ok(customRule2Index < adsIndex, 'customRules 必须在广告拦截等业务规则之前');
    assert.ok(customRule2Index < matchIndex, 'customRules 必须在漏网之鱼之前');
  });

  it('config - 支持自定义 logger 注入且在 silent 模式下静默', () => {
    const logs = [];
    const customLogger = {
      warn: (msg) => logs.push(msg)
    };

    // 1. 传入自定义 logger，非法条目触发 logger.warn 而非直接抛错或裸输出
    resolveConfig({
      protectedDomains: ['   ', 'valid.com']
    }, { logger: customLogger });

    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes('protectedDomains'));
    assert.ok(logs[0].includes('格式非法、已忽略'));

    // 2. logLevel 为 silent 时，且无外部 logger 时静默抑制输出
    let consoleWarnCalled = false;
    const origWarn = console.warn;
    console.warn = () => { consoleWarnCalled = true; };
    try {
      resolveConfig({
        logLevel: 'silent',
        protectedDomains: ['   ']
      });
      assert.equal(consoleWarnCalled, false, 'silent 模式下不应触发 console.warn');
    } finally {
      console.warn = origWarn;
    }
  });

  it('strategy - devServices 与 enableGitHub / enableScholar 动态开关联动', () => {
    // 1. 默认状态：同时启用 GitHub 与 学术
    const defaultCfg = resolveConfig({});
    const defaultRes = buildRoutingRules(defaultCfg, defaultCfg.registries);
    assert.ok(defaultRes.rules.includes('RULE-SET,github,GitHub'));
    assert.ok(defaultRes.rules.includes('RULE-SET,scholar,学术网站'));

    // 2. 仅启用 github
    const ghOnlyCfg = resolveConfig({ devServices: ['github'] });
    const ghOnlyRes = buildRoutingRules(ghOnlyCfg, ghOnlyCfg.registries);
    assert.ok(ghOnlyRes.rules.includes('RULE-SET,github,GitHub'));
    assert.ok(!ghOnlyRes.rules.includes('RULE-SET,scholar,学术网站'));

    // 3. 清空 devServices
    const noneCfg = resolveConfig({ devServices: [] });
    const noneRes = buildRoutingRules(noneCfg, noneCfg.registries);
    assert.ok(!noneRes.rules.includes('RULE-SET,github,GitHub'));
    assert.ok(!noneRes.rules.includes('RULE-SET,scholar,学术网站'));

    // 4. legacy 开关显式为 false 时即使 devServices 声明也生效关闭
    const offGhCfg = resolveConfig({ enableGitHub: false, devServices: ['github', 'scholar'] });
    const offGhRes = buildRoutingRules(offGhCfg, offGhCfg.registries);
    assert.ok(!offGhRes.rules.includes('RULE-SET,github,GitHub'));
    assert.ok(offGhRes.rules.includes('RULE-SET,scholar,学术网站'));

    // 5. 支持 customServices.dev 扩展
    const customDevCfg = resolveConfig({
      devServices: ['github', 'huggingface'],
      customServices: {
        dev: {
          huggingface: {
            name: 'HuggingFace',
            rules: 'huggingface'
          }
        }
      }
    });
    const customRes = buildRoutingRules(customDevCfg, customDevCfg.registries);
    assert.ok(customRes.rules.includes('RULE-SET,github,GitHub'));
    assert.ok(customRes.rules.includes('RULE-SET,huggingface,HuggingFace'));
    assert.equal(customRes.providers['huggingface'].behavior, 'domain');
  });

  it('config - 策略流水线将配置告警透传至注入 logger 而非裸 console.warn', () => {
    const logs = [];
    const logger = {
      warn: (msg) => logs.push(msg),
      child() { return this; },
      isLevelEnabled() { return false; },
      info() {}, debug() {}, success() {}, error() {}
    };

    let consoleWarnCalled = false;
    const origWarn = console.warn;
    console.warn = () => { consoleWarnCalled = true; };
    try {
      runStrategyPipeline({ proxies: [] }, { protectedDomains: ['   ', 'a.com'] }, { logger });
    } finally {
      console.warn = origWarn;
    }

    assert.ok(logs.some(m => m.includes('protectedDomains')), '策略流水线应将配置告警透传至注入 logger');
    assert.equal(consoleWarnCalled, false, '注入 logger 时不应再触发裸 console.warn');
  });

  it('rules - createHttpRuleProvider 构造器与远端/绝对 URL 规整', () => {
    // 1. 标准 geosite 规则集
    const p1 = createHttpRuleProvider('ads', 'geosite/category-ads-all', {
      repoBase: 'https://cdn.example.com/gh',
      ruleFormat: 'mrs'
    });
    assert.equal(p1.type, 'http');
    assert.equal(p1.behavior, 'domain');
    assert.equal(p1.url, 'https://cdn.example.com/gh/geo/geosite/category-ads-all.mrs');
    assert.equal(p1.path, './ruleset/ads.mrs');
    assert.equal(p1.format, 'mrs');
    assert.equal(p1.proxy, 'DIRECT');

    // 2. geoip IP 段规则集 (behavior 自动识别为 ipcidr)
    const p2 = createHttpRuleProvider('cn-ip', 'geoip/cn', {
      repoBase: 'https://cdn.example.com/gh',
      ruleFormat: 'yaml'
    });
    assert.equal(p2.behavior, 'ipcidr');
    assert.equal(p2.format, 'yaml');
    assert.equal(p2.path, './ruleset/cn-ip.yaml');

    // 3. 绝对 URL 外部规则集（例如 anti-ad）
    const p3 = createHttpRuleProvider('anti-ad', 'https://anti-ad.net/clash.yaml', {
      repoBase: 'https://cdn.example.com/gh',
      ruleFormat: 'mrs'
    });
    assert.equal(p3.behavior, 'domain');
    assert.equal(p3.url, 'https://anti-ad.net/clash.yaml');
    assert.equal(p3.format, 'yaml');
    assert.equal(p3.path, './ruleset/anti-ad.yaml');
  });

  it('rules - assembleServiceCategory 声明式分类装配与回调', () => {
    const registry = {
      testApp: {
        name: 'TestApp',
        ruleSet: 'testapp-rules',
        provider: 'geosite/testapp',
        rules: ['RULE-SET,testapp-rules,TestApp']
      }
    };
    const providerBase = {};
    const routingRules = [];

    assembleServiceCategory({
      registry,
      activeKeys: ['testApp'],
      providerBase,
      routingRules
    });

    assert.equal(providerBase['testapp-rules'], 'geosite/testapp');
    assert.deepEqual(routingRules, ['RULE-SET,testapp-rules,TestApp']);
  });

  it('rules - 声明式专项独立服务装配 (Crypto, PayPal, WebRTC, Telegram)', () => {
    const testConfig = {
      ...DEFAULT_CONFIG,
      enableCrypto: true,
      enablePayPal: true,
      enableWebRTC: true,
      enableTelegram: true,
      osType: 'windows'
    };
    // 常量基准与专项配置元数据检验
    assert.ok(BASE_PROVIDER_ROUTES['lan-domain'], 'BASE_PROVIDER_ROUTES 应包含 lan-domain');
    assert.ok(SPECIAL_SERVICES.crypto && SPECIAL_SERVICES.telegram, 'SPECIAL_SERVICES 应包含 crypto 与 telegram');

    const { rules, providers } = buildRoutingRules(testConfig);

    // 专项服务规则验证
    assert.ok(rules.includes('RULE-SET,crypto,加密货币'));
    assert.ok(rules.includes('RULE-SET,paypal,PayPal'));
    assert.ok(rules.includes('DOMAIN-KEYWORD,webrtc,WebRTC'));
    assert.ok(rules.includes('PROCESS-NAME,Telegram.exe,Telegram'));
    assert.ok(rules.includes('RULE-SET,telegram,Telegram'));
    assert.ok(rules.includes('RULE-SET,telegram-ip,Telegram,no-resolve'));

    // 专项服务 providers 验证
    assert.ok(providers['crypto']);
    assert.ok(providers['paypal']);
    assert.ok(providers['telegram']);
    assert.ok(providers['telegram-ip']);
    assert.equal(providers['telegram-ip'].behavior, 'ipcidr');
  });

  it('rules - 无 registries 参数传入时自动回退 ServiceCatalog 构建', () => {
    const { rules, providers } = buildRoutingRules({
      enableAI: true,
      aiServices: ['chatgpt']
    });
    assert.ok(rules.includes('RULE-SET,openai,ChatGPT'));
    assert.ok(providers['openai']);
  });
});
