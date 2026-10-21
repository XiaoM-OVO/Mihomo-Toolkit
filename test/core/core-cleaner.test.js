const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeNodeName,
  checkNodeBlockReason,
  classifyNode
} = require('../../src/core/cleaner');
const { extractNodeAttributes } = require('../../src/core/metadata');
const {
  isNoticePlaceholderNode,
  hasOnlyPlaceholderNodes
} = require('../../src/core/notice');
const { markTrustedSynthetic, markTrustedProxyMetadata } = require('../../src/core/node-trust');
const { buildServiceCatalog } = require('../../src/config/catalog');

describe('【Core】节点清洗与属性提取 (cleaner)', () => {
  it('sanitizeNodeName - 基础字符与广告词过滤', () => {
    const dirty = '\u200B  🇭🇰 香港 01   \uFEFF';
    assert.equal(sanitizeNodeName(dirty), '🇭🇰 香港 01');

    const withAd = '🇭🇰 香港 01 官网: http://test.com 严禁BT';
    const sanitized = sanitizeNodeName(withAd);
    assert.ok(!sanitized.includes('http://test.com'));
    assert.ok(!sanitized.includes('严禁BT'));
  });

  it('extractNodeAttributes - 属性提取 (倍率 / 线路 / 入口)', () => {
    const { attrs } = extractNodeAttributes('深-港 IEPL x2.0 电信 联通');
    assert.equal(attrs.multiNum, 2.0);
    assert.equal(attrs.multiStr, 'x2');
    assert.equal(attrs.entryStr, '深');
    assert.ok(attrs.cleanLines.includes('IEPL'));
    assert.ok(attrs.cleanLines.includes('电联'));
    assert.equal(attrs.bestLineWeight, 1); // IEPL 最高优先级
  });

  it('extractNodeAttributes - 属性提取回归 (入口连接符、倍字倍率与线路词)', () => {
    for (const name of ['深→港', '深 港', '深至港', '深=>港', '深~>港']) {
      assert.equal(extractNodeAttributes(name).attrs.entryStr, '深', name);
    }
    const multiplier = extractNodeAttributes('🇭🇰 香港 01 - 1.5倍');
    assert.equal(multiplier.attrs.multiNum, 1.5);
    assert.ok(!multiplier.cleanName.includes('1.5倍'));
    for (const name of ['中转', '隧道']) {
      assert.ok(extractNodeAttributes('🇭🇰 香港 ' + name).attrs.cleanLines.includes(name));
    }
  });

  it('checkNodeBlockReason - 阻断与垃圾拦截 (假IP / 假密码 / 广告词)', () => {
    const fakeIpProxy = { server: '127.0.0.1', port: 8080 };
    assert.equal(checkNodeBlockReason(fakeIpProxy, 'Test'), '假IP');

    const rfc1918Proxy = { server: '172.20.0.1', port: 443 };
    assert.equal(checkNodeBlockReason(rfc1918Proxy, 'Test'), '假IP');

    const cgnatProxy = { server: '100.64.1.1', port: 443 };
    assert.equal(checkNodeBlockReason(cgnatProxy, 'Test'), '假IP');

    const ipv6PrivateProxy = { server: '[fc00::1]', port: 443 };
    assert.equal(checkNodeBlockReason(ipv6PrivateProxy, 'Test'), '假IP');

    const dummyProxy = { server: '1.2.3.4', port: 443, password: 'password' };
    assert.equal(checkNodeBlockReason(dummyProxy, 'Test'), '假密码');

    const adProxy = { server: '1.2.3.4', port: 443 };
    assert.equal(checkNodeBlockReason(adProxy, '防失联地址发布页点击关注'), '广告词');
  });

  it('classifyNode - 用户黑名单拦截 (blockKeywords / blockServers 优先于白名单)', () => {
    const cfg = { blockKeywords: ['免费领取'], blockServers: ['bad.example.com'] };

    const byName = classifyNode({ name: '🇭🇰 香港01 免费领取', server: '1.2.3.4', port: 443 }, cfg);
    assert.ok(byName.skip);
    assert.equal(byName.blockReason, '黑名单关键词');

    const byServer = classifyNode({ name: '🇭🇰 香港01', server: 'bad.example.com', port: 443 }, cfg);
    assert.ok(byServer.skip);
    assert.equal(byServer.blockReason, '黑名单服务器');

    // 黑名单优先于白名单：同时命中时以拦截为准
    const both = classifyNode(
      { name: 'x-ray 节点', server: '1.2.3.4', port: 443 },
      { whitelistKeywords: ['x-ray'], blockKeywords: ['x-ray'] }
    );
    assert.ok(both.skip);
    assert.equal(both.blockReason, '黑名单关键词');
  });

  it('classifyNode - 综合分类打标 (地区 / 业务标签 / 虚拟信息节点 / 白名单节点)', () => {
    const hkProxy = {
      name: '🇭🇰 香港 01 BGP 4K流媒体',
      server: '1.2.3.4',
      port: 443,
      type: 'vless',
      uuid: 'uuid-1'
    };
    const defaultCatalog = buildServiceCatalog();
    const result = classifyNode(hkProxy, { catalog: defaultCatalog });
    assert.ok(!result.skip);
    assert.ok(result.regionInfo);
    assert.equal(result.groupKey, 'hk');
    assert.ok(result.tags.includes('streaming'));

    // 虚拟信息节点 (内部受信看板)
    const infoProxy = markTrustedSynthetic({
      name: '剩余流量：100G',
      server: '1.0.0.1',
      port: 80,
      isSyntheticInfo: true
    });
    const infoResult = classifyNode(infoProxy);
    assert.equal(infoResult.isInfo, true);
    assert.equal(infoResult.groupKey, 'info');

    // 白名单节点
    const specialProxy = {
      name: '我的专用自建节点',
      server: '1.2.3.4',
      port: 443
    };
    const specialResult = classifyNode(specialProxy, { whitelistKeywords: ['自建'] });
    assert.equal(specialResult.isSpecial, true);
    assert.equal(specialResult.groupKey, 'special');
  });

  it('classifyNode - protocol 与 isUnknownRegion 语义规范', () => {
    const proxy = {
      name: '火星直连节点 01',
      type: 'hysteria2',
      server: '1.2.3.4',
      port: 443
    };
    const result = classifyNode(proxy, {});
    assert.equal(result.protocol, 'hysteria2');
    assert.equal(result.isUnknownRegion, true);
    assert.equal(result.groupKey, 'unknown');
    assert.equal(result.pType, undefined);
    assert.equal(result.isGarbage, undefined);
  });

  it('checkNodeBlockReason - 拒绝按文本长度误杀正常英文/外区节点 (Czech / United States)', () => {
    const czechProxy = { name: 'Czech Republic Relay', server: '89.185.100.1', port: 443 };
    assert.equal(checkNodeBlockReason(czechProxy, czechProxy.name), '');
    const czechClassified = classifyNode(czechProxy);
    assert.equal(czechClassified.skip, undefined);

    const usLongProxy = { name: 'United States West Coast', server: '142.250.190.46', port: 443 };
    assert.equal(checkNodeBlockReason(usLongProxy, usLongProxy.name), '');
    const usClassified = classifyNode(usLongProxy);
    assert.equal(usClassified.skip, undefined);
    assert.equal(usClassified.groupKey, 'us');

    // 确凿的客观垃圾与显式广告仍应被拦截
    assert.equal(checkNodeBlockReason({ server: '127.0.0.1', port: 80 }, 'Normal Name'), '假IP');
    assert.equal(checkNodeBlockReason({ server: '1.2.3.4', port: 443, password: 'password' }, 'Normal Name'), '假密码');
    assert.equal(checkNodeBlockReason({ server: '1.2.3.4', port: 443 }, '防失联地址发布页'), '广告词');
  });

  it('classifyNode - 单字大区与连字符中转节点正确识别落地 (深-港 / 港 / 日 / 美)', () => {
    const hkTransit = classifyNode({ name: '深-港 IEPL x2.0', server: '1.2.3.4', port: 443 });
    assert.equal(hkTransit.skip, undefined);
    assert.equal(hkTransit.isUnknownRegion, false);
    assert.equal(hkTransit.groupKey, 'hk');
    assert.equal(hkTransit.regionInfo?.name, '香港');

    const singleCharNodes = [
      { name: '港 01', expected: 'hk' },
      { name: '日 01', expected: 'jp' },
      { name: '台 01', expected: 'tw' },
      { name: '美 01', expected: 'us' },
      { name: '沪-日 02', expected: 'jp' },
      { name: '京-美 03', expected: 'us' }
    ];

    for (const item of singleCharNodes) {
      const res = classifyNode({ name: item.name, server: '1.2.3.4', port: 443 });
      assert.equal(res.groupKey, item.expected, `节点「${item.name}」应归入「${item.expected}」，实际: ${res.groupKey}`);
    }
  });

  it('classifyNode - 全量收录地区均具备规范小写 groupKey 与 groupName (DE, UK, FR, AU, CA 等统一标准)', () => {
    const nodes = [
      { name: '🇩🇪 德国 法兰克福 01', expected: 'de', expectedGroup: '德国节点' },
      { name: '🇬🇧 英国 伦敦 01', expected: 'uk', expectedGroup: '英国节点' },
      { name: '🇫🇷 法国 巴黎 01', expected: 'fr', expectedGroup: '法国节点' },
      { name: '🇦🇺 澳大利亚 悉尼 01', expected: 'au', expectedGroup: '澳大利亚节点' },
      { name: '🇨🇦 加拿大 多伦多 01', expected: 'ca', expectedGroup: '加拿大节点' },
      { name: '🇮🇳 印度 孟买 01', expected: 'in', expectedGroup: '印度节点' },
      { name: '🇨🇳 中国 深圳 01', expected: 'cn', expectedGroup: '大陆节点' }
    ];
    for (const item of nodes) {
      const res = classifyNode({ name: item.name, server: '1.2.3.4', port: 443 });
      assert.equal(res.groupKey, item.expected, `${item.name} groupKey 应为 ${item.expected}`);
      assert.equal(res.regionInfo.id, item.expected, `${item.name} regionInfo.id 应为 ${item.expected}`);
      assert.equal(res.regionInfo.groupName, item.expectedGroup, `${item.name} groupName 应为 ${item.expectedGroup}`);
    }
  });

  it('extractNodeAttributes - 属性提取增强 (CMIN2 / AS9929 / x64避让 / 多格式入口识别)', () => {
    // 1. CMIN2 完整识别且不被 CMI 截断
    const cmin2 = extractNodeAttributes('香港 CMIN2 01');
    assert.equal(cmin2.attrs.cleanLines, 'CMIN2');
    assert.equal(cmin2.attrs.bestLineWeight, 2);
    assert.ok(!cmin2.cleanName.includes('N2'));

    // 2. AS9929 规范识别
    const as9929 = extractNodeAttributes('美国 AS9929 01');
    assert.equal(as9929.attrs.cleanLines, '9929');

    // 3. x64 / x86 架构词不被误判为倍率
    const archX64 = extractNodeAttributes('测试节点 x64');
    assert.equal(archX64.attrs.multiNum, 1.0);
    assert.equal(archX64.attrs.multiStr, '');

    const archX86 = extractNodeAttributes('测试节点 linux-x86');
    assert.equal(archX86.attrs.multiNum, 1.0);
    assert.equal(archX86.attrs.multiStr, '');

    // 真实 64倍 仍应被支持 (带明确倍率语义)
    const realMulti = extractNodeAttributes('测试节点 64倍');
    assert.equal(realMulti.attrs.multiNum, 1.0); // > 50 被安全守护

    // 4. 双字及 IATA 入口城市精准提取
    const entries = [
      { name: '深圳-香港 01', expected: '深' },
      { name: '广州-香港 01', expected: '广' },
      { name: '北京-美国 01', expected: '京' },
      { name: 'SZX-HK 01', expected: '深' },
      { name: 'CAN-HK 01', expected: '广' },
      { name: '穗-港 01', expected: '广' },
      { name: '上海-日本 01', expected: '沪' }
    ];

    for (const e of entries) {
      const { attrs } = extractNodeAttributes(e.name);
      assert.equal(attrs.entryStr, e.expected, `入口「${e.name}」应识别为「${e.expected}」，实际: ${attrs.entryStr}`);
    }
  });

  it('extractNodeAttributes - 运营商组合优先级（三网防吞噬）', () => {
    // 包含电信、联通、移动三网时，优先压缩为「三网」，不降级为「电联」
    const res = extractNodeAttributes('香港 电信 联通 移动 01');
    assert.deepEqual(res.attrs.lineArr, ['三网']);
    assert.equal(res.attrs.cleanLines, '三网');

    // 两网时按对应两网压缩
    assert.deepEqual(extractNodeAttributes('香港 电信 联通 01').attrs.lineArr, ['电联']);
    assert.deepEqual(extractNodeAttributes('香港 移动 联通 01').attrs.lineArr, ['移联']);
    assert.deepEqual(extractNodeAttributes('香港 电信 移动 01').attrs.lineArr, ['电移']);
  });

  it('classifyNode - 严禁BT节点仍属低倍率池，且不再包含已删除的 forbidDownload 标签', () => {
    const forbidNode = { name: '🇭🇰 香港 01 x0.2 严禁BT', server: '1.2.3.4', port: 443 };
    const forbidRes = classifyNode(forbidNode, { lowMultiThreshold: 0.5, enableIsolation: true });
    assert.ok(forbidRes.tags.includes('lowMulti'), '低倍率身份正常识别');
    assert.ok(!forbidRes.tags.includes('forbidDownload'), '已删除 forbidDownload 标签');
    assert.equal(forbidRes.isolateBucket, 'lowMulti', '低倍率节点进入低倍率隔离桶');

    // 正常低倍率节点
    const normalNode = { name: '🇭🇰 香港 01 x0.2 高速', server: '1.2.3.4', port: 443 };
    const normalRes = classifyNode(normalNode, { lowMultiThreshold: 0.5, enableIsolation: true });
    assert.ok(normalRes.tags.includes('lowMulti'));
    assert.equal(normalRes.isolateBucket, 'lowMulti');
  });

  it('classifyNode - 单字大区避让常见中文词 (日常/新建/完美 不误判为海外地区)', () => {
    const cases = [
      { name: '香港 日用 01', expected: 'hk' },
      { name: '香港 日常 01', expected: 'hk' },
      { name: '台湾 日常 01', expected: 'tw' },
      { name: '美国 新建 01', expected: 'us' },
      { name: '香港 新节点 01', expected: 'hk' },
      { name: '香港 完美 01', expected: 'hk' },
      { name: '日常节点 01', expected: 'unknown' }
    ];

    for (const c of cases) {
      const res = classifyNode({ name: c.name, server: '1.2.3.4', port: 443 });
      assert.equal(res.groupKey, c.expected, `节点「${c.name}」应归入「${c.expected}」，实际: ${res.groupKey}`);
    }
  });

  it('稳健性防御 - 假IP/非法端口/空服务/0倍率/非数组入参/自建内网节点', () => {
    // 1. 0倍率 / 0x 节点支持
    const zeroMulti = extractNodeAttributes('香港 01 0倍率', { lowMultiThreshold: 0.5 });
    assert.equal(zeroMulti.attrs.multiNum, 0);
    assert.equal(zeroMulti.attrs.multiStr, 'x0');
    assert.equal(zeroMulti.attrs.isLowMulti, true);

    const zeroX = extractNodeAttributes('香港 01 x0', { lowMultiThreshold: 0.5 });
    assert.equal(zeroX.attrs.multiNum, 0);
    assert.equal(zeroX.attrs.isLowMulti, true);

    // 4X4 不被误识别为倍率 4
    const mimo = extractNodeAttributes('香港 4X4 01');
    assert.equal(mimo.attrs.multiNum, 1);
    assert.equal(mimo.attrs.multiStr, '');

    // 2. null / 无效入参防御
    const nullRes = classifyNode(null);
    assert.equal(nullRes.skip, true);
    assert.equal(nullRes.blockReason, '无效节点数据');

    // 3. 配置入参类型防御 (非数组安全归一化)
    const strCfgRes = classifyNode(
      { name: '测试节点 01', server: '1.2.3.4', port: 443 },
      { blockKeywords: '测试', whitelistKeywords: '自建' }
    );
    assert.equal(strCfgRes.skip, true);
    assert.equal(strCfgRes.blockReason, '黑名单关键词');

    // 4. 空服务与非法端口拦截
    assert.equal(checkNodeBlockReason({ server: '', port: 443 }, 'Normal'), '假IP');
    assert.equal(checkNodeBlockReason({ server: '1.2.3.4', port: 0 }, 'Normal'), '假IP');
    assert.equal(checkNodeBlockReason({ server: '1.2.3.4', port: '0' }, 'Normal'), '假IP');
    assert.equal(checkNodeBlockReason({ server: '1.2.3.4', port: 70000 }, 'Normal'), '假IP');
    assert.equal(checkNodeBlockReason({ server: '1.2.3.4', port: -1 }, 'Normal'), '假IP');

    // 5. keepName 自建内网节点放行 (局域网/Tailscale IP)
    assert.equal(checkNodeBlockReason(markTrustedProxyMetadata({ server: '192.168.1.1', port: 7890 }, { keepName: true }), 'LAN'), '');
    assert.equal(checkNodeBlockReason(markTrustedProxyMetadata({ server: '100.64.0.1', port: 443 }, { keepName: true }), 'Tailscale'), '');
    // 未开启 keepName 时仍受假IP规则保护
    assert.equal(checkNodeBlockReason({ server: '192.168.1.1', port: 7890 }, 'LAN'), '假IP');

    // 6. 1.0.0.1 占位节点判定
    assert.equal(isNoticePlaceholderNode({ name: '套餐已到期，请续费', server: '1.0.0.1', port: 80 }), true);
  });

  it('广告与特征边界 - Telegram短链清理 / 单词边界 / 版本号防误判', () => {
    // 1. Telegram 短链与 URL Path 清理
    const tgUrl = '香港 01 https://t.me/my_channel 严禁BT';
    const tgClean = sanitizeNodeName(tgUrl);
    assert.ok(!tgClean.includes('t.me'));
    assert.ok(!tgClean.includes('my_channel'));

    const bareTg = '香港 01 t.me/my_channel';
    assert.equal(sanitizeNodeName(bareTg), '香港 01');

    const pathUrl = '香港 01 https://test.com/aff/123';
    assert.equal(sanitizeNodeName(pathUrl), '香港 01');

    // 2. 英文特征词边界防护 (Whisper 不误打 ISP，Node-v6.0 不误打 IPv6)
    const whisperNode = classifyNode({ name: '香港 Whisper 01', server: '1.2.3.4', port: 443 });
    assert.ok(!whisperNode.tags.includes('residential'), 'Whisper 不应被误判为家宽住宅 ISP');

    const versionNode = classifyNode({ name: '香港 Node-v6.0', server: '1.2.3.4', port: 443 });
    assert.ok(!versionNode.tags.includes('ipv6'), 'Node-v6.0 不应被误判为 IPv6');

    const realIpv6Node = classifyNode({ name: '香港 Node v6 01', server: '1.2.3.4', port: 443 });
    assert.ok(realIpv6Node.tags.includes('ipv6'), 'Node v6 01 应正常识别为 IPv6');
  });

  describe('【Core】清洗规则收敛与公告节点处理专项', () => {
    it('黑名单优先：对 synthetic / notice / whitelist / normal 均绝对优先拦截', () => {
      const cfg = { blockKeywords: ['强制拦截'], blockServers: ['blocked.server.com'] };

      // 1. synthetic 看板命中黑名单
      const synth = markTrustedSynthetic({ name: '剩余流量：强制拦截', server: '1.0.0.1', port: 80, isSyntheticInfo: true });
      const synthRes = classifyNode(synth, cfg);
      assert.equal(synthRes.skip, true);
      assert.equal(synthRes.blockReason, '黑名单关键词');

      // 2. 原生 notice 命中黑名单
      const notice = { name: '套餐到期通知', server: 'blocked.server.com', port: 80 };
      const noticeRes = classifyNode(notice, cfg);
      assert.equal(noticeRes.skip, true);
      assert.equal(noticeRes.blockReason, '黑名单服务器');

      // 3. whitelist 白名单节点命中黑名单
      const whitelistNode = { name: '自建专线 强制拦截', server: '1.2.3.4', port: 443 };
      const whiteRes = classifyNode(whitelistNode, { ...cfg, whitelistKeywords: ['自建'] });
      assert.equal(whiteRes.skip, true);
      assert.equal(whiteRes.blockReason, '黑名单关键词');

      // 4. _keepName 节点命中黑名单
      const keepNode = { name: '局域网 强制拦截', server: '192.168.1.1', port: 7890, _keepName: true };
      const keepRes = classifyNode(keepNode, cfg);
      assert.equal(keepRes.skip, true);
      assert.equal(keepRes.blockReason, '黑名单关键词');
    });

    it('白名单硬结构校验：必须满足有效 server/port 与非占位密码', () => {
      const whiteCfg = { whitelistKeywords: ['自建'] };

      // 缺少端口拦截
      const missingPortNormal = classifyNode({ name: '香港节点', server: '1.2.3.4' });
      assert.equal(missingPortNormal.skip, true);
      assert.equal(missingPortNormal.blockReason, '假IP');

      const missingPortWhite = classifyNode({ name: '自建节点', server: '1.2.3.4' }, whiteCfg);
      assert.equal(missingPortWhite.skip, true);
      assert.equal(missingPortWhite.blockReason, '假IP');

      // 空 server 拦截
      const emptyServer = classifyNode({ name: '自建节点', server: '', port: 443 }, whiteCfg);
      assert.equal(emptyServer.skip, true);
      assert.equal(emptyServer.blockReason, '假IP');

      // 非法端口拦截
      const zeroPort = classifyNode({ name: '自建节点', server: '1.2.3.4', port: 0 }, whiteCfg);
      assert.equal(zeroPort.skip, true);
      assert.equal(zeroPort.blockReason, '假IP');

      const overflowPort = classifyNode({ name: '自建节点', server: '1.2.3.4', port: 70000 }, whiteCfg);
      assert.equal(overflowPort.skip, true);
      assert.equal(overflowPort.blockReason, '假IP');

      // 占位弱口令拦截
      const dummyPass = classifyNode({ name: '自建节点', server: '1.2.3.4', port: 443, password: 'password' }, whiteCfg);
      assert.equal(dummyPass.skip, true);
      assert.equal(dummyPass.blockReason, '假密码');

      // 合法白名单节点：即使包含广告词，通过硬校验后依然豁免广告拦截与模板重命名
      const validWhite = classifyNode(
        { name: '自建节点 最新发布页', server: '1.2.3.4', port: 443, password: 'valid-password' },
        whiteCfg
      );
      assert.equal(validWhite.skip, undefined);
      assert.equal(validWhite.isSpecial, true);
      assert.equal(validWhite.groupKey, 'special');
    });

    it('synthetic 看板与 removeInfoNodes 行为矩阵', () => {
      // synthetic 节点开启看板保留为 1.0.0.1:80 (统一事实源)
      const synthOn = classifyNode(
        markTrustedSynthetic({ name: '剩余流量：100G', server: '1.0.0.1', port: 80, isSyntheticInfo: true }),
        { enableDashboard: true }
      );
      assert.equal(synthOn.isInfo, true);
      assert.equal(synthOn.isSyntheticInfo, true);
      assert.equal(synthOn.proxy.server, '1.0.0.1');
      assert.equal(synthOn.proxy.port, 80);

      // synthetic 节点关闭看板被跳过
      const synthOff = classifyNode(
        markTrustedSynthetic({ name: '剩余流量：100G', server: '1.0.0.1', port: 80, isSyntheticInfo: true }),
        { enableDashboard: false }
      );
      assert.equal(synthOff.skip, true);
      assert.equal(synthOff.blockReason, '看板关闭');

      // 原生 notice 节点在 removeInfoNodes: true 时被过滤
      const noticeTrue = classifyNode(
        { name: '剩余流量：100G', server: '1.0.0.1', port: 80 },
        { removeInfoNodes: true }
      );
      assert.equal(noticeTrue.skip, true);
      assert.equal(noticeTrue.blockReason, '信息说明');

      // 原生 notice 节点在 removeInfoNodes: false 时被保留为 info
      const noticeFalse = classifyNode(
        { name: '剩余流量：100G', server: '1.0.0.1', port: 80 },
        { removeInfoNodes: false }
      );
      assert.equal(noticeFalse.skip, undefined);
      assert.equal(noticeFalse.isInfo, true);
      assert.equal(noticeFalse.groupKey, 'info');
    });

    it('误杀收敛：线路描述、服务器、电报专线与流媒体状态节点放行', () => {
      const testCases = [
        // 1. 词边界与服务器名称（非客服/失联/发布）
        { name: '极客香港服务器', server: '1.2.3.4', port: 443 },
        { name: '博客日本服务器', server: '1.2.3.4', port: 443 },
        { name: '失效联通 01', server: '1.2.3.4', port: 443 },
        { name: '防火墙失效 01', server: '1.2.3.4', port: 443 },
        { name: '开发一步到位', server: '1.2.3.4', port: 443 },
        // 2. 带宽与路由特性（非推销/价格）
        { name: '香港 01 不限速 10G口', server: '1.2.3.4', port: 443 },
        { name: '日本 02 1G带宽 不限速', server: '1.2.3.4', port: 443 },
        { name: '新加坡 不限速 8折返', server: '1.2.3.4', port: 443 },
        // 3. 电报专用与流媒体状态（非公告说明）
        { name: '香港 01 电报专线', server: '1.2.3.4', port: 443 },
        { name: '香港 01 电报专用', server: '1.2.3.4', port: 443 },
        { name: '香港 01 [Netflix不可用]', server: '1.2.3.4', port: 443 },
        { name: '香港 01 Disney不可用', server: '1.2.3.4', port: 443 },
        { name: '香港 01 IPv6地址', server: '1.2.3.4', port: 443 },
        { name: '香港 01 备用地址', server: '1.2.3.4', port: 443 }
      ];

      for (const item of testCases) {
        const res = classifyNode(item, { removeInfoNodes: true });
        assert.equal(
          res.skip,
          undefined,
          `节点「${item.name}」不应被误拦截，实际拦截原因: ${res.blockReason}`
        );
        assert.notEqual(res.groupKey, 'info', `节点「${item.name}」不应被误判为公告`);
      }
    });

    it('广告与公告正例可靠识别与拦截', () => {
      // 广告词正例拦截
      const adCases = [
        '防失联地址发布页点击关注',
        '最新发布页',
        '📢 官方网址：https://example.com 优惠码9折 点击加入Q群',
        '特惠套餐 9.9元/月',
        '限时大促 5折套餐',
        '联系在线客服',
        '定制节点 01'
      ];
      for (const name of adCases) {
        const res = classifyNode({ name, server: '1.2.3.4', port: 443 });
        assert.equal(res.skip, true, `广告节点「${name}」应被拦截`);
        assert.equal(res.blockReason, '广告词');
      }

      // 公告说明正例拦截
      const noticeCases = [
        { name: '剩余流量：100G', server: '1.0.0.1', port: 80 },
        { name: '套餐到期时间: 2026-12-31', server: '1.0.0.1', port: 80 },
        { name: '本节点维护不可用', server: '1.0.0.1', port: 80 }
      ];
      for (const item of noticeCases) {
        const res = classifyNode(item, { removeInfoNodes: true });
        assert.equal(res.skip, true, `公告节点「${item.name}」应被拦截`);
        assert.equal(res.blockReason, '信息说明');
      }
    });

    it('hasOnlyPlaceholderNodes 订阅有效性判定边界', () => {
      // 场景 1：全部是公告名称，但带真实 server/port 的订阅 ➔ 不应误判为整份无效
      const realWithNoticeNames = [
        { name: '公告：节点迁移通知', server: '104.28.1.1', port: 443 },
        { name: '说明：备用入口', server: '104.28.1.2', port: 443 }
      ];
      assert.equal(
        hasOnlyPlaceholderNodes(realWithNoticeNames),
        false,
        '具备真实物理代理参数的订阅不得被判定为 placeholder-only'
      );

      // 场景 2：仅有无网络参数/占位 IP 的纯公告订阅 ➔ 判定为整份无效
      const dummyOnly = [
        { name: '套餐已到期，请续费', server: '1.0.0.1', port: 80 },
        { name: '剩余流量：0G', server: '127.0.0.1', port: 0 }
      ];
      assert.equal(
        hasOnlyPlaceholderNodes(dummyOnly),
        true,
        '仅含假IP/假端口占位节点的订阅应准确识别为 placeholder-only'
      );
    });

    it('keepName 自建内网节点与私网/占位 IP 边界', () => {
      const keep = (p) => markTrustedProxyMetadata(p, { keepName: true });

      // 1. 局域网与 Tailscale 必须真实解析为私网地址才凭借 keepName 放行
      assert.equal(checkNodeBlockReason(keep({ server: '192.168.1.1', port: 7890 }), 'LAN'), '');
      assert.equal(checkNodeBlockReason(keep({ server: '10.0.0.1', port: 7890 }), 'LAN'), '');
      assert.equal(checkNodeBlockReason(keep({ server: '100.64.0.1', port: 443 }), 'Tailscale'), '');
      assert.equal(checkNodeBlockReason(keep({ server: '127.0.0.1', port: 1080 }), 'Loopback'), '');
      assert.equal(checkNodeBlockReason(keep({ server: 'localhost', port: 1080 }), 'Localhost'), '');
      assert.equal(checkNodeBlockReason(keep({ server: '[fc00::1]', port: 443 }), 'IPv6ULA'), '');
      assert.equal(checkNodeBlockReason(keep({ server: '[fe80::1]', port: 443 }), 'IPv6LinkLocal'), '');

      // 2. 伪装私网前缀的非法格式即便带有 keepName 也予以拒绝 (必须验证 IP 真实解析)
      assert.equal(checkNodeBlockReason(keep({ server: '192.168.bad.ip', port: 7890 }), 'BadLan'), '假IP');
      assert.equal(checkNodeBlockReason(keep({ server: '192.168.999.999', port: 7890 }), 'BadLan2'), '假IP');
      assert.equal(checkNodeBlockReason(keep({ server: '10.256.1.1', port: 7890 }), 'BadLan3'), '假IP');

      // 3. 公网占位 IP 即便带有 keepName 也不予放行
      assert.equal(checkNodeBlockReason(keep({ server: '0.0.0.0', port: 443 }), 'Zero'), '假IP');
      assert.equal(checkNodeBlockReason(keep({ server: '1.1.1.1', port: 443 }), 'DNS'), '假IP');
      assert.equal(checkNodeBlockReason(keep({ server: '8.8.8.8', port: 443 }), 'DNS2'), '假IP');
      assert.equal(checkNodeBlockReason(keep({ server: '255.255.255.255', port: 443 }), 'Broadcast'), '假IP');

      // 4. 空服务与非法/缺少端口即便带有 keepName 也会被拦截
      assert.equal(checkNodeBlockReason(keep({ server: '', port: 443 }), 'Empty'), '假IP');
      assert.equal(checkNodeBlockReason(keep({ server: '192.168.1.1' }), 'MissingPort'), '假IP');
      assert.equal(checkNodeBlockReason(keep({ server: '192.168.1.1', port: null }), 'NullPort'), '假IP');
      assert.equal(checkNodeBlockReason(keep({ server: '192.168.1.1', port: 0 }), 'ZeroPort'), '假IP');
      assert.equal(checkNodeBlockReason(keep({ server: '192.168.1.1', port: 70000 }), 'OverflowPort'), '假IP');

      // 5. keepName 不豁免占位弱口令 (password、123456、全零 UUID 依然阻断)
      assert.equal(checkNodeBlockReason(keep({ server: '1.2.3.4', port: 443, password: 'password' }), 'KeepDummyPass'), '假密码');
      assert.equal(checkNodeBlockReason(keep({ server: '192.168.1.1', port: 7890, password: '123456' }), 'KeepDummyPass2'), '假密码');
      assert.equal(checkNodeBlockReason(keep({ server: '1.2.3.4', port: 443, uuid: '00000000-0000-0000-0000-000000000000' }), 'KeepDummyUUID'), '假密码');
    });

    it('filterRawInfoNodes 权威复用 isNoticeNode，不误伤真实节点与合成看板', () => {
      const { filterRawInfoNodes } = require('../../src/strategy/dashboard');

      const mixedNodes = [
        markTrustedSynthetic({ name: '📊 [订阅] 剩余流量: 100G', server: '1.0.0.1', port: 80, isSyntheticInfo: true }),
        { name: '剩余流量：500 GB', server: '1.0.0.1', port: 80 },
        { name: '【公告】本站维护中', server: '127.0.0.1', port: 80 },
        { name: '🇭🇰 香港 01 [Netflix不可用]', server: '1.2.3.4', port: 443 },
        { name: '🇭🇰 香港 02 电报专线', server: '1.2.3.5', port: 443 }
      ];

      const filtered = filterRawInfoNodes(mixedNodes);
      // 合成看板与 2 个真实代理节点应完好保留，2 个原生公告应被剔除
      assert.equal(filtered.length, 3);
      assert.ok(filtered.some(n => n.isSyntheticInfo));
      assert.ok(filtered.some(n => n.name.includes('Netflix不可用')));
      assert.ok(filtered.some(n => n.name.includes('电报专线')));
    });

    it('纯函数零副作用：classifyNode 不得原地篡改入参对象的任何属性', () => {
      // 1. 普通节点对象冻结校验
      const normalProxy = Object.freeze({ name: '🇭🇰 香港 01', server: '1.2.3.4', port: 443, type: 'ss' });
      const normalRes = classifyNode(normalProxy, {});
      assert.equal(normalRes.skip, undefined);
      assert.equal(normalRes.proxy, normalProxy);

      // 2. 特殊重命名节点冻结校验 (specialNodeRules 携带 targetName 不得直接就地修改 proxy.name)
      const specialProxy = Object.freeze({ name: '特殊自建节点', server: '1.2.3.4', port: 443, type: 'ss' });
      const specialRes = classifyNode(specialProxy, {
        specialNodeRules: [{ reg: /特殊/, targetName: '命名目标' }]
      });
      assert.equal(specialRes.isSpecial, true);
      assert.equal(specialRes.specialTargetName, '命名目标');
      assert.equal(specialProxy.name, '特殊自建节点', '原 proxy.name 不得被就地篡改');

      // 3. 内部受信看板节点冻结校验 (不得就地篡改 server 或 port)
      const synthProxy = markTrustedSynthetic(Object.freeze({
        name: '📊 看板节点',
        server: '1.0.0.1',
        port: 80,
        type: 'direct',
        isSyntheticInfo: true
      }));
      const synthRes = classifyNode(synthProxy, { enableDashboard: true });
      assert.equal(synthRes.isInfo, true);
      assert.equal(synthRes.proxy.server, '1.0.0.1');
    });

    it('白名单关键词越权防护：订阅 Tag 命中白名单不得豁免整机场广告清洗', () => {
      const cfg = {
        whitelistKeywords: ['优质专线']
      };

      // 节点属于 Tag 为 '优质专线' 的机场，但节点自身是垃圾广告/通知
      const adProxy = {
        name: '官网 https://sub.example.com 优惠码88折',
        server: '1.2.3.4',
        port: 443,
        _subTag: '优质专线'
      };

      const res = classifyNode(adProxy, cfg);
      // 节点本身未包含 '优质专线'，不得因 _subTag 提权为 isSpecial，必须正常按广告词阻断
      assert.equal(res.isSpecial, undefined);
      assert.equal(res.skip, true);
      assert.equal(res.blockReason, '广告词');
    });
  });
});
