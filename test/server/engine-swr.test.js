/**
 * Pipeline Engine SWR & Single-Flight 机制验证
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { buildProfile, safeErrorMessage, _internal } = require('../../src/pipeline/engine');
const { profileCache } = require('../../src/io/cache');
const { subFailureBackoff } = require('../../src/io/fetcher');

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

describe('【Server】Pipeline 引擎 SWR 与并发任务控制 (engine-swr)', () => {
  beforeEach(() => {
    profileCache.clear();
    _internal.normalFlights.clear();
    _internal.forceFlights.clear();
    _internal.revalidateBackoffs.clear();
    subFailureBackoff.clear();
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('state-flow - SWR 缓存状态流转与回调通知', () => {
    it('status:fresh - Fresh 命中直接返回同一缓存对象，不触发网络拉取 [SWR-1]', async () => {
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

    it('status:stale - Stale 优先返回旧快照，后台异步 Revalidate 更新新结果 [SWR-2/3]', async () => {
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

      assert.equal(fetchCount, 2, '后台 Revalidate 执行了实际网络拉取');

      // 下一次请求应该拿到后台更新后的新缓存
      let nextStatus;
      const freshResult = await buildProfile(config, {
        onCacheStatus: (st) => { nextStatus = st; }
      });
      assert.equal(nextStatus, 'fresh');
      assert.match(freshResult.yamlStr, /香港 02 Updated/);
    });

    it('status:stale - 后台刷新异常时平滑保留旧快照，不产生未捕获异常 [SWR-4]', async () => {
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

      const key = [...profileCache.cacheMap.keys()][0];
      profileCache.cacheMap.get(key).timestamp -= 1500;

      shouldFail = true;

      let status;
      const r = await buildProfile(config, {
        onCacheStatus: (st) => { status = st; }
      });

      assert.equal(status, 'stale');
      assert.match(r.yamlStr, /香港 01/);

      if (_internal.forceFlights.has(key)) {
        try { await _internal.forceFlights.get(key); } catch (_) {}
      }

      assert.ok(profileCache.has(key));
    });

    it('status:miss - 部分订阅失败时发布降级缓存，不阻塞整体写入或触发整体退避 [SWR-5]', async () => {
      globalThis.fetch = async (url) => {
        if (url.includes('sub2')) {
          return new Response('Not Found', { status: 404 });
        }
        return new Response(SUB_CONTENT_V1, { status: 200 });
      };

      const config = {
        logLevel: 'silent',
        cacheTtl: 1,
        fetchStaleTtl: 0,
        enableNodeRename: false,
        minorNodeThreshold: 1,
        subscriptions: [
          { url: 'http://93.184.216.34/sub1', tag: 'T1' },
          { url: 'http://93.184.216.34/sub2', tag: 'T2', retry: 0 }
        ]
      };

      const r = await buildProfile(config);
      assert.match(r.yamlStr, /香港 01/);

      // 冷启动无旧快照可保留：健康订阅仍可用，降级结果照常发布
      const key = [...profileCache.cacheMap.keys()][0];
      const meta = profileCache.cacheMap.get(key).meta;
      assert.equal(meta.degraded, true);
      assert.equal(meta.usableSubCount, 1);
      assert.deepEqual(meta.failedTags, ['T2']);
      // 单订阅失败走独立退避，不触发 Profile 级退避
      assert.equal(_internal.isInRevalidateBackoff(key), false);
      assert.equal(subFailureBackoff.get('http://93.184.216.34/sub2')?.failures, 1);
    });

    it('status:stale - 部分订阅失败时照常发布降级缓存，由输入 LKG 到期兜底 [SWR-5b]', async () => {
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
        fetchStaleTtl: 0,
        enableNodeRename: false,
        minorNodeThreshold: 1,
        subscriptions: [
          { url: 'http://93.184.216.34/sub1', tag: 'T1' },
          { url: 'http://93.184.216.34/sub2', tag: 'T2', retry: 0 }
        ]
      };

      await buildProfile(config);
      const key = [...profileCache.cacheMap.keys()][0];
      assert.equal(profileCache.cacheMap.get(key).meta.degraded, false);

      profileCache.cacheMap.get(key).timestamp -= 1500;
      isSecondRun = true;

      const r = await buildProfile(config);
      assert.match(r.yamlStr, /香港 01/);

      if (_internal.forceFlights.has(key)) {
        try { await _internal.forceFlights.get(key); } catch (_) {}
      }

      // 单一时钟策略：T2 已无 LKG 可复用，重建结果正常发布（节点减少即真实可用量）
      const meta = profileCache.cacheMap.get(key).meta;
      assert.equal(meta.degraded, true);
      assert.equal(meta.usableSubCount, 1);
      assert.deepEqual(meta.failedTags, ['T2']);
      // 单订阅失败走独立退避，不触发 Profile 级退避
      assert.equal(_internal.isInRevalidateBackoff(key), false);
      assert.equal(subFailureBackoff.get('http://93.184.216.34/sub2')?.failures, 1);
    });
  });

  describe('single-flight - 并发单飞请求合并规则', () => {
    it('normal-flights - 冷启动并发多个同键请求单飞合并为一次实际构建 [SWR-7]', async () => {
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

    it('flight-reuse - 强制请求不得复用普通请求，而普通请求可以复用进行中的强制请求 [SWR-8/9]', async () => {
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

      const pForce = buildProfile(config, { forceRefresh: true });
      const pNormal = buildProfile(config);

      const [rForce, rNormal] = await Promise.all([pForce, pNormal]);
      assert.equal(rForce, rNormal);
      assert.equal(fetchCount, 1, '普通请求复用了同键强制构建任务');
    });

    it('stale-flights - 并发多个 Stale 请求只触发一次后台构建任务 [SWR-6]', async () => {
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

      const [r1, r2, r3] = await Promise.all([
        buildProfile(config),
        buildProfile(config),
        buildProfile(config)
      ]);

      assert.equal(r1, r2);
      assert.equal(r2, r3);

      if (_internal.forceFlights.has(key)) {
        await _internal.forceFlights.get(key);
      }

      assert.equal(fetchCount, 2, '3 个并发 Stale 请求只触发了 1 次后台网络更新');
    });

    it('decoupling - Stale 请求无需等待后台构建即可立即返回，后台任务处于运行态且不重复创建', async () => {
      const config = {
        logLevel: 'silent',
        cacheTtl: 1,
        enableNodeRename: false,
        minorNodeThreshold: 1,
        subscriptions: [{ url: 'http://93.184.216.34/slow-sub', tag: 'T1' }]
      };

      globalThis.fetch = async () => new Response(SUB_CONTENT_V1, { status: 200 });
      await buildProfile(config);

      const profileKey = [...profileCache.cacheMap.keys()][0];
      profileCache.cacheMap.get(profileKey).timestamp -= 2000;

      let finishFetch;
      let fetchStarted = false;
      globalThis.fetch = async () => {
        fetchStarted = true;
        await new Promise(r => { finishFetch = r; });
        return new Response(SUB_CONTENT_V2, { status: 200 });
      };

      const staleResult = await buildProfile(config);
      assert.match(staleResult.yamlStr, /香港 01/);
      assert.ok(!staleResult.yamlStr.includes('香港 02'));

      assert.equal(_internal.forceFlights.has(profileKey), true, '后台任务必须已登记且处于 running 态');
      assert.equal(fetchStarted, true, '后台 fetch 必须已被调用启动');

      const secondStaleResult = await buildProfile(config);
      assert.match(secondStaleResult.yamlStr, /香港 01/);
      assert.equal(_internal.forceFlights.size, 1, '后台任务不得重复创建');

      finishFetch();
      await _internal.forceFlights.get(profileKey);

      assert.equal(_internal.forceFlights.has(profileKey), false, '任务完成后必须被移出单飞表');
      const updated = await buildProfile(config);
      assert.match(updated.yamlStr, /香港 02 Updated/);
    });
  });

  describe('generation-backoff - 代际保护与失败指数退避', () => {
    it('generation - 代际写入保护：旧任务晚完成不得覆盖新任务的成功结果 [SWR-10]', () => {
      const key = 'test-generation-race';
      const genOld = profileCache.nextGeneration();
      const genNew = profileCache.nextGeneration();

      const okNew = profileCache.set(key, { v: 'new' }, { generation: genNew });
      assert.equal(okNew, true);

      const okOld = profileCache.set(key, { v: 'old' }, { generation: genOld });
      assert.equal(okOld, false, '旧代际必须被拒绝');

      const cur = profileCache.getWithStatus(key, { freshTtlMs: 5000, staleMaxAgeMs: 10000 });
      assert.equal(cur.result.v, 'new');
    });

    it('backoff - 连续失败指数退避累加 (10s -> 20s -> 40s -> 60s max)，成功发布清除 [SWR-11]', () => {
      const key = 'test-exponential-backoff';
      _internal.clearRevalidateFailure(key);
      assert.equal(_internal.isInRevalidateBackoff(key), false);

      const now = Date.now();

      _internal.recordRevalidateFailure(key);
      let entry = _internal.revalidateBackoffs.get(key);
      assert.equal(entry.failures, 1);
      assert.ok(entry.until >= now + 9900 && entry.until <= now + 10100);
      assert.equal(_internal.isInRevalidateBackoff(key), true);

      entry.until = Date.now() - 100;
      assert.equal(_internal.isInRevalidateBackoff(key), false);
      assert.equal(_internal.revalidateBackoffs.has(key), true, '退避期满后必须保留 failures 计数');

      _internal.recordRevalidateFailure(key);
      entry = _internal.revalidateBackoffs.get(key);
      assert.equal(entry.failures, 2);
      assert.ok(entry.until >= Date.now() + 19900);

      _internal.recordRevalidateFailure(key);
      entry = _internal.revalidateBackoffs.get(key);
      assert.equal(entry.failures, 3);
      assert.ok(entry.until >= Date.now() + 39900);

      _internal.recordRevalidateFailure(key);
      entry = _internal.revalidateBackoffs.get(key);
      assert.equal(entry.failures, 4);
      assert.ok(entry.until >= Date.now() + 59900 && entry.until <= Date.now() + 60100);

      _internal.clearRevalidateFailure(key);
      assert.equal(_internal.revalidateBackoffs.has(key), false);
      assert.equal(_internal.isInRevalidateBackoff(key), false);
    });

    it('checkpoints - nodes、report、config 三大 Checkpoint 正确传递 Generation 判定发布 [SWR-12]', async () => {
      globalThis.fetch = async () => new Response(SUB_CONTENT_V1, { status: 200 });

      const baseConfig = {
        logLevel: 'silent',
        cacheTtl: 300,
        enableNodeRename: false,
        minorNodeThreshold: 1,
        subscriptions: [{ url: 'http://93.184.216.34/sub', tag: 'T1' }]
      };

      const configRes = await buildProfile(baseConfig, { mode: 'config' });
      assert.ok(configRes.yamlStr);
      assert.ok(configRes.proxies.length > 0);
      const keyConfig = [...profileCache.cacheMap.keys()][0];
      const genConfig = profileCache.cacheMap.get(keyConfig).generation;
      assert.ok(genConfig > 0, 'config 模式必须持有有效代际号');

      const nodesRes = await buildProfile(baseConfig, { mode: 'nodes' });
      assert.ok(Array.isArray(nodesRes.proxies));
      assert.ok(!nodesRes.proxyGroups);
      const keyNodes = [...profileCache.cacheMap.keys()].find(k => k !== keyConfig);
      const genNodes = profileCache.cacheMap.get(keyNodes).generation;
      assert.ok(genNodes > genConfig, 'nodes 模式必须独立分配更新代际号');

      const reportRes = await buildProfile(baseConfig, { mode: 'report' });
      assert.ok(reportRes.report);
      const keyReport = [...profileCache.cacheMap.keys()].find(k => k !== keyConfig && k !== keyNodes);
      const genReport = profileCache.cacheMap.get(keyReport).generation;
      assert.ok(genReport > genNodes, 'report 模式必须独立分配更新代际号');

      profileCache.cacheMap.get(keyConfig).generation = 999999;
      const olderGen = 100;
      const writeResult = profileCache.set(keyConfig, { yamlStr: 'dummy' }, { generation: olderGen });
      assert.equal(writeResult, false, '老代际必须被 profileCache.set 拒绝并返回 false');
    });

    it('bypass - enableCache: false 与 noCache 正确旁路，不进单飞表且触发 onBuildOutcome [SWR-13]', async () => {
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

      assert.ok(outcomeReceived, '旁路必须触发 onBuildOutcome');
      assert.equal(outcomeReceived.published, false, '禁用缓存时 published 必须为 false');
      assert.equal(outcomeReceived.hasFailedSub, false, '订阅成功时 hasFailedSub 必须为 false');
      assert.equal(outcomeReceived.result, undefined, '不得泄露内部业务 result');
      assert.ok(res.yamlStr, '返回值必须正常保持纯净业务对象');
    });

    it('safeErrorMessage - 格式化防御：null/非Error对象/字符串不崩溃 [SWR-14]', () => {
      assert.equal(safeErrorMessage(new Error('std error')), 'std error');
      assert.equal(safeErrorMessage('plain string'), 'plain string');
      assert.equal(safeErrorMessage({ message: 'custom msg' }), 'custom msg');
      assert.equal(safeErrorMessage({ foo: 'bar' }), '{"foo":"bar"}');
      assert.equal(safeErrorMessage(null), 'null');
      assert.equal(safeErrorMessage(undefined), 'undefined');
    });
  });

  describe('degraded-cache - 部分失败降级与单订阅退避', () => {
    const baseConfig = (extra = {}) => ({
      logLevel: 'silent',
      cacheTtl: 300,
      fetchRetry: 0,
      enableNodeRename: false,
      minorNodeThreshold: 1,
      subscriptions: [
        { url: 'http://93.184.216.34/good', tag: 'T1' },
        { url: 'http://93.184.216.34/bad', tag: 'T2' }
      ],
      ...extra
    });

    it('partial-failure - 冷启动部分失败仍发布降级缓存，新鲜期内持续命中 [SWR-15]', async () => {
      const fetched = [];
      globalThis.fetch = async (u) => {
        fetched.push(String(u));
        if (String(u).includes('/bad')) return new Response('Not Found', { status: 404 });
        return new Response(SUB_CONTENT_V1, { status: 200 });
      };

      const config = baseConfig();
      let outcome;
      let status;
      await buildProfile(config, {
        onBuildOutcome: (o) => { outcome = o; },
        onCacheStatus: (s) => { status = s; }
      });

      assert.equal(status, 'miss');
      assert.equal(outcome.published, true, '仍有可用订阅时必须发布缓存');
      assert.equal(outcome.degraded, true);
      assert.equal(outcome.hasFailedSub, true);
      assert.equal(outcome.hasTerminalFailure, false);
      assert.equal(outcome.usableSubCount, 1);
      assert.deepEqual(outcome.failedTags, ['T2']);

      const key = [...profileCache.cacheMap.keys()][0];
      assert.equal(profileCache.cacheMap.get(key).meta.degraded, true);
      assert.equal(profileCache.cacheMap.get(key).meta.usableSubCount, 1);

      const before = fetched.length;
      status = null;
      await buildProfile(config, { onCacheStatus: (s) => { status = s; } });
      assert.equal(status, 'fresh');
      assert.equal(fetched.length, before, '降级缓存新鲜期内不得回源');
    });

    it('partial-failure - 降级新鲜期收紧到 60s，恢复后升级为健康 Fresh [SWR-16]', async () => {
      let badDown = true;
      globalThis.fetch = async (u) => {
        if (badDown && String(u).includes('/bad')) return new Response('Not Found', { status: 404 });
        return new Response(SUB_CONTENT_V1, { status: 200 });
      };

      const config = baseConfig();
      await buildProfile(config);
      const key = [...profileCache.cacheMap.keys()][0];

      // cacheTtl=300s，但降级条目的新鲜期只保留 60s
      profileCache.cacheMap.get(key).timestamp -= 61 * 1000;
      let status;
      await buildProfile(config, { onCacheStatus: (s) => { status = s; } });
      assert.equal(status, 'stale', '降级缓存超过 60s 必须转入 Stale 并触发后台刷新');

      if (_internal.forceFlights.has(key)) {
        try { await _internal.forceFlights.get(key); } catch (_) {}
      }

      badDown = false;
      let outcome;
      const res = await buildProfile(config, {
        forceRefresh: true,
        onBuildOutcome: (o) => { outcome = o; }
      });
      assert.equal(outcome.degraded, false, '全部订阅恢复后必须升级为健康结果');
      assert.equal(outcome.usableSubCount, 2);
      assert.equal(profileCache.cacheMap.get(key).meta.degraded, false);
      assert.match(res.yamlStr, /香港 01/);
    });

    it('mixed-terminal - 单条订阅 401 仅降级，不得删除多订阅健康缓存 [SWR-17]', async () => {
      globalThis.fetch = async () => new Response(SUB_CONTENT_V1, { status: 200 });
      const config = baseConfig();
      await buildProfile(config);
      const key = [...profileCache.cacheMap.keys()][0];
      assert.equal(profileCache.cacheMap.get(key).meta.degraded, false);

      globalThis.fetch = async (u) => String(u).includes('/bad')
        ? new Response('Unauthorized', { status: 401 })
        : new Response(SUB_CONTENT_V1, { status: 200 });

      let outcome;
      await buildProfile(config, { forceRefresh: true, onBuildOutcome: (o) => { outcome = o; } });

      assert.equal(outcome.published, true);
      assert.equal(outcome.degraded, true);
      assert.equal(outcome.hasTerminalFailure, false, '仍有健康订阅时不得判定整体终态失效');
      assert.equal(outcome.usableSubCount, 1);
      assert.deepEqual(outcome.failedTags, ['T2']);
      assert.ok(profileCache.has(key), '单条 401 不得淘汰多订阅健康缓存');
      assert.equal(profileCache.cacheMap.get(key).meta.degraded, true);

      let status;
      const res = await buildProfile(config, { onCacheStatus: (s) => { status = s; } });
      assert.equal(status, 'fresh');
      assert.match(res.yamlStr, /香港 01/);
    });

    it('all-terminal - 全部订阅 401 时 fail-closed 并淘汰 Profile 缓存 [SWR-18]', async () => {
      globalThis.fetch = async () => new Response(SUB_CONTENT_V1, { status: 200 });
      const config = baseConfig();
      await buildProfile(config);
      const key = [...profileCache.cacheMap.keys()][0];
      assert.ok(profileCache.has(key));

      globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
      let outcome;
      await buildProfile(config, { forceRefresh: true, onBuildOutcome: (o) => { outcome = o; } });

      assert.equal(outcome.published, false);
      assert.equal(outcome.usableSubCount, 0);
      assert.equal(outcome.hasTerminalFailure, true);
      assert.equal(profileCache.has(key), false, '全部终态失效时必须淘汰旧 Profile 快照');
    });

    it('stale-fallback - 单订阅回退旧缓存时标记为降级交付 [SWR-19]', async () => {
      const url = 'http://93.184.216.34/solo';
      globalThis.fetch = async () => new Response(SUB_CONTENT_V1, { status: 200 });
      const config = {
        logLevel: 'silent',
        cacheTtl: 300,
        fetchRetry: 0,
        enableNodeRename: false,
        minorNodeThreshold: 1,
        subscriptions: [{ url, tag: 'Solo' }]
      };
      await buildProfile(config);
      const key = [...profileCache.cacheMap.keys()][0];

      globalThis.fetch = async () => { throw new TypeError('Network unreachable'); };
      let outcome;
      const res = await buildProfile(config, { forceRefresh: true, onBuildOutcome: (o) => { outcome = o; } });

      assert.equal(outcome.degraded, true);
      assert.equal(outcome.hasFailedSub, true);
      assert.equal(outcome.hasTerminalFailure, false);
      assert.equal(outcome.usableSubCount, 1);
      assert.deepEqual(outcome.staleTags, ['Solo']);
      assert.match(res.yamlStr, /香港 01/, '旧缓存内容仍可交付');
      assert.equal(profileCache.cacheMap.get(key).meta.degraded, true);
    });

    it('sub-backoff - 退避期跳过网络，显式强制刷新可探测恢复，成功后清除退避 [SWR-20]', async () => {
      const url = 'http://93.184.216.34/backoff';
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        throw new TypeError('Network unreachable');
      };

      const config = {
        logLevel: 'silent',
        cacheTtl: 300,
        fetchRetry: 0,
        enableNodeRename: false,
        minorNodeThreshold: 1,
        subscriptions: [{ url, tag: 'B1' }]
      };

      let outcome;
      await buildProfile(config, { onBuildOutcome: (o) => { outcome = o; } });
      assert.equal(calls, 1, '首次构建应真实回源一次');
      assert.equal(outcome.published, false);
      assert.equal(outcome.usableSubCount, 0);
      assert.equal(subFailureBackoff.get(url)?.failures, 1);

      // 退避期内普通请求：跳过网络、快速失败，且失败计数不再累加
      await buildProfile(config, { onBuildOutcome: (o) => { outcome = o; } });
      assert.equal(calls, 1, '退避期内不得回源');
      assert.equal(subFailureBackoff.get(url)?.failures, 1, '跳过网络不得累加失败次数');

      // 显式强制刷新绕过退避，用于主动探测恢复
      globalThis.fetch = async () => {
        calls++;
        return new Response(SUB_CONTENT_V1, { status: 200 });
      };
      await buildProfile(config, { forceRefresh: true, onBuildOutcome: (o) => { outcome = o; } });
      assert.equal(calls, 2, '显式强制刷新必须绕过单订阅退避');
      assert.equal(outcome.published, true);
      assert.equal(outcome.degraded, false);
      assert.equal(subFailureBackoff.has(url), false, '拉取成功后必须清除退避状态');
    });
  });
});
