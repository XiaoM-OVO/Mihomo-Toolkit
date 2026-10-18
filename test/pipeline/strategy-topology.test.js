const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_CONFIG } = require('../../src/config');
const { createServiceRegistries } = require('../../src/strategy/registries');
const { buildProxyTopology, buildBuiltinAppRecipes, HIGH_MULTI_GROUP, EXPERIMENTAL_GROUP } = require('../../src/strategy/topology');

describe('【Pipeline】策略组拓扑装配与分流桶 (strategy-topology)', () => {
  it('buildProxyTopology - 基础策略组装配与地区归纳', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const classifiedNodes = [
      {
        proxy: { name: '🇭🇰 香港 01' },
        rawName: '🇭🇰 香港 01',
        regionInfo: { id: 'hk', name: '香港', icon: '🇭🇰' },
        tags: ['streaming'],
        groupKey: 'hk'
      },
      {
        proxy: { name: '🇺🇸 美国 01' },
        rawName: '🇺🇸 美国 01',
        regionInfo: { id: 'us', name: '美国', icon: '🇺🇸' },
        tags: [],
        groupKey: 'us'
      }
    ];

    const { proxyGroups, buckets } = buildProxyTopology({
      classifiedNodes,
      userConfig: DEFAULT_CONFIG,
      registries
    });

    const names = proxyGroups.map(g => g.name);
    assert.ok(names.includes('自动选择'));
    assert.ok(names.includes('手动选择'));
    assert.ok(names.includes('漏网之鱼'));
    assert.ok(names.includes('香港节点'));
    assert.ok(names.includes('美国节点'));

    assert.equal(buckets.hk.length, 1);
    assert.equal(buckets.us.length, 1);
  });

  it('buildProxyTopology - 独立看板策略组 (enableDashboard)', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const classifiedNodes = [
      {
        proxy: { name: '剩余流量：100G' },
        rawName: '剩余流量：100G',
        isInfo: true,
        groupKey: 'info'
      }
    ];

    const { proxyGroups } = buildProxyTopology({
      classifiedNodes,
      userConfig: { ...DEFAULT_CONFIG, enableDashboard: true },
      registries
    });

    const names = proxyGroups.map(g => g.name);
    assert.ok(names.includes('订阅与状态看板'));
    const dashboard = proxyGroups.find(g => g.name === '订阅与状态看板');
    assert.ok(dashboard.proxies.includes('剩余流量：100G'));
  });

  it('buildProxyTopology - 高倍率与实验节点隔离', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const classifiedNodes = [
      {
        proxy: { name: '🇯🇵 日本 01 高倍' },
        rawName: '🇯🇵 日本 01 高倍',
        attrs: { multiNum: 3.0 },
        tags: [],
        regionInfo: { id: 'jp', name: '日本' },
        groupKey: 'jp'
      },
      {
        proxy: { name: '🇭🇰 香港 01 测速' },
        rawName: '🇭🇰 香港 01 测速',
        tags: ['experimental'],
        regionInfo: { id: 'hk', name: '香港' },
        groupKey: 'hk'
      }
    ];

    const { proxyGroups } = buildProxyTopology({
      classifiedNodes,
      userConfig: {
        ...DEFAULT_CONFIG,
        isolateHighMulti: true,
        highMultiThreshold: 2.0,
        isolateExperimental: true
      },
      registries
    });

    const names = proxyGroups.map(g => g.name);
    assert.ok(names.includes(HIGH_MULTI_GROUP));
    assert.ok(names.includes(EXPERIMENTAL_GROUP));
  });

  it('buildProxyTopology - 地区哈希负载均衡 (enableRegionHashLB)', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const classifiedNodes = [
      {
        proxy: { name: '🇭🇰 香港 01' },
        rawName: '🇭🇰 香港 01',
        regionInfo: { id: 'hk', name: '香港' },
        tags: [],
        groupKey: 'hk'
      },
      {
        proxy: { name: '🇭🇰 香港 02' },
        rawName: '🇭🇰 香港 02',
        regionInfo: { id: 'hk', name: '香港' },
        tags: [],
        groupKey: 'hk'
      },
      {
        proxy: { name: '🇺🇸 美国 01' },
        rawName: '🇺🇸 美国 01',
        regionInfo: { id: 'us', name: '美国' },
        tags: [],
        groupKey: 'us'
      }
    ];

    const { proxyGroups, buckets } = buildProxyTopology({
      classifiedNodes,
      userConfig: {
        ...DEFAULT_CONFIG,
        enableRegionHashLB: true
      },
      registries
    });

    const hkHashGroup = proxyGroups.find(g => g.name === '负载均衡-哈希 (香港)');
    assert.ok(hkHashGroup, '应生成香港哈希负载均衡组');
    assert.equal(hkHashGroup.type, 'load-balance');
    assert.equal(hkHashGroup.strategy, 'consistent-hashing');
    assert.equal(hkHashGroup.hidden, true);
    assert.deepEqual(hkHashGroup.proxies, ['🇭🇰 香港 01', '🇭🇰 香港 02']);

    const hkGroup = proxyGroups.find(g => g.name === '香港节点');
    assert.ok(hkGroup, '应包含香港地区组');
    assert.equal(hkGroup.proxies[0], '负载均衡-哈希 (香港)');
    assert.ok(hkGroup.proxies.includes('🇭🇰 香港 01'));
    assert.ok(hkGroup.proxies.includes('🇭🇰 香港 02'));

    const usHashGroup = proxyGroups.find(g => g.name.includes('哈希 (美国)'));
    assert.equal(usHashGroup, undefined, '单节点地区不应生成哈希负载组');

    assert.deepEqual(buckets.hk, ['🇭🇰 香港 01', '🇭🇰 香港 02']);
  });

  it('buildProxyTopology - 节点专属策略组注入 (customGroups)', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const classifiedNodes = [
      {
        proxy: { name: '🇺🇸 专线·我的自建节点' },
        rawName: '🇺🇸 专线·我的自建节点',
        regionInfo: { id: 'us', name: '美国' },
        groupKey: 'us',
        keepName: true,
        customGroups: ['🤖 ChatGPT', '我的独享专线'],
        tags: []
      },
      {
        proxy: { name: '🇭🇰 香港 01' },
        rawName: '🇭🇰 香港 01',
        regionInfo: { id: 'hk', name: '香港' },
        groupKey: 'hk',
        tags: []
      }
    ];

    const { proxyGroups, buckets } = buildProxyTopology({
      classifiedNodes,
      userConfig: {
        ...DEFAULT_CONFIG,
        minorNodeThreshold: 1
      },
      registries
    });

    const gptGroup = proxyGroups.find(g => g.name === 'ChatGPT');
    assert.ok(gptGroup, '应存在 ChatGPT 组');
    assert.ok(gptGroup.proxies.includes('🇺🇸 专线·我的自建节点'), 'ChatGPT 组应包含专线节点');

    const customGroup = proxyGroups.find(g => g.name === '我的独享专线');
    assert.ok(customGroup, '应动态自动创建新组');
    assert.ok(customGroup.proxies.includes('🇺🇸 专线·我的自建节点'));

    assert.ok(!buckets.us.includes('🇺🇸 专线·我的自建节点'), '专属节点不应随大流进入常规地区桶');
    assert.ok(buckets.hk.includes('🇭🇰 香港 01'), '普通节点正常入桶');
  });

  it('buildProxyTopology - customGroups 精确匹配：短目标名不再子串误注入', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const classifiedNodes = [
      {
        proxy: { name: '🇺🇸 美国 01' },
        rawName: '🇺🇸 美国 01',
        regionInfo: { id: 'us', name: '美国' },
        groupKey: 'us',
        tags: []
      },
      {
        proxy: { name: '🇺🇸 专线·自建节点' },
        rawName: '🇺🇸 专线·自建节点',
        regionInfo: { id: 'us', name: '美国' },
        groupKey: 'us',
        customGroups: ['节点'],
        tags: []
      },
      {
        proxy: { name: '🇺🇸 专线·AI节点' },
        rawName: '🇺🇸 专线·AI节点',
        regionInfo: { id: 'us', name: '美国' },
        groupKey: 'us',
        customGroups: ['🤖 ChatGPT'],
        tags: []
      }
    ];

    const { proxyGroups } = buildProxyTopology({
      classifiedNodes,
      userConfig: { ...DEFAULT_CONFIG, minorNodeThreshold: 1 },
      registries
    });

    const usGroup = proxyGroups.find(g => g.name === '美国节点');
    assert.ok(usGroup, '应存在美国节点组');
    assert.ok(
      !usGroup.proxies.includes('🇺🇸 专线·自建节点'),
      '目标名「节点」不应通过子串匹配误注入「美国节点」组'
    );

    const exactGroup = proxyGroups.find(g => g.name === '节点');
    assert.ok(exactGroup, '目标名精确不存在时应动态新建同名组，而非模糊注入他组');
    assert.ok(exactGroup.proxies.includes('🇺🇸 专线·自建节点'));

    const gptGroup = proxyGroups.find(g => g.name === 'ChatGPT');
    assert.ok(gptGroup, '应存在 ChatGPT 组');
    assert.ok(
      gptGroup.proxies.includes('🇺🇸 专线·AI节点'),
      '带 Emoji 前缀的目标名仍应精确命中同名组'
    );
  });

  it('buildProxyTopology - coreRegions 声明式主力免折叠大区定制', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const classifiedNodes = [
      {
        proxy: { name: '🇭🇰 香港 01' },
        rawName: '🇭🇰 香港 01',
        regionInfo: { id: 'hk', name: '香港' },
        groupKey: 'hk',
        tags: []
      },
      {
        proxy: { name: '🇩🇪 德国 01' },
        rawName: '🇩🇪 德国 01',
        regionInfo: { id: 'de', code: 'DE', name: '德国', groupName: '德国节点', foldGroup: 'eu', continent: 'europe' },
        groupKey: 'de',
        tags: []
      }
    ];

    // Case 1: 默认配置 (hk 为默认主力，de 为小众地区，minorNodeThreshold = 3)
    const resDefault = buildProxyTopology({
      classifiedNodes,
      userConfig: { ...DEFAULT_CONFIG, minorNodeThreshold: 3 },
      registries
    });
    const defaultGroupNames = resDefault.proxyGroups.map(g => g.name);
    assert.ok(defaultGroupNames.includes('香港节点'), '默认香港作为主力大区独立建组');
    assert.ok(!defaultGroupNames.includes('德国节点'), '默认德国节点不足3个应折叠');
    assert.ok(resDefault.buckets.other.includes('🇩🇪 德国 01'), '德国节点不足3个且欧洲大洲不足3个，最终折叠进 other 桶');

    // Case 2: 用户自定义 coreRegions: ['de'] (将德国设为主力，香港排除出主力)
    const resCustom = buildProxyTopology({
      classifiedNodes,
      userConfig: { ...DEFAULT_CONFIG, minorNodeThreshold: 3, coreRegions: ['de'] },
      registries
    });
    const customGroupNames = resCustom.proxyGroups.map(g => g.name);
    assert.ok(customGroupNames.includes('德国节点'), '德国作为自定义主力免折叠独立建组');
    assert.ok(!customGroupNames.includes('香港节点'), '香港被移出主力且不足3个被折叠');
    assert.ok(resCustom.buckets.other.includes('🇭🇰 香港 01'), '香港节点应折叠进 other 桶');
  });

  it('buildProxyTopology - customGroups 声明式自定义策略组装配与覆写', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const classifiedNodes = [
      {
        proxy: { name: '🇭🇰 香港 IEPL 01' },
        rawName: '🇭🇰 香港 IEPL 01',
        regionInfo: { id: 'hk', name: '香港' },
        tags: ['streaming'],
        attrs: { multiNum: 1.0 },
        groupKey: 'hk'
      },
      {
        proxy: { name: '🇯🇵 日本 普通 01' },
        rawName: '🇯🇵 日本 普通 01',
        regionInfo: { id: 'jp', name: '日本' },
        tags: ['download'],
        attrs: { multiNum: 0.5 },
        groupKey: 'jp'
      },
      {
        proxy: { name: '🇺🇸 美国 家宽 01' },
        rawName: '🇺🇸 美国 家宽 01',
        regionInfo: { id: 'us', name: '美国' },
        tags: ['residential'],
        attrs: { multiNum: 1.0 },
        groupKey: 'us'
      }
    ];

    const { proxyGroups } = buildProxyTopology({
      classifiedNodes,
      userConfig: {
        ...DEFAULT_CONFIG,
        enableResidential: true,
        customGroups: [
          {
            name: '🎬 我的专属流媒体',
            type: 'url-test',
            url: 'https://www.youtube.com/generate_204',
            interval: 180,
            tolerance: 30,
            match: {
              region: ['hk'],
              tags: ['streaming']
            },
            proxies: ['@matchedNodes', 'DIRECT']
          },
          {
            name: '自动选择',
            type: 'url-test',
            proxies: ['@residential', '🇭🇰 香港 IEPL 01']
          }
        ]
      },
      registries
    });

    // 1. 验证全新策略组注入
    const myStreaming = proxyGroups.find(g => g.name === '🎬 我的专属流媒体');
    assert.ok(myStreaming, '应该成功构建全新策略组');
    assert.equal(myStreaming.type, 'url-test');
    assert.equal(myStreaming.url, 'https://www.youtube.com/generate_204');
    assert.equal(myStreaming.interval, 180);
    assert.equal(myStreaming.tolerance, 30);
    assert.deepEqual(myStreaming.proxies, ['🇭🇰 香港 IEPL 01', 'DIRECT']);

    // 2. 验证同名骨架组覆盖
    const autoSelect = proxyGroups.find(g => g.name === '自动选择');
    assert.ok(autoSelect);
    assert.deepEqual(autoSelect.proxies, ['🇺🇸 美国 家宽 01', '🇭🇰 香港 IEPL 01']);
  });

  it('buildBuiltinAppRecipes - 声明式应用配方解析与元数据解耦', () => {
    const effectiveRegistries = {
      ai: {
        chatgpt: { name: 'ChatGPT', tag: 'ai', pool: 'ai', preferredRegions: ['us', 'jp'] }
      },
      streaming: {
        custom_stream: { name: '自定义流媒体', pool: 'custom_stream', preferredRegions: ['sg', 'tw'] },
        direct_stream: { name: '免翻流媒体', proxies: ['DIRECT', '香港节点'] }
      }
    };

    const regionNames = {
      us: '美国节点',
      jp: '日本节点',
      sg: '新加坡节点',
      tw: '台湾节点',
      hk: '香港节点'
    };

    const recipes = buildBuiltinAppRecipes({
      userConfig: {
        enableAI: true,
        enableStreaming: true,
        aiServices: ['chatgpt'],
        streamingServices: ['custom_stream', 'direct_stream']
      },
      effectiveRegistries,
      regionNames,
      activeRegionGroups: ['香港节点', '美国节点', '新加坡节点'],
      buckets: { ai: ['AI专线1'], custom_stream: ['流媒体1'] },
      proxyTarget: '自动选择'
    });

    const chatgpt = recipes.find(r => r.name === 'ChatGPT');
    assert.ok(chatgpt);
    assert.deepEqual(chatgpt.proxies, [
      '@residentialGroup',
      '美国节点',
      '日本节点',
      'AI专线1',
      '@defaultProxy',
      'DIRECT'
    ]);

    const customStream = recipes.find(r => r.name === '自定义流媒体');
    assert.ok(customStream);
    assert.deepEqual(customStream.proxies, [
      '流媒体1',
      '新加坡节点',
      '台湾节点',
      '@standardOptions',
      'DIRECT'
    ]);

    const directStream = recipes.find(r => r.name === '免翻流媒体');
    assert.ok(directStream);
    assert.deepEqual(directStream.proxies, ['DIRECT', '香港节点']);
  });
});

