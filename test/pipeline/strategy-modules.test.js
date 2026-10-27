const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_CONFIG, resolveConfig } = require('../../src/config');
const { applyDnsOverlay } = require('../../src/strategy/dns');
const { applyTunOverlay, applySnifferOverlay, applyCoreOptimize } = require('../../src/strategy/kernel');
const { createServiceRegistries } = require('../../src/strategy/registries');
const {
  createHttpRuleProvider,
  BASE_PROVIDER_ROUTES
} = require('../../src/strategy/rules');
const { expandRouting } = require('../../src/strategy/routing');
const { SPECIAL_SERVICES, ADS_GROUPS } = require('../../src/config/catalog');
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
    assert.equal(registries.ai.chatgpt.category, 'ai', '注册表条目必须挂载 category 字段');
  });

  it('config - 用户声明改名后同步刷新 fullName 并清除内部 _ref 属性', () => {
    const resolved = resolveConfig({
      groups: [{ ref: 'chatgpt', name: '我的AI' }]
    });
    const item = resolved.registries.ai.chatgpt;
    assert.equal(item.name, '我的AI');
    assert.equal(item.cleanName, '我的AI');
    assert.equal(item.fullName, '🤖 我的AI', '改名后必须同步更新带图标的前缀 fullName');
    assert.equal(resolved.groups[0]._ref, undefined, '内部 _ref 标记必须彻底清理避免泄漏');
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

  it('rules - 路由分流与规则集组装 (routing 表)', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const { rules, providers } = expandRouting(DEFAULT_CONFIG, registries);
    assert.ok(rules.length > 10);
    assert.ok(rules.includes('RULE-SET,ads,广告拦截'));
    assert.ok(rules.includes('MATCH,漏网之鱼'));
    assert.ok(providers['ads']);
    assert.equal(providers['ads'].behavior, 'domain');
  });

  it('rules - 私域规则写在 routing 表里：位置即优先级（基础网络之后、业务规则之前）', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const testConfig = {
      ...DEFAULT_CONFIG,
      subDomain: ['sub.example.com']
    };
    const { rules } = expandRouting(testConfig, registries, {
      routing: [
        { preset: 'subscription' },
        { rule: 'DOMAIN,my-private-domain.com,DIRECT' },
        { rule: 'DOMAIN-SUFFIX,custom-proxy.com,DIRECT' },
        { preset: 'ads' },
        { preset: 'final' }
      ]
    });

    const lanIndex = rules.indexOf('RULE-SET,lan-domain,DIRECT');
    const subDomainIndex = rules.indexOf('DOMAIN,sub.example.com,DIRECT');
    const customRule1Index = rules.indexOf('DOMAIN,my-private-domain.com,DIRECT');
    const customRule2Index = rules.indexOf('DOMAIN-SUFFIX,custom-proxy.com,DIRECT');
    const adsIndex = rules.indexOf('RULE-SET,ads,广告拦截');
    const matchIndex = rules.indexOf('MATCH,漏网之鱼');

    assert.ok(lanIndex >= 0, '必须包含 LAN 规则');
    assert.ok(subDomainIndex > lanIndex, 'subDomain 应在 LAN 之后');
    assert.ok(customRule1Index > subDomainIndex, '私域规则写在 subscription 之后即排在它后面');
    assert.ok(customRule2Index > customRule1Index, '表内顺序保持');
    assert.ok(customRule2Index < adsIndex, '写在 ads 预设之前就先于广告拦截匹配');
    assert.ok(customRule2Index < matchIndex, '必须排在漏网之鱼之前');
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

  it('strategy - 开发与学术服务由路由表条目决定，可与自定义 dev 服务混排', () => {
    const { DEFAULT_ROUTING } = require('../../src/data/default-routing');

    // 1. 默认表含 dev 预设：GitHub 与 学术 同时产出
    const defaultCfg = resolveConfig({});
    const defaultRes = expandRouting(defaultCfg, defaultCfg.registries);
    assert.ok(defaultRes.rules.includes('RULE-SET,github,GitHub'));
    assert.ok(defaultRes.rules.includes('RULE-SET,scholar,学术网站'));

    // 2. 删掉 dev 预设：两条规则一起消失
    const withoutDev = DEFAULT_ROUTING.filter(entry => entry.preset !== 'dev');
    const noneCfg = resolveConfig({ routing: withoutDev });
    const noneRes = expandRouting(noneCfg, noneCfg.registries);
    assert.ok(!noneRes.rules.includes('RULE-SET,github,GitHub'));
    assert.ok(!noneRes.rules.includes('RULE-SET,scholar,学术网站'));

    // 3. 只点名 github：学术规则不再出现
    const ghOnlyCfg = resolveConfig({
      routing: [
        ...withoutDev.filter(entry => entry.preset !== 'final'),
        { service: 'github' },
        { preset: 'final' }
      ]
    });
    const ghOnlyRes = expandRouting(ghOnlyCfg, ghOnlyCfg.registries);
    assert.ok(ghOnlyRes.rules.includes('RULE-SET,github,GitHub'));
    assert.ok(!ghOnlyRes.rules.includes('RULE-SET,scholar,学术网站'));

    // 4. 自定义 dev 服务与内置服务混排（不需要任何开关）
    const customDevCfg = resolveConfig({
      routing: [
        ...withoutDev.filter(entry => entry.preset !== 'final'),
        { service: 'github' },
        { service: 'huggingface' },
        { preset: 'final' }
      ],
      customServices: {
        dev: {
          huggingface: {
            name: 'HuggingFace',
            rules: 'huggingface'
          }
        }
      }
    });
    const customRes = expandRouting(customDevCfg, customDevCfg.registries);
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

  it('rules - 声明式专项独立服务装配 (Crypto, PayPal, WebRTC, Telegram)', () => {
    const { DEFAULT_ROUTING } = require('../../src/data/default-routing');
    const routing = [
      ...DEFAULT_ROUTING.filter(entry => entry.preset !== 'final'),
      { service: 'crypto' },
      { service: 'paypal' },
      { service: 'webrtc' },
      { preset: 'final' }
    ];
    // 常量基准与专项配置元数据检验
    assert.ok(BASE_PROVIDER_ROUTES['lan-domain'], 'BASE_PROVIDER_ROUTES 应包含 lan-domain');
    assert.ok(SPECIAL_SERVICES.crypto && SPECIAL_SERVICES.telegram, 'SPECIAL_SERVICES 应包含 crypto 与 telegram');

    const { rules, providers } = expandRouting({ ...DEFAULT_CONFIG, osType: 'windows', routing });

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
    const { rules, providers } = expandRouting({
      routing: [{ preset: 'ai' }, { preset: 'final' }]
    });
    assert.ok(rules.includes('RULE-SET,openai,ChatGPT'));
    assert.ok(providers['openai']);
  });

  it('catalog - 游戏子项继承大类默认元数据并支持聚合与专项投影', () => {
    const { buildServiceCatalog, CATEGORY_DEFAULTS } = require('../../src/config/catalog');
    const catalog = buildServiceCatalog({});
    const registries = catalog.toRegistries();

    // 1. 内置游戏平台自动继承大类徽标与图标，去除重复字面量
    assert.equal(CATEGORY_DEFAULTS.game.emoji, '🎮');
    assert.equal(registries.game.steam.uiIcon, '🎮');
    assert.equal(registries.game.epic.uiIcon, '🎮');
    assert.ok(registries.game.steam.iconUrl.includes('Game.png'));
    assert.ok(registries.game.epic.iconUrl.includes('Game.png'));

    // 2. 结构化注册表挂载聚合与专项元数据投影 (无下划线第一等公民)
    assert.ok(registries.aggregates);
    assert.ok(registries.specialized);
    assert.equal(registries.aggregates['游戏服务'].fullName, '🎮 游戏服务');
    assert.equal(registries.aggregates['游戏下载'].fullName, '🎮 游戏下载');
    assert.deepStrictEqual(registries.aggregates['游戏下载'].proxies, ['DIRECT', '下载策略', '自动选择', '手动选择', '@matchedNodes']);
    assert.deepStrictEqual(registries.aggregates['游戏服务'].proxies, ['DIRECT', '@standardOptions', '@matchedNodes']);
    // 聚合组条目同样进入「可引用组目录」，且自带 match 配方（退役 @buckets.game 伪宏）；
    // 规则来源存放在聚合条目上，组目录只承载声明
    const gameService = registries.groups['game-service'];
    assert.deepStrictEqual(gameService.match, { pool: 'game' });
    assert.equal(gameService.rules, undefined, '组目录不得夹带规则字段');
    const gameServiceRules = registries.aggregates['游戏服务'].rules;
    assert.ok(gameServiceRules.includes('RULE-SET,steam,游戏服务'), '聚合组条目必须随组交付成员分流规则');
    assert.ok(gameServiceRules.includes('DOMAIN-SUFFIX,epicgames.com,游戏服务'), '成员规则的目标组名应指向聚合组');
    assert.deepStrictEqual(registries.aggregates['游戏服务'].providers, {
      steam: 'geosite/steam@cn',
      epic: 'geosite/epicgames',
      riot: 'geosite/riot',
      blizzard: 'geosite/blizzard',
      nintendo: 'geosite/nintendo',
      playstation: 'geosite/playstation',
      xbox: 'geosite/xbox',
      ubisoft: 'geosite/ubisoft',
      origin: 'geosite/origin',
      ea: 'geosite/ea'
    });
    assert.deepStrictEqual(
      registries.aggregates['游戏下载'].rules,
      ['DOMAIN-SUFFIX,steamcontent.com,游戏下载', 'RULE-SET,steam-cn,游戏下载', 'DOMAIN-SUFFIX,download.epicgames.com,游戏下载']
    );
    assert.deepStrictEqual(registries.aggregates['游戏下载'].providers, { 'steam-cn': 'geosite/steam@cn' });
    // 社交服务一服务一组：规则目标即自身组名，且每条都自带可引用配方（无合并组）
    assert.deepStrictEqual(registries.social.facebook.rules, ['RULE-SET,facebook,Facebook']);
    assert.deepStrictEqual(registries.social.facebook.provider, 'geosite/facebook');
    assert.deepStrictEqual(registries.groups['twitter'].proxies, ['@standardOptions', 'DIRECT']);
    // 广告拦截的两条规则来源：同一组名、各自独立的 Provider/Rule
    assert.deepStrictEqual(ADS_GROUPS['ad-block'].rules, ['RULE-SET,ads,广告拦截']);
    assert.deepStrictEqual(ADS_GROUPS['ad-block'].providers, { ads: 'geosite/category-ads-all' });
    assert.deepStrictEqual(ADS_GROUPS['anti-ad'].providers, { 'anti-ad': 'https://anti-ad.net/clash.yaml' });

    assert.equal(registries.specialized['crypto'].fullName, '🪙 加密货币');
    assert.equal(registries.specialized['telegram'].fullName, '✈️ Telegram');
    // 验证专项组全量属性投影 (包含 rules/providers/process)
    assert.ok(Array.isArray(registries.specialized['telegram'].rules));
    assert.ok(registries.specialized['telegram'].process.win);
    assert.ok(registries.specialized['telegram'].providers.telegram);
    assert.ok(typeof SPECIAL_SERVICES.telegram.rules !== 'function', 'telegram.rules 必须为纯声明式数组而非函数');
  });

  it('game - 游戏子规则集按需激活与防幽灵组 (Ghost Group) 路由归并', () => {
    // 1. 按需激活：只点名 steam 与 epic 时，不加载其他 8 个游戏平台的规则与提供者
    const selectiveConfig = resolveConfig({
      routing: [{ service: 'steam' }, { service: 'epic' }, { preset: 'final' }]
    });
    const { rules: selRules, providers: selProviders } = expandRouting(selectiveConfig);

    // 激活项存在
    assert.ok(selRules.includes('RULE-SET,steam,游戏服务'));
    assert.ok(selRules.includes('RULE-SET,steam-cn,游戏下载'));
    assert.ok(selRules.includes('RULE-SET,epic,游戏服务'));
    assert.ok(selProviders['steam']);
    assert.ok(selProviders['steam-cn']);
    assert.ok(selProviders['epic']);

    // 未激活项被严格剔除，消除网络拉取冗余
    assert.ok(!selRules.includes('RULE-SET,riot,游戏服务'));
    assert.ok(!selRules.includes('RULE-SET,blizzard,游戏服务'));
    assert.ok(!selRules.includes('RULE-SET,nintendo,游戏服务'));
    assert.equal(selProviders['riot'], undefined);
    assert.equal(selProviders['blizzard'], undefined);

    // 2. 自定义游戏扩展：自动并入激活列表并安全路由到游戏聚合组，绝不产生幽灵策略组
    const customGameConfig = resolveConfig({
      routing: [
        { service: 'steam' },
        { service: 'lol' },
        { service: 'genshin' },
        { service: 'apex_dl' },
        { preset: 'final' }
      ],
      customServices: {
        game: {
          lol: { name: '英雄联盟', rules: 'lol' },
          genshin: {
            name: '原神',
            rules: [{ type: 'DOMAIN-SUFFIX', value: 'yuanshen.com' }]
          },
          apex_dl: {
            name: 'Apex下载',
            rules: [{ type: 'DOMAIN-SUFFIX', value: 'apex-dl.ea.com', target: '@download' }]
          }
        }
      }
    });
    const { rules: customRules, providers: customProviders } = expandRouting(customGameConfig);

    // 自动激活且 target 默认为 '游戏服务'
    assert.ok(customRules.includes('RULE-SET,lol,游戏服务'), '字符串 rules 默认定向至游戏服务');
    assert.ok(customRules.includes('DOMAIN-SUFFIX,yuanshen.com,游戏服务'), '对象 rules 默认定向至游戏服务');
    assert.ok(customRules.includes('DOMAIN-SUFFIX,apex-dl.ea.com,游戏下载'), '语义化 @download 定向至游戏下载');
    assert.ok(customProviders['lol'], '自动生成自定义游戏规则提供者');
    // 确保绝对没有定向到不存在的幽灵组
    assert.ok(!customRules.some(r => r.endsWith(',英雄联盟')), '严禁产生以自定义游戏名命名的幽灵目标');
  });
});
