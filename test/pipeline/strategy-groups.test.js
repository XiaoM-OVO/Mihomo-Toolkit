const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { runStrategyPipeline: strategyMain } = require('../../src/pipeline/strategy.js');
const { markTrustedSynthetic } = require('../../src/core/node-trust');
const { resolveConfig } = require('../../src/config');
const { validateGroups } = require('../../src/strategy/matcher');

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

  test('strategyMain - 高倍率隔离分组逻辑 (enableIsolation)', () => {
    const rawConfig = {
      proxies: [
        { name: '🇯🇵 日本 01 🚀 x3.0', type: 'ss', server: 'jp1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword1' },
        { name: '🇯🇵 日本 02 [0.5x]', type: 'ss', server: 'jp2.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword2' }
      ]
    };

    const userConfig = {
      enableIsolation: true,
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

  test('strategyMain - 实验节点隔离分组逻辑 (enableIsolation)', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01 测试节点', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword1' },
        { name: '🇭🇰 香港 02 备用线路', type: 'ss', server: 'hk2.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword2' },
        { name: '🇭🇰 香港 03 正常节点', type: 'ss', server: 'hk3.node.com', port: 443, cipher: 'aes-128-gcm', password: 'secretpassword3' }
      ]
    };

    const userConfig = { enableIsolation: true, minorNodeThreshold: 1 };

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

  test('strategyMain - 家宽节点注入测试 (enableIsolation + residentialNodeGroups)', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01 家宽', type: 'ss', server: 'hk-resi.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
        { name: '🇺🇸 美国 01 家宽', type: 'ss', server: 'us-resi.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' },
        { name: '🇯🇵 日本 01 普通', type: 'ss', server: 'jp.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p3' }
      ]
    };

    const userConfig = {
      enableIsolation: true,
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
        markTrustedSynthetic({ name: '📅 [机场A] 到期日：2026-12-31 (余 120 天)', type: 'direct', server: '1.0.0.1', port: 80, isSyntheticInfo: true }),
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
    assert.ok(!manualGroup.proxies.some(p => p.includes('到期日')), '手动选择组不应包含到期假节点');

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
      minorNodeThreshold: 1
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

  test('strategyMain - groups 策略组 + routing 规则 + 图标全链路端到端闭环', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
        { name: '🇺🇸 美国 01', type: 'ss', server: 'us1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' }
      ]
    };

    const userConfig = {
      minorNodeThreshold: 1,
      groupIconMode: 'both',
      groups: [
        {
          name: '奈飞专线',
          type: 'url-test',
          emoji: '🍿',
          icon: 'Netflix.png',
          match: { region: 'hk' }
        }
      ],
      routing: [
        { preset: 'subscription' },
        { rule: 'geosite:netflix', to: '奈飞专线' },
        { rule: 'DOMAIN-SUFFIX,netflix.com', to: '奈飞专线' },
        { preset: 'final' }
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

    // 2. 路由规则来自 routing 表，目标组名与展示层同步
    const rules = result.rules;
    assert.ok(rules.some(r => r === 'RULE-SET,netflix,🍿 奈飞专线'), '规则集简写应自动登记 Provider 并对齐组名');
    assert.ok(rules.some(r => r === 'DOMAIN-SUFFIX,netflix.com,🍿 奈飞专线'), '域名规则应自动补齐目标组');

    // 3. Rule-Providers 自动登记
    const providers = result['rule-providers'];
    assert.ok(providers['netflix'], '应自动登记 netflix rule-provider');
    assert.ok(providers['netflix'].url.includes('geosite/netflix'), 'provider URL 应正确拼接');
  });

  test('strategyMain - 策略组图标模式 (groupIconMode: none 纯文本无装饰)', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
        { name: '🇯🇵 日本 01', type: 'ss', server: 'jp1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' }
      ]
    };

    const userConfig = {
      groupIconMode: 'none',
      minorNodeThreshold: 1
    };

    const result = strategyMain(rawConfig, userConfig);
    const groups = result['proxy-groups'];

    // 纯文本模式：组名一律为纯净中文，不带任何 Emoji 徽标
    assert.ok(groups.some(g => g.name === '自动选择'), '应为纯净「自动选择」而非带 Emoji');
    assert.ok(groups.some(g => g.name === '手动选择'), '应为纯净「手动选择」而非带 Emoji');
    assert.ok(groups.some(g => g.name === '香港节点'), '应为纯净「香港节点」而非带 Emoji');
    assert.ok(groups.some(g => g.name === 'ChatGPT'), '应为纯净「ChatGPT」而非带 Emoji');

    // 纯文本模式：所有策略组一律不挂载 icon 属性
    for (const g of groups) {
      assert.equal(g.icon, undefined, `组「${g.name}」在 none 模式下不得挂载 icon`);
    }

    // 规则 TARGET 也应全部同步为纯净组名
    const groupNameSet = new Set(groups.map(g => g.name));
    for (const r of result.rules) {
      const parts = r.split(',');
      const target = parts[parts.length - 1] === 'no-resolve' ? parts[parts.length - 2] : parts[parts.length - 1];
      if (['DIRECT', 'REJECT', 'REJECT-DROP', 'COMPATIBLE', 'PASS'].includes(target)) continue;
      assert.ok(groupNameSet.has(target), `规则目标「${target}」必须存在于策略组清单中`);
    }
  });

  test('strategyMain - 自定义策略组图标覆盖 (groupIcons)', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' }
      ]
    };

    const userConfig = {
      groupIcons: {
        '自动选择': '⚡',
        '手动选择': { emoji: '🎯', icon: 'https://custom.icon/static.png' }
      },
      minorNodeThreshold: 1
    };

    const result = strategyMain(rawConfig, userConfig);
    const groups = result['proxy-groups'];

    const autoGroup = groups.find(g => g.name.includes('自动选择'));
    assert.ok(autoGroup, '应存在自动选择策略组');
    assert.equal(autoGroup.name, '⚡ 自动选择', '自动选择组 Emoji 应被 groupIcons 成功覆盖为 ⚡');

    const manualGroup = groups.find(g => g.name.includes('手动选择'));
    assert.ok(manualGroup, '应存在手动选择策略组');
    assert.equal(manualGroup.name, '🎯 手动选择', '手动选择组 Emoji 应被 groupIcons 成功覆盖为 🎯');
    assert.equal(manualGroup.icon, 'https://custom.icon/static.png', '手动选择组 Icon 应被 groupIcons 成功覆盖');
  });

  test('resolveConfig - groups 的 { ref } 展开结果与手写完整声明逐字段同构（不变量 2）', () => {
    const resolved = resolveConfig({ groups: [{ ref: 'chatgpt' }] });
    const declared = resolved.groups.find(g => g.name === 'ChatGPT');

    assert.ok(declared, 'ref 条目应被展开为一条完整组声明');
    // 手写同一条声明必须得到完全一致的字段（ref 不引入任何独有概念）
    // 规则字段（rules / providers / process）已不属于组：批次 3 起规则只由 routing 表生成
    assert.deepEqual(declared, {
      name: 'ChatGPT',
      type: 'select',
      match: { pool: 'chatgpt' },
      exclude: undefined,
      proxies: ['@residentialGroup', '@preferredRegions', '@matchedNodes', '@defaultProxy', 'DIRECT'],
      preferredRegions: ['us', 'jp', 'tw', 'sg', 'kr', 'eu'],
      hidden: undefined
    });
  });

  test('resolveConfig - groups 支持条目内覆写与 disabled 显式关闭', () => {
    const overridden = resolveConfig({ groups: [{ ref: 'chatgpt', type: 'url-test', name: '我的 GPT 专线' }] });
    const declared = overridden.groups.find(g => g.name === '我的 GPT 专线');
    assert.ok(declared, 'ref 条目应允许覆写 name');
    assert.equal(declared.type, 'url-test', 'ref 条目应允许覆写 type');
    assert.deepEqual(declared.match, { pool: 'chatgpt' }, '未覆写字段应保留目录声明原值');

    const disabled = resolveConfig({ groups: [{ ref: 'chatgpt', disabled: true }] });
    assert.deepEqual(disabled.groups, [], 'disabled: true 的条目不得进入引擎消费清单');

    // 同名 ref 多次出现时位置靠后者胜（与 include 的「主文件优先」一致），
    // 关闭状态必须以显式字段下传，不得写回目录或泄漏进声明。
    const disabledThenEnabled = resolveConfig({
      groups: [{ ref: 'chatgpt', disabled: true }, { ref: 'chatgpt' }]
    });
    assert.ok(
      disabledThenEnabled.groups.some(g => g.name === 'ChatGPT'),
      '关闭后重新声明应生效，且声明中不得残留 _disabled'
    );
    assert.deepEqual(disabledThenEnabled.disabledGroupRefs, [], '重新启用后关闭清单应为空');

    const enabledThenDisabled = resolveConfig({
      groups: [{ ref: 'chatgpt' }, { ref: 'chatgpt', disabled: true }]
    });
    assert.deepEqual(enabledThenDisabled.groups, [], '靠后的 disabled 条目必须关闭先前声明');
    assert.deepEqual(enabledThenDisabled.disabledGroupRefs, ['chatgpt'], '关闭状态应作为显式字段下传');
  });

  test('resolveConfig - groups 未知 ref 键 fail-closed 并报出字段路径（不变量 6）', () => {
    assert.throws(
      () => resolveConfig({ groups: [{ ref: 'no-such-group' }] }),
      /groups\[0\]\.ref: 未知内置组引用键/,
      '未知 ref 键必须配置期 fail-closed，禁止静默跳过'
    );
    assert.throws(
      () => resolveConfig({ groups: [{ ref: '' }] }),
      /groups\[0\]\.ref: 期望非空字符串引用键/
    );
    assert.throws(
      () => resolveConfig({ groups: [{ ref: 'no-such-group', disabled: true }] }),
      /groups\[0\]\.ref: 未知内置组引用键/,
      '关闭条目同样要校验引用键，不得因 disabled 静默吞掉拼写错误'
    );
  });

  test('validateGroups - 未知宏配置期 fail-closed 并报出字段路径', () => {
    assert.throws(
      () => validateGroups([{ name: '未知宏组', proxies: ['@bogusMacro'] }]),
      /proxies\[0\]：未知宏/,
      '未知宏必须在配置期 fail-closed（禁止运行期静默跳过）'
    );
    // 报错内联可用宏清单，用户不必再翻文档才知道能写什么
    assert.throws(
      () => validateGroups([{ name: '未知宏组', proxies: ['@bogusMacro'] }]),
      /可用宏：@matchednodes .*\/ @asia/,
      '未知宏报错应列出可用宏'
    );
    // 已登记宏不得误报
    validateGroups([{ name: '合法宏组', proxies: ['@matchedNodes', '@preferredRegions', 'DIRECT'] }]);
  });

  test('strategyMain - groups 引用内置组目录：声明即激活、组/规则/Provider 全链路贯通（不变量 3）', () => {
    const buildRawConfig = () => ({
      proxies: [
        { name: '🇺🇸 美国 ChatGPT 01', type: 'ss', server: 'us1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' }
      ]
    });

    const result = strategyMain(buildRawConfig(), {
      minorNodeThreshold: 1,
      groups: [{ ref: 'chatgpt' }],
      routing: [{ preset: 'subscription' }, { service: 'chatgpt' }, { preset: 'final' }]
    });

    const gpt = result['proxy-groups'].find(g => g.name === '🤖 ChatGPT');
    assert.ok(gpt, 'groups 里的 ref 声明 + routing 引用即建组（声明即激活）');
    assert.ok(
      gpt.proxies.some(p => p.includes('🤖')),
      'ref 组应按目录 match 配方命中节点'
    );
    assert.ok(
      result.rules.includes('RULE-SET,openai,🤖 ChatGPT'),
      '规则由 routing 条目生成，目标指向 ref 声明的组'
    );
    const provider = result['rule-providers'].openai;
    assert.ok(provider && provider.url.includes('geosite/openai'), 'routing 展开应登记规则集 Provider');
  });

  test('resolveConfig - 可引用判据 = 条目自带非空 proxies（成员配方未备齐者仍 fail-closed）', () => {
    // 已备齐成员配方的条目：可作为 ref 目标
    const ok = resolveConfig({ groups: [{ ref: 'youtube' }, { ref: 'telegram' }, { ref: 'google' }] });
    assert.ok(ok.groups.find(g => g.name === 'YouTube'), '流媒体条目应可被引用');
    assert.ok(ok.groups.find(g => g.name === 'Google'), '系统条目应可被引用');

    // 聚合组成员（无 proxies，不单独成组）不得进入目录：引用它必须配置期 fail-closed，并给出改引聚合组的指引
    assert.throws(
      () => resolveConfig({ groups: [{ ref: 'steam' }] }),
      /groups\[0\]\.ref: 未知内置组引用键「steam」；「steam」是聚合组「游戏服务」的成员条目，不单独成组，请改为 \{ ref: game-service \}/,
      '引用聚合组成员必须 fail-closed（禁止空壳组），且报错须指引到所属聚合组'
    );
    // 社交服务一服务一组：每个社交服务自带配方，可直接引用（不再有合并组）
    const fb = resolveConfig({ groups: [{ ref: 'facebook' }] });
    assert.ok(fb.groups.find(g => g.name === 'Facebook'), 'facebook 应可直接作为 ref 目标');
  });

  test('validateGroups - 组里写 process 等规则字段被顶层白名单拒绝', () => {
    assert.throws(
      () => validateGroups([{ name: '进程组', process: { win64: ['Telegram'] } }]),
      /未知字段「process」/,
      'process 属于规则侧（routing 表），组声明里出现必须 fail-closed'
    );
  });

  test('strategyMain - ref 与默认表叠加时幂等：不产生重复组、重复规则或重复 Provider', () => {
    const buildRawConfig = () => ({
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
        { name: '🇯🇵 日本 01', type: 'ss', server: 'jp1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' },
        { name: '🇹🇼 台湾 YouTube 专线', type: 'ss', server: 'tw1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p3' },
        { name: '🇺🇸 美国 Netflix 专线', type: 'ss', server: 'us1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p4' },
        { name: '🎮 游戏专线 01', type: 'ss', server: 'game1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p5' }
      ]
    });

    const refs = [
      'youtube', 'netflix', 'telegram', 'github', 'google', 'apple',
      'game-service', 'game-download', 'ad-block'
    ];

    const plain = strategyMain(buildRawConfig(), { minorNodeThreshold: 1 });
    const withRefs = strategyMain(buildRawConfig(), {
      minorNodeThreshold: 1,
      groups: refs.map(ref => ({ ref }))
    });

    assert.deepEqual(
      withRefs['proxy-groups'],
      plain['proxy-groups'],
      '默认表已经建好的组，再声明 ref 不得重复建组或改变顺序'
    );
    assert.deepEqual(
      [...withRefs.rules].sort(),
      [...plain.rules].sort(),
      'ref 与预设展开指向同一目标时不得产生多余规则'
    );
    assert.deepEqual(
      Object.keys(withRefs['rule-providers']).sort(),
      Object.keys(plain['rule-providers']).sort(),
      'ref 与预设展开不得产生多余 Rule-Provider'
    );
  });

  test('strategyMain - 路由表未展开的分类，ref 仍可单独建组（组不依赖规则）', () => {
    const { DEFAULT_ROUTING } = require('../../src/data/default-routing');
    const withoutSystem = DEFAULT_ROUTING.filter(entry => entry.preset !== 'system');
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' }
      ]
    };

    const result = strategyMain(rawConfig, {
      minorNodeThreshold: 1,
      routing: withoutSystem,
      groups: [{ ref: 'google' }]
    });

    assert.ok(
      result['proxy-groups'].some(g => g.name === '🔍 Google'),
      '表里没有 system 段时，ref 声明仍应把组建出来（组由引用驱动）'
    );
  });

  test('strategyMain - 同一组名的多条规则来源（广告）在表里出现一次即只建一组', () => {
    const { DEFAULT_ROUTING } = require('../../src/data/default-routing');
    const routing = DEFAULT_ROUTING.map(entry => (entry.service === 'ad-block' ? { service: 'anti-ad' } : entry));
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' }
      ]
    };

    const result = strategyMain(rawConfig, { minorNodeThreshold: 1, routing });
    const ads = result['proxy-groups'].filter(g => g.name === '🚫 广告拦截');

    assert.equal(ads.length, 1, 'ad-block / anti-ad 共享同一目标组，只能建一组');
    assert.ok(
      result.rules.includes('RULE-SET,anti-ad,🚫 广告拦截'),
      'anti-ad 条目仍应把规则指向共享组'
    );
    assert.ok(!result.rules.some(r => /^RULE-SET,ads,/.test(r)), '换成 anti-ad 后不应再出现 ads 规则');
  });

  test('strategyMain - ref 引用专项组时随组交付 PROCESS-NAME 进程规则', () => {
    const rawConfig = {
      proxies: [
        { name: '🇭🇰 香港 01', type: 'ss', server: 'hk1.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' }
      ]
    };
    const result = strategyMain(rawConfig, {
      minorNodeThreshold: 1,
      groups: [{ ref: 'telegram' }]
    });

    assert.ok(result['proxy-groups'].some(g => g.name === '✈️ Telegram'), '专项总开关关闭时 ref 仍应建组');
    assert.ok(
      result.rules.some(r => /^PROCESS-NAME,Telegram(\.exe)?,✈️ Telegram$/.test(r)),
      'ref 引用 telegram 必须随组交付进程名单规则，不得静默丢失'
    );
  });
});

