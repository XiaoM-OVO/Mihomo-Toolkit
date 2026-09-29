const test = require('node:test');
const assert = require('node:assert/strict');

const { fissionNode, fissionNodes, looksLikeDomain } = require('../src/core/fission');
const { computeNodeIndices, renderTemplate, createSeparatorCleaners } = require('../src/core/rename');
const { classifyNode, getFeatureRules } = require('../src/core/cleaner');
const { runNodesPipeline } = require('../src/pipeline/nodes');
const { deepConvertStrings } = require('../src/core/chinese-convert');
const { runPipelineEngine } = require('../src/pipeline/engine');

test('🧬 架构纯度 - core/fission 纯函数裂变算法 (零副作用)', () => {
  const dummyProxy = {
    name: '🇭🇰 香港 01',
    type: 'trojan',
    server: 'hk.example.com',
    port: 443,
    password: 'secretpassword',
    tls: true
  };

  const dummyIps = ['1.1.1.1', '1.1.1.2', '2606:4700:4700::1111'];
  const expanded = fissionNode(dummyProxy, dummyIps, { fissionMaxNodes: 3 });

  assert.equal(expanded.length, 3);
  assert.equal(expanded[0].server, '1.1.1.1');
  assert.equal(expanded[0].servername, 'hk.example.com');
  assert.equal(expanded[1].server, '1.1.1.2');
  assert.equal(expanded[1]._isFission, true);
  assert.equal(expanded[2].server, '[2606:4700:4700::1111]');

  // 验证批量纯函数 fissionNodes
  const domainMap = new Map();
  domainMap.set('hk.example.com', dummyIps);

  const batchExpanded = fissionNodes([dummyProxy], domainMap, { fissionMaxNodes: 3 });
  assert.equal(batchExpanded.length, 3);
});

test('🏷️ 核心序号 - core/rename computeNodeIndices 动态补零与多前缀对齐', () => {
  const items = [
    { regionInfo: { id: 'hk', name: '香港' }, proxy: { _indexPrefix: 'L' }, airportTag: 'LX' },
    { regionInfo: { id: 'hk', name: '香港' }, proxy: { _indexPrefix: 'L' }, airportTag: 'LX' },
    { regionInfo: { id: 'hk', name: '香港' }, proxy: { _indexPrefix: 'I' }, airportTag: 'IK' },
    { regionInfo: { id: 'jp', name: '日本' }, proxy: {}, airportTag: 'Single' } // 单节点大区无前缀
  ];

  const indexMap = computeNodeIndices(items);

  // 香港大区有多个节点，LX 前缀得到 L01, L02；IK 前缀得到 I01
  assert.equal(indexMap.get(items[0]), 'L01');
  assert.equal(indexMap.get(items[1]), 'L02');
  assert.equal(indexMap.get(items[2]), 'I01');
  // 日本单节点无前缀，保持为空
  assert.equal(indexMap.get(items[3]), '');
});

test('🧹 特征识别 - core/cleaner 恢复 AI/流媒体/IPv6/双栈/家宽全量矩阵', () => {
  const userConfig = {
    enableAI: true,
    enableStreaming: true,
    showFeatureIcon: true
  };

  const testNodes = [
    {
      proxy: { name: '🇭🇰 香港 01 ChatGPT 家宽 双栈', server: '1.2.3.4', type: 'vless', uuid: 'u1' },
      expectedTags: ['chatgpt', 'residential', 'dualstack']
    },
    {
      proxy: { name: '🇯🇵 日本 01 Netflix 4K IPv6', server: '2.3.4.5', type: 'ss', cipher: 'aes-128-gcm', password: 'p' },
      expectedTags: ['nf', 'ipv6']
    },
    {
      proxy: { name: '🇺🇸 美国 01 YouTube 蜂窝 WAP', server: '3.4.5.6', type: 'trojan', password: 'p' },
      expectedTags: ['yt', 'cellular', 'wap']
    },
    {
      proxy: { name: '🇸🇬 新加坡 01 纯物理V6', server: '2001:db8::1', type: 'vless', uuid: 'u2' },
      expectedTags: ['ipv6']
    }
  ];

  testNodes.forEach(({ proxy, expectedTags }) => {
    const classified = classifyNode(proxy, userConfig);
    assert.equal(classified.skip, undefined);
    expectedTags.forEach(tag => {
      assert.ok(classified.tags.includes(tag), `节点「${proxy.name}」应包含标签: ${tag}, 实际: ${classified.tags.join(',')}`);
    });
  });
});

