const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildProfile } = require('../src/builder.js');

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
      const { yamlStr } = await buildProfile(cfg, { type: 'full', production: true, noCache: true });
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
      const { yamlStr } = await buildProfile(cfg, { type: 'full', production: true, noCache: true });
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
      const { yamlStr } = await buildProfile(cfg, { type: 'full', production: true, noCache: true });
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
      const r1 = await buildProfile(cfg, { type: 'full', production: true, noCache: true });
      assert.ok(r1.yamlStr.includes('香港'));

      // 第二次：持续网络失败 → 降级复用上次成功内容
      globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
      const r2 = await buildProfile(cfg, { type: 'full', production: true, noCache: true });
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
      const r1 = await buildProfile(cfg, { type: 'full', production: true, noCache: true });
      assert.ok(r1.yamlStr.includes('香港'));

      // 第二次：失败但关闭降级 → 该订阅节点缺失
      globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
      const r2 = await buildProfile(cfg, { type: 'full', production: true, noCache: true });
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
      await buildProfile(cfg, { type: 'full', production: true });
      await buildProfile(cfg, { type: 'full', production: true });
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
      const { yamlStr } = await buildProfile(cfg, { type: 'full', production: true, noCache: true });
      assert.ok(!/_subTag|_rawName|_indexPrefix/.test(yamlStr), '内部私有字段不应泄漏到最终 YAML');
    } finally {
      restoreFetch();
    }
  });
});
