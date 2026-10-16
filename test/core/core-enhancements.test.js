const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { fissionNode, fissionNodes } = require('../../src/core/fission');
const { computeNodeIndices } = require('../../src/core/rename');
const { classifyNode, getFeatureRules } = require('../../src/core/cleaner');
const { resolveConfig } = require('../../src/config');
const { buildServiceCatalog } = require('../../src/config/catalog');
const { runNodesPipeline } = require('../../src/pipeline/nodes');
const { deepConvertStrings } = require('../../src/core/chinese-convert');
const { runPipelineEngine } = require('../../src/pipeline/engine');
const { markTrustedProxyMetadata } = require('../../src/core/node-trust');

describe('【Core】核心能力与健壮性增强 (enhancements)', () => {
  it('fission - 纯函数裂变算法 (零副作用)', () => {
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
    assert.equal(expanded[1].name, '🇭🇰 香港 01 #2');
    assert.equal(expanded[2].server, '[2606:4700:4700::1111]');

    // 验证批量纯函数 fissionNodes
    const domainMap = new Map();
    domainMap.set('hk.example.com', dummyIps);

    const batchExpanded = fissionNodes([dummyProxy], domainMap, { fissionMaxNodes: 3 });
    assert.equal(batchExpanded.length, 3);
  });

  it('rename - computeNodeIndices 动态补零与多前缀对齐', () => {
    const items = [
      { regionInfo: { id: 'hk', name: '香港' }, indexPrefix: 'L', proxy: {}, airportTag: 'LX' },
      { regionInfo: { id: 'hk', name: '香港' }, indexPrefix: 'L', proxy: {}, airportTag: 'LX' },
      { regionInfo: { id: 'hk', name: '香港' }, indexPrefix: 'I', proxy: {}, airportTag: 'IK' },
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

  it('cleaner - 识别矩阵 (AI / 流媒体 / IPv6 / 双栈 / 家宽)', () => {
    const userConfig = resolveConfig({
      enableAI: true,
      enableStreaming: true,
      showFeatureIcon: true
    });

    const testNodes = [
      {
        proxy: { name: '🇭🇰 香港 01 ChatGPT 家宽 双栈', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'u1' },
        expectedTags: ['chatgpt', 'residential', 'dualstack']
      },
      {
        proxy: { name: '🇯🇵 日本 01 Netflix 4K IPv6', server: '2.3.4.5', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' },
        expectedTags: ['nf', 'ipv6']
      },
      {
        proxy: { name: '🇺🇸 美国 01 YouTube 蜂窝 WAP', server: '3.4.5.6', port: 443, type: 'trojan', password: 'p' },
        expectedTags: ['yt', 'cellular', 'wap']
      },
      {
        proxy: { name: '🇸🇬 新加坡 01 纯物理V6', server: '2001:db8::1', port: 443, type: 'vless', uuid: 'u2' },
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

  it('cleaner - getFeatureRules 显式依赖注入与缺失防御', () => {
    // 1. 缺少 catalog 且尝试启用 AI 时抛出明确 TypeError
    assert.throws(
      () => getFeatureRules({ enableAI: true }),
      /userConfig\.catalog.*is required/
    );

    // 2. 缺少 catalog 且尝试启用 Streaming 时抛出明确 TypeError
    assert.throws(
      () => getFeatureRules({ enableStreaming: true }),
      /userConfig\.catalog.*is required/
    );

    // 3. 显式关闭全部动态服务时，零依赖返回纯净静态特征基线
    const staticOnly = getFeatureRules({ enableAI: false, enableStreaming: false });
    assert.ok(Array.isArray(staticOnly));
    assert.ok(staticOnly.length > 0);
    // 不包含动态 AI 服务的 tag（如 chatgpt）
    assert.ok(!staticOnly.some(r => r.tag === 'chatgpt'));

    // 4. 正确注入 catalog 时，动态 AI 与流媒体规则成功注入
    const catalog = buildServiceCatalog();
    const dynamicRules = getFeatureRules({ catalog, enableAI: true, enableStreaming: true });
    assert.ok(dynamicRules.some(r => r.tag === 'chatgpt'));
    assert.ok(dynamicRules.some(r => r.tag === 'netflix' || r.tag === 'nf'));

    // 5. classifyNode 独立调用时，若显式开启 AI 但缺少 catalog 应抛出明确 TypeError
    assert.throws(
      () => classifyNode({ name: '香港节点', server: '1.2.3.4', port: 443 }, { enableAI: true }),
      /userConfig\.catalog.*is required/
    );

    // 6. classifyNode 注入 options.featureRules 时直接生效
    const customRules = [{ reg: /SpecialNode/i, tag: 'my-special-tag' }];
    const res = classifyNode(
      { name: 'SpecialNode 01', server: '1.2.3.4', port: 443 },
      {},
      { featureRules: customRules }
    );
    assert.ok(res.tags.includes('my-special-tag'));
  });

  it('pipeline - nodes 模板渲染注入 ({index}、{features} 与 {ip_stack})', async () => {
    const proxies = [
      { name: '🇭🇰 香港 ChatGPT 家宽 双栈', server: '210.1.1.1', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' },
      { name: '🇭🇰 香港 Claude 专线', server: '210.1.1.2', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' }
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

  it('logger - runNodesPipeline 携带 logger 输出诊断且平稳运行', async () => {
    const proxies = [
      { name: '🇭🇰 香港 01 Netflix 4K 家宽', server: '210.1.1.1', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' }
    ];
    const logs = [];
    const logger = {
      debug: msg => logs.push(msg)
    };
    const result = await runNodesPipeline(proxies, {
      logger,
      enableStreaming: true,
      enableResidential: true
    });
    assert.equal(result.length, 1);
    assert.ok(logs.length > 0);
    assert.ok(logs.some(l => l.includes('业务:') && (l.includes('Netflix') || l.includes('流媒体'))));
  });

  it('rename - 碰撞安全：无序号或重名模板时自动追加序号防重', async () => {
    const proxies = [
      { name: '🇭🇰 香港 A', server: '1.2.3.4', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' },
      { name: '🇭🇰 香港 B', server: '1.2.3.5', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' }
    ];
    // 模板故意不写 {index}，会导致两节点计算出相同名称
    const result = await runNodesPipeline(proxies, {
      renameTemplate: '{icon} {region}'
    });
    assert.equal(result.length, 2);
    assert.equal(result[0].name, '🇭🇰 香港');
    assert.equal(result[1].name, '🇭🇰 香港 #2');
  });

  it('rename - 机场标签从来源传递至统一重命名计划', async () => {
    const rawP = markTrustedProxyMetadata({ name: '🇭🇰 香港 01', server: '1.2.3.4', port: 443 }, { subTag: 'A', indexPrefix: 'X' });
    const classified = classifyNode(rawP);
    assert.equal(classified.airportTag, 'A');
    const fallback = classifyNode({ name: '🇭🇰 香港 02', server: '1.2.3.5', port: 443 }, { airportTag: 'Global' });
    assert.equal(fallback.airportTag, 'Global');

    const config = {
      airportTag: 'Global',
      indexPrefixMap: { A: 'A' },
      renameTemplate: '[{airport}] {icon} {region} {index}'
    };
    const nodeOutput = await runNodesPipeline([
      markTrustedProxyMetadata({ name: '🇭🇰 香港 01', server: '1.2.3.4', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' }, { subTag: 'A' }),
      markTrustedProxyMetadata({ name: '🇭🇰 香港 02', server: '1.2.3.5', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' }, { subTag: 'A' })
    ], config);
    assert.ok(nodeOutput[0].name.startsWith('[A]'));
    assert.ok(nodeOutput[0].name.includes('A01'));
    assert.ok(nodeOutput[1].name.includes('A02'));

    const { buildProfile } = require('../../src/pipeline/engine');
    const profile = await buildProfile({
      renameTemplate: '[{airport}] {icon} {region} {index}',
      minorNodeThreshold: 1,
      subscriptions: [{
        tag: 'Air-A',
        uri: 'vless://11111111-2222-3333-4444-555555555555@example.com:443?security=tls#🇭🇰 香港 03'
      }]
    }, { mode: 'config', noCache: true });
    assert.ok(profile.outputData.proxies[0].name.startsWith('[Air-A]'));

    const strategyProxies = [
      markTrustedProxyMetadata({ name: '🇭🇰 香港 01', server: '1.2.3.4', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' }, { subTag: 'A' }),
      markTrustedProxyMetadata({ name: '🇭🇰 香港 02', server: '1.2.3.5', port: 443, type: 'ss', cipher: 'aes-128-gcm', password: 'p' }, { subTag: 'A' })
    ];
    const strategyConfig = { proxies: strategyProxies };
    const strategyOutput = require('../../src/pipeline/strategy').runStrategyPipeline(strategyConfig, config);
    assert.ok(strategyOutput.proxies[0].name.startsWith('[A]'));
    assert.ok(strategyOutput.proxies[1].name.includes('A02'));
  });

  it('engine - options.mode 与 config.outputMode 命中同一份构建缓存', async () => {
    const dummySub = [{
      uri: 'vless://11111111-2222-3333-4444-555555555555@example.com:443?security=tls#🇭🇰 香港 01'
    }];

    const resByMode = await runPipelineEngine(
      { subscriptions: dummySub, enableCache: true },
      { mode: 'nodes' }
    );

    const resByOutputMode = await runPipelineEngine(
      { subscriptions: dummySub, outputMode: 'nodes', enableCache: true },
      {}
    );

    assert.deepEqual(resByMode, resByOutputMode);
  });

  it('chinese-convert - deepConvertStrings 键名碰撞安全合并', () => {
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

  it('fission - 禁用重命名时为裂变节点赋予独立后缀防同名冲突', () => {
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

  it('chinese-sync - 规则组名精准按逗号分词替换，不误伤规则类型与域名', () => {
    const { syncChineseConvert } = require('../../src/core/chinese-sync');
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

  it('strategy - runStrategyPipeline 安全接收非对象参数', () => {
    const { runStrategyPipeline } = require('../../src/pipeline/strategy');
    const config = {
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' }
      ]
    };
    // 模拟客户端传入的字符串配置名
    const result = runStrategyPipeline(config, 'MyDefaultProfile');
    assert.ok(result['proxy-groups']);
    assert.ok(result['proxy-groups'].length > 0);
    // 确保没有展开为数字键
    assert.equal(result[0], undefined);
    assert.equal(result[1], undefined);
  });
});
