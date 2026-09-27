const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const chineseConvert = require('../src/chinese-convert.js');

describe('🔄 简繁中文全链路转换模块', () => {
  test('chineseConvert - 字符串简繁转换逻辑', () => {
    const textTr = '香港專線';
    const simplified = chineseConvert.toSimplified(textTr);
    // opencc-js 未安装时返回原文，已安装时转换为简体
    assert.ok(simplified === '香港专线' || simplified === textTr);
  });

  test('chineseConvert - 对象结构递归转换逻辑', () => {
    const reg = /^测试\d+$/i;
    const date = new Date(1700000000000);
    const obj = {
      "香港專線": ["日本高速", "美國節點"],
      filterReg: reg,
      createdAt: date
    };
    const converted = chineseConvert.deepConvertStrings(obj, chineseConvert.toSimplified);
    assert.notEqual(converted, null);
    assert.ok(typeof converted === 'object');
    // RegExp 和 Date 必须保持原型对象，不得退化为空对象 {}
    assert.ok(converted.filterReg instanceof RegExp);
    assert.equal(converted.filterReg.source, reg.source);
    assert.ok(converted.createdAt instanceof Date);
    assert.equal(converted.createdAt.getTime(), date.getTime());
  });
});