test('🚀 模板渲染 - 验证 nodes 流水线正确注入 {index}、{features} 与 {ip_stack}', async () => {
  const proxies = [
    { name: '🇭🇰 香港 ChatGPT 家宽 双栈', server: '210.1.1.1', type: 'ss', cipher: 'aes-128-gcm', password: 'p' },
    { name: '🇭🇰 香港 Claude 专线', server: '210.1.1.2', type: 'ss', cipher: 'aes-128-gcm', password: 'p' }
  ];

  const config = {
    renameTemplate: '{icon} {region} {index} {features} | {ip_stack}',
    showFeatureIcon: true,
    enableAI: true
  };

  const result = await runNodesPipeline(proxies, config);
  assert.equal(result.length, 2);

  // 验证香港地区 2 个节点自动生成了 01 与 02 序号
  assert.ok(result[0].name.includes('01'), `节点 1 应包含 01 序号: ${result[0].name}`);
  assert.ok(result[1].name.includes('02'), `节点 2 应包含 02 序号: ${result[1].name}`);

  // 验证节点 1 识别出 ChatGPT 🤖 与 家宽 🏠，以及双栈
  assert.ok(result[0].name.includes('🤖'), `节点 1 应包含 🤖: ${result[0].name}`);
  assert.ok(result[0].name.includes('🏠'), `节点 1 应包含 🏠: ${result[0].name}`);
  assert.ok(result[0].name.includes('双栈'), `节点 1 应包含 双栈: ${result[0].name}`);

  // 验证节点 2 识别出 Claude 🦀
  assert.ok(result[1].name.includes('🦀'), `节点 2 应包含 🦀: ${result[1].name}`);
});

test('⚡ 缓存归一化 - getCacheKey 对 deliveryMode 别名规范化一致', async () => {
  // pure 与 nodes 属于同一检查点形态，必须命中同一份缓存
  const dummySub = [{
    uri: 'vless://11111111-2222-3333-4444-555555555555@example.com:443?security=tls#🇭🇰 香港 01'
  }];

  const resNodes = await runPipelineEngine(
    { subscriptions: dummySub, outputMode: 'nodes', enableCache: true },
    { type: 'nodes' }
  );

  const resPure = await runPipelineEngine(
    { subscriptions: dummySub, outputMode: 'nodes', enableCache: true },
    { type: 'pure' }
  );

  assert.deepEqual(resNodes, resPure);
});

test('🔄 简繁转换 - deepConvertStrings 键名碰撞安全合并', () => {
  const mockConvert = (str) => {
    if (str === '繁體' || str === '繁体') return '繁体';
    return str;
  };

  const inputObj = {
    '繁體': ['Node A'],
    '繁体': ['Node B']
  };

  const converted = deepConvertStrings(inputObj, mockConvert);
  // 两个键名转换为同一个 '繁体' 后，数组内容应安全合并去重，而不是静默丢弃
  assert.deepEqual(converted['繁体'], ['Node A', 'Node B']);
});

test('🧬 裂变防重 - 在禁用重命名时为裂变节点赋予独立后缀，防止同名冲突', () => {
  const proxy = {
    name: '🇭🇰 香港 01',
    type: 'trojan',
    server: 'hk.example.com',
    port: 443,
    password: 'pass',
    tls: true
  };
  const ips = ['1.1.1.1', '1.1.1.2', '1.1.1.3'];
  const expanded = fissionNode(proxy, ips, { fissionMaxNodes: 3 });

  assert.equal(expanded.length, 3);
  const names = expanded.map(p => p.name);
  const uniqueNames = new Set(names);
  assert.equal(uniqueNames.size, 3, '裂变出的所有节点名称必须唯一，防止内核同名冲突');
  assert.equal(names[0], '🇭🇰 香港 01');
  assert.equal(names[1], '🇭🇰 香港 01 #2');
  assert.equal(names[2], '🇭🇰 香港 01 #3');
});

test('🔄 简繁同步 - 规则组名精准按逗号分词替换，不误伤规则类型与域名', () => {
  const { syncChineseConvert } = require('../src/core/chinese-sync');
  const mockConfig = {
    'proxy-groups': [
      { name: '🍎 苹果服务', proxies: ['DIRECT'] }
    ],
    rules: [
      'RULE-SET,apple,🍎 苹果服务',
      'DOMAIN-SUFFIX,apple.com,🍎 苹果服务',
      'MATCH,DIRECT'
    ]
  };

  const synced = syncChineseConvert(mockConfig, {
    enableChineseConvert: true,
    chineseConvertMode: 's2t'
  });

  const rules = synced.rules;
  // 规则前缀 DOMAIN-SUFFIX,apple.com 中的 apple 不会被误伤替换为其他内容，目标组名被替换为繁体
  assert.ok(rules[0].startsWith('RULE-SET,apple,'));
  assert.ok(rules[1].startsWith('DOMAIN-SUFFIX,apple.com,'));
  assert.ok(rules[0].includes('🍎 蘋果服務'));
  assert.ok(rules[1].includes('🍎 蘋果服務'));
});

test('🔌 Verge 适配 - main(config, profileName) 安全接收字符串参数', () => {
  const { main: vergeMain } = require('../src/targets/verge');
  const config = {
    proxies: [
      { name: '🇭🇰 香港 01', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' }
    ]
  };
  // 模拟 Clash Verge 传入的字符串配置名
  const result = vergeMain(config, 'MyDefaultProfile');
  assert.ok(result['proxy-groups']);
  assert.ok(result['proxy-groups'].length > 0);
  // 确保没有展开为数字键
  assert.equal(result[0], undefined);
  assert.equal(result[1], undefined);
});
