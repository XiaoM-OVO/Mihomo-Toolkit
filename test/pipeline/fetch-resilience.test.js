﻿const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { buildProfile } = require('../../src/index.js');
const { profileCache } = require('../../src/io/cache.js');
const { subFailureBackoff, subStaleCache } = require('../../src/io/fetcher.js');

// 单订阅失败退避与原始订阅快照 (L1) 都是进程级内存状态，测试之间必须隔离
beforeEach(() => {
  subFailureBackoff.clear();
  subStaleCache.clear();
  profileCache.clear();
});

// 合法订阅内容（Base64 编码，含 2 个节点；使用域名服务器避免触发假IP清洗规则）
const SUB_CONTENT = Buffer.from(`
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

const originalFetch = globalThis.fetch;

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// 构建用基础配置（公共 IP 字面量，避免测试触发真实 DNS）
function baseConfig(url, extra = {}) {
  const { global = {}, ...subExtra } = extra;
  return {
    subscriptions: [{ url, tag: 'A', ...subExtra }],
    minorNodeThreshold: 1,
    ...global
  };
}

describe('【Pipeline】订阅拉取容灾与重试降级 (fetch-resilience)', () => {
  test('重试：5xx 连续失败后成功，节点不丢失', async () => {
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      if (fetchCount <= 2) return new Response('', { status: 503 });
      return new Response(SUB_CONTENT, { status: 200 });
    };
    try {
      const cfg = baseConfig('http://93.184.216.34/sub1', { retry: 2 });
      const { yamlStr } = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      assert.equal(fetchCount, 3);
      assert.ok(yamlStr.includes('香港'));
    } finally {
      restoreFetch();
    }
  });

  test('瞬时性 4xx 可重试：408 / 429 连续失败后成功', async () => {
    for (const status of [408, 429]) {
      let fetchCount = 0;
      globalThis.fetch = async () => {
        fetchCount++;
        if (fetchCount <= 2) return new Response('', { status });
        return new Response(SUB_CONTENT, { status: 200 });
      };
      try {
        const cfg = baseConfig('http://93.184.216.34/sub-retryable-' + status, { retry: 2 });
        const { yamlStr } = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
        assert.equal(fetchCount, 3, `${status} 应可重试，共尝试 3 次`);
        assert.ok(yamlStr.includes('香港'));
      } finally {
        restoreFetch();
      }
    }
  });

  test('确定性 4xx 不重试：403 只尝试一次', async () => {
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response('', { status: 403 });
    };
    try {
      const cfg = {
        subscriptions: [
          { uri: 'vless://11111111-2222-3333-4444-555555555555@us.domain.com:443?security=tls#🇺🇸 美国 01', tag: 'OK' },
          { url: 'http://93.184.216.34/fail403', tag: 'Fail', retry: 2 }
        ],
        minorNodeThreshold: 1
      };
      await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      assert.equal(fetchCount, 1, '403 属确定性错误，不应重试');
    } finally {
      restoreFetch();
    }
  });

  test('4xx 不重试：404 只尝试一次', async () => {
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response('', { status: 404 });
    };
    try {
      const cfg = {
        subscriptions: [
          { uri: 'vless://11111111-2222-3333-4444-555555555555@us.domain.com:443?security=tls#🇺🇸 美国 01', tag: 'OK' },
          { url: 'http://93.184.216.34/fail404', tag: 'Fail', retry: 2 }
        ],
        minorNodeThreshold: 1
      };
      const { yamlStr } = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      assert.equal(fetchCount, 1);
      assert.ok(yamlStr.includes('美国'));
    } finally {
      restoreFetch();
    }
  });

  test('DNS 确定性失败（ENOTFOUND）直连不重试：不发起 HTTP 请求', async () => {
    const dnsPromises = require('node:dns').promises;
    const origin = { r4: dnsPromises.resolve4, r6: dnsPromises.resolve6, lookup: dnsPromises.lookup };
    let resolveCalls = 0;
    let fetchCount = 0;
    try {
      const notFound = () => {
        resolveCalls++;
        throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
      };
      dnsPromises.resolve4 = async () => notFound();
      dnsPromises.resolve6 = async () => notFound();
      dnsPromises.lookup = async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); };
      globalThis.fetch = async () => { fetchCount++; return new Response(SUB_CONTENT, { status: 200 }); };

      const cfg = {
        subscriptions: [
          { uri: 'vless://11111111-2222-3333-4444-555555555555@us.domain.com:443?security=tls#🇺🇸 美国 01', tag: 'OK' },
          { url: 'http://nxdomain.example/sub-dns-fail', tag: 'Fail', retry: 2, proxy: false }
        ],
        minorNodeThreshold: 1
      };
      await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      assert.equal(fetchCount, 0, 'SSRF 预检拒绝后不得发起 HTTP 请求');
      // 每次 validateUrlSsrf 会触发 A/AAAA 两路解析（各调用一次 resolve4/resolve6），共 4 次；
      // 若按 retry=2 重试则会放大到 12 次
      assert.ok(resolveCalls <= 4, `确定性 DNS 失败不应消耗重试次数 (实际解析调用 ${resolveCalls} 次)`);
    } finally {
      dnsPromises.resolve4 = origin.r4;
      dnsPromises.resolve6 = origin.r6;
      dnsPromises.lookup = origin.lookup;
      restoreFetch();
    }
  });

  test('全局 fetchRetry / fetchTimeout 配置生效', async () => {
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      if (fetchCount === 1) return new Response('', { status: 502 });
      return new Response(SUB_CONTENT, { status: 200 });
    };
    try {
      const cfg = baseConfig('http://93.184.216.34/sub2', {
        global: { fetchRetry: 1, fetchTimeout: 15 }
      });
      const { yamlStr } = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      assert.equal(fetchCount, 2);
      assert.ok(yamlStr.includes('香港'));
    } finally {
      restoreFetch();
    }
  });

  test('容灾降级：拉取持续失败时复用上次成功内容，节点不消失', async () => {
    try {
      const cfg = baseConfig('http://93.184.216.34/stale1', { retry: 0 });

      // 第一次：成功拉取
      globalThis.fetch = async () => new Response(SUB_CONTENT, { status: 200 });
      const r1 = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      assert.ok(r1.yamlStr.includes('香港'));

      // 第二次：持续网络失败 → 降级复用上次成功内容
      globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
      const r2 = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      assert.ok(r2.yamlStr.includes('香港'), '降级后节点不应丢失');
      assert.ok(r2.yamlStr.includes('日本'));
    } finally {
      restoreFetch();
    }
  });

  test('fetchStaleTtl: 0 时关闭降级，拉取失败节点消失', async () => {
    try {
      const cfg = {
        subscriptions: [
          { uri: 'vless://11111111-2222-3333-4444-555555555555@us.domain.com:443?security=tls#🇺🇸 美国 01', tag: 'OK' },
          { url: 'http://93.184.216.34/stale0', tag: 'A', retry: 0 }
        ],
        minorNodeThreshold: 1,
        fetchStaleTtl: 0
      };

      // 第一次：成功拉取并缓存兜底数据
      globalThis.fetch = async () => new Response(SUB_CONTENT, { status: 200 });
      const r1 = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      assert.ok(r1.yamlStr.includes('香港'));

      // 第二次：失败但关闭降级 → 该订阅节点缺失
      globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
      const r2 = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      assert.ok(!r2.yamlStr.includes('香港'), '关闭降级后失败订阅不应复用旧数据');
    } finally {
      restoreFetch();
    }
  });

  test('部分构建失败发布降级缓存：短新鲜期内不回源，显式强制刷新才重新拉取', async () => {
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response('', { status: 404 });
    };
    try {
      const cfg = {
        subscriptions: [
          { uri: 'vless://11111111-2222-3333-4444-555555555555@us.domain.com:443?security=tls#🇺🇸 美国 01', tag: 'OK' },
          { url: 'http://93.184.216.34/cache1', tag: 'Fail', retry: 0 }
        ],
        minorNodeThreshold: 1
      };
      await buildProfile(cfg, { mode: 'config', production: true });
      const key = [...profileCache.cacheMap.keys()][0];
      assert.ok(key, '仍有可用订阅时必须发布缓存');
      assert.equal(profileCache.cacheMap.get(key).meta.degraded, true, '部分失败必须标记为降级缓存');
      assert.equal(profileCache.cacheMap.get(key).meta.usableSubCount, 1);

      await buildProfile(cfg, { mode: 'config', production: true });
      assert.equal(fetchCount, 1, '降级缓存新鲜期内不应重新拉取');

      // 显式强制刷新绕过缓存与单订阅退避，用于主动探测订阅恢复
      await buildProfile(cfg, { mode: 'config', production: true, forceRefresh: true });
      assert.equal(fetchCount, 2, '显式强制刷新必须重新回源');
    } finally {
      restoreFetch();
    }
  });

  test('最终 YAML 不含内部私有字段（_ 前缀）', async () => {
    globalThis.fetch = async () => new Response(SUB_CONTENT, { status: 200 });
    try {
      const cfg = {
        subscriptions: [{ url: 'http://93.184.216.34/priv1', tag: 'A', retry: 0 }],
        minorNodeThreshold: 1
      };
      const { yamlStr } = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      assert.ok(!/_subTag|_rawName|_indexPrefix/.test(yamlStr), '内部私有字段不应泄漏到最终 YAML');
    } finally {
      restoreFetch();
    }
  });

  test('多订阅到期聚合与过期防丢头 (expireAggregation: min / max)', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expireNear = nowSec + 2 * 86400;   // 2 天后到期
    const expireFar = nowSec + 100 * 86400;  // 100 天后到期
    const expirePast = nowSec - 5 * 86400;   // 5 天前已过期

    // 1. 测试 min 模式优先取未过期中的最早临期时间
    globalThis.fetch = async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('subNear')) {
        return new Response(SUB_CONTENT, {
          status: 200,
          headers: { 'subscription-userinfo': `upload=100; download=200; total=1000000; expire=${expireNear}` }
        });
      }
      return new Response(SUB_CONTENT, {
        status: 200,
        headers: { 'subscription-userinfo': `upload=100; download=200; total=2000000; expire=${expireFar}` }
      });
    };

    try {
      const cfgMin = {
        subscriptions: [
          { url: 'http://93.184.216.34/subNear', tag: 'Near', retry: 0 },
          { url: 'http://93.184.216.34/subFar', tag: 'Far', retry: 0 }
        ],
        expireAggregation: 'min'
      };
      const resMin = await buildProfile(cfgMin, { mode: 'config', production: true, noCache: true });
      assert.equal(resMin.userInfo.expire, expireNear, 'min 模式应取距离现在最近的到期时间戳');

      // 2. 测试 max 模式取最晚到期时间
      const cfgMax = { ...cfgMin, expireAggregation: 'max' };
      const resMax = await buildProfile(cfgMax, { mode: 'config', production: true, noCache: true });
      assert.equal(resMax.userInfo.expire, expireFar, 'max 模式应取最晚到期时间戳');

      // 3. 测试全部过期时防丢头：依然下发 expire 时间戳，并在 YAML 开头写入注释
      globalThis.fetch = async () => new Response(SUB_CONTENT, {
        status: 200,
        headers: { 'subscription-userinfo': `upload=100; download=200; total=1000000; expire=${expirePast}` }
      });
      const cfgExpired = {
        subscriptions: [{ url: 'http://93.184.216.34/expiredSub', tag: 'Old', retry: 0 }]
      };
      const resExpired = await buildProfile(cfgExpired, { mode: 'config', production: true, noCache: true });
      assert.equal(resExpired.userInfo.expire, expirePast, '全过期时仍应忠实下发过期时间戳');
      assert.ok(resExpired.yamlStr.includes(`# subscription-userinfo:`), '全过期时依然要生成头部注释，避免丢头');
      assert.ok(resExpired.yamlStr.includes(`expire=${expirePast}`), '头部注释中应包含过期时间戳');
    } finally {
      restoreFetch();
    }
  });

  test('纯 URI 节点或 proxy: false 时不触发拉取代理探测与警告', async () => {
    const logs = [];
    const mockLogger = {
      debug: (msg) => logs.push({ level: 'debug', msg }),
      info: (msg) => logs.push({ level: 'info', msg }),
      warn: (msg) => logs.push({ level: 'warn', msg }),
      error: (msg) => logs.push({ level: 'error', msg }),
      isLevelEnabled: () => true,
      child: () => mockLogger
    };

    // 配置了一个无效/关闭的代理端口 61234，但只有 URI 节点
    const cfg = {
      fetchProxyPort: 61234,
      fetchProxyStrategy: 'auto',
      subscriptions: [
        { uri: 'ss://YWVzLTEyOC1nY206c2VjcmV0X3NhZmVfa2V5Xzg4OTk=@hk01.example.com:443#%F0%9F%87%AD%F0%9F%87%B0%20%E9%A6%99%E6%B8%AF%2001', tag: 'DirectURI' }
      ]
    };

    await buildProfile(cfg, { mode: 'config', production: true, noCache: true, logger: mockLogger });
    const hasProxyWarn = logs.some(l => l.msg.includes('拉取代理') || l.msg.includes('61234'));
    assert.equal(hasProxyWarn, false, '纯 URI 节点不应执行代理连通性探测');
  });

  test('L1 快照复用：不同 Host 的构建在新鲜期内不再重复回源', async () => {
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response(SUB_CONTENT, { status: 200 });
    };
    try {
      const url = 'http://93.184.216.34/l1-shared';
      // 客户端 A 的 Host：写入 L1 原始快照 + 对应 L2 产物
      await buildProfile(baseConfig(url, { global: { subDomain: ['a.example.com'] } }), { mode: 'config', production: true });
      assert.equal(fetchCount, 1);

      // 客户端 B 的 Host：L2 缓存键不同必然 Miss，但 L1 仍在新鲜期，应免回源
      const res = await buildProfile(baseConfig(url, { global: { subDomain: ['b.example.com'] } }), { mode: 'config', production: true });
      assert.equal(fetchCount, 1, '新鲜期内应复用 L1 原始订阅快照，不重复回源');
      assert.ok(res.yamlStr.includes('香港'));
    } finally {
      restoreFetch();
    }
  });

  test('fetchOnly 预热：仅写 L1 原始快照，不组装产物也不发布 Profile 缓存', async () => {
    let fetchCount = 0;
    let warmOutcome = null;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response(SUB_CONTENT, { status: 200 });
    };
    try {
      const url = 'http://93.184.216.34/fetch-only';
      const warm = await buildProfile(baseConfig(url), {
        mode: 'config',
        production: true,
        forceRefresh: true,
        fetchOnly: true,
        onBuildOutcome: (outcome) => { warmOutcome = outcome; }
      });
      assert.equal(fetchCount, 1, '预热应真实拉取一次');
      assert.equal(warm.yamlStr, '', '仅拉取模式不得产出可交付配置');
      assert.equal(warmOutcome.published, false, '仅拉取模式不得写入 Profile 缓存');

      // 后续真实请求（不同 Host）应直接复用 L1，只做组装、不再回源
      const res = await buildProfile(baseConfig(url, { global: { subDomain: ['c.example.com'] } }), { mode: 'config', production: true });
      assert.equal(fetchCount, 1, '预热写入的 L1 快照应被首次请求复用');
      assert.ok(res.yamlStr.includes('香港'));
    } finally {
      restoreFetch();
    }
  });
});
