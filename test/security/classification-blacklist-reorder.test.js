const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  markTrustedSynthetic,
  isTrustedSynthetic,
  sanitizeExternalProxy,
  sanitizeExternalProxies
} = require('../../src/core/node-trust');
const {
  classifyNode,
  checkNodeBlockReason,
  matchUserBlacklist
} = require('../../src/core/cleaner');
const {
  isNoticeNode,
  hasOnlyPlaceholderNodes
} = require('../../src/core/notice');
const { dedupeNodes } = require('../../src/core/dedupe');
const { sortNodes } = require('../../src/core/sort');
const { runNodesPipeline } = require('../../src/pipeline/nodes');
const {
  generateInfoNodes,
  buildGlobalDashboardNodes,
  createFetchErrorNode,
  filterRawInfoNodes
} = require('../../src/strategy/dashboard');

describe('【Security】安全分类、内部 Synthetic 信任来源与黑名单顺序重构', () => {

  describe('1. 内部 Synthetic 信任来源与外部伪造防御', () => {
    it('外部节点伪造 isSyntheticInfo / _synthetic 绝不获得 synthetic 豁免', async () => {
      // 1.1 伪造 synthetic 且结构非法 (缺少端口 / 假IP) ➔ 必须走普通硬结构校验并拦截
      const fakeIllegalProxy = {
        name: '外部伪造节点01',
        server: '',
        port: null,
        isSyntheticInfo: true,
        _synthetic: true
      };
      assert.equal(isTrustedSynthetic(fakeIllegalProxy), false, '外部伪造对象不属于可信集合');

      const classifiedIllegal = classifyNode(fakeIllegalProxy);
      assert.equal(classifiedIllegal.skip, true);
      assert.equal(classifiedIllegal.blockReason, '假IP', '非法外部伪造节点必须被假IP硬校验拦截');

      // 1.2 伪造 synthetic 且带有假密码
      const fakeDummyAuthProxy = {
        name: '外部伪造节点02',
        server: '1.2.3.4',
        port: 443,
        password: 'password',
        isSyntheticInfo: true
      };
      const classifiedDummy = classifyNode(fakeDummyAuthProxy);
      assert.equal(classifiedDummy.skip, true);
      assert.equal(classifiedDummy.blockReason, '假密码', '外部伪造节点绝不能豁免弱口令拦截');

      // 1.3 伪造 synthetic 且带有真实参数 ➔ 绝不能免去重，必须走正常物理去重
      const fakeP1 = {
        name: '🇭🇰 香港 01 伪造看板',
        type: 'ss',
        server: '1.2.3.4',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'real_password',
        isSyntheticInfo: true
      };
      const fakeP2 = {
        name: '🇭🇰 香港 02 伪造看板同IP',
        type: 'ss',
        server: '1.2.3.4',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'real_password',
        isSyntheticInfo: true
      };
      const dedupedFake = dedupeNodes([fakeP1, fakeP2]);
      assert.equal(dedupedFake.length, 1, '外部伪造 synthetic 节点必须接受物理指纹去重');

      // 1.4 runNodesPipeline 端到端：伪造 synthetic 且合法 ➔ 正常按普通节点分类与重命名
      const pipelineRes = await runNodesPipeline([fakeP1], { enableNodeRename: true });
      assert.equal(pipelineRes.length, 1);
      assert.ok(pipelineRes[0].name.includes('香港'), '外部合法节点正常参与重命名');
      assert.ok(!pipelineRes[0].name.includes('伪造看板'));

      // 1.5 外部伪造对象在 sortNodes 中绝不置顶
      const sortedRes = sortNodes([
        { rawName: '🇭🇰 香港 01', regionInfo: { id: 'hk', name: '香港' } },
        { rawName: '🇺🇸 美国 01 伪造看板', isSyntheticInfo: true, regionInfo: { id: 'us', name: '美国' } }
      ]);
      assert.equal(sortedRes[0].regionInfo.name, '香港', '未受信伪造对象绝不置顶');

      // 1.6 纯看板判定：只有真实代理为 0 且仅剩受信看板时才是 isZeroNode
      const onlyFakeProxy = [fakeP1];
      const realProxies = onlyFakeProxy.filter(p => !isTrustedSynthetic(p));
      assert.equal(realProxies.length, 1, '伪造 synthetic 节点被视为真实代理，不会触发纯分流拦截模式');
    });

    it('sanitizeExternalProxy 消毒防篡改：浅拷贝移除内部保留字段，原对象绝对不变', () => {
      const rawSharedFromParser = {
        name: '外部原始节点',
        server: '1.2.3.4',
        port: 443,
        isSyntheticInfo: true,
        _synthetic: true,
        _keepName: true,
        _subTag: 'malicious-tag',
        _indexPrefix: '99',
        _customGroups: ['admin'],
        _cleaned: true
      };

      const sanitized = sanitizeExternalProxy(rawSharedFromParser);

      // 原对象绝对未被原地修改
      assert.equal(rawSharedFromParser.isSyntheticInfo, true);
      assert.equal(rawSharedFromParser._keepName, true);
      assert.equal(rawSharedFromParser._subTag, 'malicious-tag');

      // 消毒产物是独立浅拷贝，明确列出的内部保留字段已被彻底剥离
      assert.notEqual(sanitized, rawSharedFromParser);
      assert.equal(sanitized.name, '外部原始节点');
      assert.equal(sanitized.server, '1.2.3.4');
      assert.equal(sanitized.port, 443);
      assert.equal(sanitized.isSyntheticInfo, undefined);
      assert.equal(sanitized._synthetic, undefined);
      assert.equal(sanitized._keepName, undefined);
      assert.equal(sanitized._subTag, undefined);
      assert.equal(sanitized._indexPrefix, undefined);
      assert.equal(sanitized._customGroups, undefined);
      assert.equal(sanitized._cleaned, undefined);

      // 无内部保留字段的对象应直接返回原引用（避免无谓拷贝）
      const cleanRaw = { name: '干净节点', server: '2.2.2.2', port: 443 };
      assert.equal(sanitizeExternalProxy(cleanRaw), cleanRaw);
    });

    it('内部生成的各类 synthetic 节点仍正确进入看板，并保持既有输出行为', async () => {
      // 2.1 generateInfoNodes
      const subInfo = 'upload=1073741824; download=2147483648; total=10737418240; expire=1893456000';
      const { nodes: synthNodes } = generateInfoNodes(subInfo, '机场A');
      assert.ok(synthNodes.length >= 2);
      synthNodes.forEach(node => {
        assert.equal(isTrustedSynthetic(node), true, 'generateInfoNodes 产物必须可信');
      });

      // 2.2 buildGlobalDashboardNodes
      const globalNodes = buildGlobalDashboardNodes({
        globalUpload: 1000,
        globalDownload: 2000,
        globalTotal: 100000,
        globalExpire: 1893456000
      });
      assert.ok(globalNodes.length >= 2);
      globalNodes.forEach(node => {
        assert.equal(isTrustedSynthetic(node), true, 'buildGlobalDashboardNodes 产物必须可信');
      });

      // 2.3 createFetchErrorNode
      const errNode = createFetchErrorNode('机场B', 'fetch failed');
      assert.equal(isTrustedSynthetic(errNode), true, 'createFetchErrorNode 产物必须可信');

      // 2.4 端到端：受信看板在 runNodesPipeline 中保留且不被重命名，地址规范为 127.0.0.1:80
      const output = await runNodesPipeline([...synthNodes], { enableDashboard: true });
      assert.equal(output.length, synthNodes.length);
      output.forEach(node => {
        assert.equal(node.server, '127.0.0.1');
        assert.equal(node.port, 80);
      });

      // 2.5 看板关闭时，受信看板被过滤
      const outputDisabled = await runNodesPipeline([...synthNodes], { enableDashboard: false });
      assert.equal(outputDisabled.length, 0);
    });
  });

  describe('2. 用户黑名单必须先于物理去重', () => {
    it('相同物理指纹的黑名单节点绝不能抢先去重掉后续正常节点', async () => {
      // 场景：节点1 命中用户黑名单关键词，节点2 为合法正常节点，两者具备完全一致的物理连接指纹
      const blockedFirst = {
        name: '包含关键字广告_强制拦截',
        type: 'ss',
        server: '104.28.1.1',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'same_password_fingerprint'
      };
      const normalSecond = {
        name: '🇭🇰 香港 01 优质专线',
        type: 'ss',
        server: '104.28.1.1',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'same_password_fingerprint'
      };

      const result = await runNodesPipeline([blockedFirst, normalSecond], {
        blockKeywords: ['强制拦截'],
        enableDedupe: true,
        withClassified: true
      });

      // 验证：黑名单节点1 被拦截丢弃；正常节点2 绝不能被先去重掉，而是被成功保留并清洗输出！
      assert.equal(result.proxies.length, 1, '必须产出 1 个正常节点');
      assert.ok(result.proxies[0].name.includes('香港'), '输出的必须是正常香港节点');
      assert.equal(result.meta.stats.discardedCount, 1, '丢弃计数正确记录黑名单拦截');
      assert.equal(result.meta.stats.dedupeCount, 0, '去重计数为 0 (正常节点未被重复剔除)');
    });

    it('反例对照：当两者均未命中黑名单时，物理去重正常剔除后出现项', async () => {
      const nodeA = {
        name: '🇭🇰 香港 01',
        type: 'ss',
        server: '104.28.1.1',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'same_password_fingerprint'
      };
      const nodeB = {
        name: '🇭🇰 香港 02',
        type: 'ss',
        server: '104.28.1.1',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'same_password_fingerprint'
      };

      const result = await runNodesPipeline([nodeA, nodeB], {
        enableDedupe: true,
        withClassified: true
      });

      assert.equal(result.proxies.length, 1);
      assert.equal(result.meta.stats.dedupeCount, 1, '去重正常工作');
      assert.equal(result.meta.stats.discardedCount, 0);
    });

    it('用户黑名单优先于 whitelist、special、notice 和 synthetic', async () => {
      const cfg = {
        blockKeywords: ['拦截关键词'],
        blockServers: ['blocked.server.net']
      };

      // 白名单命中黑名单
      const whiteBlocked = {
        name: '自建专线 拦截关键词',
        server: '1.2.3.4',
        port: 443
      };
      const whiteRes = classifyNode(whiteBlocked, { ...cfg, whitelistKeywords: ['自建'] });
      assert.equal(whiteRes.skip, true);
      assert.equal(whiteRes.blockReason, '黑名单关键词');

      // special 命中黑名单服务器
      const specialBlocked = {
        name: '专有节点',
        server: 'blocked.server.net',
        port: 443
      };
      const specialRes = classifyNode(specialBlocked, {
        ...cfg,
        specialNodeRules: [{ reg: /专有/, targetName: '专有' }]
      });
      assert.equal(specialRes.skip, true);
      assert.equal(specialRes.blockReason, '黑名单服务器');

      // notice 命中黑名单
      const noticeBlocked = {
        name: '套餐到期通知 拦截关键词',
        server: '127.0.0.1',
        port: 80
      };
      const noticeRes = classifyNode(noticeBlocked, cfg);
      assert.equal(noticeRes.skip, true);
      assert.equal(noticeRes.blockReason, '黑名单关键词');

      // synthetic 看板命中黑名单服务器
      const synthBlocked = markTrustedSynthetic({
        name: '📊 状态看板',
        server: 'blocked.server.net',
        port: 80,
        isSyntheticInfo: true
      });
      const synthRes = classifyNode(synthBlocked, cfg);
      assert.equal(synthRes.skip, true);
      assert.equal(synthRes.blockReason, '黑名单服务器');
    });

    it('黑名单服务器匹配在 DNS 裂变前后均有效，且不改变现有字面量匹配语义', async () => {
      // 1. 裂变前命中 blockServers 直接阻断，不进入裂变
      const preFissionBlocked = {
        name: '🇯🇵 日本 01',
        server: 'bad-domain.com',
        port: 443
      };
      const resPre = await runNodesPipeline([preFissionBlocked], {
        blockServers: ['bad-domain.com'],
        withClassified: true
      });
      assert.equal(resPre.proxies.length, 0);
      assert.equal(resPre.meta.stats.discardedCount, 1);

      // 2. 裂变后命中：域名未在黑名单，但解析后的特定 IP 命中 blockServers
      // 在 runNodesPipeline 中模拟已解析后的裂变节点
      const fissionResolvedBlocked = {
        name: '🇯🇵 日本 01-1',
        server: '185.199.108.153',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'valid_password_ok'
      };
      const fissionResolvedOk = {
        name: '🇯🇵 日本 01-2',
        server: '185.199.109.153',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'valid_password_ok'
      };
      const resPost = await runNodesPipeline([fissionResolvedBlocked, fissionResolvedOk], {
        blockServers: ['185.199.108.153'],
        withClassified: true
      });
      assert.equal(resPost.proxies.length, 1);
      assert.equal(resPost.proxies[0].server, '185.199.109.153');
      assert.equal(resPost.meta.stats.discardedCount, 1);

      // 3. 字面量匹配包含语义测试 (不改变现有 matchUserBlacklist 行为)
      assert.equal(matchUserBlacklist({ server: 'sub.target.com' }, 'test', { blockServers: ['target.com'] }), '黑名单服务器');
      assert.equal(matchUserBlacklist({ server: 'other.com' }, 'test', { blockServers: ['target.com'] }), '');
    });
  });

  describe('3. 分类与硬结构校验边界', () => {
    it('whitelist 与 special 节点仍必须满足合法 server、整数端口 1-65535 和非占位密码', () => {
      const whiteCfg = { whitelistKeywords: ['自建'] };

      // 空 server 拦截
      assert.equal(classifyNode({ name: '自建节点', server: '', port: 443 }, whiteCfg).blockReason, '假IP');

      // 缺少端口 / 非法端口拦截
      assert.equal(classifyNode({ name: '自建节点', server: '1.2.3.4' }, whiteCfg).blockReason, '假IP');
      assert.equal(classifyNode({ name: '自建节点', server: '1.2.3.4', port: 0 }, whiteCfg).blockReason, '假IP');
      assert.equal(classifyNode({ name: '自建节点', server: '1.2.3.4', port: 'abc' }, whiteCfg).blockReason, '假IP');
      assert.equal(classifyNode({ name: '自建节点', server: '1.2.3.4', port: 70000 }, whiteCfg).blockReason, '假IP');

      // 占位弱口令拦截
      assert.equal(classifyNode({ name: '自建节点', server: '1.2.3.4', port: 443, password: 'password' }, whiteCfg).blockReason, '假密码');
      assert.equal(classifyNode({ name: '自建节点', server: '1.2.3.4', port: 443, password: '123456' }, whiteCfg).blockReason, '假密码');
      assert.equal(classifyNode({ name: '自建节点', server: '1.2.3.4', port: 443, uuid: '00000000-0000-0000-0000-000000000000' }, whiteCfg).blockReason, '假密码');

      // 合法结构且命中白名单：放行并直接交付，豁免广告词与模板重命名
      const legalSpecial = classifyNode({
        name: '自建节点 防失联地址发布页',
        server: '1.2.3.4',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'genuine_password'
      }, whiteCfg);
      assert.equal(legalSpecial.isSpecial, true);
      assert.equal(legalSpecial.skip, undefined);
    });

    it('弱公告词搭配真实代理参数时绝不误杀；占位公告依配置过滤', () => {
      // 1. 弱公告词搭配真实代理参数 ➔ 绝不是 notice 节点，必须保留
      const realWithNoticeName = {
        name: '🇭🇰 香港 01 线路维护通知',
        server: 'hk.node.com',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'valid_password'
      };
      assert.equal(isNoticeNode(realWithNoticeName), false, '真实代理参数节点不可判定为 notice');

      const classifiedReal = classifyNode(realWithNoticeName, { removeInfoNodes: true });
      assert.equal(classifiedReal.skip, undefined);
      assert.equal(classifiedReal.isInfo, undefined, '必须作为正常代理节点');

      // 2. 弱公告词搭配占位/回环参数 ➔ 判定为 notice 节点，依 removeInfoNodes 过滤
      const placeholderNotice = {
        name: '🇭🇰 线路维护通知',
        server: '127.0.0.1',
        port: 80
      };
      assert.equal(isNoticeNode(placeholderNotice), true, '占位网络参数节点正确判定为 notice');
      const filteredNotice = classifyNode(placeholderNotice, { removeInfoNodes: true });
      assert.equal(filteredNotice.skip, true);
      assert.equal(filteredNotice.blockReason, '信息说明');

      // 3. 强公告词 (纯流量/到期横幅) 无论挂在什么 server/port 均判定为 notice
      const explicitNoticeWithRealPort = {
        name: '剩余流量：500 GB',
        server: '1.2.3.4',
        port: 443
      };
      assert.equal(isNoticeNode(explicitNoticeWithRealPort), true, '明确的纯流量横幅判定为 notice');
    });

    it('hasOnlyPlaceholderNodes 订阅有效性检查边界：对真实节点与占位节点判定准确', () => {
      // 混合列表：包含真实节点与公告节点 ➔ 判定有服务能力 (返回 false)
      const mixed = [
        { name: '到期时间：2026-12-31', server: '127.0.0.1', port: 80 },
        { name: '🇭🇰 香港 01 官网通知', server: 'hk.node.com', port: 443, password: 'p1' }
      ];
      assert.equal(hasOnlyPlaceholderNodes(mixed), false);

      // 全占位列表 ➔ 判定无可用代理 (返回 true)
      const allPlaceholders = [
        { name: '剩余流量：100G', server: '1.0.0.1', port: 80 },
        { name: '套餐到期：2026-12-31', server: '127.0.0.1', port: 80 },
        { name: '官网地址：https://example.com', server: '0.0.0.0', port: 80 }
      ];
      assert.equal(hasOnlyPlaceholderNodes(allPlaceholders), true);

      // 外部伪造 isSyntheticInfo 节点不能影响占位判定
      const forgedPlaceholders = [
        { name: '剩余流量：100G', server: '1.0.0.1', port: 80, isSyntheticInfo: true }
      ];
      assert.equal(hasOnlyPlaceholderNodes(forgedPlaceholders), true, '外部伪造 synthetic 仍被识别为占位节点');

      // 内部受信 synthetic 看板节点不参与占位判定 (isNoticePlaceholderNode 为 false)
      const trustedSynth = [
        markTrustedSynthetic({ name: '剩余流量：100G', server: '1.0.0.1', port: 80, isSyntheticInfo: true })
      ];
      assert.equal(hasOnlyPlaceholderNodes(trustedSynth), false, '内部受信看板节点不属于原生占位');
    });
  });
});
