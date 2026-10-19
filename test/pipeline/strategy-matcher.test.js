const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  compileMultiMatcher,
  compilePatternMatcher,
  compileRegionMatcher,
  compileTagMatcher,
  compileProtocolMatcher,
  compileAirportMatcher,
  compileFeaturePoolMatcher,
  createNodePredicate,
  filterNodes,
  validateRecipe,
  validateCustomGroups
} = require('../../src/strategy/matcher');

describe('【Strategy】拓扑 DSL 节点谓词匹配器 (strategy-matcher)', () => {

  describe('1. 倍率匹配器 (compileMultiMatcher)', () => {
    it('比较运算符: <=, <, >=, >, ==', () => {
      const lte = compileMultiMatcher('<= 1.5');
      assert.equal(lte(1.0), true);
      assert.equal(lte(1.5), true);
      assert.equal(lte(1.51), false);

      const lt = compileMultiMatcher('< 2.0');
      assert.equal(lt(1.99), true);
      assert.equal(lt(2.0), false);

      const gte = compileMultiMatcher('>= 1.0');
      assert.equal(gte(1.0), true);
      assert.equal(gte(0.99), false);

      const gt = compileMultiMatcher('> 2.5');
      assert.equal(gt(2.51), true);
      assert.equal(gt(2.5), false);

      const eq = compileMultiMatcher('== 1.0');
      assert.equal(eq(1.0), true);
      assert.equal(eq(1.5), false);
    });

    it('区间表达式: [min, max], (min, max], [min, max), (min, max)', () => {
      const closed = compileMultiMatcher('[0, 1.5]');
      assert.equal(closed(0), true);
      assert.equal(closed(1.0), true);
      assert.equal(closed(1.5), true);
      assert.equal(closed(-0.1), false);
      assert.equal(closed(1.51), false);

      const halfOpen = compileMultiMatcher('(0, 2.0]');
      assert.equal(halfOpen(0), false);
      assert.equal(halfOpen(0.01), true);
      assert.equal(halfOpen(2.0), true);
      assert.equal(halfOpen(2.01), false);
    });

    it('数组与纯数字', () => {
      const arrMatcher = compileMultiMatcher([0, 1.5]);
      assert.equal(arrMatcher(1.0), true);
      assert.equal(arrMatcher(2.0), false);

      const numMatcher = compileMultiMatcher(2.0);
      assert.equal(numMatcher(2.0), true);
      assert.equal(numMatcher(1.5), false);
    });

    it('非法与空输入安全回退 null', () => {
      assert.equal(compileMultiMatcher(null), null);
      assert.equal(compileMultiMatcher(''), null);
      assert.equal(compileMultiMatcher('invalid'), null);
    });
  });

  describe('2. 名称与正则匹配器 (compilePatternMatcher)', () => {
    it('子串不区分大小写匹配', () => {
      const matcher = compilePatternMatcher('专线');
      assert.equal(matcher('🇭🇰 香港 IEPL 专线 01'), true);
      assert.equal(matcher('🇭🇰 香港 BGP 01'), false);
    });

    it('字符串正则 (/regex/flags)', () => {
      const matcher = compilePatternMatcher('/(?:专线|iepl)/i');
      assert.equal(matcher('🇭🇰 香港 IEPL 01'), true);
      assert.equal(matcher('🇭🇰 香港 专线 01'), true);
      assert.equal(matcher('🇭🇰 香港 普通 01'), false);
    });

    it('RegExp 实例与多模式数组', () => {
      const matcher = compilePatternMatcher([/专线/i, 'BGP']);
      assert.equal(matcher('深圳-香港专线'), true);
      assert.equal(matcher('上海-东京 BGP'), true);
      assert.equal(matcher('普通直连'), false);
    });
  });

  describe('3. 地区匹配器 (compileRegionMatcher)', () => {
    const nodeHK = {
      regionInfo: { id: 'hk', name: '香港', group: 'asia' },
      groupKey: 'hk'
    };
    const nodeCN = {
      regionInfo: { id: 'cn', name: '中国', group: 'asia' },
      groupKey: 'cn'
    };
    const nodeUS = {
      regionInfo: { id: 'us', name: '美国', group: 'america' },
      groupKey: 'us'
    };
    const nodeUnknown = {
      isUnknownRegion: true,
      groupKey: 'unknown'
    };

    it('正向地区代码与中文名', () => {
      const matcher = compileRegionMatcher(['hk', 'tw', '日本']);
      assert.equal(matcher(nodeHK), true);
      assert.equal(matcher(nodeUS), false);
    });

    it('大洲代码', () => {
      const matcher = compileRegionMatcher('asia');
      assert.equal(matcher(nodeHK), true);
      assert.equal(matcher(nodeCN), true);
      assert.equal(matcher(nodeUS), false);
    });

    it('负向排除 (!cn)', () => {
      const matcher = compileRegionMatcher(['asia', '!cn']);
      assert.equal(matcher(nodeHK), true);
      assert.equal(matcher(nodeCN), false);
    });

    it('纯负向排除 (!cn)', () => {
      const matcher = compileRegionMatcher('!cn');
      assert.equal(matcher(nodeHK), true);
      assert.equal(matcher(nodeUS), true);
      assert.equal(matcher(nodeCN), false);
    });

    it('unknown 地区识别', () => {
      const matcher = compileRegionMatcher('unknown');
      assert.equal(matcher(nodeUnknown), true);
      assert.equal(matcher(nodeHK), false);
    });

    it('大洲与次大区层级匹配 (真实元数据衍生: 亚洲, 东南亚, 欧洲, 美洲, 大洋洲)', () => {
      const realHK = { regionInfo: { id: 'hk', name: '香港', continent: 'asia', subGroup: 'ea' } };
      const realJP = { regionInfo: { id: 'jp', name: '日本', continent: 'asia', subGroup: 'ea' } };
      const realSG = { regionInfo: { id: 'sg', name: '新加坡', continent: 'asia', subGroup: 'sea' } };
      const realMY = { regionInfo: { id: 'my', code: 'MY', name: '马来西亚', foldGroup: 'sea', continent: 'asia', subGroup: 'sea' } };
      const realUS = { regionInfo: { id: 'us', code: 'US', name: '美国', continent: 'americas', subGroup: 'na' } };
      const realDE = { regionInfo: { id: 'de', code: 'DE', name: '德国', foldGroup: 'eu', continent: 'europe' } };
      const realAU = { regionInfo: { id: 'au', code: 'AU', name: '澳大利亚', foldGroup: 'oc', continent: 'oceania', subGroup: 'oc' } };

      // 亚洲及中文
      const asiaMatcher = compileRegionMatcher('asia');
      assert.equal(asiaMatcher(realHK), true);
      assert.equal(asiaMatcher(realJP), true);
      assert.equal(asiaMatcher(realSG), true);
      assert.equal(asiaMatcher(realMY), true);
      assert.equal(asiaMatcher(realUS), false);
      assert.equal(asiaMatcher(realDE), false);

      const asiaZhMatcher = compileRegionMatcher('亚洲');
      assert.equal(asiaZhMatcher(realHK), true);
      assert.equal(asiaZhMatcher(realUS), false);

      // 东南亚 (sea / 东南亚)
      const seaMatcher = compileRegionMatcher('sea');
      assert.equal(seaMatcher(realSG), true);
      assert.equal(seaMatcher(realMY), true);
      assert.equal(seaMatcher(realHK), false);
      assert.equal(seaMatcher(realJP), false);

      const seaZhMatcher = compileRegionMatcher('东南亚');
      assert.equal(seaZhMatcher(realSG), true);
      assert.equal(seaZhMatcher(realHK), false);

      // 欧洲及美洲
      const euMatcher = compileRegionMatcher('europe');
      assert.equal(euMatcher(realDE), true);
      assert.equal(euMatcher(realUS), false);

      const amMatcher = compileRegionMatcher('americas');
      assert.equal(amMatcher(realUS), true);
      assert.equal(amMatcher(realHK), false);

      // 大洋洲
      const ocMatcher = compileRegionMatcher('oceania');
      assert.equal(ocMatcher(realAU), true);
      assert.equal(ocMatcher(realHK), false);

      // 国家代号精准匹配 (de, au, my 等非核心原样支持)
      const deMatcher = compileRegionMatcher('de');
      assert.equal(deMatcher(realDE), true);
      assert.equal(deMatcher(realUS), false);

      const auMatcher = compileRegionMatcher('au');
      assert.equal(auMatcher(realAU), true);
      assert.equal(auMatcher(realHK), false);
    });
  });

  describe('4. 标签匹配器 (compileTagMatcher)', () => {
    it('基础标签命中与任一匹配 (any)', () => {
      const matcher = compileTagMatcher(['chatgpt', 'gemini']);
      assert.equal(matcher(['chatgpt', 'residential']), true);
      assert.equal(matcher(['gemini']), true);
      assert.equal(matcher(['youtube']), false);
    });

    it('排除标签 (!download)', () => {
      const matcher = compileTagMatcher(['streaming', '!download']);
      assert.equal(matcher(['streaming']), true);
      assert.equal(matcher(['streaming', 'download']), false);
      assert.equal(matcher(['download']), false);
    });

    it('全量必须满足 (all)', () => {
      const matcher = compileTagMatcher({ all: ['residential', 'chatgpt'] });
      assert.equal(matcher(['residential', 'chatgpt']), true);
      assert.equal(matcher(['residential', 'chatgpt', 'streaming']), true);
      assert.equal(matcher(['residential']), false);
    });
  });

  describe('5. 协议与特征池匹配器 (Protocol / Airport / FeaturePool)', () => {
    it('协议匹配 (支持 !排除)', () => {
      const matcher = compileProtocolMatcher(['ss', 'vless']);
      assert.equal(matcher({ protocol: 'ss' }), true);
      assert.equal(matcher({ proxy: { type: 'VLESS' } }), true);
      assert.equal(matcher({ protocol: 'vmess' }), false);

      const noHttp = compileProtocolMatcher('!http');
      assert.equal(noHttp({ protocol: 'ss' }), true);
      assert.equal(noHttp({ protocol: 'http' }), false);
    });

    it('机场订阅标签匹配', () => {
      const matcher = compileAirportMatcher(['sub-a', 'sub-b']);
      assert.equal(matcher({ airportTag: 'sub-a' }), true);
      assert.equal(matcher({ airportTag: 'sub-c' }), false);
    });

    it('特征池匹配 (featurePools)', () => {
      const matcher = compileFeaturePoolMatcher('ai');
      assert.equal(matcher({ featurePools: ['ai', 'streaming'] }), true);
      assert.equal(matcher({ featurePools: ['game'] }), false);
    });
  });

  describe('6. 复合规则与一体化谓词 (compileRule & createNodePredicate)', () => {
    const testNodes = [
      {
        proxy: { name: '🇭🇰 香港 IEPL 01', type: 'ss' },
        rawName: '🇭🇰 香港 IEPL 01',
        regionInfo: { id: 'hk', name: '香港', group: 'asia' },
        tags: ['streaming'],
        attrs: { multiNum: 1.0 },
        featurePools: ['streaming']
      },
      {
        proxy: { name: '🇭🇰 香港 普通 02', type: 'vmess' },
        rawName: '🇭🇰 香港 普通 02',
        regionInfo: { id: 'hk', name: '香港', group: 'asia' },
        tags: ['download'],
        attrs: { multiNum: 0.5 },
        featurePools: ['download']
      },
      {
        proxy: { name: '🇺🇸 美国 高倍 01', type: 'vless' },
        rawName: '🇺🇸 美国 高倍 01',
        regionInfo: { id: 'us', name: '美国', group: 'america' },
        tags: ['residential', 'chatgpt'],
        attrs: { multiNum: 3.0 },
        featurePools: ['ai']
      },
      {
        proxy: { name: '🇨🇳 中国 节点 01', type: 'ss' },
        rawName: '🇨🇳 中国 节点 01',
        regionInfo: { id: 'cn', name: '中国', group: 'asia' },
        tags: [],
        attrs: { multiNum: 1.0 }
      },
      {
        proxy: { name: '📊 剩余流量 100G', type: 'ss' },
        rawName: '📊 剩余流量 100G',
        isInfo: true
      },
      {
        proxy: { name: '⚠️ 广告节点', type: 'ss' },
        rawName: '⚠️ 广告节点',
        skip: true
      }
    ];

    it('复合 match: 地区 + 倍率 + 正则', () => {
      const predicate = createNodePredicate({
        match: {
          region: ['hk'],
          multi: '<= 1.0',
          pattern: 'IEPL'
        }
      });
      assert.equal(predicate(testNodes[0]), true);  // 港 + 1.0 + IEPL
      assert.equal(predicate(testNodes[1]), false); // 港 + 0.5 但不是 IEPL
      assert.equal(predicate(testNodes[2]), false); // 美
    });

    it('match + exclude 协同: 筛选低倍率港美但排除下载', () => {
      const predicate = createNodePredicate({
        match: {
          region: ['hk', 'us']
        },
        exclude: {
          tags: ['download'],
          multi: '> 2.0'
        }
      });
      assert.equal(predicate(testNodes[0]), true);  // 港流媒体 1.0 -> 命中
      assert.equal(predicate(testNodes[1]), false); // 命中 exclude tags: download
      assert.equal(predicate(testNodes[2]), false); // 命中 exclude multi: > 2.0
      assert.equal(predicate(testNodes[3]), false); // cn 不在 match region
    });

    it('filterNodes 批量过滤与看板/跳过节点自动防御', () => {
      const result = filterNodes(testNodes, {
        match: {
          region: ['hk', 'us', 'cn']
        },
        exclude: {
          tags: ['download']
        }
      });
      // testNodes[0]: 港 IEPL -> 保留
      // testNodes[1]: 港 下载 -> 被 exclude
      // testNodes[2]: 美 高倍 -> 保留
      // testNodes[3]: 中 -> 保留
      // testNodes[4]: 看板节点 -> 默认剥离
      // testNodes[5]: skip 节点 -> 剥离
      assert.equal(result.length, 3);
      assert.deepEqual(
        result.map(n => n.proxy.name),
        ['🇭🇰 香港 IEPL 01', '🇺🇸 美国 高倍 01', '🇨🇳 中国 节点 01']
      );
    });

    it('filterNodes: includeInfo: true 保留看板节点', () => {
      const result = filterNodes(testNodes, {
        includeInfo: true
      });
      assert.ok(result.some(n => n.isInfo));
    });
  });

  describe('7. 配方合规校验与严格阻断 (validateRecipe & validateCustomGroups)', () => {
    it('合法配方与函数谓词正常通过', () => {
      assert.doesNotThrow(() => validateRecipe({ region: 'hk' }, 'test'));
      assert.doesNotThrow(() => validateRecipe({ multi: '<= 1.5', tags: ['streaming'] }, 'test'));
      assert.doesNotThrow(() => validateRecipe(() => true, 'test'));
    });

    it('非对象、空对象或空数组拦截', () => {
      assert.throws(() => validateRecipe(null, 'test'), /配方必须为非空普通对象/);
      assert.throws(() => validateRecipe('invalid', 'test'), /配方必须为非空普通对象/);
      assert.throws(() => validateRecipe([], 'test'), /配方必须为非空普通对象/);
      assert.throws(() => validateRecipe({}, 'test'), /配方对象不能为空/);
    });

    it('未知匹配维度拦截 (Fail-Closed)', () => {
      assert.throws(
        () => validateRecipe({ regin: 'hk' }, 'test'),
        /未知匹配维度「regin」/
      );
    });

    it('各匹配维度类型与非空约束', () => {
      // 字符串类型
      assert.throws(() => validateRecipe({ region: '' }, 'test'), /字符串值不能为空/);
      assert.throws(() => validateRecipe({ region: [] }, 'test'), /数组不能为空/);
      assert.throws(() => validateRecipe({ region: [123] }, 'test'), /期望非空 string 类型/);

      // 倍率格式
      assert.throws(() => validateRecipe({ multi: NaN }, 'test'), /倍率数值不能为 NaN/);
      assert.throws(() => validateRecipe({ multi: 'invalid' }, 'test'), /倍率格式不合法/);
      assert.throws(() => validateRecipe({ multi: [1] }, 'test'), /包含两个数字的元组/);

      // 标签格式
      assert.throws(() => validateRecipe({ tags: '' }, 'test'), /标签名不能为空/);
      assert.throws(() => validateRecipe({ tags: { unknown: ['a'] } }, 'test'), /未知键「unknown」/);

      // 正则格式
      assert.throws(() => validateRecipe({ pattern: '' }, 'test'), /正则\/名称关键词不能为空/);

      // 模式与布尔
      assert.throws(() => validateRecipe({ mode: 'invalid' }, 'test'), /期望 'all' 或 'any'/);
      assert.throws(() => validateRecipe({ isSpecial: 'true' }, 'test'), /期望 boolean 类型/);
      assert.throws(() => validateRecipe({ custom: 'not_fn' }, 'test'), /期望 function 谓词类型/);
    });

    it('validateCustomGroups 批次校验与路径溯源', () => {
      assert.throws(
        () => validateCustomGroups('not_array'),
        /customGroups 配置必须为策略组对象数组/
      );

      assert.throws(
        () => validateCustomGroups([null]),
        /customGroups\[0\]: 策略组定义必须为有效对象/
      );

      assert.throws(
        () => validateCustomGroups([{ name: '流媒体', match: [] }]),
        /策略组\s*「流媒体」 -> match: 配方数组不能为空/
      );

      assert.throws(
        () => validateCustomGroups([{ name: '流媒体', match: [{ regin: 'hk' }] }]),
        /策略组\s*「流媒体」 -> match\[0\]: 未知匹配维度「regin」/
      );

      assert.doesNotThrow(() => {
        validateCustomGroups([
          {
            name: '流媒体',
            match: { region: 'hk' },
            exclude: [{ tags: ['download'] }]
          }
        ]);
      });
    });
  });

});

