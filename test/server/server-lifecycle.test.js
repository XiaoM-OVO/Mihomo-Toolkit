/**
 * Server Lifecycle: Graceful Shutdown, Config Hot-Reload Debounce & Healthz Metrics
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const yaml = require('yaml');
const { startServer } = require('../../src/targets/server');
const { createLogger } = require('../../src/core/logger');

const silentLogger = createLogger({ tag: 'Server', level: 'silent', colors: false });

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-lifecycle-'));
}

async function startTestServer(options) {
  const server = startServer({ port: 0, logger: silentLogger, registerSignalHandlers: false, ...options });
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
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const BASE_PROXY_1 = {
  name: '🇭🇰 香港 01',
  type: 'ss',
  server: '198.51.100.1',
  port: 443,
  cipher: 'aes-256-gcm',
  password: 'test-password'
};

const BASE_PROXY_2 = {
  name: '🇯🇵 日本 01',
  type: 'ss',
  server: '198.51.100.2',
  port: 443,
  cipher: 'aes-256-gcm',
  password: 'test-password'
};

describe('【Server】生命周期管理与热重载稳固性 (server-lifecycle)', () => {
  it('healthz - 输出运行时监控指标与服务状态', async () => {
    const tmpDir = makeTmpDir();
    const configFile = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configFile, yaml.stringify({
      subscriptions: [{ name: 'HK-Sub', ...BASE_PROXY_1 }]
    }));

    const { server, port } = await startTestServer({ configPath: configFile });
    try {
      const res = await request(port, '/healthz');
      assert.equal(res.status, 200);
      const json = JSON.parse(res.body);
      assert.equal(json.status, 'ok');
      assert.equal(json.service, 'Mihomo-Toolkit');
      assert.equal(json.activeBuilds, 0);
      assert.equal(typeof json.uptime, 'number');
      assert.equal(typeof json.maxConcurrentBuilds, 'number');
    } finally {
      await server.closeGracefully();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('hot-reload - 多并发请求下热重载单飞合并且配置生效', async () => {
    const tmpDir = makeTmpDir();
    const configFile = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configFile, yaml.stringify({
      subscriptions: [{ name: 'HK-Sub', ...BASE_PROXY_1 }]
    }));

    const { server, port } = await startTestServer({ configPath: configFile });
    try {
      // 首次请求验证初始配置
      const res1 = await request(port, '/sub');
      assert.equal(res1.status, 200);
      assert.match(res1.body, /香港/);
      assert.doesNotMatch(res1.body, /日本/);

      // 修改配置文件增加日本节点
      // 稍微调整 mtime 确保触发文件系统检测
      await new Promise(r => setTimeout(r, 50));
      fs.writeFileSync(configFile, yaml.stringify({
        subscriptions: [
          { name: 'HK-Sub', ...BASE_PROXY_1 },
          { name: 'JP-Sub', ...BASE_PROXY_2 }
        ]
      }));

      // 并发 5 个请求打入
      const concurrentReqs = Array.from({ length: 5 }, () => request(port, '/sub'));
      const results = await Promise.all(concurrentReqs);

      for (const res of results) {
        assert.equal(res.status, 200);
        assert.match(res.body, /香港/);
        assert.match(res.body, /日本/);
      }
    } finally {
      await server.closeGracefully();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('hot-reload - 0 字节临时截断写入防抖容错与保底', async () => {
    const tmpDir = makeTmpDir();
    const configFile = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configFile, yaml.stringify({
      subscriptions: [{ name: 'HK-Sub', ...BASE_PROXY_1 }]
    }));

    const { server, port } = await startTestServer({ configPath: configFile });
    try {
      const res1 = await request(port, '/sub');
      assert.equal(res1.status, 200);
      assert.match(res1.body, /香港/);

      // 模拟编辑器先 truncate 清空文件 (0 字节)
      await new Promise(r => setTimeout(r, 50));
      fs.writeFileSync(configFile, '');

      // 请求打入：不应被空内容清空内存配置，必须保住上一份有效配置
      const res2 = await request(port, '/sub');
      assert.equal(res2.status, 200);
      assert.match(res2.body, /香港/);

      // 编辑器随后写入新配置
      fs.writeFileSync(configFile, yaml.stringify({
        subscriptions: [{ name: 'JP-Sub', ...BASE_PROXY_2 }]
      }));

      // 下一次请求成功读入新配置
      const res3 = await request(port, '/sub');
      assert.equal(res3.status, 200);
      assert.match(res3.body, /日本/);
    } finally {
      await server.closeGracefully();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('hot-reload - 语法损坏时自动降级保住旧配置', async () => {
    const tmpDir = makeTmpDir();
    const configFile = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configFile, yaml.stringify({
      subscriptions: [{ name: 'HK-Sub', ...BASE_PROXY_1 }]
    }));

    const { server, port } = await startTestServer({ configPath: configFile });
    try {
      const res1 = await request(port, '/sub');
      assert.equal(res1.status, 200);
      assert.match(res1.body, /香港/);

      // 模拟用户配置写错语法
      await new Promise(r => setTimeout(r, 50));
      fs.writeFileSync(configFile, 'subscriptions: [broken-unclosed');

      // 请求打入：不应崩溃，必须降级保住旧配置
      const res2 = await request(port, '/sub');
      assert.equal(res2.status, 200);
      assert.match(res2.body, /香港/);
    } finally {
      await server.closeGracefully();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('graceful-shutdown - 平滑退出等待在途请求完成排空后再关闭', async () => {
    const tmpDir = makeTmpDir();
    const configFile = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(configFile, yaml.stringify({
      subscriptions: [{ name: 'HK-Sub', ...BASE_PROXY_1 }]
    }));

    const { server, port } = await startTestServer({ configPath: configFile });
    try {
      let shutdownPromise = null;

      // 监听请求到达服务器并在其处理期间触发平滑停机
      server.once('request', () => {
        setImmediate(() => {
          shutdownPromise = server.closeGracefully(5000);
        });
      });

      // 在途请求应正常成功完成并返回 200
      const res = await request(port, '/sub');
      assert.equal(res.status, 200);
      assert.match(res.body, /香港/);

      // 等待停机完全排空结束
      if (shutdownPromise) {
        await shutdownPromise;
      } else {
        await server.closeGracefully(5000);
      }
      assert.equal(server.listening, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
