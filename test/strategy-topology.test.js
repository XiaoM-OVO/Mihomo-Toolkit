const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_CONFIG } = require('../src/config');
const { createServiceRegistries } = require('../src/strategy/registries');
const { buildProxyTopology, HIGH_MULTI_GROUP, EXPERIMENTAL_GROUP } = require('../src/strategy/topology');

test('🧩 拓扑模块单元测试 - 基础策略组装配与地区归纳', () => {
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

test('🧩 拓扑模块单元测试 - 独立看板策略组 (enableDashboard)', () => {
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

test('🧩 拓扑模块单元测试 - 高倍率与实验节点隔离', () => {
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

test('🧩 拓扑模块单元测试 - 自定义节点分组注入 (customNodeGroups)', () => {
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
