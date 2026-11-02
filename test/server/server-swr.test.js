/**
 * Server SWR, X-Cache Headers & Guarded Background Refresh
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const yaml = require('yaml');
const { startServer, mapCacheStatusToHeader } = require('../../src/targets/server');
const { profileCache } = require('../../src/io/cache');
const { buildProfile, _internal } = require('../../src/pipeline/engine');
const { createLogger } = require('../../src/core/logger');
const { subFailureBackoff, subStaleCache } = require('../../src/io/fetcher');

const silentLogger = createLogger({ tag: 'Server', level: 'silent', colors: false });

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

const SUB_YAML = Buffer.from(`
proxies:
  - name: "🇭🇰 香港 01"
    type: ss
    server: hk.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');

async function startTestServer(options) {
  const server = startServer({ port: 0, logger: silentLogger, ...options });
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }
  return { server, port: server.address().port };
}

function request(port, pathStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathStr,
        method: 'GET',
        headers,
        agent: false
      },
      (res) => {
        let body = '';
        res.setEncoding('utf-8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('【Server】HTTP 服务端 SWR 与后台防重叠刷新 (server-swr)', () => {
  beforeEach(() => {
    profileCache.clear();
    _internal.normalFlights.clear();
    _internal.forceFlights.clear();
    _internal.fetchOnlyFlights.clear();
    _internal.revalidateBackoffs.clear();
    subFailureBackoff.clear();
    subStaleCache.clear();
  });

  afterEach(() => {
    restoreFetch();
  });

  describe('headers - X-Cache 响应头流转与映射', () => {
    it('mapCacheStatusToHeader - 状态映射一致性', () => {
      assert.equal(mapCacheStatusToHeader('fresh'), 'HIT');
      assert.equal(mapCacheStatusToHeader('stale'), 'STALE');
      assert.equal(mapCacheStatusToHeader('miss'), 'MISS');
      assert.equal(mapCacheStatusToHeader('force'), 'BYPASS');
      assert.equal(mapCacheStatusToHeader('bypass'), 'BYPASS');
      assert.equal(mapCacheStatusToHeader('unknown'), 'BYPASS');
    });

    it('X-Cache - 首次 Miss 返回 MISS，随后 Fresh 返回 HIT', async () => {
      globalThis.fetch = async () => new Response(SUB_YAML, { status: 200 });

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-swr-'));
      const configFile = path.join(dir, 'config.yaml');
      fs.writeFileSync(configFile, `
logLevel: silent
cacheTtl: 300
enableWarmup: false
enableNodeRename: false
minorNodeThreshold: 1
subscriptions:
  - url: http://93.184.216.34/sub
    tag: T1
`, 'utf-8');

      const { server, port } = await startTestServer({ configPath: configFile });

      try {
        const res1 = await request(port, '/sub');
        assert.equal(res1.status, 200);
        assert.equal(res1.headers['x-cache'], 'MISS');
        assert.match(res1.body, /香港 01/);

        const res2 = await request(port, '/sub');
        assert.equal(res2.status, 200);
        assert.equal(res2.headers['x-cache'], 'HIT');
        assert.match(res2.body, /香港 01/);
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('X-Cache - Stale 请求返回 STALE 且不被后台 Revalidate 篡改', async () => {
      globalThis.fetch = async () => new Response(SUB_YAML, { status: 200 });

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-swr-'));
      const configFile = path.join(dir, 'config.yaml');
      fs.writeFileSync(configFile, `
logLevel: silent
cacheTtl: 1
cacheStaleMaxAge: 100
enableWarmup: false
enableNodeRename: false
minorNodeThreshold: 1
subscriptions:
  - url: http://93.184.216.34/sub
    tag: T1
`, 'utf-8');

      const { server, port } = await startTestServer({ configPath: configFile });

      try {
        await request(port, '/sub');

        const key = [...profileCache.cacheMap.keys()][0];
        profileCache.cacheMap.get(key).timestamp -= 1500;

        let finishRevalidate;
        globalThis.fetch = async () => {
          await new Promise(r => { finishRevalidate = r; });
          return new Response(SUB_YAML, { status: 200 });
        };

        const resStale = await request(port, '/sub');
        assert.equal(resStale.status, 200);
        assert.equal(resStale.headers['x-cache'], 'STALE');
        assert.match(resStale.body, /香港 01/);

        finishRevalidate();
        if (_internal.forceFlights.has(key)) {
          await _internal.forceFlights.get(key);
        }
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('X-Cache - ?refresh=1 强制刷新返回 BYPASS', async () => {
      globalThis.fetch = async () => new Response(SUB_YAML, { status: 200 });

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-swr-'));
      const configFile = path.join(dir, 'config.yaml');
      fs.writeFileSync(configFile, `
logLevel: silent
cacheTtl: 300
refreshCooldown: 0
enableWarmup: false
enableNodeRename: false
minorNodeThreshold: 1
subscriptions:
  - url: http://93.184.216.34/sub
    tag: T1
`, 'utf-8');

      const { server, port } = await startTestServer({ configPath: configFile });

      try {
        await request(port, '/sub');

        const resForce = await request(port, '/sub?refresh=1');
        assert.equal(resForce.status, 200);
        assert.equal(resForce.headers['x-cache'], 'BYPASS');
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('headers - X-Degraded / X-Stale-Subs 降级状态透出', () => {
    it('降级构建与其后的缓存命中都透出降级状态头与看板提示', async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return calls === 1
          ? new Response(SUB_YAML, { status: 200 })
          : new Response('upstream down', { status: 500 });
      };

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-degraded-'));
      const configFile = path.join(dir, 'config.yaml');
      fs.writeFileSync(configFile, `
logLevel: silent
cacheTtl: 300
refreshCooldown: 0
enableWarmup: false
enableNodeRename: false
minorNodeThreshold: 1
subscriptions:
  - url: http://93.184.216.34/sub
    tag: T1
`, 'utf-8');

      const { server, port } = await startTestServer({ configPath: configFile });

      try {
        const healthy = await request(port, '/sub');
        assert.equal(healthy.status, 200);
        assert.equal(healthy.headers['x-cache'], 'MISS');
        assert.equal(healthy.headers['x-degraded'], undefined);

        // 回源失败 → L1 旧快照兜底构建，响应必须透出降级状态
        const degraded = await request(port, '/sub?refresh=1');
        assert.equal(degraded.status, 200);
        assert.equal(degraded.headers['x-cache'], 'BYPASS');
        assert.equal(degraded.headers['x-degraded'], '1');
        assert.equal(degraded.headers['x-stale-subs'], 'T1');
        assert.match(degraded.body, /拉取异常/);

        // 命中降级缓存时状态不能丢
        const degradedHit = await request(port, '/sub');
        assert.equal(degradedHit.headers['x-cache'], 'HIT');
        assert.equal(degradedHit.headers['x-degraded'], '1');
        assert.equal(degradedHit.headers['x-stale-subs'], 'T1');
        assert.match(degradedHit.body, /拉取异常/);
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('隔离性 - ?url= 外部异常请求不得污染主服务 buildHealth 与后续 localOnly 请求', async () => {
      globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes('bad-upstream')) {
          return new Response('upstream 500', { status: 500 });
        }
        return new Response(SUB_YAML, { status: 200 });
      };

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-isolation-'));
      const configFile = path.join(dir, 'config.yaml');
      fs.writeFileSync(configFile, `
logLevel: silent
cacheTtl: 300
refreshCooldown: 0
enableWarmup: false
subscriptions:
  - url: http://93.184.216.34/sub
    tag: LOCAL_OK
`, 'utf-8');

      const { server, port } = await startTestServer({ configPath: configFile });

      try {
        // 1. 本地请求初始健康
        const first = await request(port, '/sub');
        assert.equal(first.status, 200);
        assert.equal(first.headers['x-degraded'], undefined);

        // 2. 外部参数化请求异常
        await request(port, '/sub?url=http://93.184.216.35/bad-upstream');

        // 3. 后续本地请求绝对不得被外部请求污染状态
        const second = await request(port, '/sub');
        assert.equal(second.status, 200);
        assert.equal(second.headers['x-degraded'], undefined, '外部请求失败绝不能导致本地订阅透出 X-Degraded');
        assert.equal(second.headers['x-failed-subs'], undefined);
        assert.equal(second.headers['x-stale-subs'], undefined);
        assert.ok(!second.body.includes('bad-upstream'));

        // 4. /healthz 监控指标中 degraded 必须保持 false
        const health = await request(port, '/healthz');
        const healthJson = JSON.parse(health.body);
        assert.equal(healthJson.subscriptions.degraded, false);
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('guarded-refresh - 后台刷新防重叠锁与任务合并', () => {
    it('refresh-lock - 预热与定时任务共享刷新锁：上一轮未完成时跳过并记录告警，锁正常释放', async () => {
      let fetchRunning = false;
      let finishWarmup;

      globalThis.fetch = async () => {
        fetchRunning = true;
        await new Promise(r => { finishWarmup = r; });
        return new Response(SUB_YAML, { status: 200 });
      };

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-swr-'));
      const configFile = path.join(dir, 'config.yaml');
      fs.writeFileSync(configFile, `
logLevel: silent
cacheTtl: 300
enableWarmup: true
autoRefreshInterval: 1
enableNodeRename: false
minorNodeThreshold: 1
subscriptions:
  - url: http://93.184.216.34/sub
    tag: T1
`, 'utf-8');

      const { server } = await startTestServer({ configPath: configFile });

      try {
        while (!fetchRunning) {
          await new Promise(r => setTimeout(r, 20));
        }

        await new Promise(r => setTimeout(r, 1100));

        finishWarmup();
        await new Promise(r => setTimeout(r, 100));
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('refresh-lock - 后台任务抛出异常后刷新锁可靠释放，后续任务正常执行', async () => {
      let shouldFail = true;

      globalThis.fetch = async () => {
        if (shouldFail) {
          throw new Error('Upstream crash');
        }
        return new Response(SUB_YAML, { status: 200 });
      };

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-swr-'));
      const configFile = path.join(dir, 'config.yaml');
      fs.writeFileSync(configFile, `
logLevel: silent
cacheTtl: 300
enableWarmup: true
enableNodeRename: false
minorNodeThreshold: 1
subscriptions:
  - url: http://93.184.216.34/sub
    tag: T1
`, 'utf-8');

      const { server, port } = await startTestServer({ configPath: configFile });

      try {
        await new Promise(r => setTimeout(r, 100));

        shouldFail = false;
        const res = await request(port, '/sub');
        assert.equal(res.status, 200);
        assert.match(res.body, /香港 01/);
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('logging - hasFailedSub 发生时后台任务准确报告未发布新缓存', async () => {
      globalThis.fetch = async () => new Response('404 Not Found', { status: 404 });

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-swr-'));
      const configFile = path.join(dir, 'config.yaml');
      fs.writeFileSync(configFile, `
logLevel: silent
cacheTtl: 300
fetchStaleTtl: 0
enableWarmup: true
enableNodeRename: false
minorNodeThreshold: 1
subscriptions:
  - url: http://93.184.216.34/fail-sub
    tag: T1
    retry: 0
`, 'utf-8');

      const logs = [];
      const captureLogger = createLogger({
        tag: 'Server',
        level: 'debug',
        colors: false,
        out: (msg) => { logs.push(msg); }
      });

      const { server } = await startTestServer({ configPath: configFile, logger: captureLogger });

      try {
        await new Promise(r => setTimeout(r, 200));

        const combinedLog = logs.join('\n');
        assert.ok(!combinedLog.includes('初始缓存预热完成'), '未成功发布时严禁声称预热完成');
        assert.match(combinedLog, /订阅快照预热完成，但部分订阅不可用/, '预热失败订阅应如实报告部分不可用');
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('co-flight - 复用正在运行的同键强制构建时，复用方精准获知发布状态且不重复回源', async () => {
      let fetchCount = 0;
      let finishFlight;

      globalThis.fetch = async () => {
        fetchCount++;
        await new Promise(r => { finishFlight = r; });
        return new Response(SUB_YAML, { status: 200 });
      };

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-swr-'));
      const configFile = path.join(dir, 'config.yaml');
      fs.writeFileSync(configFile, `
logLevel: silent
cacheTtl: 300
enableWarmup: false
enableNodeRename: false
minorNodeThreshold: 1
subscriptions:
  - url: http://93.184.216.34/shared-sub
    tag: T1
`, 'utf-8');

      const { server, port } = await startTestServer({ configPath: configFile });

      try {
        let clientFinished = false;
        let clientRes = null;
        const clientReq = http.request(
          { host: '127.0.0.1', port, path: '/sub?refresh=1', agent: false },
          (res) => {
            let body = '';
            res.setEncoding('utf-8');
            res.on('data', c => { body += c; });
            res.on('end', () => {
              clientRes = { status: res.statusCode, body };
              clientFinished = true;
            });
          }
        );
        clientReq.end();

        while (_internal.forceFlights.size === 0) {
          await new Promise(r => setTimeout(r, 10));
        }

        let sharedOutcome = null;
        const rawConfig = yaml.parse(fs.readFileSync(configFile, 'utf-8'));
        rawConfig.outputMode = 'config';

        const secondaryBuildPromise = buildProfile(rawConfig, {
          production: true,
          mode: 'config',
          forceRefresh: true,
          onBuildOutcome: (meta) => {
            sharedOutcome = meta;
          }
        });

        finishFlight();

        const secondaryRes = await secondaryBuildPromise;
        while (!clientFinished) {
          await new Promise(r => setTimeout(r, 10));
        }

        assert.equal(clientRes.status, 200);
        assert.match(secondaryRes.yamlStr, /香港 01/);
        assert.equal(fetchCount, 1, '同键任务必须单飞合并，严禁重复回源');

        assert.ok(sharedOutcome !== null, '复用方必须成功接收 onBuildOutcome 回调');
        assert.equal(sharedOutcome.published, true, '复用任务发布成功必须被准确报告');
        assert.equal(sharedOutcome.hasFailedSub, false);
        assert.equal(sharedOutcome.hasTerminalFailure, false, '复用方元数据契约必须包含 hasTerminalFailure');
        assert.equal(sharedOutcome.result, undefined, '内部元数据不得泄漏完整 result');
      } finally {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
