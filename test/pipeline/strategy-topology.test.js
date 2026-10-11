const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_CONFIG } = require('../../src/config');
const { createServiceRegistries } = require('../../src/strategy/registries');
const { buildProxyTopology, HIGH_MULTI_GROUP, EXPERIMENTAL_GROUP } = require('../../src/strategy/topology');

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

  it('buildProxyTopology - 自定义节点分组注入 (customNodeGroups)', () => {
    const registries = createServiceRegistries(DEFAULT_CONFIG);
    const classifiedNodes = [
      {
        proxy: { name: '我的自建香港专线' },
        rawName: '我的自建香港专线',
        isSpecial: true,
        groupKey: 'special',
        tags: []
      }
    ];

    const { proxyGroups } = buildProxyTopology({
      classifiedNodes,
      userConfig: {
        ...DEFAULT_CONFIG,
        customNodeGroups: {
          '自建香港': ['🤖 ChatGPT', '🐱 GitHub']
        }
      },
      registries
    });

    const gptGroup = proxyGroups.find(g => g.name === 'ChatGPT');
    assert.ok(gptGroup);
    assert.ok(gptGroup.proxies.includes('我的自建香港专线'));
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

    const hkHashGroup = proxyGroups.find(g => g.name === '⚖️ 负载均衡-哈希 (香港)');
    assert.ok(hkHashGroup, '应生成香港哈希负载均衡组');
    assert.equal(hkHashGroup.type, 'load-balance');
    assert.equal(hkHashGroup.strategy, 'consistent-hashing');
    assert.equal(hkHashGroup.hidden, true);
    assert.deepEqual(hkHashGroup.proxies, ['🇭🇰 香港 01', '🇭🇰 香港 02']);

    const hkGroup = proxyGroups.find(g => g.name === '香港节点');
    assert.ok(hkGroup, '应包含香港地区组');
    assert.equal(hkGroup.proxies[0], '⚖️ 负载均衡-哈希 (香港)');
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
});
