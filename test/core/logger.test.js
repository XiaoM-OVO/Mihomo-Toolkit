const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, redactText } = require('../../src/core/logger');

describe('【Core】统一分级终端 Logger (logger)', () => {
  it('filter - silent 模式完全静默', () => {
    const logs = [];
    const logger = createLogger({
      level: 'silent',
      out: (msg, level) => logs.push({ msg, level })
    });

    logger.debug('dbg');
    logger.info('inf');
    logger.warn('wrn');
    logger.error('err');

    assert.equal(logs.length, 0);
  });

  it('filter - warn 模式仅放行 warn 与 error', () => {
    const logs = [];
    const logger = createLogger({
      level: 'warn',
      out: (msg, level) => logs.push({ msg, level })
    });

    logger.debug('dbg');
    logger.info('inf');
    logger.warn('warning message');
    logger.error('error message');

    assert.equal(logs.length, 2);
    assert.equal(logs[0].level, 'warn');
    assert.equal(logs[1].level, 'error');
  });

  it('filter - debug 模式放行全部级别，且 setLevel 支持动态切换', () => {
    const logs = [];
    const logger = createLogger({
      level: 'debug',
      out: (msg, level) => logs.push({ msg, level })
    });

    assert.equal(logger.isLevelEnabled('debug'), true);
    assert.equal(logger.isLevelEnabled('info'), true);

    logger.debug('test debug');
    assert.equal(logs.length, 1);

    logger.setLevel('error');
    assert.equal(logger.isLevelEnabled('debug'), false);
    assert.equal(logger.isLevelEnabled('error'), true);

    logger.info('ignored info');
    assert.equal(logs.length, 1);

    logger.error('passed error');
    assert.equal(logs.length, 2);
  });

  it('scope - child 派生子 Logger 并解析正确的 Debug/Warn 作用域徽标', () => {
    const logs = [];
    const root = createLogger({
      tag: 'CLI',
      level: 'debug',
      colors: false,
      timestamps: false,
      tagWidth: 12,
      out: (msg) => logs.push(msg)
    });

    root.info('root message');
    assert.ok(logs[0].startsWith('[CLI]        root message'));

    const cleaner = root.child('Cleaner');
    cleaner.info('cleaner info');
    cleaner.debug('cleaner debug');
    cleaner.warn('cleaner warn');

    assert.ok(logs[1].startsWith('[Cleaner]    cleaner info'));
    assert.ok(logs[2].startsWith('[Clean:DBG]  cleaner debug'));
    assert.ok(logs[3].startsWith('[Clean:WARN] cleaner warn'));

    const strat = root.child('Strategy');
    strat.debug('strategy debug');
    assert.ok(logs[4].startsWith('[Strat:DBG]  strategy debug'));

    const warm = root.child('Warmup');
    warm.info('warmup info');
    assert.ok(logs[5].startsWith('[Warmup]     warmup info'));

    const cron = root.child('Cron');
    cron.warn('cron warn');
    assert.ok(logs[6].startsWith('[Cron:WARN]  cron warn'));
  });

  it('format - 多行树形分支换行自动对齐缩进', () => {
    const logs = [];
    const logger = createLogger({
      tag: 'IO',
      level: 'info',
      colors: false,
      timestamps: false,
      tagWidth: 12,
      out: (msg) => logs.push(msg)
    });

    logger.info(`📡 解析完成:\n├── 🌐 源 A\n└── 📌 源 B`);
    const lines = logs[0].split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[0], '[IO]         📡 解析完成:');
    // 前缀定宽 12 + 1 空格 = 13 个字符
    assert.equal(lines[1], '             ├── 🌐 源 A');
    assert.equal(lines[2], '             └── 📌 源 B');
  });

  it('redact - 过滤 URL Token、密钥、密码与 Proxy 凭据', () => {
    const secretUrl = 'https://example.com/api/v1/client/subscribe?token=secret123456&foo=bar';
    const redacted = redactText(secretUrl);
    assert.ok(!redacted.includes('secret123456'));
    assert.ok(redacted.includes('token=***'));

    const authHeader = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';
    assert.equal(redactText(authHeader), 'Bearer ***');

    const basicAuthUrl = 'https://admin:myPassword123@sub.airport.org/sub';
    assert.equal(redactText(basicAuthUrl), 'https://***@sub.airport.org/sub');

    const vlessUri = 'vless://uuid-1234-5678@node1.example.com:443';
    assert.equal(redactText(vlessUri), 'vless://***@node1.example.com:443');

    const hy2Uri = 'hy2://mypassword123@node2.example.com:443';
    assert.equal(redactText(hy2Uri), 'hy2://***@node2.example.com:443');

    const tuicUri = 'tuic://uuid-1234:pass456@node3.example.com:8443';
    assert.equal(redactText(tuicUri), 'tuic://***@node3.example.com:8443');

    const vmessUri = 'vmess://eyJhZGQiOiIxMjcuMC4wLjEiLCJpZCI6InV1aWQtMTIzNCJ9';
    assert.equal(redactText(vmessUri), 'vmess://***');
  });

  it('redact - Logger 集成脱敏选项受控生效', () => {
    const logs = [];
    const logger = createLogger({
      tag: 'Fetch',
      colors: false,
      timestamps: false,
      redact: true,
      out: (msg) => logs.push(msg)
    });

    logger.info('Fetching https://airport.com/sub?token=supersecret999');
    assert.ok(!logs[0].includes('supersecret999'));
    assert.ok(logs[0].includes('token=***'));

    const unredactedLogs = [];
    const rawLogger = createLogger({
      tag: 'Fetch',
      colors: false,
      timestamps: false,
      redact: false,
      out: (msg) => unredactedLogs.push(msg)
    });
    rawLogger.info('Fetching https://airport.com/sub?token=supersecret999');
    assert.ok(unredactedLogs[0].includes('supersecret999'));
  });

  it('pipeline - options.silent / quiet 完全静默', async () => {
    const { runPipelineEngine } = require('../../src/pipeline/engine');
    const logs = [];
    const customLogger = createLogger({
      level: 'silent',
      out: (msg) => logs.push(msg)
    });
    const dummySub = {
      uri: 'proxies:\n  - name: test\n    type: ss\n    server: 1.1.1.1\n    port: 443\n    cipher: aes-128-gcm\n    password: p',
      tag: 'test'
    };
    const res = await runPipelineEngine({ subscriptions: [dummySub] }, { silent: true, logger: customLogger });
    assert.ok(res);
    assert.equal(logs.length, 0);
  });

  it('pipeline - 自动化测试环境下默认静默防噪音', async () => {
    const { buildProfile } = require('../../src/index');
    const userConfig = {
      subscriptions: [
        {
          uri: 'vless://11111111-2222-3333-4444-555555555555@hk.domain.com:443?security=tls#🇭🇰 香港 01',
          tag: 'Sub1'
        }
      ]
    };
    const { proxies } = await buildProfile(userConfig, { mode: 'nodes', noCache: true });
    assert.ok(proxies);
    assert.equal(proxies.length, 1);
  });
});
