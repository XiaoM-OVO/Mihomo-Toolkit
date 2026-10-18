const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { dedupeNodes } = require('../../src/core/dedupe');
const { matchNodeRegion, extractCity } = require('../../src/core/geo');
const { renderTemplate, createSeparatorCleaners, buildRenamePlan, applyRenamePlan } = require('../../src/core/rename');
const { getEnhancedRegionDefs, validateMapping, isRegionInContinent, filterRegionsByContinent, CONTINENT_ALIAS_MAP, SUB_REGION_DEFS } = require('../../src/core/shared/regions');
const { PROTOCOL_ICONS, FEATURE_ICONS, FEATURE_TEXT_MAP } = require('../../src/core/shared/icons');
const { isPrivateIp, isAllowedUrl } = require('../../src/io/ssrf');
const { formatBytes, calcResetDays } = require('../../src/strategy/dashboard');

describe('【Core】核心基础构件 (modules)', () => {
  it('shared/regions & icons - 共享字典与常量合法性及单例缓存', () => {
    assert.equal(validateMapping(), true);
    const defs = getEnhancedRegionDefs();
    assert.ok(defs.length > 20);
    // 验证不可变单例缓存，零重复编译
    assert.equal(getEnhancedRegionDefs(), defs);
    assert.ok(Object.isFrozen(defs));

    // 验证大区与次大区别名表全量自派生
    assert.ok(Array.isArray(SUB_REGION_DEFS) && SUB_REGION_DEFS.length >= 4);
    assert.equal(CONTINENT_ALIAS_MAP['东南亚'], 'sea');
    assert.equal(CONTINENT_ALIAS_MAP['southeast-asia'], 'sea');
    assert.equal(CONTINENT_ALIAS_MAP['south-asia'], 'sas');
    assert.equal(CONTINENT_ALIAS_MAP['南亚'], 'sas');
    assert.equal(CONTINENT_ALIAS_MAP['北美'], 'na');
    assert.equal(CONTINENT_ALIAS_MAP['拉美'], 'latam');
    assert.equal(CONTINENT_ALIAS_MAP['欧洲'], 'europe');
    assert.equal(CONTINENT_ALIAS_MAP['eu'], 'europe');

    assert.equal(PROTOCOL_ICONS.vless, '🛸');
    assert.equal(FEATURE_ICONS.game, '🎮');
    assert.equal(FEATURE_TEXT_MAP.game, '游戏');

    // 验证沙特 (sa) 与南亚次大区 (sas) 彻底脱敏无冲突
    const saDef = defs.find(r => r.id === 'sa');
    const inDef = defs.find(r => r.id === 'in');
    assert.ok(saDef && inDef);
    assert.equal(saDef.name, '沙特');
    assert.equal(inDef.name, '印度');
    assert.equal(isRegionInContinent(saDef, 'sas'), false);
    assert.equal(isRegionInContinent(saDef, '南亚'), false);
    assert.equal(isRegionInContinent(saDef, 'me'), true);
    assert.equal(isRegionInContinent(inDef, 'sas'), true);
    assert.equal(isRegionInContinent(inDef, '南亚'), true);
    assert.deepEqual(filterRegionsByContinent(['沙特节点', '印度节点'], '南亚'), ['印度节点']);
    assert.deepEqual(filterRegionsByContinent(['沙特节点', '印度节点'], '中东'), ['沙特节点']);
  });

  it('dedupe - 节点物理去重算法 (dedupeNodes)', () => {
    const proxies = [
      { name: 'Node 1', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'uuid-1' },
      { name: 'Node 2', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'uuid-1' }, // 重复
      { name: 'Node 3', server: '1.2.3.4', port: 443, type: 'vless', uuid: 'uuid-2' }  // 独立
    ];
    let dupeCount = 0;
    const deduped = dedupeNodes(proxies, {
      onDuplicate: () => { dupeCount++; }
    });
    assert.equal(deduped.length, 2);
    assert.equal(dupeCount, 1);
    assert.equal(deduped[0].name, 'Node 1');
    assert.equal(deduped[1].name, 'Node 3');
  });

  it('geo - 地区与城市提取 (matchNodeRegion / extractCity)', () => {
    const defs = getEnhancedRegionDefs();
    const hk = matchNodeRegion('🇭🇰 香港 01 BGP', defs);
    assert.ok(hk);
    assert.equal(hk.id, 'hk');

    const jp = matchNodeRegion('🇯🇵 东京 02 [VIP]', defs);
    assert.ok(jp);
    assert.equal(jp.id, 'jp');
    assert.equal(extractCity('🇯🇵 东京 02 [VIP]', jp), '东京');
  });

  it('geo - 歧义代码、CN2 与旗帜序号识别回归', () => {
    const defs = getEnhancedRegionDefs();
    assert.equal(matchNodeRegion('香港 CN2 GIA 01', defs)?.id, 'hk');
    assert.equal(matchNodeRegion('美国 CN2 GIA 01', defs)?.id, 'us');
    assert.equal(matchNodeRegion('HK built in 01', defs)?.id, 'hk');
    assert.equal(matchNodeRegion('US do it 01', defs)?.id, 'us');
    assert.equal(matchNodeRegion('HK this is fast 01', defs)?.id, 'hk');
    assert.equal(matchNodeRegion('🇭🇰 01', defs)?.id, 'hk');
    assert.equal(matchNodeRegion('🇯🇵 — #02', defs)?.id, 'jp');
    assert.equal(matchNodeRegion('IN 01', defs)?.name, '印度');
    assert.equal(matchNodeRegion('IT 01', defs)?.name, '意大利');
    assert.equal(matchNodeRegion('IS 01', defs)?.name, '冰岛');
    assert.equal(matchNodeRegion('MY 01', defs)?.name, '马来西亚');
    // 反向回国节点：美->沪 必须命中中国 (cn) 而非美国 (us)，因匹配长度优先
    assert.equal(matchNodeRegion('美->沪 回国专线 01', defs)?.id, 'cn');
    // 普通中转节点：深->香港 必须命中落地香港 (hk) 而非国内入口深圳
    assert.equal(matchNodeRegion('深->香港 01', defs)?.id, 'hk');
    assert.equal(matchNodeRegion('深->德国 01', defs)?.id, 'de');
  });

  it('rename - 模板渲染与空变量清洗 (renderTemplate)', () => {
    const cleaners = createSeparatorCleaners();
    const vars = {
      icon: '🇭🇰',
      region: '香港',
      index: '01',
      features: '📺',
      multi: 'x1.0',
      line: 'BGP'
    };
    const rendered = renderTemplate('{icon} {region} {index} {features} | {line}', vars, {}, cleaners);
    assert.equal(rendered, '🇭🇰 香港 01 📺 | BGP');

    // 空变量与冗余分隔符自动清洗
    const renderedEmpty = renderTemplate('{icon} {region} | {in} | {features}', { icon: '🇺🇸', region: '美国' }, {}, cleaners);
    assert.equal(renderedEmpty, '🇺🇸 美国');
  });

  it('rename - 空机场括号与悬空分隔符清理回归', () => {
    const rendered = renderTemplate('[{airport}] | {icon} {region}', {
      icon: '🇭🇰', region: '香港'
    }, {}, createSeparatorCleaners());
    assert.equal(rendered, '🇭🇰 香港');

    const fullWidth = renderTemplate('【{airport}】 | （{airport}） | {region}', {
      region: '香港'
    }, {}, createSeparatorCleaners());
    assert.equal(fullWidth, '香港');

    // 模板渲染产物全空时无条件回退原始名称
    const fallbackName = renderTemplate('{in} | {city}', {}, { name: 'RawProxy01' }, createSeparatorCleaners());
    assert.equal(fallbackName, 'RawProxy01');
  });

  it('rename - 两阶段命名仲裁同名碰撞防护 (applyRenamePlan)', () => {
    const items = [
      { proxy: { name: '🇭🇰 香港 01' }, rawName: '🇭🇰 香港 01', isSpecial: true },
      { proxy: { name: '🇭🇰 香港 01' }, rawName: '🇭🇰 香港 01', isSpecial: true },
      { proxy: { name: '🇯🇵 日本 01' }, rawName: '🇯🇵 日本 01', isSpecial: true },
      { proxy: { name: '🇭🇰 香港 01' }, rawName: '🇭🇰 香港 01', isSpecial: true }
    ];
    const plan = buildRenamePlan(items, {});
    applyRenamePlan(items, plan);
    assert.equal(items[0].proxy.name, '🇭🇰 香港 01');
    assert.equal(items[1].proxy.name, '🇭🇰 香港 01 #2');
    assert.equal(items[2].proxy.name, '🇯🇵 日本 01');
    assert.equal(items[3].proxy.name, '🇭🇰 香港 01 #3');

    // 避免与列表中已存在的带序号节点产生二次撞车
    const preexisting = [
      { proxy: { name: '节点 A' }, rawName: '节点 A', isSpecial: true },
      { proxy: { name: '节点 A' }, rawName: '节点 A', isSpecial: true },
      { proxy: { name: '节点 A #2' }, rawName: '节点 A #2', isSpecial: true }
    ];
    const prePlan = buildRenamePlan(preexisting, {});
    applyRenamePlan(preexisting, prePlan);
    assert.equal(preexisting[0].proxy.name, '节点 A');
    assert.equal(preexisting[1].proxy.name, '节点 A #3');
    assert.equal(preexisting[2].proxy.name, '节点 A #2');
  });

  it('ssrf - 基础私网 IP 与协议判定 (isPrivateIp / isAllowedUrl)', () => {
    assert.equal(isPrivateIp('127.0.0.1'), true);
    assert.equal(isPrivateIp('10.0.0.1'), true);
    assert.equal(isPrivateIp('192.168.1.1'), true);
    assert.equal(isPrivateIp('8.8.8.8'), false);
    assert.equal(isAllowedUrl('http://127.0.0.1:8080'), false);
    assert.equal(isAllowedUrl('https://example.com/sub'), true);
  });

  it('sub-info - 订阅流量与重置日换算 (formatBytes / calcResetDays)', () => {
    assert.equal(formatBytes(1024 * 1024 * 500), '500.00 MB');
    assert.equal(formatBytes(1024 * 1024 * 1024 * 2.5), '2.50 GB');
    assert.ok(typeof calcResetDays({ resetDay: 1 }) === 'number');
  });
});
