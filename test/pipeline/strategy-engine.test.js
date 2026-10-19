const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  detectGroupCycles,
  resolveGroupProxies,
  evaluateGroupDefinition,
  evaluateCustomTopology
} = require('../../src/strategy/topology-engine');

describe('【Strategy】拓扑 DSL 装配引擎 (topology-engine)', () => {

  describe('1. 策略组环路检测 (detectGroupCycles)', () => {
    it('无环图 (DAG) 正常通过', () => {
      const groups = [
        { name: '自动选择', proxies: ['🇭🇰 香港 01', '🇯🇵 日本 01'] },
        { name: '手动选择', proxies: ['自动选择', '🇭🇰 香港 01'] },
        { name: '流媒体', proxies: ['自动选择', 'DIRECT'] }
      ];
      const result = detectGroupCycles(groups);
      assert.equal(result.hasCycle, false);
      assert.equal(result.cycles.length, 0);
    });

    it('直接循环引用 (A -> B -> A) 准确检出', () => {
      const groups = [
        { name: '组A', proxies: ['组B', '节点1'] },
        { name: '组B', proxies: ['组A', '节点2'] }
      ];
      const result = detectGroupCycles(groups);
      assert.equal(result.hasCycle, true);
      assert.ok(result.cycles.length > 0);
      assert.deepEqual(result.cycles[0], ['组A', '组B', '组A']);
    });

    it('传递循环引用 (A -> B -> C -> A) 准确检出', () => {
      const groups = [
        { name: '组A', proxies: ['组B'] },
        { name: '组B', proxies: ['组C'] },
        { name: '组C', proxies: ['组A'] }
      ];
      const result = detectGroupCycles(groups);
      assert.equal(result.hasCycle, true);
      assert.ok(result.cycles.some(c => c.join('->').includes('组A->组B->组C->组A')));
    });

    it('自引用不构成跨组循环死锁', () => {
      const groups = [
        { name: '组A', proxies: ['组A', '节点1'] }
      ];
      const result = detectGroupCycles(groups);
      assert.equal(result.hasCycle, false);
    });

    it('evaluateCustomTopology 检测到环路死锁严格抛错 (Fail-Closed)', () => {
      const customGroups = [
        { name: '组A', proxies: ['组B'] },
        { name: '组B', proxies: ['组A'] }
      ];
      assert.throws(
        () => evaluateCustomTopology({ customGroups }),
        /\[customGroups\] 检测到策略组存在循环依赖 \(Cycle Dependency\): 组A -> 组B -> 组A/
      );
    });
  });

  describe('2. 宏变量与代理列表解析 (resolveGroupProxies)', () => {
    it('未显式声明 proxies 时默认回退 @matchedNodes', () => {
      const resolved = resolveGroupProxies({
        declaredProxies: [],
        matchedNodeNames: ['节点A', '节点B']
      });
      assert.deepEqual(resolved, ['节点A', '节点B']);
    });

    it('宏替换 (@matchedNodes, @residential, @allStandard, @defaultProxy, @activeRegions)', () => {
      const declared = [
        '@residential',
        '@matchedNodes',
        '@defaultProxy',
        '香港节点',
        '@activeRegions',
        'DIRECT'
      ];
      const macroContext = {
        residential: ['家宽1'],
        allStandard: ['标节1', '标节2'],
        activeRegions: ['香港节点', '日本节点'],
        defaultProxy: '自动选择'
      };
      const matchedNodeNames = ['匹配节1'];

      const resolved = resolveGroupProxies({
        declaredProxies: declared,
        matchedNodeNames,
        macroContext
      });

      assert.deepEqual(resolved, [
        '家宽1',
        '匹配节1',
        '自动选择',
        '香港节点',
        '日本节点',
        'DIRECT'
      ]);
    });

    it('宏替换 (@standardOptions, @residentialGroup)', () => {
      const declared = ['@residentialGroup', '@matchedNodes', '@standardOptions', 'DIRECT'];
      const macroContext = {
        residentialGroup: ['家宽优选'],
        standardOptions: ['自动选择', '手动选择', '故障转移', '香港节点']
      };
      const matchedNodeNames = ['节点A'];

      const resolved = resolveGroupProxies({
        declaredProxies: declared,
        matchedNodeNames,
        macroContext
      });

      assert.deepEqual(resolved, [
        '家宽优选',
        '节点A',
        '自动选择',
        '手动选择',
        '故障转移',
        '香港节点',
        'DIRECT'
      ]);
    });

    it('重复项保序去重', () => {
      const declared = ['DIRECT', '@matchedNodes', 'DIRECT', '自动选择', '自动选择'];
      const resolved = resolveGroupProxies({
        declaredProxies: declared,
        matchedNodeNames: ['节点1', 'DIRECT']
      });
      assert.deepEqual(resolved, ['DIRECT', '节点1', '自动选择']);
    });

    it('大洲与次大区宏替换 (@asia, @europe, @americas, @sea, @oceania)', () => {
      const activeRegions = [
        '香港节点',
        '日本节点',
        '新加坡节点',
        '美国节点',
        '德国节点',
        '东南亚节点',
        '其他节点'
      ];
      const macroContext = { activeRegions };

      // 亚洲宏
      const asiaResolved = resolveGroupProxies({
        declaredProxies: ['@asia', 'DIRECT'],
        macroContext
      });
      assert.deepEqual(asiaResolved, ['香港节点', '日本节点', '新加坡节点', '东南亚节点', 'DIRECT']);

      // 欧洲宏
      const euResolved = resolveGroupProxies({
        declaredProxies: ['@europe', 'DIRECT'],
        macroContext
      });
      assert.deepEqual(euResolved, ['德国节点', 'DIRECT']);

      // 美洲宏
      const amResolved = resolveGroupProxies({
        declaredProxies: ['@americas', 'DIRECT'],
        macroContext
      });
      assert.deepEqual(amResolved, ['美国节点', 'DIRECT']);

      // 东南亚次大区宏
      const seaResolved = resolveGroupProxies({
        declaredProxies: ['@sea', 'DIRECT'],
        macroContext
      });
      assert.deepEqual(seaResolved, ['新加坡节点', '东南亚节点', 'DIRECT']);
    });
  });

  describe('3. 单个策略组定义求解 (evaluateGroupDefinition)', () => {
    const mockNodes = [
      {
        proxy: { name: '🇭🇰 香港 01' },
        rawName: '🇭🇰 香港 01',
        regionInfo: { id: 'hk', name: '香港' },
        tags: ['streaming'],
        attrs: { multiNum: 1.0 }
      },
      {
        proxy: { name: '🇯🇵 日本 01' },
        rawName: '🇯🇵 日本 01',
        regionInfo: { id: 'jp', name: '日本' },
        tags: ['streaming'],
        attrs: { multiNum: 1.0 }
      },
      {
        proxy: { name: '🇺🇸 美国 01' },
        rawName: '🇺🇸 美国 01',
        regionInfo: { id: 'us', name: '美国' },
        tags: ['download'],
        attrs: { multiNum: 0.5 }
      }
    ];

    it('select 组装配与 match 动态节点筛选', () => {
      const groupDef = {
        name: '流媒体精选',
        type: 'select',
        match: {
          region: ['hk', 'jp']
        },
        proxies: ['@matchedNodes', 'DIRECT']
      };

      const result = evaluateGroupDefinition(groupDef, {
        classifiedNodes: mockNodes
      });

      assert.equal(result.name, '流媒体精选');
      assert.equal(result.type, 'select');
      assert.deepEqual(result.proxies, ['🇭🇰 香港 01', '🇯🇵 日本 01', 'DIRECT']);
    });

    it('url-test 测速组与原生字段透传', () => {
      const groupDef = {
        name: '自动优选',
        type: 'url-test',
        url: 'https://test.com/generate_204',
        interval: 180,
        tolerance: 30,
        lazy: false,
        match: {
          tags: ['streaming']
        }
      };

      const result = evaluateGroupDefinition(groupDef, {
        classifiedNodes: mockNodes
      });

      assert.equal(result.name, '自动优选');
      assert.equal(result.type, 'url-test');
      assert.equal(result.url, 'https://test.com/generate_204');
      assert.equal(result.interval, 180);
      assert.equal(result.tolerance, 30);
      assert.equal(result.lazy, false);
      assert.deepEqual(result.proxies, ['🇭🇰 香港 01', '🇯🇵 日本 01']);
    });

    it('fallback 与 load-balance 类型透传', () => {
      const fbDef = { name: '备用策略', type: 'fallback' };
      const lbDef = { name: '均衡策略', type: 'load-balance', strategy: 'round-robin' };

      const fb = evaluateGroupDefinition(fbDef);
      const lb = evaluateGroupDefinition(lbDef);

      assert.equal(fb.type, 'fallback');
      assert.equal(lb.type, 'load-balance');
      assert.equal(lb.strategy, 'round-robin');
    });

    it('原生扩展字段透传 (hidden, filter, exclude-filter)', () => {
      const groupDef = {
        name: '专属ChatGPT',
        type: 'select',
        hidden: true,
        filter: '(?i)openai',
        'exclude-filter': '(?i)free'
      };

      const result = evaluateGroupDefinition(groupDef);
      assert.equal(result.hidden, true);
      assert.equal(result.filter, '(?i)openai');
      assert.equal(result['exclude-filter'], '(?i)free');
    });

    it('无名称或空对象安全返回 null', () => {
      assert.equal(evaluateGroupDefinition(null), null);
      assert.equal(evaluateGroupDefinition({}), null);
      assert.equal(evaluateGroupDefinition({ name: '   ' }), null);
    });
  });

  describe('4. 批量求解自定义拓扑 (evaluateCustomTopology)', () => {
    it('批量求解多策略组并正常返回', () => {
      const customGroups = [
        {
          name: '香港优选',
          type: 'url-test',
          match: { region: 'hk' }
        },
        {
          name: '美国优选',
          type: 'select',
          match: { region: 'us' },
          proxies: ['@matchedNodes', '香港优选', 'DIRECT']
        }
      ];

      const classifiedNodes = [
        { proxy: { name: '🇭🇰 港1' }, regionInfo: { id: 'hk' } },
        { proxy: { name: '🇺🇸 美1' }, regionInfo: { id: 'us' } }
      ];

      const { evaluatedGroups, cycles } = evaluateCustomTopology({
        customGroups,
        classifiedNodes
      });

      assert.equal(evaluatedGroups.length, 2);
      assert.equal(evaluatedGroups[0].name, '香港优选');
      assert.deepEqual(evaluatedGroups[0].proxies, ['🇭🇰 港1']);
      assert.equal(evaluatedGroups[1].name, '美国优选');
      assert.deepEqual(evaluatedGroups[1].proxies, ['🇺🇸 美1', '香港优选', 'DIRECT']);
      assert.equal(cycles.length, 0);
    });

    it('异常策略组不阻断整体批次 (Fail-Safe)', () => {
      const customGroups = [
        null,
        { name: '正常组', proxies: ['DIRECT'] },
        { /* 缺失 name */ type: 'select' }
      ];

      const { evaluatedGroups } = evaluateCustomTopology({ customGroups });
      assert.equal(evaluatedGroups.length, 1);
      assert.equal(evaluatedGroups[0].name, '正常组');
    });
  });

});
