/**
 * 策略组身份表（Group Identity）
 *
 * 内部判定只用身份键，中文组名只是展示标签；本用例锁定「键 → 规范名」的
 * 单一真相源、骨架组判定顺序，以及 catalog / 目标注册表对同一份表的消费。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  GROUP_KEYS,
  GROUP_IDENTITIES,
  groupName,
  groupKeyOfName,
  skeletonGroupNames,
  poolDependentGroupNames
} = require('../../src/data/catalog/identity');
const { SKELETON_GROUP_NAMES } = require('../../src/strategy/target-registry');
const { DOWNLOAD_GROUPS, SKELETON_GROUP_DEFS, ADS_GROUPS } = require('../../src/data/catalog/groups');

describe('【Strategy】策略组身份表 (Group Identity)', () => {
  it('骨架组名按判定优先级投影，与目标注册表保持同一顺序', () => {
    assert.deepEqual(skeletonGroupNames(), [
      '自动选择',
      '手动选择',
      '故障转移',
      '下载策略',
      '负载均衡-轮询',
      '漏网之鱼',
      '家宽优选',
      '中国分流',
      'IPv6控制台',
      '高倍率优选',
      '实验节点',
      '订阅与状态看板',
      '其他节点',
      '未知识别'
    ]);
    assert.deepEqual([...SKELETON_GROUP_NAMES], skeletonGroupNames());
  });

  it('未知身份键 fail-closed，不会静默退化为名字匹配', () => {
    assert.throws(() => groupName('not-a-key'), /未知策略组身份键/);
  });

  it('组名反查身份键：剥离 Emoji / 图标前缀后精确命中', () => {
    assert.equal(groupKeyOfName('自动选择'), GROUP_KEYS.auto);
    assert.equal(groupKeyOfName('🚀 自动选择'), GROUP_KEYS.auto);
    assert.equal(groupKeyOfName('🇨🇳 中国分流'), GROUP_KEYS.domestic);
    assert.equal(groupKeyOfName('ChatGPT'), null, '服务组不在身份表内');
    assert.equal(groupKeyOfName(''), null);
  });

  it('池依赖口径由身份表声明，不再维护第二份名单', () => {
    assert.deepEqual(poolDependentGroupNames().sort(), [
      '下载策略',
      '负载均衡-轮询',
      '低倍率节点',
      '家宽优选',
      '实验节点',
      '高倍率优选'
    ].sort());
  });

  it('catalog 组声明的名字全部投影自身份表', () => {
    assert.equal(DOWNLOAD_GROUPS[0].name, groupName(GROUP_KEYS.download));
    assert.equal(DOWNLOAD_GROUPS[1].name, groupName(GROUP_KEYS.roundRobin));
    assert.equal(SKELETON_GROUP_DEFS.domestic.split.name, groupName(GROUP_KEYS.domestic));
    assert.equal(SKELETON_GROUP_DEFS.final.return.name, groupName(GROUP_KEYS.final));
    assert.equal(ADS_GROUPS['ad-block'].name, groupName(GROUP_KEYS.adBlock));
    assert.equal(ADS_GROUPS['anti-ad'].name, groupName(GROUP_KEYS.antiAd));
  });

  it('规范名唯一（广告拦截的两个规则来源按设计共用组名）', () => {
    const names = Object.values(GROUP_IDENTITIES).map(def => def.name);
    const duplicates = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
    assert.deepEqual(duplicates, ['广告拦截']);
  });
});
