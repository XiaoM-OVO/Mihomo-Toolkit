const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { resolveConfig } = require('../../src/config');
const { buildServiceCatalog, compileRegex } = require('../../src/config/catalog');
const { runNodesPipeline } = require('../../src/pipeline/nodes');
const { runStrategyPipeline } = require('../../src/pipeline/strategy');

describe('【Pipeline】服务编目引擎与特征装配 (catalog-services)', () => {
  it('compileRegex - 正则安全编译器', () => {
    const native = /\bOpenAI\b/i;
    assert.equal(compileRegex(native), native);

    const fromSlash = compileRegex('/\\b(DeepSeek|DS)\\b/i');
    assert.ok(fromSlash instanceof RegExp);
    assert.equal(fromSlash.test('This is DeepSeek node'), true);
    assert.equal(fromSlash.test('Other'), false);

    const fromPlain = compileRegex('Claude|Anthropic');
    assert.ok(fromPlain instanceof RegExp);
    assert.equal(fromPlain.test('My Claude node'), true);

    assert.equal(compileRegex(''), null);
    assert.equal(compileRegex(null), null);
  });

  it('buildServiceCatalog - 增量深度合并与继承 (Delta Merge)', () => {
    const userConfig = {
      customServices: {
        ai: {
          chatgpt: {
            name: '专属ChatGPT',
            emoji: '🧠'
          },
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

    assert.equal(chatgpt.name, '专属ChatGPT');
    assert.equal(chatgpt.emoji, '🧠');
    assert.ok(chatgpt.reg instanceof RegExp);
    assert.ok(chatgpt.reg.test('OpenAI'));
    assert.equal(chatgpt.icon.file, 'OpenAI.png');

    assert.ok(deepseek);
    assert.equal(deepseek.name, 'DeepSeek');
    assert.ok(deepseek.reg instanceof RegExp);
    assert.equal(deepseek.reg.test('DeepSeek 专线'), true);
  });

  it('getFeatureMaps - 导出服务级特征图标与文本映射字典 (DRY SSOT)', () => {
    const catalog = buildServiceCatalog({
      customServices: {
        ai: {
          deepseek: {
            name: 'DeepSeek',
            emoji: '🐋'
          }
        }
      }
    });

    const { icons, texts } = catalog.getFeatureMaps();
    // 缓存幂等性
    assert.equal(catalog.getFeatureMaps(), catalog.getFeatureMaps());

    // 内置 AI 与流媒体
    assert.equal(icons['chatgpt'], '🤖');
    assert.equal(texts['chatgpt'], 'ChatGPT');
    assert.equal(icons['yt'], '▶️');
    assert.equal(icons['youtube'], '▶️');
    assert.equal(texts['yt'], 'YouTube');
    assert.equal(texts['youtube'], 'YouTube');
    assert.equal(icons['nf'], '🎬');
    assert.equal(texts['nf'], 'Netflix');
    assert.equal(icons['d+'], '🪄');
    assert.equal(texts['d+'], 'Disney+');

    // 自定义服务
    assert.equal(icons['deepseek'], '🐋');
    assert.equal(texts['deepseek'], 'DeepSeek');
  });

  it('runNodesPipeline - 节点清洗特征打标与动态 Emoji 注入 ({features})', async () => {
    const rawProxies = [
      { name: '香港专线 [DeepSeek高速] 01', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
      { name: '日本专线 [OpenAI解锁] 01', type: 'ss', server: 'jp.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' }
    ];

    const userConfig = {
      enableNodeRename: true,
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

    const dsNode = cleaned.find(p => p.name.includes('香港'));
    assert.ok(dsNode);
    assert.ok(dsNode.name.includes('🧠'), `Expected node name "${dsNode.name}" to contain 🧠`);

    const gptNode = cleaned.find(p => p.name.includes('日本'));
    assert.ok(gptNode);
    assert.ok(gptNode.name.includes('🤖'), `Expected node name "${gptNode.name}" to contain 🤖`);
  });

  it('runStrategyPipeline - 节点入桶与拓扑策略组装配 (Buckets & Groups)', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01 [OpenAI解锁]', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
        { name: '🇯🇵 日本 01 普通', type: 'ss', server: 'jp.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' },
        { name: '🇺🇸 美国 01 [DeepSeek专用]', type: 'ss', server: 'us.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p3' }
      ]
    };

    const userConfig = {
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

    const chatgptGroup = groups.find(g => g.name.includes('ChatGPT'));
    assert.ok(chatgptGroup);
    assert.ok(
      chatgptGroup.proxies.some(p => p.includes('香港')),
      'ChatGPT group should contain the matched Hong Kong node'
    );

    const deepseekGroup = groups.find(g => g.name.includes('DeepSeek'));
    assert.ok(deepseekGroup, 'Should generate 🧠 DeepSeek proxy group');
    assert.ok(
      deepseekGroup.proxies.some(p => p.includes('美国')),
      'DeepSeek group should contain the matched US node'
    );
  });

  it('servicesConfigFile - 外部服务配置文件动态加载', () => {
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
});
