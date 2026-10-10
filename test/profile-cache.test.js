/**
 * -----------------------------------------------------------------------------
 * Unit Test: Profile 内存缓存与 SWR 状态机测试
 * -----------------------------------------------------------------------------
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProfileCache, normalizeCacheDurations } = require('../src/io/cache');

test.describe('ProfileCache: 基础与兼容性', () => {
  test('旧 API 兼容：get(key, ttlMs) 在 TTL 内命中，超期物理删除并返回 null', () => {
    const cache = new ProfileCache({ maxEntries: 10 });
    cache.set('k1', { yamlStr: 'hello' });

    // 未过期命中
    const hit = cache.get('k1', 1000);
    assert.ok(hit);
    assert.equal(hit.result.yamlStr, 'hello');
    assert.equal(typeof hit.remainingSec, 'number');

    // 人工篡改 timestamp 模拟经过了 2000ms
    const entry = cache.cacheMap.get('k1');
    entry.timestamp -= 2000;

    // 超期调用：物理删除并返回 null
    const miss = cache.get('k1', 1000);
    assert.equal(miss, null);
    assert.equal(cache.has('k1'), false);
  });
});

test.describe('ProfileCache: SWR 三态状态机', () => {
  test('状态判断：Fresh -> Stale -> Miss 状态流转', () => {
    const cache = new ProfileCache({ maxEntries: 10 });
    const payload = { config: 'mock' };
    cache.set('profile-a', payload);

    const durations = {
      freshTtlMs: 500,        // 500ms 新鲜期
      staleMaxAgeMs: 2000     // 2000ms 最大总寿命
    };

    // 1. 刚刚写入：处于 Fresh
    const r1 = cache.getWithStatus('profile-a', durations);
    assert.equal(r1.status, 'fresh');
    assert.deepEqual(r1.result, payload);
    assert.ok(r1.remainingSec >= 0);

    // 2. 模拟时间推进 600ms（超过 500ms，但在 2000ms 内）：进入 Stale
    const entry = cache.cacheMap.get('profile-a');
    entry.timestamp -= 600;

    const r2 = cache.getWithStatus('profile-a', durations);
    assert.equal(r2.status, 'stale');
    assert.deepEqual(r2.result, payload);
    assert.ok(cache.has('profile-a'), 'Stale 状态必须保留缓存条目，不得删除');

    // 3. 模拟时间推进超过 2000ms：进入 Miss / Expired
    entry.timestamp -= 1500; // 累计已过去 2100ms > 2000ms
    const r3 = cache.getWithStatus('profile-a', durations);
    assert.equal(r3.status, 'miss');
    assert.equal(r3.result, null);
  });

  test('零 TTL 边界语义：freshTtlMs === 0 时立即进入 Stale', () => {
    const cache = new ProfileCache({ maxEntries: 10 });
    cache.set('profile-zero', { data: 123 });

    const durations = {
      freshTtlMs: 0,         // 0ms 新鲜期
      staleMaxAgeMs: 10000   // 10s 最大可用期
    };

    // 写入即可命中 Stale，不应判定为 Fresh
    const res = cache.getWithStatus('profile-zero', durations);
    assert.equal(res.status, 'stale');
    assert.equal(res.result.data, 123);
  });
});

test.describe('ProfileCache: 代际时序与并发防护', () => {
  test('单调递增 Generation：后启动的任务优先，老任务落后写入被安全拦截', () => {
    const cache = new ProfileCache({ maxEntries: 10 });

    const gen1 = cache.nextGeneration();
    const gen2 = cache.nextGeneration();
    assert.ok(gen2 > gen1, '代际号必须单调递增');

    // 模拟：任务 2 先完成并写入缓存
    const ok2 = cache.set('same-key', { version: 2 }, { generation: gen2 });
    assert.equal(ok2, true);

    const current = cache.getWithStatus('same-key', { freshTtlMs: 10000, staleMaxAgeMs: 20000 });
    assert.equal(current.result.version, 2);

    // 模拟：任务 1 后完成，尝试覆写同一键
    const ok1 = cache.set('same-key', { version: 1 }, { generation: gen1 });
    assert.equal(ok1, false, '较老代际任务写入必须被拦截拒绝');

    // 缓存依然为版本 2，未被踩踏
    const after = cache.getWithStatus('same-key', { freshTtlMs: 10000, staleMaxAgeMs: 20000 });
    assert.equal(after.result.version, 2);
  });

  test('代际计数单调安全：使用普通递增不回绕，超上限抛出安全异常', () => {
    const cache = new ProfileCache({ maxEntries: 10 });
    // 人工将内部计数器拨至上限前夕
    cache._generationCounter = Number.MAX_SAFE_INTEGER - 1;

    const g1 = cache.nextGeneration();
    assert.equal(g1, Number.MAX_SAFE_INTEGER);

    // 再次调用超过 MAX_SAFE_INTEGER 必须抛出错误，严禁回绕破坏单调性
    assert.throws(() => {
      cache.nextGeneration();
    }, /exceeded Number\.MAX_SAFE_INTEGER/);
  });
});

test.describe('ProfileCache: LRU 容量控制与元数据解耦', () => {
  test('LRU 淘汰：达到上限淘汰最久未访问条目', () => {
    const cache = new ProfileCache({ maxEntries: 3 });
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    cache.set('k3', 'v3');

    // 访问 k1，使 k2 成为最老条目
    cache.getWithStatus('k1', { freshTtlMs: 5000, staleMaxAgeMs: 10000 });

    // 写入第 4 个
    cache.set('k4', 'v4');
    assert.equal(cache.has('k2'), false, 'k2 应该被淘汰');
    assert.equal(cache.has('k1'), true);
    assert.equal(cache.has('k3'), true);
    assert.equal(cache.has('k4'), true);
  });

  test('LRU 修复：更新已存在的条目时，必须刷新其 LRU 顺序至末尾', () => {
    const cache = new ProfileCache({ maxEntries: 3 });
    cache.set('A', 'val-A');
    cache.set('B', 'val-B');
    cache.set('C', 'val-C');

    // 当前顺序 A -> B -> C
    // 此时更新 A
    cache.set('A', 'val-A-updated');

    // 插入全新条目 D，此时最老的条目应该是 B，而不是刚刚更新过的 A！
    cache.set('D', 'val-D');

    assert.equal(cache.has('B'), false, 'B 应该被 LRU 淘汰');
    assert.equal(cache.has('A'), true, '刚更新的 A 必须存活');
    assert.equal(cache.has('C'), true);
    assert.equal(cache.has('D'), true);
    assert.equal(cache.getWithStatus('A').result, 'val-A-updated');
  });

  test('纯净解耦：结果对象保持冻结/独立，元数据不污染 payload', () => {
    const cache = new ProfileCache({ maxEntries: 10 });
    const payload = Object.freeze({ yamlStr: 'proxies: []', count: 0 });

    cache.set('frozen-key', payload);
    const item = cache.getWithStatus('frozen-key', { freshTtlMs: 5000, staleMaxAgeMs: 10000 });

    assert.equal(item.status, 'fresh');
    assert.equal(item.result, payload);
    assert.equal(Object.isFrozen(item.result), true);
    assert.equal(item.result.isStale, undefined, 'payload 不得被污染挂载内部元数据');
  });
});

test.describe('normalizeCacheDurations 参数归一化与类型防御', () => {
  test('合法参数正常换算', () => {
    const res = normalizeCacheDurations({ cacheTtl: 60, cacheStaleMaxAge: 3600 });
    assert.equal(res.freshTtlMs, 60000);
    assert.equal(res.staleMaxAgeMs, 3600000);
  });

  test('默认值回退：非法值、负数、未定义', () => {
    const res1 = normalizeCacheDurations({});
    assert.equal(res1.freshTtlMs, 300000); // 300s
    assert.equal(res1.staleMaxAgeMs, 86400000); // 24h

    const res2 = normalizeCacheDurations({ cacheTtl: -10, cacheStaleMaxAge: 'invalid' });
    assert.equal(res2.freshTtlMs, 300000);
    assert.equal(res2.staleMaxAgeMs, 86400000);
  });

  test('隐式类型转换陷阱防御：null / 空字符串 / 布尔值不得意外转换成 0 或 1', () => {
    // 验证 null: Number(null) === 0
    const resNull = normalizeCacheDurations({ cacheTtl: null, cacheStaleMaxAge: null });
    assert.equal(resNull.freshTtlMs, 300000, 'null 绝不能变成 0，应回退默认 300s');
    assert.equal(resNull.staleMaxAgeMs, 86400000, 'null 绝不能变成 0，应回退默认 24h');

    // 验证空字符串: Number('') === 0
    const resEmpty = normalizeCacheDurations({ cacheTtl: '   ', cacheStaleMaxAge: '' });
    assert.equal(resEmpty.freshTtlMs, 300000, '空字符串绝不能变成 0');
    assert.equal(resEmpty.staleMaxAgeMs, 86400000);

    // 验证布尔值: Number(false) === 0, Number(true) === 1
    const resBool = normalizeCacheDurations({ cacheTtl: false, cacheStaleMaxAge: true });
    assert.equal(resBool.freshTtlMs, 300000, 'false 绝不能隐式转成 0');
    assert.equal(resBool.staleMaxAgeMs, 86400000, 'true 绝不能隐式转成 1s');
  });

  test('大小关系防御：staleMaxAge < freshTtl 时自动对齐', () => {
    const res = normalizeCacheDurations({ cacheTtl: 600, cacheStaleMaxAge: 300 });
    assert.equal(res.freshTtlMs, 600000);
    assert.equal(res.staleMaxAgeMs, 600000, 'staleMaxAge 自动对齐 freshTtl');
  });

  test('明确合法的零值与数字字符串零值保留', () => {
    // 数字 0
    const resZeroNum = normalizeCacheDurations({ cacheTtl: 0, cacheStaleMaxAge: 120 });
    assert.equal(resZeroNum.freshTtlMs, 0);
    assert.equal(resZeroNum.staleMaxAgeMs, 120000);

    // 字符串 "0"
    const resZeroStr = normalizeCacheDurations({ cacheTtl: '0', cacheStaleMaxAge: '120' });
    assert.equal(resZeroStr.freshTtlMs, 0);
    assert.equal(resZeroStr.staleMaxAgeMs, 120000);
  });
});
