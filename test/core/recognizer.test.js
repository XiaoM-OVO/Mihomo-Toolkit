const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { recognizeRegion } = require('../../src/core/recognizer');
const { matchNodeRegion } = require('../../src/core/geo');
const { detectRegion, extractEntry } = require('../../src/core/metadata');

/**
 * 地区与出入口识别回归：历史缺陷是「geo 与 metadata 各有一套判定」，
 * 以及「入口城市词表混进了落地地区」（香港/日本/美国…被当成入口）。
 */
describe('【Core】地区与出入口识别 (recognizer)', () => {
  it('入口只认国内中转城市，落地地区不会被误认成入口', () => {
    assert.equal(extractEntry('香港 日本 专线').entryStr, '');
    assert.equal(extractEntry('日本 香港').entryStr, '');
    assert.equal(extractEntry('新加坡 美国').entryStr, '');
    assert.equal(extractEntry('台湾 香港 中转').entryStr, '');
    assert.equal(extractEntry('🇯🇵 香港').entryStr, '');
  });

  it('入口仍能识别「国内城市 + 连接符 + 落地」的常见写法', () => {
    assert.equal(extractEntry('深-港 IEPL 01').entryStr, '深');
    assert.equal(extractEntry('SZX-HK 01').entryStr, '深');
    assert.equal(extractEntry('广州-香港 01').entryStr, '广');
    assert.equal(extractEntry('北京-美国 01').entryStr, '京');
    assert.equal(extractEntry('上海-日本 01').entryStr, '沪');
    assert.equal(extractEntry('深港专线').entryStr, '深');
  });

  it('落地取「最后出现」的地区，而不是最长匹配', () => {
    assert.equal(matchNodeRegion('香港 日本 专线')?.name, '日本');
    assert.equal(matchNodeRegion('日本 香港')?.name, '香港');
    assert.equal(matchNodeRegion('新加坡 美国')?.name, '美国');
    assert.equal(matchNodeRegion('深-港 IEPL 01')?.name, '香港');
    assert.equal(matchNodeRegion('美->沪 回国专线')?.name, '中国');
  });

  it('geo 与 metadata 的落地结论一致（不再各判各的）', () => {
    const names = [
      '香港 日本 专线', '香港 转 日本 落地', '日本 香港', '上海 入口 香港',
      '🇯🇵 香港', '🇭🇰 香港 01', '深港专线', '广州 香港', '新加坡 美国',
      '沪 日 中转', '香港 IPLC 日本', '深圳-东京', '美国 洛杉矶', '日本 东京 IEPL'
    ];
    for (const name of names) {
      const geo = matchNodeRegion(name);
      const meta = detectRegion(name);
      assert.equal(meta.regionDef?.name ?? null, geo?.name ?? null, name);
    }
  });

  it('冲突只做标记，不丢落地：多地区 / 国旗与文案不一致', () => {
    const multi = recognizeRegion('香港 日本 专线');
    assert.equal(multi.regionDef?.name, '日本');
    assert.equal(multi.hasConflict, true);
    assert.equal(multi.conflictReason, 'multi-region');

    const flagText = recognizeRegion('🇯🇵 香港');
    assert.equal(flagText.regionDef?.name, '香港');
    assert.equal(flagText.hasConflict, true);
    assert.equal(flagText.conflictReason, 'flag-text');

    const clean = recognizeRegion('🇭🇰 香港 01');
    assert.equal(clean.regionDef?.name, '香港');
    assert.equal(clean.hasConflict, false);
  });

  it('多面国旗直接判冲突，严格模式禁用未知国旗动态建区', () => {
    const twoFlags = recognizeRegion('🇭🇰🇯🇵 01');
    assert.equal(twoFlags.hasConflict, true);
    assert.equal(twoFlags.conflictReason, 'multi-flag');

    assert.equal(recognizeRegion('🇦🇦 测试地 01', undefined, { strictRegionMatch: true }).regionDef, null);
    assert.equal(recognizeRegion('🇦🇦 测试地 01').regionDef?.name, '测试地');
  });
});
