﻿const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { buildProfile } = require('../../src/index.js');
const { profileCache } = require('../../src/io/cache.js');
const { subFailureBackoff, subStaleCache, recordSubFetchFailure } = require('../../src/io/fetcher.js');

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

// 携带控制面越权字段的订阅内容（用于验证审计去重按订阅来源隔离）
const HOSTILE_SUB_CONTENT = Buffer.from(`
proxies:
  - name: "🇭🇰 香港 01"
    type: ss
    server: hk.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
external-controller: 127.0.0.1:9090
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

/** 生成携带节点私有 DoH 的订阅内容（Base64） */
function subWithResolver({ proxyName, server, resolver }) {
  return Buffer.from(`
dns:
  proxy-server-nameserver:
    - ${resolver}
proxies:
  - name: "${proxyName}"
    type: ss
    server: ${server}
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');
}

/** 收集日志的 mock logger */
function makeLogger(logs) {
  const logger = {
    debug: (msg) => logs.push({ level: 'debug', msg }),
    info: (msg) => logs.push({ level: 'info', msg }),
    warn: (msg) => logs.push({ level: 'warn', msg }),
    error: (msg) => logs.push({ level: 'error', msg }),
    isLevelEnabled: () => true,
    child: () => logger
  };
  return logger;
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
      const logs = [];
      const mockLogger = {
        debug: (msg) => logs.push({ level: 'debug', msg }),
        info: (msg) => logs.push({ level: 'info', msg }),
        warn: (msg) => logs.push({ level: 'warn', msg }),
        error: (msg) => logs.push({ level: 'error', msg }),
        isLevelEnabled: () => true,
        child: () => mockLogger
      };
      const r2 = await buildProfile(cfg, { mode: 'config', production: true, noCache: true, logger: mockLogger });
      assert.ok(r2.yamlStr.includes('香港'), '降级后节点不应丢失');
      assert.ok(r2.yamlStr.includes('日本'));
      assert.ok(
        logs.some(l => l.level === 'info' && l.msg.includes('缓存兜底')),
        '缓存兜底的源应在汇总树中如实标注'
      );
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
    assert.ok(
      logs.some(l => l.level === 'info' && l.msg.includes('订阅源解析完成')),
      '纯 URI 节点（未回源）同样应输出订阅源汇总树'
    );
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

  test('汇总树仅在真实回源时输出：纯快照组装不打来源清单', async () => {
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response(SUB_CONTENT, { status: 200 });
    };
    const logs = [];
    const mockLogger = {
      debug: (msg) => logs.push({ level: 'debug', msg }),
      info: (msg) => logs.push({ level: 'info', msg }),
      warn: (msg) => logs.push({ level: 'warn', msg }),
      error: (msg) => logs.push({ level: 'error', msg }),
      isLevelEnabled: () => true,
      child: () => mockLogger
    };
    try {
      const url = 'http://93.184.216.34/tree-gate';
      // 首次真实回源：应输出来源汇总树
      await buildProfile(baseConfig(url), { mode: 'config', production: true, logger: mockLogger });
      assert.ok(
        logs.some(l => l.level === 'info' && l.msg.includes('订阅源解析完成')),
        '真实回源的构建应输出来源汇总树'
      );

      // 新鲜期内不同 Host：仅组装 L1 快照，不应再输出来源汇总树
      const before = logs.length;
      await buildProfile(baseConfig(url, { global: { subDomain: ['gate.example.com'] } }), { mode: 'config', production: true, logger: mockLogger });
      assert.equal(fetchCount, 1, '新鲜期内不应重复回源');
      assert.equal(
        logs.slice(before).some(l => l.msg.includes('订阅源解析完成')),
        false,
        '未回源的组装不应输出来源汇总树'
      );
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

  test('控制面审计去重：不同 URL 相同 tag 各自首次发现，不共享计数', async () => {
    globalThis.fetch = async () => new Response(HOSTILE_SUB_CONTENT, { status: 200 });
    const logs = [];
    const mockLogger = {
      debug: (msg) => logs.push({ level: 'debug', msg }),
      info: (msg) => logs.push({ level: 'info', msg }),
      warn: (msg) => logs.push({ level: 'warn', msg }),
      error: (msg) => logs.push({ level: 'error', msg }),
      isLevelEnabled: () => true,
      child: () => mockLogger
    };
    try {
      const cfg = {
        subscriptions: [
          { url: 'http://93.184.216.34/audit-dup-a', tag: 'DUP', retry: 0 },
          { url: 'http://93.184.216.34/audit-dup-b', tag: 'DUP', retry: 0 }
        ],
        minorNodeThreshold: 1
      };
      await buildProfile(cfg, { mode: 'config', production: true, noCache: true, logger: mockLogger });
      const firstWarns = logs.filter(l => l.level === 'warn' && l.msg.includes('控制面沙箱') && l.msg.includes('首次发现'));
      assert.equal(firstWarns.length, 2, '两个不同 URL 的订阅应各自输出「首次发现」');
      assert.equal(
        logs.filter(l => l.msg.includes('重复检测')).length,
        0,
        '相同 tag 的不同订阅不得共享去重计数'
      );
    } finally {
      restoreFetch();
    }
  });

  test('控制面审计去重：同一订阅重复审计降级为 debug 并保留次数', async () => {
    globalThis.fetch = async () => new Response(HOSTILE_SUB_CONTENT, { status: 200 });
    const logs = [];
    const mockLogger = {
      debug: (msg) => logs.push({ level: 'debug', msg }),
      info: (msg) => logs.push({ level: 'info', msg }),
      warn: (msg) => logs.push({ level: 'warn', msg }),
      error: (msg) => logs.push({ level: 'error', msg }),
      isLevelEnabled: () => true,
      child: () => mockLogger
    };
    try {
      const url = 'http://93.184.216.34/audit-repeat';
      await buildProfile(baseConfig(url, { retry: 0 }), { mode: 'config', production: true, noCache: true, logger: mockLogger });
      await buildProfile(baseConfig(url, { retry: 0 }), { mode: 'config', production: true, noCache: true, logger: mockLogger });

      const firstWarns = logs.filter(l => l.level === 'warn' && l.msg.includes('控制面沙箱') && l.msg.includes('首次发现'));
      assert.equal(firstWarns.length, 1, '同一订阅首次审计只应 warn 一次');
      assert.equal(
        logs.filter(l => l.level === 'debug' && l.msg.includes('重复检测（第 2 次')).length,
        1,
        '同一订阅的重复审计应降级为 debug 并保留重复次数'
      );
    } finally {
      restoreFetch();
    }
  });

  test('终态退避：首次失败进入 6h 级长冷却，逐次递增至 24h 封顶', () => {
    const key = 'http://93.184.216.34/terminal-cooldown';
    const base = 6 * 60 * 60 * 1000;
    const first = recordSubFetchFailure(key, new Error('401'), true);
    assert.equal(first.terminal, true);
    assert.equal(first.terminalFailures, 1);
    assert.ok(
      first.delayMs >= base * 0.8 && first.delayMs <= base * 1.2,
      `首次终态冷却应约为 6h，实际 ${first.delayMs}ms`
    );

    const second = recordSubFetchFailure(key, new Error('401'), true);
    assert.ok(
      second.delayMs >= base * 2 * 0.8 && second.delayMs <= base * 2 * 1.2,
      `第二次终态冷却应约为 12h，实际 ${second.delayMs}ms`
    );

    const third = recordSubFetchFailure(key, new Error('401'), true);
    assert.ok(third.delayMs <= 24 * 60 * 60 * 1000, '终态冷却不得超过 24h 上限');
    assert.ok(third.delayMs >= 24 * 60 * 60 * 1000 * 0.8, '连续终态失败应接近 24h 上限');
  });

  test('终态长冷却：普通请求不回源，forceRefresh 可探测恢复并清除退避', async () => {
    const url = 'http://93.184.216.34/terminal-recover';
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response('Unauthorized', { status: 401 });
    };
    try {
      await buildProfile(baseConfig(url, { retry: 0 }), { mode: 'config', production: true, noCache: true });
      assert.equal(calls, 1);
      const state = subFailureBackoff.get(url);
      assert.ok(state && state.terminal, '401 应记录为终态退避');
      assert.ok(state.delayMs >= 6 * 60 * 60 * 1000 * 0.8, `终态冷却应约为 6h，实际 ${state.delayMs}ms`);

      // 冷却期内普通请求：不发起网络 IO
      globalThis.fetch = async () => {
        calls++;
        return new Response(SUB_CONTENT, { status: 200 });
      };
      await buildProfile(baseConfig(url, { retry: 0 }), { mode: 'config', production: true, noCache: true });
      assert.equal(calls, 1, '终态长冷却期内不得回源');

      // 显式强制刷新仍可探测恢复
      const recovered = await buildProfile(baseConfig(url, { retry: 0 }), {
        mode: 'config', production: true, noCache: true, forceRefresh: true
      });
      assert.equal(calls, 2, 'forceRefresh 必须绕过终态长冷却');
      assert.ok(recovered.yamlStr.includes('香港'));
      assert.equal(subFailureBackoff.has(url), false, '恢复成功后必须清除退避状态');
    } finally {
      restoreFetch();
    }
  });

  test('订阅 proxy-server-nameserver：私有 DoH 按节点域名解析器继承', async () => {
    const content = Buffer.from(`
dns:
  proxy-server-nameserver:
    - https://dns.airport-a.com/dns-query/secret-token
proxies:
  - name: "🇭🇰 香港 01"
    type: ss
    server: hk.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');
    globalThis.fetch = async () => new Response(content, { status: 200 });
    try {
      const logs = [];
      const mockLogger = {
        debug: (msg) => logs.push({ level: 'debug', msg }),
        info: (msg) => logs.push({ level: 'info', msg }),
        warn: (msg) => logs.push({ level: 'warn', msg }),
        error: (msg) => logs.push({ level: 'error', msg }),
        isLevelEnabled: () => true,
        child: () => mockLogger
      };
      const { yamlStr } = await buildProfile(baseConfig('http://93.184.216.34/dns-asset'), {
        mode: 'config', production: true, noCache: true, logger: mockLogger
      });
      assert.ok(yamlStr.includes('dns.airport-a.com/dns-query/secret-token'), '应继承订阅的节点解析器');
      assert.ok(
        logs.some(l => l.level === 'info' && l.msg.includes('注入 DNS 映射')),
        '继承行为必须有审计日志'
      );
      assert.ok(
        !logs.some(l => l.msg.includes('secret-token')),
        '日志不得泄露含 token 的解析器 URL'
      );
    } finally {
      restoreFetch();
    }
  });

  test('订阅 proxy-server-nameserver：用户显式 dnsServer 优先于订阅值', async () => {
    const content = Buffer.from(`
dns:
  proxy-server-nameserver:
    - https://dns.airport-a.com/dns-query/secret-token
proxies:
  - name: "🇭🇰 香港 01"
    type: ss
    server: hk.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');
    globalThis.fetch = async () => new Response(content, { status: 200 });
    try {
      const cfg = baseConfig('http://93.184.216.34/dns-override', {
        global: { dnsServer: ['9.9.9.9'] }
      });
      const { yamlStr } = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      assert.ok(yamlStr.includes('9.9.9.9'), '用户显式配置的解析器必须生效');
      assert.ok(!yamlStr.includes('airport-a.com'), '不得用订阅解析器覆盖用户显式配置');
      assert.equal(require('yaml').parse(yamlStr).dns['respect-rules'], true, '非映射模式必须保持 respect-rules=true');
      assert.ok(!yamlStr.includes('#RULES'), '非映射模式不得输出 RULES 标记');
    } finally {
      restoreFetch();
    }
  });

  test('订阅 proxy-server-nameserver：明文域名解析器被拒绝', async () => {
    const content = Buffer.from(`
dns:
  proxy-server-nameserver:
    - dns.airport-a.com
proxies:
  - name: "🇭🇰 香港 01"
    type: ss
    server: hk.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');
    globalThis.fetch = async () => new Response(content, { status: 200 });
    try {
      const { yamlStr } = await buildProfile(baseConfig('http://93.184.216.34/dns-plain'), {
        mode: 'config', production: true, noCache: true
      });
      assert.ok(!yamlStr.includes('airport-a.com'), '明文域名解析器不得进入产物');
      assert.ok(yamlStr.includes('119.29.29.29'), '应回退到默认纯 IP 节点解析器');
      assert.equal(require('yaml').parse(yamlStr).dns['respect-rules'], true, '无映射时不得关闭 respect-rules');
      assert.ok(!yamlStr.includes('#RULES'), '无映射时不得输出 RULES 标记');
    } finally {
      restoreFetch();
    }
  });

  test('多订阅节点解析器：按节点域名隔离，不跨订阅共享', async () => {
    const contentA = Buffer.from(`
dns:
  proxy-server-nameserver:
    - https://dns.airport-a.com/dns-query/token-a
proxies:
  - name: "🇭🇰 香港 01"
    type: ss
    server: hk.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');
    const contentB = Buffer.from(`
dns:
  proxy-server-nameserver:
    - https://dns.airport-b.com/dns-query/token-b
proxies:
  - name: "🇯🇵 日本 01"
    type: ss
    server: jp.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');
    let index = 0;
    globalThis.fetch = async () => new Response(index++ === 0 ? contentA : contentB, { status: 200 });
    try {
      const cfg = {
        subscriptions: [
          { url: 'http://93.184.216.34/iso-a', tag: 'A', retry: 0 },
          { url: 'http://93.184.216.34/iso-b', tag: 'B', retry: 0 }
        ],
        minorNodeThreshold: 1
      };
      const { yamlStr } = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      const YAML = require('yaml');
      const out = YAML.parse(yamlStr);
      assert.deepEqual(out.dns['nameserver-policy']['hk.domain.com'], ['https://dns.airport-a.com/dns-query/token-a']);
      assert.deepEqual(out.dns['nameserver-policy']['jp.domain.com'], ['https://dns.airport-b.com/dns-query/token-b']);
      assert.equal(out.dns['proxy-server-nameserver'], undefined, '映射模式下必须留空节点解析器');
      // 兼容 v1.19.13：映射模式必须关闭 respect-rules，并对非节点解析器显式标记 #RULES
      assert.equal(out.dns['respect-rules'], false, '映射模式必须关闭 respect-rules');
      assert.ok(
        out.dns.nameserver.every(s => String(s).endsWith('#RULES')),
        '主解析链必须显式携带 #RULES 出口标记'
      );
      assert.ok(
        out.dns['nameserver-policy']['rule-set:cn-domain'].every(s => String(s).endsWith('#RULES')),
        'cn-domain 策略必须显式携带 #RULES'
      );
      assert.ok(
        out.dns['nameserver-policy']['rule-set:non-cn'].every(s => String(s).endsWith('#RULES')),
        'non-cn 策略必须显式携带 #RULES'
      );
      assert.ok(
        !out.dns['nameserver-policy']['hk.domain.com'][0].includes('#RULES'),
        '节点域名专属映射必须保持直连引导，不得带 #RULES'
      );
    } finally {
      restoreFetch();
    }
  });

  test('特殊 DNS 条目：system 存在时整体回退非映射模式，映射不生效且告警脱敏', async () => {
    const content = subWithResolver({
      proxyName: '🇭🇰 香港 01', server: 'hk.domain.com',
      resolver: 'https://dns.airport-a.com/dns-query/secrect-token'
    });
    globalThis.fetch = async () => new Response(content, { status: 200 });
    try {
      const logs = [];
      const cfg = baseConfig('http://93.184.216.34/special-system', {
        global: { dnsProxy: ['system'] }
      });
      const { yamlStr } = await buildProfile(cfg, {
        mode: 'config', production: true, noCache: true, logger: makeLogger(logs)
      });
      const out = require('yaml').parse(yamlStr);
      assert.equal(out.dns['respect-rules'], true, '回退后必须恢复 respect-rules=true');
      assert.ok(Array.isArray(out.dns['proxy-server-nameserver']) && out.dns['proxy-server-nameserver'].length > 0,
        '回退后 proxy-server-nameserver 必须非空');
      assert.equal(out.dns['nameserver-policy']['hk.domain.com'], undefined, '回退后不得残留订阅域名专属映射');
      assert.ok(!yamlStr.includes('#RULES'), '回退后不得输出 RULES 标记');
      assert.ok(
        logs.some(l => l.level === 'warn' && l.msg.includes('映射模式已禁用') && l.msg.includes('respect-rules 保持开启')),
        '必须明确说明映射模式被禁用及回退结果'
      );
      assert.ok(
        !logs.some(l => l.msg.includes('secrect-token') || l.msg.includes('dns.airport-a.com')),
        '回退警告不得包含订阅 URL、DoH 地址或 token'
      );
    } finally {
      restoreFetch();
    }
  });

  test('特殊 DNS 条目：dhcp:// 存在时同样整体回退非映射模式', async () => {
    const content = subWithResolver({
      proxyName: '🇭🇰 香港 01', server: 'hk.domain.com',
      resolver: 'https://dns.airport-a.com/dns-query/secrect-token'
    });
    globalThis.fetch = async () => new Response(content, { status: 200 });
    try {
      const logs = [];
      const cfg = baseConfig('http://93.184.216.34/special-dhcp', {
        global: { dnsDirect: ['dhcp://en0'] }
      });
      const { yamlStr } = await buildProfile(cfg, {
        mode: 'config', production: true, noCache: true, logger: makeLogger(logs)
      });
      const out = require('yaml').parse(yamlStr);
      assert.equal(out.dns['respect-rules'], true, '回退后必须恢复 respect-rules=true');
      assert.ok(Array.isArray(out.dns['proxy-server-nameserver']) && out.dns['proxy-server-nameserver'].length > 0,
        '回退后 proxy-server-nameserver 必须非空');
      assert.equal(out.dns['nameserver-policy']['hk.domain.com'], undefined, '回退后不得残留订阅域名专属映射');
      assert.ok(!yamlStr.includes('#RULES'), '回退后不得输出 RULES 标记');
      assert.ok(
        logs.some(l => l.level === 'warn' && l.msg.includes('映射模式已禁用')),
        '特殊条目触发回退必须有脱敏告警'
      );
      assert.ok(
        !logs.some(l => l.msg.includes('secrect-token') || l.msg.includes('dns.airport-a.com')),
        '回退警告不得包含订阅 URL、DoH 地址或 token'
      );
    } finally {
      restoreFetch();
    }
  });

  test('解析器冲突：同名域名不同 DoH 整体回退默认 DNS，日志脱敏', async () => {
    const contentA = subWithResolver({
      proxyName: '🇭🇰 香港 A', server: 'hk.domain.com',
      resolver: 'https://dns.airport-a.com/dns-query/token-a'
    });
    const contentB = subWithResolver({
      proxyName: '🇭🇰 香港 B', server: 'hk.domain.com',
      resolver: 'https://dns.airport-b.com/dns-query/token-b'
    });
    const byUrl = {
      'http://93.184.216.34/conflict-a': contentA,
      'http://93.184.216.34/conflict-b': contentB
    };
    globalThis.fetch = async (input) => {
      const target = typeof input === 'string' ? input : input.url;
      return new Response(byUrl[target] || '', { status: 200 });
    };
    try {
      const logs = [];
      const cfg = {
        subscriptions: [
          { url: 'http://93.184.216.34/conflict-a', tag: 'A', retry: 0 },
          { url: 'http://93.184.216.34/conflict-b', tag: 'B', retry: 0 }
        ],
        minorNodeThreshold: 1
      };
      const { yamlStr } = await buildProfile(cfg, {
        mode: 'config', production: true, noCache: true, logger: makeLogger(logs)
      });
      const out = require('yaml').parse(yamlStr);
      assert.equal(out.dns['nameserver-policy']['hk.domain.com'], undefined, '冲突域名不得写入映射');
      assert.deepEqual(out.dns['proxy-server-nameserver'], ['223.5.5.5', '119.29.29.29'], '冲突时必须回退默认节点解析器');
      assert.ok(
        !yamlStr.includes('airport-a.com') && !yamlStr.includes('airport-b.com'),
        '冲突时不得保留任意一方的私有 DoH'
      );
      assert.ok(
        logs.some(l => l.level === 'warn' && l.msg.includes('节点解析器冲突') && l.msg.includes('hk.domain.com')),
        '首次冲突必须 warn，并说明域名'
      );
      assert.ok(
        !logs.some(l => l.msg.includes('token-a') || l.msg.includes('token-b') || l.msg.includes('airport-a')),
        '冲突日志不得泄露订阅 URL、DoH 地址或 token'
      );
      assert.equal(out.dns['respect-rules'], true, '无映射时必须保持 respect-rules=true');
      assert.ok(!yamlStr.includes('#RULES'), '无映射时不得输出 RULES 标记');
    } finally {
      restoreFetch();
    }
  });

  test('解析器去重：同域名同解析器在多个订阅中只保留一条映射', async () => {
    const content = subWithResolver({
      proxyName: '🇭🇰 香港 01', server: 'hk.domain.com',
      resolver: 'https://dns.airport-a.com/dns-query/token-a'
    });
    const byUrl = {
      'http://93.184.216.34/dedup-a': content,
      'http://93.184.216.34/dedup-b': content
    };
    globalThis.fetch = async (input) => {
      const target = typeof input === 'string' ? input : input.url;
      return new Response(byUrl[target] || '', { status: 200 });
    };
    try {
      const logs = [];
      const cfg = {
        subscriptions: [
          { url: 'http://93.184.216.34/dedup-a', tag: 'A', retry: 0 },
          { url: 'http://93.184.216.34/dedup-b', tag: 'B', retry: 0 }
        ],
        minorNodeThreshold: 1
      };
      const { yamlStr } = await buildProfile(cfg, {
        mode: 'config', production: true, noCache: true, logger: makeLogger(logs)
      });
      const out = require('yaml').parse(yamlStr);
      assert.deepEqual(
        out.dns['nameserver-policy']['hk.domain.com'],
        ['https://dns.airport-a.com/dns-query/token-a']
      );
      assert.equal(out.dns['proxy-server-nameserver'], undefined, '映射模式下必须留空节点解析器');
      assert.equal(out.dns['respect-rules'], false, '映射模式必须关闭 respect-rules');
      assert.ok(!String(out.dns['nameserver-policy']['hk.domain.com'][0]).includes('#RULES'), '节点映射不得带 #RULES');
      assert.ok(
        !logs.some(l => l.level === 'warn' && l.msg.includes('节点解析器冲突')),
        '解析器集合相同不应判定为冲突'
      );
    } finally {
      restoreFetch();
    }
  });

  test('解析器冲突：A/B 相同、C 不同时整个域名退出映射', async () => {
    const resolverA = 'https://dns.airport-a.com/dns-query/token-a';
    const contentA = subWithResolver({ proxyName: '🇭🇰 香港 A', server: 'hk.domain.com', resolver: resolverA });
    const contentB = subWithResolver({ proxyName: '🇭🇰 香港 B', server: 'hk.domain.com', resolver: resolverA });
    const contentC = subWithResolver({
      proxyName: '🇭🇰 香港 C', server: 'hk.domain.com',
      resolver: 'https://dns.airport-c.com/dns-query/token-c'
    });
    const byUrl = {
      'http://93.184.216.34/abc-a': contentA,
      'http://93.184.216.34/abc-b': contentB,
      'http://93.184.216.34/abc-c': contentC
    };
    globalThis.fetch = async (input) => {
      const target = typeof input === 'string' ? input : input.url;
      return new Response(byUrl[target] || '', { status: 200 });
    };
    try {
      const cfg = {
        subscriptions: [
          { url: 'http://93.184.216.34/abc-a', tag: 'A', retry: 0 },
          { url: 'http://93.184.216.34/abc-b', tag: 'B', retry: 0 },
          { url: 'http://93.184.216.34/abc-c', tag: 'C', retry: 0 }
        ],
        minorNodeThreshold: 1
      };
      const { yamlStr } = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
      const out = require('yaml').parse(yamlStr);
      assert.equal(out.dns['nameserver-policy']['hk.domain.com'], undefined, '存在任一不同解析器即整体冲突');
      assert.ok(!yamlStr.includes('airport-a.com'), '不得保留 A/B 的共同解析器');
      assert.deepEqual(out.dns['proxy-server-nameserver'], ['223.5.5.5', '119.29.29.29']);
      assert.equal(out.dns['respect-rules'], true, '全部冲突时不得关闭 respect-rules');
    } finally {
      restoreFetch();
    }
  });

  test('解析器冲突：六种订阅顺序的 DNS 产物完全一致', async () => {
    const resolverA = 'https://dns.airport-a.com/dns-query/token-a';
    const contentA = Buffer.from(`
dns:
  proxy-server-nameserver:
    - ${resolverA}
proxies:
  - name: "🇭🇰 香港 A"
    type: ss
    server: a.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
  - name: "🇸🇬 新加坡 A"
    type: ss
    server: shared.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');
    const contentB = subWithResolver({
      proxyName: '🇯🇵 日本 B', server: 'b.domain.com',
      resolver: 'https://dns.airport-b.com/dns-query/token-b'
    });
    const contentC = subWithResolver({
      proxyName: '🇸🇬 新加坡 C', server: 'shared.domain.com',
      resolver: 'https://dns.airport-c.com/dns-query/token-c'
    });
    const byUrl = {
      'http://93.184.216.34/order-a': contentA,
      'http://93.184.216.34/order-b': contentB,
      'http://93.184.216.34/order-c': contentC
    };
    globalThis.fetch = async (input) => {
      const target = typeof input === 'string' ? input : input.url;
      return new Response(byUrl[target] || '', { status: 200 });
    };
    const baseSubs = {
      A: { url: 'http://93.184.216.34/order-a', tag: 'A', retry: 0 },
      B: { url: 'http://93.184.216.34/order-b', tag: 'B', retry: 0 },
      C: { url: 'http://93.184.216.34/order-c', tag: 'C', retry: 0 }
    };
    const orders = [
      ['A', 'B', 'C'], ['A', 'C', 'B'], ['B', 'A', 'C'],
      ['B', 'C', 'A'], ['C', 'A', 'B'], ['C', 'B', 'A']
    ];
    try {
      const YAML = require('yaml');
      let baseline = null;
      for (const order of orders) {
        subStaleCache.clear();
        subFailureBackoff.clear();
        profileCache.clear();
        const cfg = { subscriptions: order.map(k => baseSubs[k]), minorNodeThreshold: 1 };
        const { yamlStr } = await buildProfile(cfg, { mode: 'config', production: true, noCache: true });
        const dns = YAML.parse(yamlStr).dns;
        if (baseline === null) {
          baseline = JSON.stringify(dns);
          assert.deepEqual(dns['nameserver-policy']['a.domain.com'], [resolverA]);
          assert.deepEqual(dns['nameserver-policy']['b.domain.com'], ['https://dns.airport-b.com/dns-query/token-b']);
          assert.equal(dns['nameserver-policy']['shared.domain.com'], undefined, '冲突域名必须退出映射');
          assert.ok(dns['nameserver-policy']['rule-set:cn-domain'], '普通分流 DNS 策略不得被破坏');
          assert.ok(dns['nameserver-policy']['rule-set:non-cn'], '普通分流 DNS 策略不得被破坏');
          assert.equal(dns['respect-rules'], false, '存在有效映射时必须关闭 respect-rules');
          assert.ok(!String(dns['nameserver-policy']['a.domain.com'][0]).includes('#RULES'), '节点映射不得带 #RULES');
        } else {
          assert.equal(JSON.stringify(dns), baseline, `订阅顺序 ${order.join('')} 的 DNS 产物必须一致`);
        }
      }
    } finally {
      restoreFetch();
    }
  });

  test('dnsNodePolicyFold：默认折叠为 .suffix，关闭后逐域名精确键', async () => {
    const content = Buffer.from(`
dns:
  proxy-server-nameserver:
    - https://dns.airport-a.com/dns-query/token-a
proxies:
  - name: "🇭🇰 香港 01"
    type: ss
    server: hk01.459292.xyz
    port: 443
    cipher: aes-256-gcm
    password: test
  - name: "🇭🇰 香港 02"
    type: ss
    server: hk02.459292.xyz
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');
    const doh = ['https://dns.airport-a.com/dns-query/token-a'];
    const YAML = require('yaml');
    globalThis.fetch = async () => new Response(content, { status: 200 });
    try {
      const foldLogs = [];
      const folded = await buildProfile(
        baseConfig('http://93.184.216.34/fold-on', { retry: 0 }),
        { mode: 'config', production: true, noCache: true, logger: makeLogger(foldLogs) }
      );
      const dnsFolded = YAML.parse(folded.yamlStr).dns;
      assert.deepEqual(dnsFolded['nameserver-policy']['.459292.xyz'], doh, '同源同后缀应折叠');
      assert.equal(dnsFolded['nameserver-policy']['hk01.459292.xyz'], undefined, '折叠后不再保留精确键');
      assert.equal(dnsFolded['respect-rules'], false);
      assert.ok(
        foldLogs.some(l => l.level === 'info' && l.msg.includes('注入 DNS 映射') && l.msg.includes('通配 1')),
        '折叠后日志应按映射条数与通配条数表述，不能把键数说成域名数'
      );

      const exact = await buildProfile(
        baseConfig('http://93.184.216.34/fold-off', { global: { dnsNodePolicyFold: false }, retry: 0 }),
        { mode: 'config', production: true, noCache: true }
      );
      const dnsExact = YAML.parse(exact.yamlStr).dns;
      assert.deepEqual(dnsExact['nameserver-policy']['hk01.459292.xyz'], doh);
      assert.deepEqual(dnsExact['nameserver-policy']['hk02.459292.xyz'], doh);
      assert.equal(dnsExact['nameserver-policy']['.459292.xyz'], undefined, '关闭后不得出现通配键');
    } finally {
      restoreFetch();
    }
  });

  test('资产闭包日志按分类计数，不逐项罗列且不泄露解析器地址', async () => {
    const content = subWithResolver({
      proxyName: '🇭🇰 香港', server: 'hk.domain.com',
      resolver: 'https://dns.airport-a.com/dns-query/secret-token'
    });
    globalThis.fetch = async () => new Response(content, { status: 200 });
    const logs = [];
    try {
      await buildProfile(
        baseConfig('http://93.184.216.34/asset-log', { retry: 0 }),
        { mode: 'config', production: true, noCache: true, logger: makeLogger(logs) }
      );
      const line = logs.find(l => l.level === 'info' && l.msg.includes('资产闭包'));
      assert.ok(line, '应输出资产闭包日志');
      assert.match(line.msg, /解析器 1/, '应按分类给出解析器计数');
      assert.match(line.msg, /域名 1/, '应按分类给出域名计数');
      assert.ok(!line.msg.includes('https://'), '不得输出解析器 URL');
      assert.ok(!line.msg.includes('secret-token'), '不得输出解析器 token');
      assert.ok(!/proxy-resolver:[0-9]/.test(line.msg), '不再逐项罗列');
      assert.ok(!line.msg.includes('示例'), '不附带示例，避免半截列表');
    } finally {
      restoreFetch();
    }
  });
});
