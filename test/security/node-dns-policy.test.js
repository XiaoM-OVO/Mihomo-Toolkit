const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resolveNodeDnsPolicies } = require('../../src/core/security/node-dns-policy.js');

function candidate(domain, resolvers, sourceId) {
  return { domain, resolvers, sourceId };
}

describe('【Security】节点域名解析器归属决议 (node-dns-policy)', () => {
  test('同域名同解析器集合：去重合并为一条映射', () => {
    const { policies, conflicts } = resolveNodeDnsPolicies([
      candidate('hk.example.com', ['https://doh-a.example/dns-query'], 'url:aaa'),
      candidate('hk.example.com', ['https://doh-a.example/dns-query'], 'url:bbb')
    ]);
    assert.deepEqual(policies, { 'hk.example.com': ['https://doh-a.example/dns-query'] });
    assert.deepEqual(conflicts, []);
  });

  test('同域名不同解析器：整体判定冲突，不生成映射、不做 union', () => {
    const { policies, conflicts } = resolveNodeDnsPolicies([
      candidate('hk.example.com', ['https://doh-a.example/dns-query'], 'url:aaa'),
      candidate('hk.example.com', ['https://doh-b.example/dns-query'], 'url:bbb')
    ]);
    assert.deepEqual(policies, {});
    assert.deepEqual(conflicts, [
      { domain: 'hk.example.com', subscriptions: 2, distinctResolvers: 2 }
    ]);
  });

  test('A/B 相同、C 不同：整个域名冲突，不保留 A/B 的公共解析器', () => {
    const same = ['https://doh-a.example/dns-query'];
    const { policies, conflicts } = resolveNodeDnsPolicies([
      candidate('shared.example.com', same, 'url:aaa'),
      candidate('shared.example.com', same, 'url:bbb'),
      candidate('shared.example.com', ['https://doh-c.example/dns-query'], 'url:ccc')
    ]);
    assert.deepEqual(policies, {});
    assert.deepEqual(conflicts, [
      { domain: 'shared.example.com', subscriptions: 3, distinctResolvers: 2 }
    ]);
  });

  test('订阅顺序无关：六种排列输出完全一致', () => {
    const items = [
      candidate('a.example.com', ['https://doh-a.example/dns-query'], 'url:aaa'),
      candidate('b.example.com', ['https://doh-b.example/dns-query'], 'url:bbb'),
      candidate('conflict.example.com', ['https://doh-c.example/dns-query'], 'url:ccc'),
      candidate('conflict.example.com', ['https://doh-d.example/dns-query'], 'url:ddd')
    ];
    const permutations = [
      [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3],
      [1, 0, 2, 3], [2, 0, 1, 3], [2, 1, 0, 3]
    ];
    const baseline = JSON.stringify(resolveNodeDnsPolicies(items));
    for (const order of permutations) {
      const result = resolveNodeDnsPolicies(order.map(i => items[i]));
      assert.equal(JSON.stringify(result), baseline, `排列 ${order.join('')} 输出必须一致`);
    }
  });

  test('域名规范化：大小写与末尾根点视为同一域名', () => {
    const { policies } = resolveNodeDnsPolicies([
      candidate('HK.Example.COM.', ['https://doh-a.example/dns-query'], 'url:aaa'),
      candidate('hk.example.com', ['https://doh-a.example/dns-query'], 'url:bbb')
    ]);
    assert.deepEqual(policies, { 'hk.example.com': ['https://doh-a.example/dns-query'] });
  });

  test('无效候选被跳过：空解析器、缺失域名或来源', () => {
    const { policies, conflicts } = resolveNodeDnsPolicies([
      candidate('', ['https://doh-a.example/dns-query'], 'url:aaa'),
      candidate('ok.example.com', [], 'url:bbb'),
      candidate('ok.example.com', ['https://doh-a.example/dns-query'], '')
    ]);
    assert.deepEqual(policies, {});
    assert.deepEqual(conflicts, []);
  });
});
