const test = require('node:test');
const assert = require('node:assert/strict');

const { dedupeNodes, getNodeFingerprint } = require('../src/core/dedupe');
const { matchNodeRegion, extractCity } = require('../src/core/geo');
const { renderTemplate, createSeparatorCleaners } = require('../src/core/rename');
const { getEnhancedRegionDefs, validateMapping } = require('../src/core/shared/regions');
const { PROTOCOL_ICONS, FEATURE_ICONS, FEATURE_TEXT_MAP } = require('../src/core/shared/icons');
const { isPrivateIp, isAllowedUrl } = require('../src/io/ssrf');
const { parseContent, parseVlessUri } = require('../src/io/parsers');
const { formatBytes, calcResetDays } = require('../src/io/sub-info');

test('🧩 核心模块单元测试 - 共享字典与常量', () => {
  assert.equal(validateMapping(), true);
  const defs = getEnhancedRegionDefs();
  assert.ok(defs.length > 20);
  assert.equal(PROTOCOL_ICONS.vless, '🛸');
  assert.equal(FEATURE_ICONS.game, '🎮');
  assert.equal(FEATURE_TEXT_MAP.game, '游戏');
});

test('🧩 核心模块单元测试 - 节点去重算法 (dedupe)', () => {
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

test('🧩 核心模块单元测试 - 地区与城市识别 (geo)', () => {
  const defs = getEnhancedRegionDefs();
  const hk = matchNodeRegion('🇭🇰 香港 01 BGP', defs);
  assert.ok(hk);
  assert.equal(hk.id, 'hk');

  const jp = matchNodeRegion('🇯🇵 东京 02 [VIP]', defs);
  assert.ok(jp);
  assert.equal(jp.id, 'jp');
  assert.equal(extractCity('🇯🇵 东京 02 [VIP]', jp), '东京');
});

test('🧩 核心模块单元测试 - 节点重命名与模板渲染 (rename)', () => {
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

test('🧩 核心模块单元测试 - SSRF 私网校验', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.0.0.1'), true);
  assert.equal(isPrivateIp('192.168.1.1'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isAllowedUrl('http://127.0.0.1:8080'), false);
  assert.equal(isAllowedUrl('https://example.com/sub'), true);
});

test('🧩 核心模块单元测试 - 订阅信息合成 (sub-info)', () => {
  assert.equal(formatBytes(1024 * 1024 * 500), '500.00 MB');
  assert.equal(formatBytes(1024 * 1024 * 1024 * 2.5), '2.50 GB');
  assert.ok(typeof calcResetDays({ resetDay: 1 }) === 'number');
});
