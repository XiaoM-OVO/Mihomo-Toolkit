const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildProfile } = require('../../src/index.js');
const { subStaleCache, SubStaleCacheMap } = require('../../src/io/fetcher.js');
const { profileCache } = require('../../src/io/cache.js');

// 合法节点内容（Base64 编码，含 2 个节点；使用域名服务器避免触发假IP清洗规则）
const VALID_SUB_CONTENT = Buffer.from(`
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

// 纯占位/到期/续费节点内容（包含假IP/假端口和提示性名称）
const PLACEHOLDER_ONLY_CONTENT = Buffer.from(`
proxies:
  - name: "🛑 您的套餐已到期，请前往官网续费"
    type: ss
    server: 127.0.0.1
    port: 80
    cipher: aes-256-gcm
    password: test
  - name: "🌐 官网地址：airport.com"
    type: ss
    server: 0.0.0.0
    port: 0
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');

const originalFetch = globalThis.fetch;

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe('【Pipeline】多订阅生命周期与容灾鉴权/过期防护 (sub-expiry-lifecycle)', () => {

  test('网络超时、连接错误及 5xx：有效旧缓存可正常容灾兜底', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/net-fail-test';
      const cfg = {
        subscriptions: [{ url, tag: 'NetSub', retry: 0 }],
        minorNodeThreshold: 1
      };

      // 1. 首次成功获取有效订阅
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, { status: 200 });
      const r1 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(r1.yamlStr.includes('香港'));

      // 2. 随后发生网络连接失败 (TypeError)
      globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
      const r2 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(r2.yamlStr.includes('香港'), '网络错误应允许旧缓存兜底');

      // 3. 随后发生 502 Bad Gateway
      globalThis.fetch = async () => new Response('', { status: 502 });
      const r3 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(r3.yamlStr.includes('香港'), '502 网关错误应允许旧缓存兜底');
    } finally {
      restoreFetch();
    }
  });

  test('HTTP 401：明确鉴权拒绝，不回退旧缓存并清理 subStaleCache', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-401';
      const cfg = {
        subscriptions: [{ url, tag: 'AuthSub', retry: 0 }],
        minorNodeThreshold: 1
      };

      // 1. 首次成功拉取并建立有效旧缓存
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, { status: 200 });
      const r1 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(r1.yamlStr.includes('香港'));
      assert.ok(subStaleCache.has(url), '首次拉取应有 stale 缓存');

      // 2. 账号失效返回 401 Unauthorized
      globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
      const r2 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(!r2.yamlStr.includes('香港'), '401 凭据失效时不输出旧节点');
      assert.equal(subStaleCache.has(url), false, '401 发生后必须物理删除对应 subStaleCache');

      // 3. 随后发生普通网络故障，不得复活容灾
      globalThis.fetch = async () => { throw new TypeError('Network error'); };
      const r3 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(!r3.yamlStr.includes('香港'), '已淘汰记录在后续普通网络故障中不得复活');
    } finally {
      restoreFetch();
    }
  });

  test('HTTP 403：按独立策略处理（非 401），未被粗暴误判为鉴权失效', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-403';
      const cfg = {
        subscriptions: [{ url, tag: 'WafSub', retry: 0 }],
        minorNodeThreshold: 1
      };

      // 1. 首次成功建立缓存
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, { status: 200 });
      const r1 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(r1.yamlStr.includes('香港'));

      // 2. 外部返回 403 (如 WAF/Cloudflare 误杀或 IP 拦截)，由于 403 不等同于 401 凭据失效，在未到期时允许容灾
      globalThis.fetch = async () => new Response('Forbidden WAF blocked', { status: 403 });
      const r2 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(r2.yamlStr.includes('香港'), '403 不得与 401 混为一谈，未过期缓存应保持容灾能力');
      assert.ok(subStaleCache.has(url), '403 暂态故障不得误杀 subStaleCache');
    } finally {
      restoreFetch();
    }
  });

  test('旧缓存已到期：即使在 fetchStaleTtl 窗口内，也不得作为有效节点输出并物理淘汰', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-expired';
      const cfg = {
        subscriptions: [{ url, tag: 'ExpSub', retry: 0 }],
        minorNodeThreshold: 1,
        fetchStaleTtl: 24 // 允许 24 小时 stale 容灾
      };

      // 1. 建立缓存，但带有 10 秒前已过期的 expire 时间戳
      const expireNear = Math.floor(Date.now() / 1000) - 10;
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, {
        status: 200,
        headers: { 'subscription-userinfo': `upload=100; download=200; total=1000000; expire=${expireNear}` }
      });
      await buildProfile(cfg, { mode: 'config', noCache: true });

      // 2. 模拟随后机场网络中断
      globalThis.fetch = async () => { throw new TypeError('Network error'); };
      const r2 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(!r2.yamlStr.includes('香港'), '旧缓存中的 expire 已超时，即使在 fetchStaleTtl 内也不得输出旧节点');
      assert.equal(subStaleCache.has(url), false, '过期缓存被拒绝后应物理从 subStaleCache 中淘汰');
    } finally {
      restoreFetch();
    }
  });

  test('本次成功响应确认已到期：不作为健康订阅写入缓存，拒绝容灾并物理淘汰', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-fresh-expired';
      const cfg = {
        subscriptions: [{ url, tag: 'FreshExpSub', retry: 0 }],
        minorNodeThreshold: 1
      };

      // 1. 之前有有效旧缓存
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, { status: 200 });
      await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(subStaleCache.has(url));

      // 2. 本次拉取成功返回 HTTP 200，但头信息明确显示已过期
      const expirePast = Math.floor(Date.now() / 1000) - 60;
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, {
        status: 200,
        headers: { 'subscription-userinfo': `upload=100; download=200; total=1000000; expire=${expirePast}` }
      });
      const r2 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(!r2.yamlStr.includes('香港'), '本次响应已过期，不输出旧节点');
      assert.equal(subStaleCache.has(url), false, '本次确认到期必须清除 subStaleCache，不得缓存死数据');
    } finally {
      restoreFetch();
    }
  });

  test('expire = 0 或缺失：不得误判为过期，仍可容灾', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-no-expire';
      const cfg = {
        subscriptions: [{ url, tag: 'NoExpSub', retry: 0 }],
        minorNodeThreshold: 1
      };

      // 1. 成功建立缓存，expire=0（不限时/永久套餐）
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, {
        status: 200,
        headers: { 'subscription-userinfo': `upload=100; download=200; total=1000000; expire=0` }
      });
      await buildProfile(cfg, { mode: 'config', noCache: true });

      // 2. 随后网络断开
      globalThis.fetch = async () => { throw new TypeError('Network error'); };
      const r2 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(r2.yamlStr.includes('香港'), 'expire=0 不得误判为过期，应允许正常容灾');
      assert.ok(subStaleCache.has(url), '合法未到期缓存应保留在 subStaleCache');
    } finally {
      restoreFetch();
    }
  });

  test('本次成功响应确认流量耗尽：不允许继续使用旧节点兜底并物理淘汰', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-quota-full';
      const cfg = {
        subscriptions: [{ url, tag: 'QuotaSub', retry: 0 }],
        minorNodeThreshold: 1
      };

      // 1. 之前有有效旧缓存
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, {
        status: 200,
        headers: { 'subscription-userinfo': `upload=100; download=200; total=1000000; expire=0` }
      });
      await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(subStaleCache.has(url));

      // 2. 本次拉取成功返回 HTTP 200，但 Userinfo 明确显示流量已用尽 (download >= total)
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, {
        status: 200,
        headers: { 'subscription-userinfo': `upload=500000; download=500000; total=1000000; expire=0` }
      });
      const r2 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(!r2.yamlStr.includes('香港'), '本次确认流量耗尽时，不得兜底输出旧节点');
      assert.equal(subStaleCache.has(url), false, '本次确认流量耗尽后必须清除 subStaleCache');
    } finally {
      restoreFetch();
    }
  });

  test('本地旧流量记录过时：在网络故障时不得仅凭本地旧流量将订阅永久判死', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-reset-cycle';
      const cfg = {
        subscriptions: [{ url, tag: 'CycleSub', retry: 0 }],
        minorNodeThreshold: 1
      };

      // 1. 上次成功抓取时的旧缓存（已用流量达到甚至超过 total，但未过期）
      // 模拟上个计费周期流量用尽，之后可能已经重置
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, {
        status: 200,
        headers: { 'subscription-userinfo': `upload=500000; download=500000; total=1000000; expire=0` }
      });
      // 手动建立包含超流信息的旧缓存记录（模拟历史遗留）
      subStaleCache.set(url, {
        content: VALID_SUB_CONTENT,
        subInfo: 'upload=500000; download=500000; total=1000000; expire=0',
        timestamp: Date.now()
      });

      // 2. 随后发生网络抖动（无新响应确认当前周期流量耗尽）
      globalThis.fetch = async () => { throw new TypeError('Network timeout'); };
      const r2 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(r2.yamlStr.includes('香港'), '网络故障时不得仅凭本地可能已过时的旧流量记录将订阅永久判死');
      assert.ok(subStaleCache.has(url), '未明确超期的旧缓存应被保留');
    } finally {
      restoreFetch();
    }
  });

  test('只包含占位节点的异常响应：不覆盖此前成功缓存，旧缓存未到期时继续保护', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-placeholders';
      const cfg = {
        subscriptions: [{ url, tag: 'NoticeSub', retry: 0 }],
        minorNodeThreshold: 1
      };

      // 1. 成功拉取真实可用节点并建立缓存
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, { status: 200 });
      const r1 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(r1.yamlStr.includes('香港'));

      // 2. 机场下发全部为“到期续费/官网公告”占位节点（异常响应）
      globalThis.fetch = async () => new Response(PLACEHOLDER_ONLY_CONTENT, { status: 200 });
      const r2 = await buildProfile(cfg, { mode: 'config', noCache: true });

      // 检验：由于旧缓存未包含过期 expire，且异常响应不可覆盖缓存，降级使用上次健康数据
      assert.ok(r2.yamlStr.includes('香港'), '占位节点不得洗掉真实节点，旧有效缓存应受保护');
      assert.ok(!r2.yamlStr.includes('官网地址'), '占位节点不作为正常代理节点输出');
      assert.ok(subStaleCache.has(url), '原有效旧缓存仍应保留');
    } finally {
      restoreFetch();
    }
  });

  test('多订阅场景：一个订阅失效或到期，不影响其他正常订阅', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const urlGood = 'http://93.184.216.34/sub-good';
      const urlBad = 'http://93.184.216.34/sub-bad-auth';

      const GOOD_CONTENT = Buffer.from(`
proxies:
  - name: "🇺🇸 美国 01"
    type: ss
    server: us.domain.com
    port: 443
    cipher: aes-256-gcm
    password: test
`.trim()).toString('base64');

      const cfg = {
        subscriptions: [
          { url: urlGood, tag: 'GoodAirport', retry: 0 },
          { url: urlBad, tag: 'BadAirport', retry: 0 }
        ],
        minorNodeThreshold: 1
      };

      // 1. 两个订阅首次都成功
      globalThis.fetch = async (reqUrl) => {
        const u = reqUrl.toString();
        if (u.includes('sub-good')) return new Response(GOOD_CONTENT, { status: 200 });
        return new Response(VALID_SUB_CONTENT, { status: 200 });
      };
      const r1 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(r1.yamlStr.includes('美国'));
      assert.ok(r1.yamlStr.includes('香港'));

      // 2. 随后 BadAirport 返回 401 失效，GoodAirport 依然健康
      globalThis.fetch = async (reqUrl) => {
        const u = reqUrl.toString();
        if (u.includes('sub-good')) return new Response(GOOD_CONTENT, { status: 200 });
        return new Response('401 Token Dead', { status: 401 });
      };
      const r2 = await buildProfile(cfg, { mode: 'config', noCache: true });
      assert.ok(r2.yamlStr.includes('美国'), '正常订阅不受任何影响');
      assert.ok(!r2.yamlStr.includes('香港'), '失效订阅的旧节点被正常移除');
      assert.equal(subStaleCache.has(urlBad), false, '坏订阅被清除');
      assert.ok(subStaleCache.has(urlGood), '好订阅继续保持');
    } finally {
      restoreFetch();
    }
  });

  test('Profile 内存缓存与 SWR 刷新路径：明确失效淘汰 Profile 快照，后续普通请求立即反映失效', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-swr-terminal';
      const cfg = {
        subscriptions: [{ url, tag: 'SWRTerminalSub', retry: 0 }],
        cacheTtl: 1, // 1s fresh
        cacheStaleMaxAge: 10,
        minorNodeThreshold: 1
      };

      // 1. 首次成功构建并写入 ProfileCache
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, { status: 200 });
      const r1 = await buildProfile(cfg, { mode: 'config' });
      assert.ok(r1.yamlStr.includes('香港'));

      // 2. 等待 1.1s 进入 stale 阶段
      await new Promise(r => setTimeout(r, 1100));

      // 3. 后台触发异步更新（模拟客户端请求命中 stale，后台 Revalidate 发生 401 明确失效）
      globalThis.fetch = async () => new Response('401 Token Expired', { status: 401 });
      const rStale = await buildProfile(cfg, { mode: 'config' });
      assert.ok(rStale.yamlStr.includes('香港'), '当前 stale 请求秒级拿到响应');

      // 等待后台 Revalidate 完成
      await new Promise(r => setTimeout(r, 60));

      // 4. 重点验证：后台检测到 401 终态失效后，必须淘汰 ProfileCache！
      // 接下来新来的普通请求（非强制刷新），不能再拿到包含香港 01 的旧节点！
      const rAfter = await buildProfile(cfg, { mode: 'config' });
      assert.ok(!rAfter.yamlStr.includes('香港'), '终态失效后，后续普通请求不得继续命中旧缓存');
    } finally {
      restoreFetch();
    }
  });

  test('Profile 内存缓存与 SWR 刷新路径：普通网络故障保留可用 Profile 缓存，后续请求继续平滑容灾', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-swr-transient';
      const cfg = {
        subscriptions: [{ url, tag: 'SWRTransientSub', retry: 0 }],
        cacheTtl: 1, // 1s fresh
        cacheStaleMaxAge: 10,
        minorNodeThreshold: 1
      };

      // 1. 首次成功构建
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, { status: 200 });
      const r1 = await buildProfile(cfg, { mode: 'config' });
      assert.ok(r1.yamlStr.includes('香港'));

      // 2. 等待 1.1s 进入 stale 阶段
      await new Promise(r => setTimeout(r, 1100));

      // 3. 后台回源遭遇暂态 502 / 网络错误（普通网络故障，非终态失效）
      globalThis.fetch = async () => new Response('', { status: 502 });
      const rStale = await buildProfile(cfg, { mode: 'config' });
      assert.ok(rStale.yamlStr.includes('香港'));

      // 等待后台 Revalidate 完成
      await new Promise(r => setTimeout(r, 60));

      // 4. 重点验证：普通网络故障不得无条件删除 ProfileCache！旧配置必须继续服务
      const rAfter = await buildProfile(cfg, { mode: 'config' });
      assert.ok(rAfter.yamlStr.includes('香港'), '普通网络故障下，原有效配置快照必须保留');
    } finally {
      restoreFetch();
    }
  });

  test('单 URL 路径：本次响应通过 Userinfo 明确报告到期或流量耗尽时，元数据保留且拒绝容灾', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/single-url-expired';
      const expirePast = Math.floor(Date.now() / 1000) - 3600;

      // 1. 建立旧有效缓存
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, { status: 200 });
      await buildProfile({}, { url, mode: 'config', noCache: true });
      assert.ok(subStaleCache.has(url));

      // 2. 本次请求返回 200 但 Userinfo 明确已到期
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, {
        status: 200,
        headers: { 'subscription-userinfo': `upload=100; download=200; total=1000000; expire=${expirePast}` }
      });
      const res = await buildProfile({}, { url, mode: 'config', noCache: true });
      assert.ok(!res.yamlStr.includes('香港'), '单 URL 路径已到期时绝不得输出旧节点');
      assert.equal(subStaleCache.has(url), false, '单 URL 终态失效后物理删除 subStaleCache');
      assert.equal(res.userInfo.expire, expirePast, '单 URL 路径应忠实保留 expire 元数据用于注释防丢头');
      assert.ok(res.yamlStr.includes(`# subscription-userinfo:`), '单 URL 路径生成防丢头注释');
    } finally {
      restoreFetch();
    }
  });

  test('边界 1：无 subStaleCache 记录时，HTTP 401 仍然上报终态失效并淘汰 Profile Cache', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-no-stale-401';
      const cfg = {
        subscriptions: [{ url, tag: 'NoStale401', retry: 0 }],
        cacheTtl: 1,
        cacheStaleMaxAge: 10,
        minorNodeThreshold: 1
      };

      // 1. 先人工在 profileCache 中放入一条有效 Profile
      const cacheKey = require('../../src/pipeline/engine.js').buildProfileCacheKey(cfg, { mode: 'config' });
      profileCache.set(cacheKey, { yamlStr: 'proxies:\n  - name: 模拟旧Profile' }, { generation: profileCache.nextGeneration() });
      assert.ok(profileCache.has(cacheKey));

      // 2. 模拟拉取，此时 subStaleCache 完全为空，直接遭遇 401
      // 通过 forceRefresh: true 穿透缓存发起真实构建，触发 Single-Flight 构建与 onBuildOutcome
      globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
      let outcome = null;
      await buildProfile(cfg, {
        mode: 'config',
        forceRefresh: true,
        onBuildOutcome: (o) => { outcome = o; }
      });

      assert.ok(outcome, '必须触发 onBuildOutcome');
      assert.equal(outcome.hasTerminalFailure, true, '无 staleCache 发生 401 必须上报 hasTerminalFailure=true');
      assert.equal(profileCache.has(cacheKey), false, '无 staleCache 发生 401 也必须淘汰对应 ProfileCache');
    } finally {
      restoreFetch();
    }
  });

  test('边界 2：无 subStaleCache 记录时，本次 HTTP 200 明确报告已过期，仍然上报终态失效', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-no-stale-expired';
      const cfg = {
        subscriptions: [{ url, tag: 'NoStaleExp', retry: 0 }],
        minorNodeThreshold: 1
      };

      // subStaleCache 为空，首次拉取返回 200 但 expire 早已过期
      const expirePast = Math.floor(Date.now() / 1000) - 100;
      globalThis.fetch = async () => new Response(VALID_SUB_CONTENT, {
        status: 200,
        headers: { 'subscription-userinfo': `upload=100; download=200; total=1000000; expire=${expirePast}` }
      });
      let outcome = null;
      const res = await buildProfile(cfg, {
        mode: 'config',
        noCache: true,
        onBuildOutcome: (o) => { outcome = o; }
      });

      assert.equal(outcome.hasTerminalFailure, true, '无 staleCache 本次过期必须上报 hasTerminalFailure=true');
      assert.ok(!res.yamlStr.includes('香港'), '不得输出节点');
      assert.equal(subStaleCache.has(url), false, '绝不得将其写入 subStaleCache');
    } finally {
      restoreFetch();
    }
  });

  test('边界 3：subStaleCache 已超过保留期限 (fetchStaleTtl)，旧缓存已知过期仍正确淘汰 Profile Cache', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/sub-over-ttl-expired';
      const cfg = {
        subscriptions: [{ url, tag: 'OverTtlExp', retry: 0 }],
        fetchStaleTtl: 1, // 1小时
        cacheTtl: 1,
        cacheStaleMaxAge: 10,
        minorNodeThreshold: 1
      };

      // 手动注入一条 3 小时前的旧缓存（已超期），且里面的 expire 也早已过期
      const expirePast = Math.floor(Date.now() / 1000) - 3600;
      subStaleCache.set(url, {
        content: VALID_SUB_CONTENT,
        subInfo: `upload=100; download=200; total=1000000; expire=${expirePast}`,
        timestamp: Date.now() - 3 * 3600 * 1000 // 3小时前
      });

      const cacheKey = require('../../src/pipeline/engine.js').buildProfileCacheKey(cfg, { mode: 'config' });
      profileCache.set(cacheKey, { yamlStr: 'proxies:\n  - name: 模拟旧Profile' }, { generation: profileCache.nextGeneration() });
      assert.ok(profileCache.has(cacheKey));

      // 随后发生网络超时，forceRefresh: true 触发真实构建与 onBuildOutcome
      globalThis.fetch = async () => { throw new TypeError('Network timeout'); };
      let outcome = null;
      await buildProfile(cfg, {
        mode: 'config',
        forceRefresh: true,
        onBuildOutcome: (o) => { outcome = o; }
      });

      assert.ok(outcome, '必须触发 onBuildOutcome');
      assert.equal(outcome.hasTerminalFailure, true, '即使超过 fetchStaleTtl，已知旧缓存过期仍判定为终态失效');
      assert.equal(subStaleCache.has(url), false, '该过期旧缓存应被淘汰');
      assert.equal(profileCache.has(cacheKey), false, 'ProfileCache 必须被淘汰');
    } finally {
      restoreFetch();
    }
  });

  test('边界 4：新一代健康构建完成后，较旧的终态失败构建不会删除新缓存 (代际保护)', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const cacheKey = 'concurrent-test-key';

      // 模拟代次场景：
      // 老任务 gen=1 发生了终态失效，但在它完成淘汰前，新任务 gen=2 已经抢先成功构建并发布了健康缓存
      const gen1 = profileCache.nextGeneration(); // 1
      const gen2 = profileCache.nextGeneration(); // 2

      // 新任务发布成功条目 (代次 2)
      profileCache.set(cacheKey, { yamlStr: 'proxies:\n  - name: 崭新健康Profile' }, { generation: gen2 });
      assert.ok(profileCache.has(cacheKey));

      // 此时老任务 (代次 1) 尝试基于终态失效执行淘汰
      const deleted = profileCache.delete(cacheKey, gen1);
      assert.equal(deleted, false, '代次较低的老任务禁止删除代次更高的新缓存');
      assert.ok(profileCache.has(cacheKey), '新缓存必须安全保留');
    } finally {
      restoreFetch();
    }
  });

  test('边界 5 (端到端交错并发)：旧构建延迟报告终态失败，新构建抢先发布健康缓存，代际保护阻止老任务误删新缓存且后续请求直接命中', async () => {
    subStaleCache.clear();
    profileCache.clear();
    try {
      const url = 'http://93.184.216.34/e2e-interleaved-test';
      const cfg = {
        subscriptions: [{ url, tag: 'InterleavedSub', retry: 0 }],
        enableCache: true,
        cacheTtl: 300,
        minorNodeThreshold: 1
      };

      let fetchCallCount = 0;
      let resolveOldTaskFetch;
      const oldTaskFetchGate = new Promise((resolve) => {
        resolveOldTaskFetch = resolve;
      });

      // 模拟交错请求：
      // 第 1 次 fetch（来自 Task 1）：挂起等待 oldTaskFetchGate 信号，随后返回 401 终态失败
      // 第 2 次 fetch（来自 Task 2）：立即返回 200 健康节点响应
      globalThis.fetch = async () => {
        fetchCallCount += 1;
        if (fetchCallCount === 1) {
          await oldTaskFetchGate;
          return new Response('Unauthorized', { status: 401 });
        }
        return new Response(VALID_SUB_CONTENT, { status: 200 });
      };

      // 1. 启动旧任务 Task 1 (普通构建请求，内部 generation = 1)
      // 此时 profileCache 为空，Task 1 进入 normalFlights 并调用 fetch，挂起在 oldTaskFetchGate
      let oldTaskOutcome = null;
      const oldTaskPromise = buildProfile(cfg, {
        mode: 'config',
        onBuildOutcome: (o) => { oldTaskOutcome = o; }
      });

      // 确保 Task 1 已经实际开始执行并进入 fetch 挂起
      while (fetchCallCount === 0) {
        await new Promise((r) => setImmediate(r));
      }

      // 2. 在 Task 1 尚未完成时，启动新任务 Task 2 (forceRefresh: true 强制构建，内部 generation = 2)
      // 由于 Task 1 位于 normalFlights，强制刷新不共享 normalFlights，独立启动新的构建流程
      let newTaskOutcome = null;
      const newRes = await buildProfile(cfg, {
        mode: 'config',
        forceRefresh: true,
        onBuildOutcome: (o) => { newTaskOutcome = o; }
      });

      // 验证 Task 2 已经成功发布了健康缓存
      assert.ok(newTaskOutcome, 'Task 2 必须触发 onBuildOutcome');
      assert.equal(newTaskOutcome.published, true, 'Task 2 必须成功发布健康缓存');
      assert.equal(newTaskOutcome.hasTerminalFailure, false, 'Task 2 不应有终态失败');
      assert.ok(newRes.yamlStr.includes('香港'), 'Task 2 必须生成有效节点');

      const cacheKey = require('../../src/pipeline/engine.js').buildProfileCacheKey(cfg, { mode: 'config' });
      assert.ok(profileCache.has(cacheKey), 'ProfileCache 当前必须存在 Task 2 发布的健康快照');
      const cachedBeforeOldSettles = profileCache.getWithStatus(cacheKey, { freshTtlMs: 300000 });
      assert.equal(cachedBeforeOldSettles.status, 'fresh');
      const gen2 = cachedBeforeOldSettles.generation;

      // 同时验证 Task 2 已经成功写入了 subStaleCache 且具有有效版本与引用
      assert.ok(subStaleCache.has(url), 'Task 2 必须已写入 subStaleCache');
      const t2StaleEntry = subStaleCache.get(url);
      assert.ok(t2StaleEntry, 't2StaleEntry 必须存在');
      assert.ok(t2StaleEntry.content.includes(VALID_SUB_CONTENT.slice(0, 10)), '内容必须为有效节点');

      // 3. 释放挂起的旧任务 Task 1，使其收到 401 终态失败，进入 runBuildTask 触发淘汰
      resolveOldTaskFetch();
      await oldTaskPromise;

      assert.ok(oldTaskOutcome, 'Task 1 必须触发 onBuildOutcome');
      assert.equal(oldTaskOutcome.hasTerminalFailure, true, 'Task 1 必须判定为终态失效');

      // 4. 关键断言：
      // (a) Profile Cache 代际保护：Task 1 的 taskGeneration (1) 低于缓存中条目的 generation (2)，profileCache.delete(cacheKey, 1) 拒绝删除！
      assert.ok(profileCache.has(cacheKey), 'ProfileCache 中的新条目不被旧任务误删');
      const cachedAfterOldSettles = profileCache.getWithStatus(cacheKey, { freshTtlMs: 300000 });
      assert.equal(cachedAfterOldSettles.status, 'fresh');
      assert.equal(cachedAfterOldSettles.generation, gen2, '缓存中条目的代次必须依然是 Task 2 的代次');

      // (b) 订阅级缓存安全保护：Task 1 失败时只能根据发起时捕获的旧条目淘汰，不得误删 Task 2 新写入的 subStaleCache！
      assert.ok(subStaleCache.has(url), 'subStaleCache 不被旧任务 Task 1 误删');
      assert.equal(subStaleCache.get(url), t2StaleEntry, 'subStaleCache 中保留的必须严格是 Task 2 写入的健康条目引用');

      // 5. 模拟普通网络故障：验证 Task 2 留下的新订阅缓存能够正常提供容灾降级
      globalThis.fetch = async () => { throw new TypeError('Network timeout'); };
      // 通过 forceRefresh: true 穿透 Profile 缓存，强制拉取网络以检验 subStaleCache 容灾降级
      const fallbackRes = await buildProfile(cfg, {
        mode: 'config',
        forceRefresh: true
      });

      assert.ok(fallbackRes.yamlStr.includes('香港'), '网络故障时必须成功由 Task 2 留下的 subStaleCache 容灾兜底');
      assert.ok(subStaleCache.has(url), '容灾兜底后 subStaleCache 依然安全保留');

      // 6. 验证现有明确失效时的正确淘汰：在无并发新任务覆写的普通情况下，遭遇 401 必须正常淘汰该缓存
      globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
      let normalFailOutcome = null;
      await buildProfile(cfg, {
        mode: 'config',
        forceRefresh: true,
        onBuildOutcome: (o) => { normalFailOutcome = o; }
      });

      assert.equal(normalFailOutcome?.hasTerminalFailure, true, '确认终态失效');
      assert.equal(subStaleCache.has(url), false, '普通单任务遭遇 401 必须清理 subStaleCache');
      assert.equal(profileCache.has(cacheKey), false, '对应 ProfileCache 必须被清理');

      // 再次模拟网络故障，由于缓存已被合法清除，不应发生失效容灾
      globalThis.fetch = async () => { throw new TypeError('Network timeout'); };
      const emptyRes = await buildProfile(cfg, {
        mode: 'config',
        forceRefresh: true
      });
      assert.ok(!emptyRes.yamlStr.includes('香港'), '已淘汰的失效缓存不再继续容灾');
    } finally {
      restoreFetch();
    }
  });

  test('边界 6 (单元级)：SubStaleCacheMap 安全淘汰与版本/条目身份边界', () => {
    const cache = new SubStaleCacheMap();
    const url = 'http://test.com/sub';

    // 1. 无初始缓存时（snapshot 未定义），无权删除并发写入的条目
    cache.set(url, { content: 't2-data', timestamp: Date.now() });
    assert.equal(cache.deleteIfMatch(url, undefined), false, '无初始缓存时拒绝删除并发新条目');
    assert.equal(cache.deleteIfMatch(url, null), false);
    assert.equal(cache.has(url), true);

    // 2. 身份不同时（并发写入了全新对象），快照拒绝删除
    const fakeSnapshot = { entry: { content: 'old-data' }, version: 1 };
    assert.equal(cache.deleteIfMatch(url, fakeSnapshot), false, '对象引用不一致时拒绝删除');
    assert.equal(cache.has(url), true);

    // 3. 关键场景验证：同一对象被再次写入（版本号递增），持有旧版本快照的任务禁止删除
    const sharedEntry = { content: 'shared-data', timestamp: Date.now() };
    cache.set(url, sharedEntry);
    const oldSnapshot = cache.getSnapshot(url); // 捕获当时的版本号快照，如 version=2

    // 同一对象被再次写入（例如并发任务刷新或重试），内部版本号递增为 version=3
    cache.set(url, sharedEntry);

    // 此时旧任务拿旧快照 oldSnapshot (version=2) 尝试执行淘汰：
    // 虽然 sharedEntry 引用完全相同，但内部版本已变为 3，必须识别出重写并拒绝误删！
    const deleteOldResult = cache.deleteIfMatch(url, oldSnapshot);
    assert.equal(deleteOldResult, false, '同一对象被再次写入后，旧版本快照严禁删除');
    assert.equal(cache.has(url), true, '条目必须安全保留');

    // 4. 最新快照与当前条目和版本完全一致时，允许合法淘汰并清理内部 _versions 记录
    const latestSnapshot = cache.getSnapshot(url);
    const deleteLatestResult = cache.deleteIfMatch(url, latestSnapshot);
    assert.equal(deleteLatestResult, true, '最新快照（引用与版本均一致）允许淘汰');
    assert.equal(cache.has(url), false, '条目已被清理');
    assert.equal(cache._versions.has(url), false, '_versions 内部版本映射必须已被同步清理，避免残留');

    // 5. 契约防御：直接传入裸条目对象（缺少 version 快照契约）时拒绝删除
    cache.set(url, { content: 'raw-data', timestamp: Date.now() });
    const rawEntry = cache.get(url);
    assert.equal(cache.deleteIfMatch(url, rawEntry), false, '直接传入裸条目非快照对象必须被拒绝');
    assert.equal(cache.has(url), true, '条目依然安全保留');
  });

});
