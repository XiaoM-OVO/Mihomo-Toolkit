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

  test('解析器规范化：scheme/host 大小写与路径尾斜杠差异视为同一集合', () => {
    const { policies, conflicts } = resolveNodeDnsPolicies([
      candidate('hk.example.com', ['HTTPS://DoH-A.Example.COM/dns-query/'], 'url:aaa'),
      candidate('hk.example.com', ['https://doh-a.example.com/dns-query'], 'url:bbb')
    ]);
    // 规范化后不应再被误判为冲突（否则域名会静默回退默认 DNS）
    assert.deepEqual(conflicts, []);
    assert.deepEqual(policies, {
      'hk.example.com': ['https://doh-a.example.com/dns-query']
    });
  });

  test('解析器规范化：非 URL 形态（主机名/IP）保持原样并参与去重', () => {
    const { policies } = resolveNodeDnsPolicies([
      candidate('hk.example.com', [' 8.8.8.8 ', '8.8.8.8'], 'url:aaa')
    ]);
    assert.deepEqual(policies, { 'hk.example.com': ['8.8.8.8'] });
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

  test('折叠：同源同后缀的多个节点域名合并为一条 .suffix 通配键', () => {
    const doh = ['https://doh-a.example/dns-query'];
    const { policies } = resolveNodeDnsPolicies([
      candidate('sg01.459292.xyz', doh, 'url:aaa'),
      candidate('tw06.459292.xyz', doh, 'url:aaa'),
      candidate('us02.459292.xyz', doh, 'url:aaa')
    ]);
    assert.deepEqual(policies, { '.459292.xyz': doh });
  });

  test('折叠：多层域名优先使用最具体的后缀，避免通配范围放大', () => {
    const doh = ['https://doh-a.example/dns-query'];
    const { policies } = resolveNodeDnsPolicies([
      candidate('a.b.example.com', doh, 'url:aaa'),
      candidate('c.b.example.com', doh, 'url:aaa')
    ]);
    assert.deepEqual(policies, { '.b.example.com': doh });
  });

  test('折叠：单个域名不折叠，仍输出精确键', () => {
    const doh = ['https://doh-a.example/dns-query'];
    const { policies } = resolveNodeDnsPolicies([
      candidate('hk.example.com', doh, 'url:aaa')
    ]);
    assert.deepEqual(policies, { 'hk.example.com': doh });
  });

  test('折叠：同后缀跨订阅不同来源时不折叠，保持精确键隔离', () => {
    const dohA = ['https://doh-a.example/dns-query'];
    const dohB = ['https://doh-b.example/dns-query'];
    const { policies } = resolveNodeDnsPolicies([
      candidate('hk.example.com', dohA, 'url:aaa'),
      candidate('jp.example.com', dohB, 'url:bbb')
    ]);
    assert.deepEqual(policies, {
      'hk.example.com': dohA,
      'jp.example.com': dohB
    });
  });

  test('折叠：后缀下存在冲突域名时整段不折叠', () => {
    const doh = ['https://doh-a.example/dns-query'];
    const { policies, conflicts } = resolveNodeDnsPolicies([
      candidate('hk.example.com', doh, 'url:aaa'),
      candidate('jp.example.com', doh, 'url:aaa'),
      candidate('shared.example.com', doh, 'url:aaa'),
      candidate('shared.example.com', ['https://doh-b.example/dns-query'], 'url:bbb')
    ]);
    // 折叠会把冲突域名交给本订阅解析器，违反「冲突回退默认 DNS」
    assert.equal(policies['.example.com'], undefined);
    assert.deepEqual(policies['hk.example.com'], doh);
    assert.deepEqual(policies['jp.example.com'], doh);
    assert.equal(policies['shared.example.com'], undefined);
    assert.deepEqual(conflicts, [
      { domain: 'shared.example.com', subscriptions: 2, distinctResolvers: 2 }
    ]);
  });

  test('折叠开关关闭：同源同后缀仍输出逐域名精确键', () => {
    const doh = ['https://doh-a.example/dns-query'];
    const { policies } = resolveNodeDnsPolicies([
      candidate('hk01.459292.xyz', doh, 'url:aaa'),
      candidate('hk02.459292.xyz', doh, 'url:aaa')
    ], { fold: false });
    assert.deepEqual(policies, {
      'hk01.459292.xyz': doh,
      'hk02.459292.xyz': doh
    });
  });

  test('折叠结果与订阅顺序无关', () => {
    const dohA = ['https://doh-a.example/dns-query'];
    const dohB = ['https://doh-b.example/dns-query'];
    const items = [
      candidate('sg01.459292.xyz', dohA, 'url:aaa'),
      candidate('tw01.459292.xyz', dohA, 'url:aaa'),
      candidate('hk.344211.cc', dohB, 'url:bbb'),
      candidate('tw.344211.cc', dohB, 'url:bbb')
    ];
    const baseline = JSON.stringify(resolveNodeDnsPolicies(items));
    for (const order of [[3, 2, 1, 0], [1, 0, 3, 2], [2, 3, 0, 1]]) {
      assert.equal(JSON.stringify(resolveNodeDnsPolicies(order.map(i => items[i]))), baseline);
    }
    const { policies } = resolveNodeDnsPolicies(items);
    assert.deepEqual(policies, {
      '.344211.cc': dohB,
      '.459292.xyz': dohA
    });
  });
});
