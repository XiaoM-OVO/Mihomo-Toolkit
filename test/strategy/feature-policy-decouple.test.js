const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { runStrategyPipeline } = require('../../src/pipeline/strategy');
const { runNodesPipeline } = require('../../src/pipeline/nodes');

describe('【Strategy】多维特征事实与策略分流解耦 (feature-policy-decouple)', () => {
  it('复合多维特征节点：家宽 + 流媒体 + 高倍率同时并存并多路收纳', () => {
    // 构造一个同时具备：台湾地区、家宽 (residential)、Netflix/流媒体 (streaming)、高倍率 x3.0 的复合节点
    const skeleton = {
      proxies: [
        {
          name: '🇹🇼 台湾 01 [家宽] [Netflix] 🚀 x3.0',
          type: 'ss',
          server: 'tw.node.com',
          port: 8388,
          cipher: 'aes-128-gcm',
          password: 'pass'
        }
      ]
    };

    const userConfig = {
      enableIsolation: true,
      highMultiThreshold: 2.5,
      enableNodeRename: false
    };

    const result = runStrategyPipeline(skeleton, userConfig);
    const groups = result['proxy-groups'];

    const resiGroup = groups.find(g => g.name.includes('家宽'));
    const netflixGroup = groups.find(g => g.name.includes('Netflix'));
    const highMultiGroup = groups.find(g => g.name.includes('高倍率'));
    const twGroup = groups.find(g => g.name.includes('台湾'));
    const autoGroup = groups.find(g => g.name.includes('自动选择'));

    // 1. 验证该节点多路进入家宽组、流媒体组、高倍率组
    assert.ok(resiGroup, '应存在家宽优选组');
    assert.ok(resiGroup.proxies.includes('🇹🇼 台湾 01 [家宽] [Netflix] 🚀 x3.0'), '家宽组应包含该节点');
    assert.equal(resiGroup.proxies.filter(p => p === '🇹🇼 台湾 01 [家宽] [Netflix] 🚀 x3.0').length, 1, '家宽组内该节点必须唯一，严禁重复入桶');

    assert.ok(netflixGroup, '应存在 Netflix 组');
    assert.ok(netflixGroup.proxies.includes('🇹🇼 台湾 01 [家宽] [Netflix] 🚀 x3.0'), 'Netflix 组应包含该节点');
    assert.equal(netflixGroup.proxies.filter(p => p === '🇹🇼 台湾 01 [家宽] [Netflix] 🚀 x3.0').length, 1, 'Netflix 组内该节点必须唯一，严禁重复入桶');

    assert.ok(highMultiGroup, '应存在高倍率组');
    assert.ok(highMultiGroup.proxies.includes('🇹🇼 台湾 01 [家宽] [Netflix] 🚀 x3.0'), '高倍率组应包含该节点');
    assert.equal(highMultiGroup.proxies.filter(p => p === '🇹🇼 台湾 01 [家宽] [Netflix] 🚀 x3.0').length, 1, '高倍率组内该节点必须唯一，严禁重复入桶');

    // 2. 验证该节点由于主力门禁（高倍率与家宽隔离），被正确从台湾大区组和自动选择主力池隔离
    if (twGroup) {
      assert.ok(!twGroup.proxies.includes('🇹🇼 台湾 01 [家宽] [Netflix] 🚀 x3.0'), '台湾大区组不应包含被隔离的节点');
    }
    if (autoGroup) {
      assert.ok(!autoGroup.proxies.includes('🇹🇼 台湾 01 [家宽] [Netflix] 🚀 x3.0'), '主力全量标准池不应包含被隔离的节点');
    }

    // 3. 验证全局 proxies 列表没有被复制，保持唯一
    assert.equal(result.proxies.length, 1, '全局 proxies 列表长度严格为 1，无重复节点记录');
  });

  it('倍率阈值严格边界：2.5 留在主力组，2.51 隔离至高倍率组', () => {
    const skeleton = {
      proxies: [
        {
          name: '🇯🇵 日本 01 🚀 x2.5',
          type: 'ss',
          server: 'jp1.node.com',
          port: 8388,
          cipher: 'aes-128-gcm',
          password: 'pass'
        },
        {
          name: '🇯🇵 日本 02 🚀 x2.51',
          type: 'ss',
          server: 'jp2.node.com',
          port: 8388,
          cipher: 'aes-128-gcm',
          password: 'pass'
        }
      ]
    };

    const userConfig = {
      enableIsolation: true,
      highMultiThreshold: 2.5,
      enableNodeRename: false,
      minorNodeThreshold: 1
    };

    const result = runStrategyPipeline(skeleton, userConfig);
    const groups = result['proxy-groups'];

    const jpGroup = groups.find(g => g.name.includes('日本'));
    const highMultiGroup = groups.find(g => g.name.includes('高倍率'));

    assert.ok(jpGroup, '应生成日本节点组');
    assert.ok(highMultiGroup, '应生成高倍率节点组');

    // 2.5 未严格大于阈值，应留在日本节点组
    assert.ok(jpGroup.proxies.includes('🇯🇵 日本 01 🚀 x2.5'), 'x2.5 应保留在日本节点组');
    assert.ok(!highMultiGroup.proxies.includes('🇯🇵 日本 01 🚀 x2.5'), 'x2.5 不应进入高倍率组');

    // 2.51 严格大于 2.5，应进入高倍率组并从日本节点组隔离
    assert.ok(highMultiGroup.proxies.includes('🇯🇵 日本 02 🚀 x2.51'), 'x2.51 应进入高倍率组');
    assert.ok(!jpGroup.proxies.includes('🇯🇵 日本 02 🚀 x2.51'), 'x2.51 不应留在日本大区组');
  });

  it('隔离开关关闭时，高倍率节点正常回归主力大区组', () => {
    const skeleton = {
      proxies: [
        {
          name: '🇭🇰 香港 01 🚀 x5.0',
          type: 'ss',
          server: 'hk1.node.com',
          port: 8388,
          cipher: 'aes-128-gcm',
          password: 'pass'
        }
      ]
    };

    const userConfig = {
      enableIsolation: false, // 关闭隔离
      highMultiThreshold: 2.5,
      enableNodeRename: false,
      minorNodeThreshold: 1
    };

    const result = runStrategyPipeline(skeleton, userConfig);
    const groups = result['proxy-groups'];

    const hkGroup = groups.find(g => g.name.includes('香港'));
    const highMultiGroup = groups.find(g => g.name.includes('高倍率'));

    assert.ok(hkGroup, '应生成香港节点组');
    assert.ok(hkGroup.proxies.includes('🇭🇰 香港 01 🚀 x5.0'), '未开启隔离时 x5.0 正常进入香港节点组');
    assert.equal(highMultiGroup, undefined, '未开启隔离时不生成高倍率节点组');
  });

  it('未知地区节点 (unknown) 保留原名进入“未知识别”组，若具业务特征依然多路入业务组', () => {
    const skeleton = {
      proxies: [
        {
          name: 'Custom Server [ChatGPT] 01', // 无国家标识，但带 ChatGPT 特征
          type: 'ss',
          server: 'custom.node.com',
          port: 8388,
          cipher: 'aes-128-gcm',
          password: 'pass'
        }
      ]
    };

    const userConfig = {
      enableNodeRename: false
    };

    const result = runStrategyPipeline(skeleton, userConfig);
    const groups = result['proxy-groups'];

    const chatGptGroup = groups.find(g => g.name.includes('ChatGPT'));
    const unknownGroup = groups.find(g => g.name.includes('未知识别'));

    assert.ok(unknownGroup, '应存在未知识别兜底组');
    assert.ok(unknownGroup.proxies.includes('Custom Server [ChatGPT] 01'), '未知地区节点进入未知识别组');

    assert.ok(chatGptGroup, '应存在 ChatGPT 策略组');
    assert.ok(chatGptGroup.proxies.includes('Custom Server [ChatGPT] 01'), '具备 ChatGPT 特征的未知地区节点应多路进入 ChatGPT 组');
  });

  it('各策略组引用的节点名称与清洗/重命名后的最终节点名称 100% 对齐，且不生成重复节点记录', async () => {
    const rawProxies = [
      {
        name: '🇭🇰 香港 01 IEPL [ChatGPT] 🚀 x1.0',
        type: 'ss',
        server: 'hk.node.com',
        port: 8388,
        cipher: 'aes-128-gcm',
        password: 'pass'
      }
    ];

    const config = {
      enablePipeline: true,
      enableNodeRename: true,
      minorNodeThreshold: 1
    };

    // 端到端执行完整 nodes pipeline，获得已打标上下文与清洗后节点
    const nodeRes = await runNodesPipeline(rawProxies, { ...config, withClassified: true });
    const finalCleanName = nodeRes.proxies[0].name;

    // 运行 strategy pipeline，传入 classifiedNodes 上下文
    const skeleton = { proxies: nodeRes.proxies };
    const result = runStrategyPipeline(skeleton, config, { classifiedNodes: nodeRes.classifiedNodes });

    // 验证策略组中引用的节点名称
    const hkGroup = result['proxy-groups'].find(g => g.name.includes('香港'));
    const chatGptGroup = result['proxy-groups'].find(g => g.name.includes('ChatGPT'));

    assert.ok(hkGroup, '应存在香港策略组');
    assert.ok(hkGroup.proxies.includes(finalCleanName), '香港节点组引用的必须是清洗重命名后的名称');

    assert.ok(chatGptGroup, '应存在 ChatGPT 策略组');
    assert.ok(chatGptGroup.proxies.includes(finalCleanName), 'ChatGPT 组引用的必须是清洗重命名后的名称');

    // 验证全局 proxies 列表保持单一条目
    assert.equal(result.proxies.length, 1, '产物 proxies 列表严格保持单一条目，绝无副本复制');
  });

  it('专用池（家宽、下载、实验）与通用特征池入桶严格唯一，策略组无重复条目', () => {
    // 构造具备家宽、低倍率下载、实验节点特征的节点
    const skeleton = {
      proxies: [
        {
          name: '🇭🇰 香港 01 [家宽] [实验] 🚀 x0.1', // 命中 residential, experimental, download
          type: 'ss',
          server: 'hk-test.node.com',
          port: 8388,
          cipher: 'aes-128-gcm',
          password: 'pass'
        }
      ]
    };

    const userConfig = {
      enableIsolation: true,
      enableNodeRename: false,
      minorNodeThreshold: 1
    };

    const result = runStrategyPipeline(skeleton, userConfig);
    const groups = result['proxy-groups'];

    const resiGroup = groups.find(g => g.name.includes('家宽'));
    const lowMultiGroup = groups.find(g => g.name === '低倍率节点');
    const downloadGroup = groups.find(g => g.name.includes('下载策略'));
    const expGroup = groups.find(g => g.name.includes('实验'));

    const nodeName = '🇭🇰 香港 01 [家宽] [实验] 🚀 x0.1';

    // 1. 家宽组唯一性
    assert.ok(resiGroup, '应存在家宽优选组');
    assert.ok(resiGroup.proxies.includes(nodeName), '家宽组应包含该节点');
    assert.equal(
      resiGroup.proxies.filter(p => p === nodeName).length,
      1,
      '家宽组内该节点数量必须为 1，严禁因 featurePools + buckets.residential 路径产生重复'
    );

    // 2. 低倍率池唯一性 + 下载策略按 @pool 声明展开低倍率成员
    assert.ok(lowMultiGroup, '应存在低倍率节点池组');
    assert.ok(lowMultiGroup.proxies.includes(nodeName), '低倍率节点组应包含该节点');
    assert.equal(
      lowMultiGroup.proxies.filter(p => p === nodeName).length,
      1,
      '低倍率组内该节点数量必须为 1，严禁因 featurePools + 低倍率桶两条路径重复入组'
    );
    assert.ok(downloadGroup, '应存在下载策略组');
    assert.ok(downloadGroup.proxies.includes('DIRECT'), '下载策略首位为 DIRECT');
    // 下载策略不再直接包含物理节点，而是引用轮询组
    const rrGroup = groups.find(g => g.name.includes('负载均衡-轮询'));
    assert.ok(rrGroup, '低倍率池非空时应存在轮询组');
    assert.ok(rrGroup.proxies.includes(nodeName), '轮询组应包含低倍率节点');

    // 3. 实验节点组唯一性
    assert.ok(expGroup, '应存在实验节点组');
    assert.ok(expGroup.proxies.includes(nodeName), '实验节点组应包含该节点');
    assert.equal(
      expGroup.proxies.filter(p => p === nodeName).length,
      1,
      '实验节点组内该节点数量必须为 1，严禁因 featurePools + buckets.experimental 路径产生重复'
    );

    // 4. 断言所有策略组内的 proxies 成员各自全局唯一
    for (const g of groups) {
      if (Array.isArray(g.proxies)) {
        const uniqueSet = new Set(g.proxies);
        assert.equal(
          g.proxies.length,
          uniqueSet.size,
          `策略组 [${g.name}] 内的 proxies 列表存在重复成员！`
        );
      }
    }
  });
});
