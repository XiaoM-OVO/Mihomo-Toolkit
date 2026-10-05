const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildProfile } = require('../src/index.js');

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

describe('🔄 订阅抓取容灾模块', () => {
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

  test('构建不完整时不写入缓存：失败订阅再次请求会重新拉取', async () => {
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
      await buildProfile(cfg, { mode: 'config', production: true });
      assert.equal(fetchCount, 2, '构建不完整时不应写入缓存，第二次应重新拉取');
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

  test('纯 URI 节点或 proxy: false 时不触发抓取代理探测与警告', async () => {
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
    const hasProxyWarn = logs.some(l => l.msg.includes('抓取代理') || l.msg.includes('61234'));
    assert.equal(hasProxyWarn, false, '纯 URI 节点不应执行代理连通性探测');
  });
});
