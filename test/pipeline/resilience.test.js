const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ResilienceContext,
  ResidentResilienceContext,
  StatelessResilienceContext,
  createResidentResilienceContext,
  createStatelessResilienceContext,
  resolveResilienceContext
} = require('../../src/pipeline/resilience');
const { subFailureBackoff, subStaleCache } = require('../../src/io/fetcher');

describe('【Pipeline】弹性策略上下文 (ResilienceContext)', () => {
  describe('StatelessResilienceContext (一次性运行 / CLI)', () => {
    it('纯无状态：isStateful 为 false，不读写退避表与快照缓存', () => {
      const ctx = createStatelessResilienceContext();
      assert.equal(ctx.isStateful, false);

      const url = 'http://93.184.216.34/test-stateless';
      assert.equal(ctx.isInBackoff(url), false);
      assert.equal(ctx.getBackoffState(url), null);
      assert.equal(ctx.formatBackoffDetail({ failures: 3, delayMs: 60000 }), '');

      // 记录失败为安全 no-op，绝不污染全局 subFailureBackoff
      subFailureBackoff.delete(url);
      const rec = ctx.recordFailure(url, new Error('network error'), false);
      assert.equal(rec, null);
      assert.equal(subFailureBackoff.has(url), false);

      // 快照查询恒为 null，保存为 no-op，绝不污染全局 subStaleCache
      subStaleCache.delete(url);
      assert.equal(ctx.getStaleSnapshot(url), null);
      assert.equal(ctx.getFreshSnapshot(url, 60000), null);
      ctx.saveSnapshot(url, 'proxies: []', null, 60000);
      assert.equal(subStaleCache.has(url), false);

      // 退避复用恒返回 null
      assert.equal(ctx.resolveBackoffStale(url, null, 60000), null);
    });

    it('evaluateStaleFallback: 保留终态判定能力，但不产生容灾回退决策与拒绝理由', () => {
      const ctx = createStatelessResilienceContext();

      // 401 终态
      const d401 = ctx.evaluateStaleFallback({ statusCode: 401 });
      assert.equal(d401.isTerminal, true);
      assert.equal(d401.terminalKind, 'http401');
      assert.equal(d401.allowFallback, false);
      assert.equal(d401.fallbackRejectReason, '');

      // 流量耗尽终态
      const dQuota = ctx.evaluateStaleFallback({ isQuotaExhausted: true });
      assert.equal(dQuota.isTerminal, true);
      assert.equal(dQuota.terminalKind, 'quota');
      assert.equal(dQuota.allowFallback, false);
      assert.equal(dQuota.fallbackRejectReason, '');

      // 瞬时网络异常：非终态，无兜底
      const dNet = ctx.evaluateStaleFallback(new Error('timeout'));
      assert.equal(dNet.isTerminal, false);
      assert.equal(dNet.allowFallback, false);
      assert.equal(dNet.fallbackRejectReason, '');
    });

    it('logFallbackReject: 安全 no-op，绝不输出「兜底被拒绝」日志', () => {
      const ctx = createStatelessResilienceContext();
      const logs = [];
      const dummyLogger = {
        debug: (msg) => logs.push(msg)
      };
      ctx.logFallbackReject(dummyLogger, 'http://test.com', '无可用缓存', { debug: true });
      assert.equal(logs.length, 0, '一次性模式绝不得输出兜底被拒绝日志');
    });
  });

  describe('ResidentResilienceContext (常驻服务 / Server)', () => {
    it('具备状态记忆能力：记录退避并在成功时清除', () => {
      const customBackoff = new Map();
      const customCache = new Map();
      customCache.getSnapshot = (k) => customCache.get(k) || null;
      customCache.getFresh = (k, ttl) => {
        const e = customCache.get(k);
        return e && (Date.now() - e.timestamp < ttl) ? e : null;
      };
      customCache.deleteIfMatch = (k, _snap) => customCache.delete(k);

      const ctx = new ResidentResilienceContext({
        staleCache: customCache,
        failureBackoff: customBackoff
      });
      assert.equal(ctx.isStateful, true);

      const url = 'http://93.184.216.34/test-resident';
      // 成功写入快照
      ctx.saveSnapshot(url, 'test-content', { expire: 0 }, 60000);
      assert.ok(customCache.has(url));
      assert.equal(ctx.getStaleSnapshot(url)?.content, 'test-content');
    });

    it('evaluateStaleFallback: 401 判定为终态并拒绝回退旧缓存', () => {
      const ctx = createResidentResilienceContext();
      const decision = ctx.evaluateStaleFallback({ statusCode: 401 });
      assert.equal(decision.isTerminal, true);
      assert.equal(decision.terminalKind, 'http401');
      assert.equal(decision.allowFallback, false);
      assert.ok(decision.fallbackRejectReason.includes('拒绝回退旧缓存'));
    });

    it('logFallbackReject: 常驻模式在 debug 下正常输出兜底决策日志', () => {
      const ctx = createResidentResilienceContext();
      const logs = [];
      const dummyLogger = {
        debug: (msg) => logs.push(msg)
      };
      ctx.logFallbackReject(dummyLogger, 'http://test.com', '缓存超过保留期限', { debug: true });
      assert.equal(logs.length, 1);
      assert.ok(logs[0].includes('兜底被拒绝'));
      assert.ok(logs[0].includes('缓存超过保留期限'));
    });
  });

  describe('基类契约', () => {
    it('evaluateStaleFallback 必须由子类实现，基类不得伪造非终态决策', () => {
      const ctx = new ResilienceContext();
      assert.throws(() => ctx.evaluateStaleFallback({ statusCode: 401 }), /必须由子类实现/);
    });
  });

  describe('顶层门面 (src/index.js)', () => {
    it('导出 createStatelessResilienceContext，供 SDK 显式选择一次性语义', () => {
      const facade = require('../../src/index');
      assert.equal(typeof facade.createStatelessResilienceContext, 'function');
      assert.equal(facade.createStatelessResilienceContext().isStateful, false);
    });

    it('不导出常驻上下文构造器，避免暴露测试注入钩子', () => {
      const facade = require('../../src/index');
      assert.equal(facade.createResidentResilienceContext, undefined);
    });
  });

  describe('resolveResilienceContext', () => {
    it('显式传入 resilience 时直接采用', () => {
      const custom = new StatelessResilienceContext();
      const resolved = resolveResilienceContext({ resilience: custom });
      assert.strictEqual(resolved, custom);
    });

    it('默认解析为 ResidentResilienceContext', () => {
      const resolved = resolveResilienceContext({});
      assert.ok(resolved instanceof ResidentResilienceContext);
      assert.equal(resolved.isStateful, true);
    });
  });
});
