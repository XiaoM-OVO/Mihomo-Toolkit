const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  SKELETON_GROUPS,
  stripGroupDecoration,
  buildPresentationMaps,
  applyPresentation
} = require('../../src/strategy/presentation');
const { runStrategyPipeline } = require('../../src/pipeline/strategy');

describe('【Strategy】策略组展示层与图标装饰 (strategy-presentation)', () => {

  describe('1. 装饰剥离纯函数 (stripGroupDecoration)', () => {
    it('去除单 Emoji 及其后置空格', () => {
      assert.equal(stripGroupDecoration('🚀 自动选择'), '自动选择');
      assert.equal(stripGroupDecoration('📍 手动选择'), '手动选择');
      assert.equal(stripGroupDecoration('🐟 漏网之鱼'), '漏网之鱼');
    });

    it('去除国旗 Emoji、符号与复合 Emoji', () => {
      assert.equal(stripGroupDecoration('🇭🇰 香港节点'), '香港节点');
      assert.equal(stripGroupDecoration('🇺🇸 美国节点'), '美国节点');
      assert.equal(stripGroupDecoration('▶️ YouTube'), 'YouTube');
      assert.equal(stripGroupDecoration('⚡ 极速线路'), '极速线路');
    });

    it('无装饰文本或无前缀 Emoji 保持不变', () => {
      assert.equal(stripGroupDecoration('自动选择'), '自动选择');
      assert.equal(stripGroupDecoration('DIRECT'), 'DIRECT');
      assert.equal(stripGroupDecoration('REJECT'), 'REJECT');
      assert.equal(stripGroupDecoration(''), '');
      assert.equal(stripGroupDecoration(null), '');
      assert.equal(stripGroupDecoration(undefined), '');
    });
  });

  describe('2. 映射表构建与防双重 Emoji 机制 (buildPresentationMaps)', () => {
    it('groups 包含预设 Emoji 时不发生双重拼接', () => {
      const userConfig = {
        groups: [
          { name: '⚡ 极速日韩', emoji: '⚡' },
          { name: '🚀 极速欧美', emoji: '✈️' },
          { name: '纯净节点', emoji: '🛡️' }
        ]
      };
      const { emojiMap } = buildPresentationMaps(userConfig);

      // 同名同 emoji 不应重复变成 "⚡ ⚡ 极速日韩"
      assert.equal(emojiMap['极速日韩'], '⚡ 极速日韩');
      assert.equal(emojiMap['⚡ 极速日韩'], '⚡ 极速日韩');

      // 覆盖替换 emoji：name 中的 🚀 被替换为 ✈️
      assert.equal(emojiMap['极速欧美'], '✈️ 极速欧美');
      assert.equal(emojiMap['🚀 极速欧美'], '✈️ 极速欧美');

      // 原名无 emoji 正常添加
      assert.equal(emojiMap['纯净节点'], '🛡️ 纯净节点');
    });

    it('未显式声明 registries 时自动安全回退至 Catalog 构建', () => {
      const userConfig = { groupIconMode: 'icon' };
      const { emojiMap, iconMap } = buildPresentationMaps(userConfig);

      assert.ok(emojiMap['ChatGPT']);
      assert.ok(iconMap['ChatGPT']);
      assert.equal(emojiMap['ChatGPT'], '🤖 ChatGPT');
    });

    it('groupIcons 自定义配置支持字符串与对象声明', () => {
      const userConfig = {
        groupIcons: {
          '自动选择': '⚡',
          '手动选择': { emoji: '🎯', icon: 'https://custom.icon/select.png' }
        }
      };
      const { emojiMap, iconMap, explicitIcons } = buildPresentationMaps(userConfig);

      assert.equal(emojiMap['自动选择'], '⚡ 自动选择');
      assert.equal(emojiMap['手动选择'], '🎯 手动选择');
      assert.equal(iconMap['手动选择'], 'https://custom.icon/select.png');
      assert.ok(explicitIcons.has('手动选择'));
    });

    it('SKELETON_GROUPS 纯净化：仅保留 15 个纯基础设施策略组，业务聚合组与专项组由 Catalog 注册表派生', () => {
      const skeletonKeys = Object.keys(SKELETON_GROUPS);
      assert.equal(skeletonKeys.length, 15, 'SKELETON_GROUPS 应精确包含 15 个纯基础设施组');
      assert.ok(!skeletonKeys.includes('游戏服务'), 'SKELETON_GROUPS 严禁包含业务服务：游戏服务');
      assert.ok(!skeletonKeys.includes('游戏下载'), 'SKELETON_GROUPS 严禁包含业务服务：游戏下载');
      assert.ok(!skeletonKeys.includes('Twitter'), 'SKELETON_GROUPS 严禁包含业务服务：Twitter');
      assert.ok(!skeletonKeys.includes('Telegram'), 'SKELETON_GROUPS 严禁包含专项服务：Telegram');
      assert.ok(!skeletonKeys.includes('加密货币'), 'SKELETON_GROUPS 严禁包含专项服务：加密货币');
      assert.ok(!skeletonKeys.includes('PayPal'), 'SKELETON_GROUPS 严禁包含专项服务：PayPal');
      assert.ok(!skeletonKeys.includes('WebRTC'), 'SKELETON_GROUPS 严禁包含专项服务：WebRTC');

      const { emojiMap, iconMap } = buildPresentationMaps({});
      // 聚合与专项策略组依然必须被完整映射且带有正确徽标与图标
      assert.equal(emojiMap['游戏服务'], '🎮 游戏服务');
      assert.equal(emojiMap['游戏下载'], '🎮 游戏下载');
      assert.equal(emojiMap['Twitter'], '🐦 Twitter');
      assert.equal(emojiMap['Facebook'], '👥 Facebook');
      assert.equal(emojiMap['Telegram'], '✈️ Telegram');
      assert.equal(emojiMap['加密货币'], '🪙 加密货币');
      assert.equal(emojiMap['PayPal'], '💳 PayPal');
      assert.equal(emojiMap['WebRTC'], '🗣 WebRTC');

      assert.ok(iconMap['游戏服务'].includes('Game.png'));
      assert.ok(iconMap['Facebook'].includes('Facebook.png'));
      assert.ok(iconMap['Telegram'].includes('Telegram.png'));
    });
  });

  describe('3. 展示模式应用 (applyPresentation)', () => {
    it('none 模式：彻底剥离所有内置组及自定义组的 Emoji，不挂载 icon，并同步规则与代理引用', () => {
      const config = {
        'proxy-groups': [
          { name: '🚀 自动选择', proxies: ['🇭🇰 香港 01', '🇯🇵 日本 01'] },
          { name: '⚡ 极速日韩', proxies: ['🚀 自动选择'] },
          { name: '漏网之鱼', proxies: ['⚡ 极速日韩'] }
        ],
        rules: [
          'RULE-SET,telegram,⚡ 极速日韩',
          'MATCH,漏网之鱼'
        ],
        'rule-providers': {
          custom_rp: { proxy: '⚡ 极速日韩' }
        }
      };

      applyPresentation(config, { groupIconMode: 'none' });

      // 组名全部被净化
      assert.equal(config['proxy-groups'][0].name, '自动选择');
      assert.equal(config['proxy-groups'][1].name, '极速日韩');
      assert.equal(config['proxy-groups'][2].name, '漏网之鱼');

      // 策略组内部引用的代理目标同步净化
      assert.deepEqual(config['proxy-groups'][1].proxies, ['自动选择']);
      assert.deepEqual(config['proxy-groups'][2].proxies, ['极速日韩']);

      // 规则 TARGET 同步净化
      assert.equal(config.rules[0], 'RULE-SET,telegram,极速日韩');
      assert.equal(config.rules[1], 'MATCH,漏网之鱼');

      // rule-providers 同步净化
      assert.equal(config['rule-providers'].custom_rp.proxy, '极速日韩');

      // 无 icon 挂载
      for (const g of config['proxy-groups']) {
        assert.equal(g.icon, undefined);
      }
    });

    it('icon 模式：组名为纯净中文，挂载 g.icon，不带 Emoji 且同步引用', () => {
      const config = {
        'proxy-groups': [
          { name: '🚀 自动选择', proxies: ['香港节点'] },
          { name: '⚡ 极速日韩', proxies: ['🚀 自动选择'] }
        ],
        rules: [
          'RULE-SET,test,⚡ 极速日韩'
        ]
      };

      const userConfig = {
        groupIconMode: 'icon',
        groups: [
          { name: '⚡ 极速日韩', icon: 'https://cdn.example.com/fast.png' }
        ]
      };

      applyPresentation(config, userConfig);

      // 组名净化
      assert.equal(config['proxy-groups'][0].name, '自动选择');
      assert.equal(config['proxy-groups'][1].name, '极速日韩');

      // 挂载 icon
      assert.ok(config['proxy-groups'][0].icon.includes('Urltest.png'));
      assert.equal(config['proxy-groups'][1].icon, 'https://cdn.example.com/fast.png');

      // proxies 与 rules 同步
      assert.deepEqual(config['proxy-groups'][1].proxies, ['自动选择']);
      assert.equal(config.rules[0], 'RULE-SET,test,极速日韩');
    });

    it('emoji 模式：防双重 Emoji，并准确同步 proxies、rules 与 rule-providers', () => {
      const config = {
        'proxy-groups': [
          { name: '自动选择', proxies: ['香港节点'] },
          { name: '极速日韩', proxies: ['自动选择'] }
        ],
        rules: [
          'DOMAIN-SUFFIX,google.com,自动选择',
          'MATCH,极速日韩'
        ],
        'rule-providers': {
          rp1: { proxy: '极速日韩' }
        }
      };

      const userConfig = {
        groupIconMode: 'emoji',
        groups: [
          { name: '⚡ 极速日韩', emoji: '⚡' }
        ]
      };

      applyPresentation(config, userConfig);

      assert.equal(config['proxy-groups'][0].name, '🚀 自动选择');
      assert.equal(config['proxy-groups'][1].name, '⚡ 极速日韩');

      assert.deepEqual(config['proxy-groups'][1].proxies, ['🚀 自动选择']);
      assert.equal(config.rules[0], 'DOMAIN-SUFFIX,google.com,🚀 自动选择');
      assert.equal(config.rules[1], 'MATCH,⚡ 极速日韩');
      assert.equal(config['rule-providers'].rp1.proxy, '⚡ 极速日韩');
    });
  });

  describe('4. 流水线集成验证 (runStrategyPipeline)', () => {
    it('groups 预设带有 Emoji 时，在 emoji 模式下输出干净单一 Emoji', () => {
      const rawConfig = {
        proxies: [
          { name: '🇭🇰 香港 01', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' },
          { name: '🇯🇵 日本 01', type: 'ss', server: 'jp.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p2' }
        ]
      };
      const userConfig = {
        groups: [
          {
            name: '⚡ 极速亚太',
            type: 'select',
            emoji: '⚡',
            match: { region: ['HK', 'JP'] }
          }
        ],
        minorNodeThreshold: 1
      };

      const result = runStrategyPipeline(rawConfig, userConfig);
      const groupNames = result['proxy-groups'].map(g => g.name);

      assert.ok(groupNames.includes('⚡ 极速亚太'), '应包含单一 Emoji 装饰的极速亚太');
      assert.ok(!groupNames.includes('⚡ ⚡ 极速亚太'), '严禁出现双重 Emoji 前缀');
    });

    it('groups 预设带有 Emoji 时，在 none 模式下输出纯净中文无 Emoji', () => {
      const rawConfig = {
        proxies: [
          { name: '🇭🇰 香港 01', type: 'ss', server: 'hk.node.com', port: 443, cipher: 'aes-128-gcm', password: 'p1' }
        ]
      };
      const userConfig = {
        groupIconMode: 'none',
        groups: [
          {
            name: '⚡ 极速亚太',
            type: 'select',
            emoji: '⚡',
            match: { region: 'HK' }
          }
        ],
        minorNodeThreshold: 1
      };

      const result = runStrategyPipeline(rawConfig, userConfig);
      const groupNames = result['proxy-groups'].map(g => g.name);

      assert.ok(groupNames.includes('极速亚太'), 'none 模式下自定义组必须被剥离为纯净中文');
      assert.ok(!groupNames.includes('⚡ 极速亚太'), 'none 模式下严禁包含任何 Emoji');
    });
  });
});
