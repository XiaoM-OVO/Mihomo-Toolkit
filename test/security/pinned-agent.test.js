const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fetch: undiciFetch } = require('undici');
const { createPinnedLookup, createPinnedAgent, extractSsrfBlock } = require('../../src/io/pinned-agent');

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:2800:220:1:248:1893:25c8:1946';

/** 以 Node lookup 回调约定调用注入的 lookup */
function callLookup(lookup, host, options = {}) {
  return new Promise((resolve, reject) => {
    lookup(host, options, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  });
}

function policyError(message) {
  const err = new Error(message);
  err.ssrfBlocked = 'policy';
  err.retryable = false;
  return err;
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

describe('【Security】建连期 IP Pinning (pinned-agent)', () => {
  it('公网地址 - undici 的 all 调用返回全部已校验条目，单值调用按 Node 约定回调', async () => {
    const lookup = createPinnedLookup({
      resolve: async () => [{ address: PUBLIC_V4, family: 4 }, { address: PUBLIC_V6, family: 6 }]
    });

    const all = await callLookup(lookup, 'example.com', { all: true, hints: 0 });
    assert.deepEqual(all.address, [
      { address: PUBLIC_V4, family: 4 },
      { address: PUBLIC_V6, family: 6 }
    ]);

    const one = await callLookup(lookup, 'example.com', {});
    assert.equal(one.address, PUBLIC_V4);
    assert.equal(one.family, 4);
  });

  it('私网 / 回环地址 - 建连期拒绝并标记 policy（不可重试）', async () => {
    const lookup = createPinnedLookup({
      resolve: async () => [{ address: '127.0.0.1', family: 4 }]
    });

    await assert.rejects(
      () => callLookup(lookup, 'rebind.example', { all: true }),
      (err) => err.ssrfBlocked === 'policy' && err.retryable === false && /私网 IP 127\.0\.0\.1/.test(err.message)
    );
  });

  it('混合候选地址 - 任一地址落在私网即拒绝整个目标', async () => {
    const lookup = createPinnedLookup({
      resolve: async () => [PUBLIC_V4, '10.0.0.5']
    });

    await assert.rejects(
      () => callLookup(lookup, 'mixed.example', { all: true }),
      (err) => err.ssrfBlocked === 'policy' && /10\.0\.0\.5/.test(err.message)
    );
  });

  it('解析失败 / 无可用地址 - 标记 unverified 而不是 policy', async () => {
    const failed = createPinnedLookup({ resolve: async () => { throw new Error('ENOTFOUND'); } });
    await assert.rejects(
      () => callLookup(failed, 'nxdomain.example', { all: true }),
      (err) => err.ssrfBlocked === 'unverified'
    );

    const empty = createPinnedLookup({ resolve: async () => [] });
    await assert.rejects(
      () => callLookup(empty, 'empty.example', { all: true }),
      (err) => err.ssrfBlocked === 'unverified' && /无可用地址/.test(err.message)
    );
  });

  it('family 过滤 - 只返回与请求族一致的地址', async () => {
    const lookup = createPinnedLookup({
      resolve: async () => [PUBLIC_V4, PUBLIC_V6]
    });

    const v6 = await callLookup(lookup, 'example.com', { all: true, family: 6 });
    assert.deepEqual(v6.address, [{ address: PUBLIC_V6, family: 6 }]);

    const v4 = await callLookup(lookup, 'example.com', { all: true, family: 4 });
    assert.deepEqual(v4.address, [{ address: PUBLIC_V4, family: 4 }]);

    const v4Only = createPinnedLookup({ resolve: async () => [PUBLIC_V4] });
    await assert.rejects(
      () => callLookup(v4Only, 'example.com', { all: true, family: 6 }),
      (err) => err.ssrfBlocked === 'unverified'
    );
  });

  it('集成 - Agent 的 lookup 真正参与建连', async () => {
    const server = http.createServer((req, res) => res.end('pinned-ok'));
    const port = await listen(server);
    const agent = createPinnedAgent({
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
      isBlocked: () => false
    });

    try {
      const res = await undiciFetch(`http://pinned-agent.example:${port}/`, { dispatcher: agent });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'pinned-ok');
    } finally {
      await agent.close();
      await closeServer(server);
    }
  });

  it('错误链提取 - 支持 cause 与 AggregateError 包装，且深度上限生效', () => {
    const inner = policyError('SSRF 预检失败：rebind.example 解析到私网 IP 127.0.0.1');

    const wrapped = new Error('fetch failed', {
      cause: new AggregateError([new Error('connect ECONNREFUSED'), inner])
    });
    assert.equal(extractSsrfBlock(wrapped), inner);

    let deep = inner;
    for (let i = 0; i < 4; i++) deep = new Error('layer', { cause: deep });
    assert.equal(extractSsrfBlock(deep), inner);

    let tooDeep = inner;
    for (let i = 0; i < 5; i++) tooDeep = new Error('layer', { cause: tooDeep });
    assert.equal(extractSsrfBlock(tooDeep), null);
    assert.equal(extractSsrfBlock(null), null);
  });

  it('集成 - 私网目标在建连阶段被拒绝（fetch 错误链带出 policy 标记）', async () => {
    const server = http.createServer((req, res) => res.end('should-not-reach'));
    const port = await listen(server);
    const agent = createPinnedAgent({
      resolve: async () => [{ address: '127.0.0.1', family: 4 }]
    });

    try {
      await assert.rejects(
        async () => { await undiciFetch(`http://rebind-to-loopback.example:${port}/`, { dispatcher: agent }); },
        (err) => {
          const blocked = extractSsrfBlock(err);
          return Boolean(blocked) && blocked.ssrfBlocked === 'policy';
        }
      );
    } finally {
      await agent.close();
      await closeServer(server);
    }
  });
});
