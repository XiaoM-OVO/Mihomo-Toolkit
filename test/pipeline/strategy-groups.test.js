const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { runStrategyPipeline: strategyMain } = require('../../src/pipeline/strategy.js');
const { markTrustedSynthetic } = require('../../src/core/node-trust');

describe('【Pipeline】策略组与分流拓扑构建 (strategy-groups)', () => {
  test('strategyMain - AI / 流媒体 / 社交策略组生成与节点注入测试', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword1' },
        { name: '🇯🇵 日本 01', type: 'ss', server: 'jp.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword2' },
        { name: '🇺🇸 美国 01', type: 'ss', server: 'us.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword3' },
        { name: '🇸🇬 新加坡 01', type: 'ss', server: 'sg.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword4' }
      ]
    };

    const userConfig = {
      enableAI: true,
      enableStreaming: true,
      enableSocial: true,
      minorNodeThreshold: 1
    };

    const result = strategyMain(rawConfig, userConfig);
    const groups = result['proxy-groups'];
    const groupNames = groups.map(g => g.name);

    // 1. 验证基础与应用策略组已被生成
    assert.ok(groupNames.includes('📍 手动选择'));
    assert.ok(groupNames.includes('🚀 自动选择'));
    assert.ok(groupNames.includes('🤖 ChatGPT'));
    assert.ok(groupNames.includes('▶️ YouTube'));
    assert.ok(groupNames.includes('✈️ Telegram'));

    // 2. 验证地区策略组已生成
    assert.ok(groupNames.includes('🇭🇰 香港节点'));
    assert.ok(groupNames.includes('🇯🇵 日本节点'));
    assert.ok(groupNames.includes('🇺🇸 美国节点'));
    assert.ok(groupNames.includes('🇸🇬 新加坡节点'));
  });

  test('strategyMain - 高倍率隔离分组逻辑 (isolateHighMulti)', () => {
    const rawConfig = {
      proxies: [
        { name: '🇯🇵 日本 01 🚀 x3.0', type: 'ss', server: 'jp1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword1' },
        { name: '🇯🇵 日本 02 [0.5x]', type: 'ss', server: 'jp2.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword2' }
      ]
    };

    const userConfig = {
      isolateHighMulti: true,
      highMultiThreshold: 1.5,
      minorNodeThreshold: 1
    };

    const result = strategyMain(rawConfig, userConfig);
    const groups = result['proxy-groups'];
    const highMultiGroup = groups.find(g => g.name.includes('高倍'));

    // 验证生成了高倍率独立组，且节点被归入该组
    assert.ok(highMultiGroup !== undefined, '应生成高倍率独立策略组');
    assert.ok(highMultiGroup.proxies.length > 0, '高倍率组应包含节点');
  });

  test('strategyMain - 实验节点隔离分组逻辑 (isolateExperimental)', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01 测试节点', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword1' },
        { name: '🇭🇰 香港 02 备用线路', type: 'ss', server: 'hk2.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword2' },
        { name: '🇭🇰 香港 03 正常节点', type: 'ss', server: 'hk3.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword3' }
      ]
    };

    const userConfig = { isolateExperimental: true, minorNodeThreshold: 1 };

    const result = strategyMain(rawConfig, userConfig);
    const groups = result['proxy-groups'];
    const expGroup = groups.find(g => g.name.includes('实验'));

    // 验证生成了实验节点独立组，且测试/备用节点被归入该组，正常节点留在普通池
    assert.ok(expGroup !== undefined, '应生成实验节点独立策略组');
    assert.ok(expGroup.proxies.length === 2, '实验组应包含测试与备用 2 个节点');
    const hkGroup = groups.find(g => g.name.includes('香港'));
    assert.ok(hkGroup && hkGroup.proxies.length === 1, '普通香港组应仅保留 1 个正常节点');
    assert.ok(!hkGroup.proxies.some(p => p.includes('🧪')), '普通香港组不应包含实验节点');
  });

  test('strategyMain - 家宽节点注入测试 (residentialNodeGroups)', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01 家宽', type: 'ss', server: 'hk-resi.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
        { name: '🇺🇸 美国 01 家宽', type: 'ss', server: 'us-resi.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' },
        { name: '🇯🇵 日本 01 普通', type: 'ss', server: 'jp.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p3' }
      ]
    };

    const userConfig = {
      enableResidential: true,
      enableAI: true,
      residentialNodeGroups: {
        'hk': ['🤖 ChatGPT'],
        'all': ['🐱 GitHub']
      },
      minorNodeThreshold: 1
    };

    const result = strategyMain(rawConfig, userConfig);
    const groups = result['proxy-groups'];
    const chatGpt = groups.find(g => g.name === '🤖 ChatGPT');
    const github = groups.find(g => g.name === '🐱 GitHub');

    // ChatGPT 组仅注入了香港家宽
    assert.ok(chatGpt.proxies.some(p => p.includes('香港') && p.includes('🏠')));
    assert.ok(!chatGpt.proxies.some(p => p.includes('美国')));

    // GitHub 组注入了所有家宽 (hk + us)
    assert.ok(github.proxies.some(p => p.includes('香港') && p.includes('🏠')));
    assert.ok(github.proxies.some(p => p.includes('美国') && p.includes('🏠')));
  });

  test('strategyMain - 独立订阅看板策略组与主力组隔离测试 (enableDashboard)', () => {
    const rawConfig = {
      proxies: [
        markTrustedSynthetic({ name: '🏷️ [机场A] 剩余流量：100 GB / 500 GB (20.0%)', type: 'direct', server: '1.0.0.1', port: 80, isSyntheticInfo: true }),
        markTrustedSynthetic({ name: '📅 [机场A] 套餐到期：2026-12-31 (余 120 天)', type: 'direct', server: '1.0.0.1', port: 80, isSyntheticInfo: true }),
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' }
      ]
    };

    // 1. 默认 enableDashboard: true ➔ 独立看板策略组存在，手动选择组无假节点
    const resultEnabled = strategyMain(rawConfig, { minorNodeThreshold: 1 });
    const groupsEnabled = resultEnabled['proxy-groups'];
    const dashboardGroup = groupsEnabled.find(g => g.name === '📊 订阅与状态看板');
    const manualGroup = groupsEnabled.find(g => g.name === '📍 手动选择');

    assert.ok(dashboardGroup !== undefined, '应生成「📊 订阅与状态看板」策略组');
    assert.ok(dashboardGroup.proxies.length >= 2, '看板组应包含合成信息节点');
    assert.ok(!manualGroup.proxies.some(p => p.includes('剩余流量')), '手动选择组不应包含流量假节点');
    assert.ok(!manualGroup.proxies.some(p => p.includes('套餐到期')), '手动选择组不应包含到期假节点');

    // 2. enableDashboard: false ➔ 不生成看板策略组，且假节点被丢弃
    const resultDisabled = strategyMain(rawConfig, { enableDashboard: false, minorNodeThreshold: 1 });
    const groupsDisabled = resultDisabled['proxy-groups'];
    assert.ok(!groupsDisabled.some(g => g.name.includes('看板')), '关闭看板时不得生成看板策略组');
  });

  test('strategyMain - 策略组图标模式 (groupIconMode: both / icon)', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
        { name: '🇹🇼 台湾 01', type: 'ss', server: 'tw.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' },
        { name: '🇯🇵 日本 01', type: 'ss', server: 'jp.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p3' },
        { name: '🇨🇳 中国 01', type: 'ss', server: 'cn.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p4' }
      ]
    };

    // 1. both 模式：保留 Emoji，且追加在线 icon（包含地区组与大陆节点国旗）
    const resBoth = strategyMain(rawConfig, {
      groupIconMode: 'both',
      iconRepoOrz: 'https://test-icon.com/',
      minorNodeThreshold: 1,
      enableDomesticGroup: true
    });
    const autoBoth = resBoth['proxy-groups'].find(g => g.name.includes('自动选择'));
    assert.ok(autoBoth && autoBoth.icon && autoBoth.icon.includes('test-icon.com'), 'both 模式应注入在线 icon 链接');
    const hkBoth = resBoth['proxy-groups'].find(g => g.name === '🇭🇰 香港节点');
    assert.ok(hkBoth && hkBoth.icon && hkBoth.icon.includes('HK.png'), 'both 模式地区组应正确挂载国旗在线图标');
    const cnBoth = resBoth['proxy-groups'].find(g => g.name === '🇨🇳 大陆节点');
    assert.ok(cnBoth && cnBoth.icon && cnBoth.icon.includes('CN.png'), 'both 模式大陆节点应正确挂载国旗与在线图标');

    // 2. icon 模式：剔除 Emoji，重命名为纯文本，并确保全量 rules 目标 100% 存在
    const resIcon = strategyMain(rawConfig, {
      groupIconMode: 'icon',
      minorNodeThreshold: 1,
      enableAI: true,
      enableStreaming: true,
      enableSocial: true,
      enableGame: true,
      enableTelegram: true,
      enableGitHub: true,
      enableScholar: true,
      enableCrypto: true,
      enablePayPal: true,
      enableWebRTC: true,
      streamingServices: ['bahamut', 'bilibili', 'tiktok']
    });

    const autoIcon = resIcon['proxy-groups'].find(g => g.name === '自动选择');
    assert.ok(autoIcon !== undefined, 'icon 模式应将「🚀 自动选择」重命名为「自动选择」');
    const hkIcon = resIcon['proxy-groups'].find(g => g.name === '香港节点');
    assert.ok(hkIcon && hkIcon.icon && hkIcon.icon.includes('HK.png'), 'icon 模式下地区组应挂载在线图标');

    // 断言规则引用完整性：杜绝任何规则指向带残留 Emoji 的不存在策略组
    const groupNameSet = new Set(resIcon['proxy-groups'].map(g => g.name));
    const brokenRules = resIcon.rules.filter(r => {
      const parts = r.split(',');
      const target = parts[parts.length - 1] === 'no-resolve' ? parts[parts.length - 2] : parts[parts.length - 1];
      return target && !['DIRECT', 'REJECT', 'REJECT-DROP', 'COMPATIBLE', 'PASS'].includes(target) && !groupNameSet.has(target);
    });
    assert.equal(brokenRules.length, 0, `icon 模式下不得存在断裂规则，发现: ${JSON.stringify(brokenRules)}`);

    // 断言流媒体拓扑与 DAG 剪枝后候选组保留完整性
    const bahamut = resIcon['proxy-groups'].find(g => g.name === 'Bahamut');
    assert.ok(bahamut, '应存在 Bahamut 策略组');
    assert.ok(bahamut.proxies.includes('台湾节点') && bahamut.proxies.includes('香港节点'), 'Bahamut 应保留台湾和香港地区组引用');

    const bilibili = resIcon['proxy-groups'].find(g => g.name === 'BiliBili');
    assert.ok(bilibili, '应存在 BiliBili 策略组');
    assert.ok(bilibili.proxies.includes('台湾节点') && bilibili.proxies.includes('香港节点'), 'Bilibili 应保留台湾和香港地区组引用');

    const tiktok = resIcon['proxy-groups'].find(g => g.name === 'TikTok');
    assert.ok(tiktok, '应存在 TikTok 策略组');
    assert.ok(!tiktok.proxies.includes('香港节点') && !tiktok.proxies.includes('大陆节点'), 'TikTok 应准确排除香港与大陆节点');
  });

  test('strategyMain - 哈希负载均衡组随 groupIconMode 渲染（icon 模式剥离 ⚖️ 并挂载图标）', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
        { name: '🇭🇰 香港 02', type: 'ss', server: 'hk2.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' }
      ]
    };
    const base = { enableRegionHashLB: true, minorNodeThreshold: 1, iconRepoOrz: 'https://test-icon.com/' };

    // emoji（默认）模式：纯净中文名由展示层追加 ⚖️ 徽标
    const resEmoji = strategyMain(rawConfig, { ...base, groupIconMode: 'emoji' });
    const emojiHash = resEmoji['proxy-groups'].find(g => g.name === '⚖️ 负载均衡-哈希 (香港)');
    assert.ok(emojiHash, 'emoji 模式应为哈希组追加 ⚖️ 徽标');

    // icon 模式：不得残留 Emoji，且挂载在线图标
    const resIcon = strategyMain(rawConfig, { ...base, groupIconMode: 'icon' });
    const iconHash = resIcon['proxy-groups'].find(g => g.name.includes('负载均衡-哈希'));
    assert.ok(iconHash, 'icon 模式应保留哈希组');
    assert.ok(!iconHash.name.includes('⚖️'), 'icon 模式下哈希组名不得残留 Emoji');
    assert.equal(iconHash.name, '负载均衡-哈希 (香港)');
    assert.ok(iconHash.icon && iconHash.icon.includes('Roundrobin.png'), 'icon 模式应为哈希组挂载在线图标');
  });

  test('strategyMain - hideUnknownGroup 隐藏未知识别策略组', () => {
    const rawConfig = {
      proxies: [
        { name: '火星节点 01', type: 'ss', server: 'mars.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword1' }
      ]
    };
    const resDefault = strategyMain(rawConfig, { hideUnknownGroup: false });
    const defaultUnknown = resDefault['proxy-groups'].find(g => g.name.includes('未知识别'));
    assert.ok(defaultUnknown);
    assert.equal(defaultUnknown.hidden, false);

    const resHidden = strategyMain(rawConfig, { hideUnknownGroup: true });
    const hiddenUnknown = resHidden['proxy-groups'].find(g => g.name.includes('未知识别'));
    assert.ok(hiddenUnknown);
    assert.equal(hiddenUnknown.hidden, true);
  });

  test('strategyMain - customGroups 策略组、分流规则与图标全链路端到端闭环', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
        { name: '🇺🇸 美国 01', type: 'ss', server: 'us1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' }
      ]
    };

    const userConfig = {
      minorNodeThreshold: 1,
      groupIconMode: 'both',
      customGroups: [
        {
          name: '奈飞专线',
          type: 'url-test',
          emoji: '🍿',
          icon: 'Netflix.png',
          match: { region: 'hk' },
          rules: [
            'netflix',
            'DOMAIN-SUFFIX,netflix.com'
          ]
        }
      ]
    };

    const result = strategyMain(rawConfig, userConfig);
    const groups = result['proxy-groups'];
    const netflixGroup = groups.find(g => g.name.includes('奈飞专线'));

    // 1. 策略组与展示层 Emoji / Icon 渲染
    assert.ok(netflixGroup, '应成功生成奈飞专线策略组');
    assert.equal(netflixGroup.name, '🍿 奈飞专线');
    assert.ok(netflixGroup.icon && netflixGroup.icon.includes('Netflix.png'), '应正确挂载在线图标');
    assert.deepEqual(netflixGroup.proxies, ['🇭🇰 香港']);

    // 2. 路由分流规则 (rules) 自动挂载且目标组名与展示层同步
    const rules = result.rules;
    assert.ok(rules.some(r => r === 'RULE-SET,netflix,🍿 奈飞专线'), '简写规则集应自动挂载并对齐组名');
    assert.ok(rules.some(r => r === 'DOMAIN-SUFFIX,netflix.com,🍿 奈飞专线'), '域名规则应自动补齐目标组');

    // 3. Rule-Providers 自动登记
    const providers = result['rule-providers'];
    assert.ok(providers['netflix'], '应自动登记 netflix rule-provider');
    assert.ok(providers['netflix'].url.includes('geosite/netflix'), 'provider URL 应正确拼接');
  });
});

