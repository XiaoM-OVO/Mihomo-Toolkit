const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { resolveConfig } = require('../src/config');
const { buildServiceCatalog, compileRegex } = require('../src/config/catalog');
const { runNodesPipeline } = require('../src/pipeline/nodes');
const { runStrategyPipeline } = require('../src/pipeline/strategy');
const { buildProxyTopology } = require('../src/strategy/topology');

test('📚 Catalog 编目引擎 - 正则安全编译器 (compileRegex)', () => {
  // 原生 RegExp 保持原样
  const native = /\bOpenAI\b/i;
  assert.equal(compileRegex(native), native);

  // 字符串 /pattern/flags 解析
  const fromSlash = compileRegex('/\\b(DeepSeek|DS)\\b/i');
  assert.ok(fromSlash instanceof RegExp);
  assert.equal(fromSlash.test('This is DeepSeek node'), true);
  assert.equal(fromSlash.test('Other'), false);

  // 纯文本关键字自动包裹为 /keyword/i
  const fromPlain = compileRegex('Claude|Anthropic');
  assert.ok(fromPlain instanceof RegExp);
  assert.equal(fromPlain.test('My Claude node'), true);

  // 容错处理
  assert.equal(compileRegex(''), null);
  assert.equal(compileRegex(null), null);
});

test('📚 Catalog 编目引擎 - 增量深度合并与继承 (Delta Merge)', () => {
  const userConfig = {
    customServices: {
      ai: {
        // 案例 1: 仅覆盖官方已有服务的名字，其他正则/规则/图标自动继承
        chatgpt: {
          name: '专属ChatGPT',
          emoji: '🧠'
        },
        // 案例 2: 纯新增全新第三方服务
        deepseek: {
          name: 'DeepSeek',
          emoji: '✨',
          reg: '/\\bDeepSeek\\b/i',
          rules: 'deepseek'
        }
      }
    }
  };

  const catalog = buildServiceCatalog(userConfig);
  const chatgpt = catalog.getService('ai', 'chatgpt');
  const deepseek = catalog.getService('ai', 'deepseek');

  // chatgpt 名字被覆盖，但其正则与图标依然完整继承官方基准
  assert.equal(chatgpt.name, '专属ChatGPT');
  assert.equal(chatgpt.emoji, '🧠');
  assert.ok(chatgpt.reg instanceof RegExp);
  assert.ok(chatgpt.reg.test('OpenAI'));
  assert.equal(chatgpt.icon.file, 'OpenAI.png');

  // deepseek 全新服务成功注册
  assert.ok(deepseek);
  assert.equal(deepseek.name, 'DeepSeek');
  assert.ok(deepseek.reg instanceof RegExp);
  assert.equal(deepseek.reg.test('DeepSeek 专线'), true);
});

test('📚 Catalog 编目引擎 - 节点清洗特征打标与动态 Emoji 注入 ({features})', async () => {
  const rawProxies = [
    { name: '香港专线 [DeepSeek高速] 01', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
    { name: '日本专线 [OpenAI解锁] 01', type: 'ss', server: 'jp.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' }
  ];

  const userConfig = {
    enableNodeRename: true,
    aiServices: ['chatgpt', 'deepseek'],
    customServices: {
      ai: {
        deepseek: {
          name: 'DeepSeek',
          emoji: '🧠',
          reg: 'DeepSeek'
        }
      }
    }
  };

  const cleaned = await runNodesPipeline(rawProxies, userConfig);

  // 验证自定义服务的 Emoji (🧠) 成功注入到节点名字的 {features} 占位符中
  const dsNode = cleaned.find(p => p.name.includes('香港'));
  assert.ok(dsNode);
  assert.ok(dsNode.name.includes('🧠'), `Expected node name "${dsNode.name}" to contain 🧠`);

  // 验证内置 ChatGPT 节点的 Emoji (🤖) 正常渲染
  const gptNode = cleaned.find(p => p.name.includes('日本'));
  assert.ok(gptNode);
  assert.ok(gptNode.name.includes('🤖'), `Expected node name "${gptNode.name}" to contain 🤖`);
});

test('📚 Catalog 编目引擎 - 节点入桶与拓扑策略组装配 (Buckets & Proxy Groups)', () => {
  const rawConfig = {
    proxies: [
      { name: '🇭🇰 香港 01 [OpenAI解锁]', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
      { name: '🇯🇵 日本 01 普通', type: 'ss', server: 'jp.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' },
      { name: '🇺🇸 美国 01 [DeepSeek专用]', type: 'ss', server: 'us.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p3' }
    ]
  };

  const userConfig = {
    enableAI: true,
    aiServices: ['chatgpt', 'deepseek'],
    customServices: {
      ai: {
        deepseek: {
          name: 'DeepSeek',
          emoji: '🧠',
          reg: 'DeepSeek'
        }
      }
    },
    minorNodeThreshold: 1
  };

  const output = runStrategyPipeline(rawConfig, userConfig);
  const groups = output['proxy-groups'];

  // 验证 ChatGPT 策略组成员中包含命中了特征正则的香港节点
  const chatgptGroup = groups.find(g => g.name.includes('ChatGPT'));
  assert.ok(chatgptGroup);
  assert.ok(
    chatgptGroup.proxies.some(p => p.includes('香港')),
    'ChatGPT group should contain the matched Hong Kong node'
  );

  // 验证自定义 DeepSeek 策略组成功生成，且包含命中了特征的美国节点
  const deepseekGroup = groups.find(g => g.name.includes('DeepSeek'));
  assert.ok(deepseekGroup, 'Should generate 🧠 DeepSeek proxy group');
  assert.ok(
    deepseekGroup.proxies.some(p => p.includes('美国')),
    'DeepSeek group should contain the matched US node'
  );
});

test('📚 Catalog 编目引擎 - 外部服务配置文件加载 (servicesConfigFile)', () => {
  const tmpDir = os.tmpdir();
  const tempConfigFile = path.join(tmpDir, `custom-services-${Date.now()}.js`);

  fs.writeFileSync(tempConfigFile, `
    module.exports = {
      ai: {
        corp_ai: {
          name: '企业私有AI',
          emoji: '🏢',
          reg: /CorpAI/i
        }
      }
    };
  `, 'utf8');

  try {
    const config = resolveConfig({
      servicesConfigFile: tempConfigFile
    });

    const corpAi = config.catalog.getService('ai', 'corp_ai');
    assert.ok(corpAi);
    assert.equal(corpAi.name, '企业私有AI');
    assert.equal(corpAi.emoji, '🏢');
  } finally {
    try { fs.unlinkSync(tempConfigFile); } catch {}
  }
});
