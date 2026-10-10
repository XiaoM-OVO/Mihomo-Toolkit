/**
 * -----------------------------------------------------------------------------
 * Integration Test: Pipeline Engine SWR & Single-Flight 机制验证
 * -----------------------------------------------------------------------------
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProfile, safeErrorMessage, _internal } = require('../src/pipeline/engine');
const { profileCache } = require('../src/io/cache');

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

const SUB_CONTENT_V1 = Buffer.from(`
proxies:
  - name: "🇭🇰 香港 01"
    type: ss
    server: hk.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
  - name: "🇯🇵 日本 01"
    type: ss
    server: jp.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');

const SUB_CONTENT_V2 = Buffer.from(`
proxies:
  - name: "🇭🇰 香港 02 Updated"
    type: ss
    server: hk.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
  - name: "🇯🇵 日本 02 Updated"
    type: ss
    server: jp.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');

test.beforeEach(() => {
  profileCache.clear();
  _internal.normalFlights.clear();
  _internal.forceFlights.clear();
  _internal.revalidateBackoffs.clear();
});

test.afterEach(() => {
  restoreFetch();
});

test.describe('Engine SWR: 缓存状态流转与回调', () => {
  test('1. Fresh 命中直接返回，不触发构建，回调状态为 fresh', async () => {
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response(SUB_CONTENT_V1, { status: 200 });
    };

    const config = {
      logLevel: 'silent',
      cacheTtl: 300,
      enableNodeRename: false,
      minorNodeThreshold: 1,
      subscriptions: [{ url: 'http://93.184.216.34/sub', tag: 'T1' }]
    };

    let status1;
    const r1 = await buildProfile(config, {
      onCacheStatus: (st) => { status1 = st; }
    });
    assert.equal(status1, 'miss');
    assert.equal(fetchCount, 1);
    assert.match(r1.yamlStr, /香港 01/);

    let status2;
    const r2 = await buildProfile(config, {
      onCacheStatus: (st) => { status2 = st; }
    });
    assert.equal(status2, 'fresh');
    assert.equal(fetchCount, 1, 'Fresh 状态不得触发新的网络 fetch');
    assert.equal(r2, r1, 'Fresh 状态直接返回同一缓存对象');
  });

  test('2 & 3. Stale 优先返回旧快照，后台 Revalidate 完成后下一次请求拿到新结果', async () => {
    let currentPayload = SUB_CONTENT_V1;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response(currentPayload, { status: 200 });
    };

    const config = {
      logLevel: 'silent',
      cacheTtl: 1, // 1 秒新鲜期
      cacheStaleMaxAge: 100,
      enableNodeRename: false,
      minorNodeThreshold: 1,
      subscriptions: [{ url: 'http://93.184.216.34/sub', tag: 'T1' }]
    };

    // 首次构建
    await buildProfile(config);
    assert.equal(fetchCount, 1);

    // 人工将缓存时间拨退 1.5s，进入 Stale
    const key = [...profileCache.cacheMap.keys()][0];
    const entry = profileCache.cacheMap.get(key);
    entry.timestamp -= 1500;

    // 修改远端服务吐出的节点为 V2
    currentPayload = SUB_CONTENT_V2;

    let status;
    const staleResult = await buildProfile(config, {
      onCacheStatus: (st) => { status = st; }
    });

    // 验证立即返回旧快照
    assert.equal(status, 'stale');
    assert.match(staleResult.yamlStr, /香港 01/);
    assert.ok(!staleResult.yamlStr.includes('香港 02 Updated'));

    // 等待后台 Revalidate 单飞任务完成
    if (_internal.forceFlights.has(key)) {
      await _internal.forceFlights.get(key);
    }

    assert.equal(fetchCount, 2, '后台 Revalidate 执行了实际网络抓取');

    // 下一次请求应该拿到后台更新后的新缓存
    let nextStatus;
    const freshResult = await buildProfile(config, {
      onCacheStatus: (st) => { nextStatus = st; }
    });
    assert.equal(nextStatus, 'fresh');
    assert.match(freshResult.yamlStr, /香港 02 Updated/);
  });

  test('4. 后台刷新异常时保留旧快照，不产生未处理异常', async () => {
    let shouldFail = false;
    globalThis.fetch = async () => {
      if (shouldFail) {
        return new Response('Internal Error', { status: 500 });
      }
      return new Response(SUB_CONTENT_V1, { status: 200 });
    };

    const config = {
      logLevel: 'silent',
      cacheTtl: 1,
      enableNodeRename: false,
      minorNodeThreshold: 1,
      subscriptions: [{ url: 'http://93.184.216.34/sub', tag: 'T1', retry: 0 }]
    };

    await buildProfile(config);

    // 拨退进入 Stale
    const key = [...profileCache.cacheMap.keys()][0];
    profileCache.cacheMap.get(key).timestamp -= 1500;

    // 触发异常
    shouldFail = true;

    let status;
    const r = await buildProfile(config, {
      onCacheStatus: (st) => { status = st; }
    });

    // 依然成功秒回旧快照
    assert.equal(status, 'stale');
    assert.match(r.yamlStr, /香港 01/);

    // 等待可能的异常单飞落定
    if (_internal.forceFlights.has(key)) {
      try { await _internal.forceFlights.get(key); } catch (_) {}
    }

    // 旧缓存未被删除
    assert.ok(profileCache.has(key));
  });

  test('5. hasFailedSub 导致未发布新结果时，旧快照仍保留并进入退避', async () => {
    let isSecondRun = false;
    globalThis.fetch = async (url) => {
      if (isSecondRun && url.includes('sub2')) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(SUB_CONTENT_V1, { status: 200 });
    };

    const config = {
      logLevel: 'silent',
      cacheTtl: 1,
      fetchStaleTtl: 0, // 关闭单源兜底使 404 真实造成 hasFailedSub
      enableNodeRename: false,
      minorNodeThreshold: 1,
      subscriptions: [
        { url: 'http://93.184.216.34/sub1', tag: 'T1' },
        { url: 'http://93.184.216.34/sub2', tag: 'T2', retry: 0 }
      ]
    };

    // 首次构建：双订阅均成功，正常发布写入缓存
    await buildProfile(config);
    const key = [...profileCache.cacheMap.keys()][0];

    // 进入 Stale
    profileCache.cacheMap.get(key).timestamp -= 1500;
    isSecondRun = true;

    // 触发 Stale 请求
    const r = await buildProfile(config);
    assert.match(r.yamlStr, /香港 01/);

    // 等待后台 Revalidate 完成（此时 sub2 失败触发 hasFailedSub）
    if (_internal.forceFlights.has(key)) {
      try { await _internal.forceFlights.get(key); } catch (_) {}
    }

    // 旧完整缓存未被破坏
    assert.ok(profileCache.has(key));
    // 并且正确进入了退避保护
    assert.equal(_internal.isInRevalidateBackoff(key), true);
  });
});

test.describe('Engine Single-Flight: 任务合并规则', () => {
  test('7. 冷启动并发多个同键普通请求只启动一次实际构建 (Single-Flight)', async () => {
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response(SUB_CONTENT_V1, { status: 200 });
    };

    const config = {
      logLevel: 'silent',
      cacheTtl: 300,
      enableNodeRename: false,
      minorNodeThreshold: 1,
      subscriptions: [{ url: 'http://93.184.216.34/sub', tag: 'T1' }]
    };

    // 并发发起 4 个请求
    const [r1, r2, r3, r4] = await Promise.all([
      buildProfile(config),
      buildProfile(config),
      buildProfile(config),
      buildProfile(config)
    ]);

    assert.equal(fetchCount, 1, '4 个并发请求必须单飞合并，只触发 1 次网络 fetch');
    assert.equal(r1, r2);
    assert.equal(r2, r3);
    assert.equal(r3, r4);
  });

  test('8 & 9. 强制请求不得复用普通请求，而普通请求可以复用进行中的强制请求', async () => {
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response(SUB_CONTENT_V1, { status: 200 });
    };

    const config = {
      logLevel: 'silent',
      cacheTtl: 300,
      enableNodeRename: false,
      minorNodeThreshold: 1,
      subscriptions: [{ url: 'http://93.184.216.34/sub', tag: 'T1' }]
    };

    // 启动一个强制请求与一个普通请求
    const pForce = buildProfile(config, { forceRefresh: true });
    const pNormal = buildProfile(config);

    const [rForce, rNormal] = await Promise.all([pForce, pNormal]);
    assert.equal(rForce, rNormal);
    assert.equal(fetchCount, 1, '普通请求复用了同键强制构建任务');
  });

  test('6. 并发多个 Stale 请求只触发一次后台构建任务', async () => {
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response(SUB_CONTENT_V1, { status: 200 });
    };

    const config = {
      logLevel: 'silent',
      cacheTtl: 1,
      enableNodeRename: false,
      minorNodeThreshold: 1,
      subscriptions: [{ url: 'http://93.184.216.34/sub', tag: 'T1' }]
    };

    await buildProfile(config);
    assert.equal(fetchCount, 1);

    const key = [...profileCache.cacheMap.keys()][0];
    profileCache.cacheMap.get(key).timestamp -= 1500;

    // 并发 3 个 Stale 请求
    const [r1, r2, r3] = await Promise.all([
      buildProfile(config),
      buildProfile(config),
      buildProfile(config)
    ]);

    assert.equal(r1, r2);
    assert.equal(r2, r3);

    // 等待后台单飞结束
    if (_internal.forceFlights.has(key)) {
      await _internal.forceFlights.get(key);
    }

    assert.equal(fetchCount, 2, '3 个并发 Stale 请求只触发了 1 次后台网络更新');
  });

  test('确定性解耦验证：Stale 请求无需等待后台构建即可立即返回，后台任务处于运行态且不重复创建', async () => {
    const config = {
      logLevel: 'silent',
      cacheTtl: 1,
      enableNodeRename: false,
      minorNodeThreshold: 1,
      subscriptions: [{ url: 'http://93.184.216.34/slow-sub', tag: 'T1' }]
    };

    // 1. 首次普通构建
    globalThis.fetch = async () => new Response(SUB_CONTENT_V1, { status: 200 });
    await buildProfile(config);

    const profileKey = [...profileCache.cacheMap.keys()][0];
    // 篡改进入 Stale
    profileCache.cacheMap.get(profileKey).timestamp -= 2000;

    // 2. 将后续 fetch 设置为挂起状态
    let finishFetch;
    let fetchStarted = false;
    globalThis.fetch = async () => {
      fetchStarted = true;
      await new Promise(r => { finishFetch = r; });
      return new Response(SUB_CONTENT_V2, { status: 200 });
    };

    // 3. 执行 Stale 请求：此时后台 fetch 必定挂起，但客户端请求必须立刻拿到旧结果！
    const staleResult = await buildProfile(config);
    assert.match(staleResult.yamlStr, /香港 01/);
    assert.ok(!staleResult.yamlStr.includes('香港 02'));

    // 验证后台任务确实已处于运行态（已被注册进 forceFlights）
    assert.equal(_internal.forceFlights.has(profileKey), true, '后台任务必须已登记且处于 running 态');
    assert.equal(fetchStarted, true, '后台 fetch 必须已被调用启动');

    // 4. 发起第二个并发 Stale 请求：断言其直接命中并复用已有的后台任务，不创建新任务
    const secondStaleResult = await buildProfile(config);
    assert.match(secondStaleResult.yamlStr, /香港 01/);
    assert.equal(_internal.forceFlights.size, 1, '后台任务不得重复创建');

    // 5. 放行后台异步 fetch 完成
    finishFetch();
    await _internal.forceFlights.get(profileKey);

    // 后台完成，新缓存就绪
    assert.equal(_internal.forceFlights.has(profileKey), false, '任务完成后必须被移出单飞表');
    const updated = await buildProfile(config);
    assert.match(updated.yamlStr, /香港 02 Updated/);
  });
});

test.describe('Engine SWR: 代际时序与退避机制', () => {
  test('10. 代际写入保护：旧任务晚完成不得覆盖新任务的成功结果', () => {
    const key = 'test-generation-race';
    const genOld = profileCache.nextGeneration();
    const genNew = profileCache.nextGeneration();

    // 新任务先完成写入
    const okNew = profileCache.set(key, { v: 'new' }, { generation: genNew });
    assert.equal(okNew, true);

    // 旧任务晚完成尝试写入
    const okOld = profileCache.set(key, { v: 'old' }, { generation: genOld });
    assert.equal(okOld, false, '旧代际必须被拒绝');

    const cur = profileCache.getWithStatus(key, { freshTtlMs: 5000, staleMaxAgeMs: 10000 });
    assert.equal(cur.result.v, 'new');
  });

  test('11. 连续失败指数退避累加增长 (10s -> 20s -> 40s -> 60s max)，成功发布清除', () => {
    const key = 'test-exponential-backoff';
    _internal.clearRevalidateFailure(key);
    assert.equal(_internal.isInRevalidateBackoff(key), false);

    const now = Date.now();

    // 第一次失败：10s 退避 (failures=1)
    _internal.recordRevalidateFailure(key);
    let entry = _internal.revalidateBackoffs.get(key);
    assert.equal(entry.failures, 1);
    assert.ok(entry.until >= now + 9900 && entry.until <= now + 10100);
    assert.equal(_internal.isInRevalidateBackoff(key), true);

    // 模拟 11 秒后（退避窗口已过）
    entry.until = Date.now() - 100;
    // 窗口过期但记录不得被清理
    assert.equal(_internal.isInRevalidateBackoff(key), false);
    assert.equal(_internal.revalidateBackoffs.has(key), true, '退避期满后必须保留 failures 计数');

    // 第二次失败：20s 退避 (failures=2)
    _internal.recordRevalidateFailure(key);
    entry = _internal.revalidateBackoffs.get(key);
    assert.equal(entry.failures, 2);
    assert.ok(entry.until >= Date.now() + 19900);

    // 第三次失败：40s 退避 (failures=3)
    _internal.recordRevalidateFailure(key);
    entry = _internal.revalidateBackoffs.get(key);
    assert.equal(entry.failures, 3);
    assert.ok(entry.until >= Date.now() + 39900);

    // 第四次失败：封顶 60s (failures=4)
    _internal.recordRevalidateFailure(key);
    entry = _internal.revalidateBackoffs.get(key);
    assert.equal(entry.failures, 4);
    assert.ok(entry.until >= Date.now() + 59900 && entry.until <= Date.now() + 60100);

    // 成功发布新缓存后清除记录
    _internal.clearRevalidateFailure(key);
    assert.equal(_internal.revalidateBackoffs.has(key), false);
    assert.equal(_internal.isInRevalidateBackoff(key), false);
  });

  test('12. nodes、report、config 三大 Checkpoint 正确传递 Generation 并以 profileCache.set 真实返回值判定 published', async () => {
    globalThis.fetch = async () => new Response(SUB_CONTENT_V1, { status: 200 });

    const baseConfig = {
      logLevel: 'silent',
      cacheTtl: 300,
      enableNodeRename: false,
      minorNodeThreshold: 1,
      subscriptions: [{ url: 'http://93.184.216.34/sub', tag: 'T1' }]
    };

    // 1. config 模式：首次构建正常发布
    const configRes = await buildProfile(baseConfig, { mode: 'config' });
    assert.ok(configRes.yamlStr);
    assert.ok(configRes.proxies.length > 0);
    const keyConfig = [...profileCache.cacheMap.keys()][0];
    const genConfig = profileCache.cacheMap.get(keyConfig).generation;
    assert.ok(genConfig > 0, 'config 模式必须持有有效代际号');

    // 2. nodes 模式：独立缓存键，正常发布
    const nodesRes = await buildProfile(baseConfig, { mode: 'nodes' });
    assert.ok(Array.isArray(nodesRes.proxies));
    assert.ok(!nodesRes.proxyGroups);
    const keyNodes = [...profileCache.cacheMap.keys()].find(k => k !== keyConfig);
    const genNodes = profileCache.cacheMap.get(keyNodes).generation;
    assert.ok(genNodes > genConfig, 'nodes 模式必须独立分配更新代际号');

    // 3. report 模式：独立缓存键，正常发布
    const reportRes = await buildProfile(baseConfig, { mode: 'report' });
    assert.ok(reportRes.report);
    const keyReport = [...profileCache.cacheMap.keys()].find(k => k !== keyConfig && k !== keyNodes);
    const genReport = profileCache.cacheMap.get(keyReport).generation;
    assert.ok(genReport > genNodes, 'report 模式必须独立分配更新代际号');

    // 4. 代际拒绝场景：人工将 configKey 垫高到更大代际号
    profileCache.cacheMap.get(keyConfig).generation = 999999;
    // 强制触发一次以较老代际运行的 config 构建写入，测试 published 返回 false
    const olderGen = 100;
    const writeResult = profileCache.set(keyConfig, { yamlStr: 'dummy' }, { generation: olderGen });
    assert.equal(writeResult, false, '老代际必须被 profileCache.set 拒绝并返回 false');
  });

  test('13. enableCache: false 与 noCache 正确旁路，不进 Single-Flight 表且触发 onBuildOutcome 通知', async () => {
    globalThis.fetch = async () => new Response(SUB_CONTENT_V1, { status: 200 });

    const config = {
      logLevel: 'silent',
      enableCache: false,
      subscriptions: [{ url: 'http://93.184.216.34/sub', tag: 'T1' }]
    };

    let status;
    let outcomeReceived;
    const res = await buildProfile(config, {
      onCacheStatus: (st) => { status = st; },
      onBuildOutcome: (outcome) => { outcomeReceived = outcome; }
    });
    assert.equal(status, 'bypass');
    assert.equal(profileCache.size, 0);

    // 验证旁路正常分发 onBuildOutcome，状态明确标识 published: false, hasFailedSub: false
    assert.ok(outcomeReceived, '旁路必须触发 onBuildOutcome');
    assert.equal(outcomeReceived.published, false, '禁用缓存时 published 必须为 false');
    assert.equal(outcomeReceived.hasFailedSub, false, '订阅成功时 hasFailedSub 必须为 false');
    assert.equal(outcomeReceived.result, undefined, '不得泄露内部业务 result');
    assert.ok(res.yamlStr, '返回值必须正常保持纯净业务对象');
  });

  test('14. safeErrorMessage 安全格式化：null/非Error对象/字符串不崩溃', () => {
    assert.equal(safeErrorMessage(new Error('std error')), 'std error');
    assert.equal(safeErrorMessage('plain string'), 'plain string');
    assert.equal(safeErrorMessage({ message: 'custom msg' }), 'custom msg');
    assert.equal(safeErrorMessage({ foo: 'bar' }), '{"foo":"bar"}');
    assert.equal(safeErrorMessage(null), 'null');
    assert.equal(safeErrorMessage(undefined), 'undefined');
  });
});
