/**
 * 客户端 UA 变体回归：匹配表归一化、UA 识别、osType=none 进程规则剥除与缓存键隔离
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveUaVariantPatterns, matchUaVariant } = require('../../src/config/ua-variant');
const { resolveConfig } = require('../../src/config');
const {
  UA_VARIANT_PATTERN_DEFAULTS,
  UA_VARIANT_KEYS,
  UA_VARIANT_OS,
  UA_OS_PARAM_VALUES,
  UA_OS_PARAM_TO_OSTYPE
} = require('../../src/data/ua-variants');
const { expandRouting } = require('../../src/strategy/routing');
const { buildProfileCacheKey } = require('../../src/pipeline/engine');
const { startServer } = require('../../src/targets/server');
const { createLogger } = require('../../src/core/logger');

describe('【Server】UA 变体匹配表归一化 (ua-variant)', () => {
  it('patterns - 未配置时返回纯内置默认表', () => {
    const { patterns, warnings } = resolveUaVariantPatterns(undefined);
    assert.deepStrictEqual(warnings, []);
    assert.deepStrictEqual(patterns, UA_VARIANT_PATTERN_DEFAULTS);
    // 返回值必须是可变副本，不得共享冻结基线的引用
    patterns.ios.push('test-probe');
    assert.ok(!UA_VARIANT_PATTERN_DEFAULTS.ios.includes('test-probe'));
  });

  it('patterns - 用户键级覆写：命中键整体替换，未声明键保留默认', () => {
    const { patterns, warnings } = resolveUaVariantPatterns({ ios: ['MyClient/'] });
    assert.deepStrictEqual(warnings, []);
    assert.deepStrictEqual(patterns.ios, ['MyClient/']);
    assert.deepStrictEqual(patterns.android, UA_VARIANT_PATTERN_DEFAULTS.android);
  });

  it('patterns - 非法条目逐条丢弃并告警，不静默吞掉用户意图', () => {
    const { patterns, warnings } = resolveUaVariantPatterns({
      ios: ['ok-client/', 42, '   ', '', 'another/'],
      android: 'not-an-array',
      mac: ['bogus-key']
    });
    assert.deepStrictEqual(patterns.ios, ['ok-client/', 'another/']);
    assert.deepStrictEqual(patterns.android, UA_VARIANT_PATTERN_DEFAULTS.android, '非法键值沿用默认表');
    assert.ok(warnings.some(w => w.includes('42')));
    assert.ok(warnings.some(w => w.includes('android')));
    assert.ok(warnings.some(w => w.includes('mac')));
  });

  it('patterns - 整段非对象与重复条目归一', () => {
    const bad = resolveUaVariantPatterns(['stash']);
    assert.ok(bad.warnings.length === 1 && bad.warnings[0].includes('必须是对象'));
    assert.deepStrictEqual(bad.patterns, UA_VARIANT_PATTERN_DEFAULTS);

    const dup = resolveUaVariantPatterns({ ios: ['a/', 'a/', ' a/ '] });
    assert.deepStrictEqual(dup.patterns.ios, ['a/']);
  });
});

describe('【Server】UA 变体识别 (matchUaVariant)', () => {
  const { patterns } = resolveUaVariantPatterns(undefined);

  it('match - 内置表命中 iOS 客户端', () => {
    for (const ua of [
      'Stash/940 (iPhone; iOS 18.1)',
      'Shadowrocket/2380 CFNetwork/1568',
      'SFI/1.10.2 (iPhone; iOS 18.1)',
      'Loon/3.2.4 (iPhone; iOS 18.0)',
      'Surge iOS/3550'
    ]) {
      assert.equal(matchUaVariant(ua, patterns), 'ios', `应识别为 ios: ${ua}`);
    }
  });

  it('match - 内置表命中 Android 客户端', () => {
    for (const ua of [
      'ClashMetaForAndroid/2.11.5',
      'SFA/1.10.2 (Android 15)',
      'NekoBox/1.3.2 (Android)'
    ]) {
      assert.equal(matchUaVariant(ua, patterns), 'android', `应识别为 android: ${ua}`);
    }
  });

  it('match - 桌面与未知 UA 不命中（落默认变体）', () => {
    for (const ua of [
      'clash-verge/v2.20.0',
      'mihomo-party/1.5.0',
      'clash.meta/v1.19.33',
      'FlClash/0.8.60',
      'curl/8.5.0',
      'unknown',
      ''
    ]) {
      assert.equal(matchUaVariant(ua, patterns), null, `不应命中: ${ua}`);
    }
  });

  it('match - 大小写不敏感且用户自定义表生效', () => {
    const custom = resolveUaVariantPatterns({ ios: ['quantumult'] }).patterns;
    assert.equal(matchUaVariant('Quantumult X/1.0.30', custom), 'ios');
    assert.equal(matchUaVariant('QUANTUMULT X/1.0.30', custom), 'ios');
    // 默认表命中不到 Quantumult
    assert.equal(matchUaVariant('Quantumult X/1.0.30', patterns), null);
  });
});

describe('【Server】UA 变体派生表与参数契约', () => {
  it('constants - 移动端变体统一映射到 osType=none', () => {
    for (const key of UA_VARIANT_KEYS) {
      assert.equal(UA_VARIANT_OS[key], 'none');
    }
  });

  it('constants - ?os= 参数映射覆盖全部合法值且 ios/android 为 none 别名', () => {
    assert.deepStrictEqual([...UA_OS_PARAM_VALUES].sort(), ['all', 'android', 'ios', 'linux', 'mac', 'windows']);
    assert.equal(UA_OS_PARAM_TO_OSTYPE.ios, 'none');
    assert.equal(UA_OS_PARAM_TO_OSTYPE.android, 'none');
    for (const v of ['windows', 'mac', 'linux', 'all']) {
      assert.equal(UA_OS_PARAM_TO_OSTYPE[v], v);
    }
  });
});

describe('【Server】osType=none 变体的产物行为', () => {
  const routing = [{ preset: 'bt' }, { preset: 'download' }, { preset: 'process' }];

  it('routing - 默认 osType 产出进程规则', () => {
    const cfg = resolveConfig({ routing });
    const { rules } = expandRouting(cfg, cfg.registries);
    assert.ok(rules.some(r => r.startsWith('PROCESS-NAME,IDMan.exe,')), '默认变体必须包含下载进程规则');
    assert.ok(rules.some(r => r.startsWith('PROCESS-NAME,qBittorrent.exe,')), '默认变体必须包含 BT 进程规则');
  });

  it('routing - osType=none 剥除全部进程规则，域名/IP 分流不受影响', () => {
    const cfg = resolveConfig({ osType: 'none', routing });
    const { rules } = expandRouting(cfg, cfg.registries);
    assert.ok(
      !rules.some(r => r.startsWith('PROCESS-NAME,')),
      'none 变体不得产出任何 PROCESS-NAME 规则'
    );
    assert.ok(rules.some(r => r.startsWith('RULE-SET,')), '域名/IP 分流规则必须保留');
  });

  it('cache - 变体 patch 进缓存键：none 与默认隔离、同 patch 键稳定', () => {
    const base = { subscriptions: [{ url: 'https://sub.example.com/link?token=x' }] };
    const none = { ...base, osType: 'none' };
    const baseline = buildProfileCacheKey(base, { mode: 'config' });
    const noneKey = buildProfileCacheKey(none, { mode: 'config' });
    assert.notEqual(noneKey, baseline, 'osType=none 变体必须与默认变体使用不同缓存键');
    assert.equal(
      noneKey,
      buildProfileCacheKey({ ...base, osType: 'none' }, { mode: 'config' }),
      '相同变体 patch 必须得到稳定缓存键'
    );
  });
});

describe('【Server】UA 变体 HTTP 端到端 (ua-variant)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-ua-variant-'));
  const configPath = path.join(tmpDir, 'config.yaml');
  // 仅 BT 段：目标恒为 DIRECT，不依赖订阅可用性即可观察进程规则的存在与消失
  fs.writeFileSync(configPath, [
    'logLevel: "silent"',
    'enableCache: false',
    'routing:',
    '  - preset: bt'
  ].join('\n'), 'utf-8');

  const server = startServer({
    port: 0,
    configPath,
    logger: createLogger({ tag: 'Server', level: 'silent', colors: false }),
    registerSignalHandlers: false
  });

  after(() => { server.close(); });

  function request(pathStr, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: server.address().port, path: pathStr, method: 'GET', headers, agent: false },
        (res) => {
          let body = '';
          res.setEncoding('utf-8');
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('http - 桌面 UA 走默认变体：BT 进程规则原样下发', async () => {
    const { status, body } = await request('/', { 'User-Agent': 'clash-verge/v2.20.0' });
    assert.equal(status, 200);
    assert.ok(body.includes('PROCESS-NAME,qBittorrent.exe,DIRECT'), '默认变体必须包含 BT 进程规则');
  });

  it('http - iOS UA 命中移动端变体：进程规则被剥除', async () => {
    const { status, body } = await request('/', { 'User-Agent': 'Stash/940 (iPhone; iOS 18.1)' });
    assert.equal(status, 200);
    assert.ok(!body.includes('PROCESS-NAME,'), '移动端变体不得包含任何进程规则');
    assert.ok(body.includes('proxies:'), '产物仍是完整配置形态');
  });

  it('http - Android UA 与 ?os=ios 上下文键隔离，产物一致剥除', async () => {
    const { body: androidBody } = await request('/', { 'User-Agent': 'ClashMetaForAndroid/2.11.5' });
    assert.ok(!androidBody.includes('PROCESS-NAME,'));
    const { body: iosParamBody } = await request('/?os=ios', { 'User-Agent': 'clash-verge/v2.20.0' });
    assert.ok(!iosParamBody.includes('PROCESS-NAME,'), '?os=ios 显式参数同样剥除进程规则');
  });

  it('http - ?os=linux 覆写 osType：切换到 Lin 名单', async () => {
    const { status, body } = await request('/?os=linux', { 'User-Agent': 'clash-verge/v2.20.0' });
    assert.equal(status, 200);
    // Lin 名单不追加 .exe 后缀（仅 Win 名单追加）
    assert.ok(body.includes('PROCESS-NAME,aria2c,DIRECT'), 'linux 变体必须包含 Lin 名单进程规则');
    assert.ok(!body.includes('PROCESS-NAME,qBittorrent.exe,DIRECT'), 'Win 名单不得出现');
  });

  it('http - 非法 ?os= 值 fail-closed 返回 400', async () => {
    const { status, body } = await request('/?os=windows95');
    assert.equal(status, 400);
    assert.ok(body.includes('Invalid os param'));
  });
});
