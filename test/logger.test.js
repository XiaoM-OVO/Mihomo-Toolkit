const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, Logger, redactText } = require('../src/core/logger');

describe('🪵 统一分级终端 Logger 模块测试', () => {
  it('日志级别过滤 - silent 模式彻底静默', () => {
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

  it('日志级别过滤 - warn 模式仅放行 warn 与 error', () => {
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

  it('日志级别过滤 - debug 模式放行全部级别，且 setLevel 支持动态切换', () => {
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

  it('作用域微标与缩写 - child 派生子 Logger 并解析正确的 Debug/Warn 标识', () => {
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

  it('多行树形分支换行自动对齐缩进', () => {
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

  it('敏感信息自动脱敏 - 过滤 URL Token、密钥、密码与 Proxy 凭据', () => {
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
  });

  it('Logger 集成脱敏 - redact 选项受控生效', () => {
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

  it('流水线日志控制 - options.silent / quiet 彻底静默', async () => {
    const { runPipelineEngine } = require('../src/pipeline/engine');
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
});
