/**
 * -----------------------------------------------------------------------------
 * 流水线基准与负载压测 (Pipeline Benchmark & Load Test)
 * -----------------------------------------------------------------------------
 * 覆盖阶段：协议解析 ➔ 冷启动全链路编译 ➔ 热缓存延迟/并发 ➔ HTTP 服务端并发 ➔ 内存稳定性
 *
 * 设计要点：
 *   1. 默认使用种子固定的合成语料（多协议 + 固定比例脏数据），规模可调；
 *      --source 可切换为真实订阅文件或 URL，便于与线上样本对齐。
 *   2. 每个阶段先预热再取样，避免 JIT 与模块懒加载污染首个样本。
 *   3. 统计口径统一为：样本数 / 均值 / 标准差 / 变异系数 / p50 / p90 / p95 / p99 / max。
 *   4. 热路径与 HTTP 使用闭环并发压测，输出真实 QPS 与延迟分位数。
 *   5. 内存阶段交替执行冷构建并采样堆占用，用线性回归斜率判断是否存在持续增长。
 *   6. --json 导出机器可读结果，--baseline 做回归门禁，超阈值以非零退出码结束。
 *
 * 用法：
 *   node --expose-gc scripts/benchmark.js
 *   node --expose-gc scripts/benchmark.js --nodes 5000 --duration 10 --concurrency 64
 *   node --expose-gc scripts/benchmark.js --source ./real-sub.txt --json bench-result.json
 *   node --expose-gc scripts/benchmark.js --baseline bench-result.json --max-regression 15
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');
const { parseContent } = require('../src/io/parsers');
const { buildProfile } = require('../src/index');
const { profileCache } = require('../src/io/cache');
const pkg = require('../package.json');

const ENGINE_OPTIONS = Object.freeze({ mode: 'config', silent: true });
const COLD_WARMUP_ROUNDS = 2;
const PARSER_WARMUP_ROUNDS = 3;
/** 内存采样间隔：热构建每执行 N 次采样一次，避免高频 gc 干扰 */
const MEMORY_SAMPLE_EVERY = 25;

// ─── 语料生成参数（权重之和即为协议分布，固定后语料可复现） ───────────────────

const REGIONS = [
  { name: '香港', emoji: '🇭🇰', code: 'hk' },
  { name: '台湾', emoji: '🇹🇼', code: 'tw' },
  { name: '日本', emoji: '🇯🇵', code: 'jp' },
  { name: '新加坡', emoji: '🇸🇬', code: 'sg' },
  { name: '美国', emoji: '🇺🇸', code: 'us' },
  { name: '韩国', emoji: '🇰🇷', code: 'kr' },
  { name: '英国', emoji: '🇬🇧', code: 'uk' },
  { name: '德国', emoji: '🇩🇪', code: 'de' },
  { name: '荷兰', emoji: '🇳🇱', code: 'nl' },
  { name: '俄罗斯', emoji: '🇷🇺', code: 'ru' },
  { name: '澳大利亚', emoji: '🇦🇺', code: 'au' },
  { name: '加拿大', emoji: '🇨🇦', code: 'ca' }
];

const PROVIDERS = ['Aurora', 'Nebula', 'Zenith', 'Orbit', 'Vertex', 'Lumen', 'Nimbus', 'Pulse'];

const PROTOCOL_MIX = [
  ['vmess', 28],
  ['vless', 24],
  ['trojan', 18],
  ['ss', 14],
  ['hysteria2', 7],
  ['tuic', 4],
  ['socks5', 3],
  ['http', 2]
];

const PORTS = [443, 8443, 2053, 2083, 2087, 2096, 20991, 12345];
const SS_CIPHERS = ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305'];
const FINGERPRINTS = ['chrome', 'firefox', 'safari', 'random'];

// ─── 参数解析 ────────────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set([
  '--nodes',
  '--seed',
  '--source',
  '--duration',
  '--concurrency',
  '--cold-iterations',
  '--memory-cold',
  '--memory-hot',
  '--json',
  '--baseline',
  '--max-regression'
]);

function printHelp() {
  console.log(`
Mihomo-Toolkit 基准与负载压测

用法:
  node --expose-gc scripts/benchmark.js [选项]

选项:
  --nodes <n>             合成语料节点数，默认 3000
  --seed <n>              合成语料随机种子，默认 20261111
  --source <file|url>     使用真实订阅样本（忽略 --nodes/--seed）
  --duration <秒>         各负载阶段测量时长，默认 5
  --concurrency <n>       闭环并发数，默认 CPU 核数 × 2（上限 64）
  --cold-iterations <n>   冷启动（清缓存）测量轮数，默认 20
  --memory-cold <n>       内存阶段冷构建轮数，默认 8
  --memory-hot <n>        内存阶段热构建轮数，默认 600
  --json <path>           导出机器可读结果
  --baseline <path>       与基线结果对比并执行回归门禁
  --max-regression <百分比> 允许的最大性能回退，默认 20
  --no-http               跳过 HTTP 服务端压测
  -h, --help              显示本帮助

说明:
  1. 阶段顺序：语料 → Parser → 冷启动 → 热延迟 → 热并发 → 冷启动风暴 → SWR → HTTP → 内存。
  2. 冷启动阶段每轮都会清空 Profile 缓存，对应真实的首次请求/定时刷新成本。
  3. 冷启动风暴阶段同时发起 N 个同键请求，用放大系数验证 Single-Flight 是否把并发合并为单次构建。
  4. SWR 阶段用 cacheTtl=0 让缓存立即陈旧，观察后台重建对前台尾延迟的影响。
  5. 热缓存与 HTTP 阶段为闭环并发：并发数固定，测量真实吞吐与含排队的延迟；
     HTTP 负载由独立子进程发起，避免与服务端争抢同一事件循环。
  6. 内存阶段依赖 --expose-gc 触发确定性 GC；未开启时会给出提示且数值含 GC 噪声。
  7. 未提供 --baseline 时只输出测量结果，不做任何「通过/失败」判定。
`);
}

function toNumber(raw, flag) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`参数 ${flag} 取值非法：${raw}`);
  }
  return value;
}

/** 允许为 0 的数值参数（如 --max-regression 0 表示零容忍回退） */
function toNonNegativeNumber(raw, flag) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`参数 ${flag} 取值非法：${raw}`);
  }
  return value;
}

function requireNonEmpty(raw, flag) {
  if (!raw || !raw.trim()) {
    throw new Error(`参数 ${flag} 取值不能为空`);
  }
  return raw;
}

function toInt(raw, flag) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`参数 ${flag} 取值非法：${raw}`);
  }
  return value;
}

function applyOption(opts, flag, raw) {
  switch (flag) {
    case '--nodes': opts.nodes = toInt(raw, flag); break;
    case '--seed': opts.seed = toInt(raw, flag); break;
    case '--source': opts.source = requireNonEmpty(raw, flag); break;
    case '--duration': opts.durationMs = Math.round(toNumber(raw, flag) * 1000); break;
    case '--concurrency': opts.concurrency = toInt(raw, flag); break;
    case '--cold-iterations': opts.coldIterations = toInt(raw, flag); break;
    case '--memory-cold': opts.memoryColdIterations = toInt(raw, flag); break;
    case '--memory-hot': opts.memoryHotIterations = toInt(raw, flag); break;
    case '--json': opts.json = requireNonEmpty(raw, flag); break;
    case '--baseline': opts.baseline = requireNonEmpty(raw, flag); break;
    case '--max-regression': opts.maxRegressionPct = toNonNegativeNumber(raw, flag); break;
    default: throw new Error(`未知参数：${flag}`);
  }
}

function parseArgs(argv) {
  const opts = {
    nodes: 3000,
    seed: 20261111,
    source: '',
    durationMs: 5000,
    concurrency: Math.min(64, Math.max(8, os.cpus().length * 2)),
    coldIterations: 20,
    memoryColdIterations: 8,
    memoryHotIterations: 600,
    json: '',
    baseline: '',
    maxRegressionPct: 20,
    http: true,
    help: false
  };

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    const eqIndex = token.indexOf('=');
    const flag = eqIndex >= 0 ? token.slice(0, eqIndex) : token;
    let value = eqIndex >= 0 ? token.slice(eqIndex + 1) : null;

    if (flag === '-h' || flag === '--help') {
      opts.help = true;
      i += 1;
      continue;
    }
    if (flag === '--no-http') {
      opts.http = false;
      i += 1;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) {
      throw new Error(`未知参数：${flag}（使用 --help 查看用法）`);
    }
    if (value === null) {
      value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`参数 ${flag} 缺少取值`);
      }
      i += 1;
    }
    applyOption(opts, flag, value);
    i += 1;
  }

  return opts;
}

// ─── 确定性语料生成 ──────────────────────────────────────────────────────────

/** mulberry32：固定种子的轻量 PRNG，保证同种子下语料逐字节一致 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return function rand() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

function pickWeighted(rand, table) {
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = rand() * total;
  for (const [value, weight] of table) {
    cursor -= weight;
    if (cursor < 0) return value;
  }
  return table[table.length - 1][0];
}

function randomHex(rand, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(rand() * 16).toString(16);
  }
  return out;
}

function randomUuid(rand) {
  const hex = randomHex(rand, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join('-');
}

function buildNodeUri(kind, ctx) {
  const { rand, ordinal, region, provider, server, port } = ctx;
  const nameText = `${region.emoji} ${region.name} ${provider} ${String(ordinal).padStart(3, '0')}`;
  const name = encodeURIComponent(nameText);
  const sni = `www.${provider.toLowerCase()}-cdn.example`;
  const fingerprint = pick(rand, FINGERPRINTS);

  switch (kind) {
    case 'vmess': {
      const payload = {
        v: '2',
        ps: nameText,
        add: server,
        port: String(port),
        id: randomUuid(rand),
        aid: '0',
        scy: 'auto',
        net: pick(rand, ['tcp', 'ws', 'grpc']),
        type: 'none',
        host: sni,
        path: '/ray',
        tls: 'tls',
        sni,
        fp: fingerprint
      };
      return `vmess://${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`;
    }
    case 'vless': {
      const params = new URLSearchParams({
        encryption: 'none',
        security: 'reality',
        pbk: randomHex(rand, 43),
        sid: randomHex(rand, 8),
        sni,
        fp: fingerprint,
        type: 'grpc',
        serviceName: 'bench-grpc'
      });
      return `vless://${randomUuid(rand)}@${server}:${port}?${params.toString()}#${name}`;
    }
    case 'trojan': {
      const params = new URLSearchParams({
        sni,
        fp: fingerprint,
        type: 'ws',
        path: '/trojan',
        host: sni
      });
      return `trojan://${randomHex(rand, 12)}@${server}:${port}?${params.toString()}#${name}`;
    }
    case 'ss': {
      const cipher = pick(rand, SS_CIPHERS);
      const credential = Buffer.from(`${cipher}:${randomHex(rand, 10)}`, 'utf8').toString('base64url');
      return `ss://${credential}@${server}:${port}#${name}`;
    }
    case 'hysteria2': {
      const params = new URLSearchParams({
        sni,
        insecure: '1',
        obfs: 'salamander',
        'obfs-password': randomHex(rand, 8)
      });
      return `hy2://${randomHex(rand, 16)}@${server}:${port}?${params.toString()}#${name}`;
    }
    case 'tuic': {
      const params = new URLSearchParams({
        sni,
        alpn: 'h3',
        congestion_control: 'bbr',
        udp_relay_mode: 'native'
      });
      return `tuic://${randomUuid(rand)}:${randomHex(rand, 10)}@${server}:${port}?${params.toString()}#${name}`;
    }
    case 'socks5':
      return `socks5://bench:${randomHex(rand, 8)}@${server}:${port}#${name}`;
    default:
      return `http://bench:${randomHex(rand, 8)}@${server}:${port}#${name}`;
  }
}

/**
 * 构造脏数据行：覆盖未知协议、重复行、非法端口、缺失主机、纯垃圾文本五类，
 * 用于检验清洗与去重链路的真实开销。
 */
function buildPollutedLine(rand, index, lastUri) {
  switch (index % 5) {
    case 0: return 'this_is_not_a_node_link';
    case 1: return `ssr://${Buffer.from('benchmark-unsupported-scheme').toString('base64')}`;
    case 2: return lastUri;
    case 3: return `vless://${randomUuid(rand)}@too-long-port.bench.example:99999#invalid-port`;
    default: return 'trojan://broken-secret@#missing-host';
  }
}

function generateCorpus(nodeCount, seed) {
  const rand = mulberry32(seed);
  const lines = [];
  let pollutedLines = 0;
  let lastUri = '';

  for (let i = 0; i < nodeCount; i += 1) {
    const region = pick(rand, REGIONS);
    const provider = pick(rand, PROVIDERS);
    const server = `${region.code}${Math.floor(rand() * 300) + 1}.${provider.toLowerCase()}.bench.example`;
    const port = pick(rand, PORTS);
    const kind = pickWeighted(rand, PROTOCOL_MIX);

    lastUri = buildNodeUri(kind, { rand, ordinal: i + 1, region, provider, server, port });
    lines.push(lastUri);

    // 每 47 个节点插入一条脏数据，污染比例约 2%
    if ((i + 1) % 47 === 0) {
      lines.push(buildPollutedLine(rand, i, lastUri));
      pollutedLines += 1;
    }
  }

  return { content: lines.join('\n'), totalLines: lines.length, pollutedLines };
}

// ─── 统计工具 ────────────────────────────────────────────────────────────────

function summarize(samples) {
  const count = samples.length;
  if (count === 0) {
    return {
      count: 0, meanMs: 0, stddevMs: 0, cvPct: 0,
      minMs: 0, p50Ms: 0, p90Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0
    };
  }

  // 排序副本：不修改调用方数组
  const sorted = [...samples].sort((a, b) => a - b);
  const meanMs = sorted.reduce((sum, v) => sum + v, 0) / count;
  const variance = sorted.reduce((sum, v) => sum + (v - meanMs) ** 2, 0) / count;
  const stddevMs = Math.sqrt(variance);
  const percentile = (p) => sorted[Math.min(count - 1, Math.max(0, Math.ceil(p * count) - 1))];

  return {
    count,
    meanMs,
    stddevMs,
    cvPct: meanMs > 0 ? (stddevMs / meanMs) * 100 : 0,
    minMs: sorted[0],
    p50Ms: percentile(0.5),
    p90Ms: percentile(0.9),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted[count - 1]
  };
}

function linearSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - meanX;
    numerator += dx * (values[i] - meanY);
    denominator += dx * dx;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function formatMs(value) {
  if (value >= 100) return value.toFixed(1);
  if (value >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

function formatMsStat(stats) {
  return `均值 ${formatMs(stats.meanMs)} ms · p50 ${formatMs(stats.p50Ms)} ms · p90 ${formatMs(stats.p90Ms)} ms · `
    + `p95 ${formatMs(stats.p95Ms)} ms · p99 ${formatMs(stats.p99Ms)} ms · max ${formatMs(stats.maxMs)} ms`;
}

function formatBytes(bytes) {
  const abs = Math.abs(bytes);
  if (abs >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (abs >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes.toFixed(0)} B`;
}

function formatBytesSigned(bytes) {
  return `${bytes >= 0 ? '+' : ''}${formatBytes(bytes)}`;
}

// ─── 负载执行器 ──────────────────────────────────────────────────────────────

/** 闭环并发：固定并发数持续打满测量时长，吞吐 = 完成数 / 实际墙钟时长 */
async function runClosedLoop({ durationMs, concurrency, task }) {
  const samples = [];
  let errors = 0;
  const startedAt = performance.now();
  const deadline = startedAt + durationMs;

  const worker = async () => {
    while (performance.now() < deadline) {
      const t0 = performance.now();
      try {
        await task();
        samples.push(performance.now() - t0);
      } catch {
        errors += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { samples, errors, elapsedMs: performance.now() - startedAt };
}

/** 同步微基准：单线程顺序循环，避免并发掩盖单次调用的真实成本 */
function runSyncLoop(durationMs, task) {
  const samples = [];
  const startedAt = performance.now();
  while (performance.now() - startedAt < durationMs) {
    const t0 = performance.now();
    task();
    samples.push(performance.now() - t0);
  }
  return { samples, elapsedMs: performance.now() - startedAt };
}

// ─── HTTP 工具 ───────────────────────────────────────────────────────────────

function fetchText(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        resolve(fetchText(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve(raw));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('请求超时')));
  });
}

function httpGet({ port, urlPath, agent }) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, agent }, (res) => {
      let bytes = 0;
      res.on('data', (chunk) => { bytes += chunk.length; });
      res.on('end', () => resolve({
        status: res.statusCode,
        cache: res.headers['x-cache'] || 'NONE',
        bytes
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('请求超时')));
  });
}

// ─── 阶段实现 ────────────────────────────────────────────────────────────────

async function prepareCorpus(opts, tmpDir) {
  const corpusPath = path.join(tmpDir, 'corpus.txt');
  let content = '';
  let sourceLabel = '';
  let pollutedLines = 0;

  if (opts.source) {
    if (/^https?:\/\//i.test(opts.source)) {
      console.log(`   拉取远端样本：${opts.source}`);
      content = await fetchText(opts.source);
      sourceLabel = 'remote-url';
    } else {
      const filePath = path.resolve(process.cwd(), opts.source);
      if (!fs.existsSync(filePath)) {
        throw new Error(`--source 文件不存在：${filePath}`);
      }
      content = fs.readFileSync(filePath, 'utf8');
      sourceLabel = 'local-file';
    }
    fs.writeFileSync(corpusPath, content, 'utf8');
  } else {
    const generated = generateCorpus(opts.nodes, opts.seed);
    content = generated.content;
    pollutedLines = generated.pollutedLines;
    sourceLabel = `synthetic(seed=${opts.seed})`;
    fs.writeFileSync(corpusPath, content, 'utf8');
  }

  if (!content.trim()) {
    throw new Error('压测语料为空，无法执行基准');
  }

  const totalLines = content.split(/\r?\n/).filter(line => line.trim()).length;
  const parsed = parseContent(content);
  const parsedNodes = Array.isArray(parsed.proxies) ? parsed.proxies.length : 0;
  const bytes = Buffer.byteLength(content);
  // 生产默认单订阅上限为 3000 节点，大规模压测需要显式放宽，避免语料被配额直接拒绝
  const securityLimit = Math.max(10000, parsedNodes * 2);

  return { corpusPath, content, sourceLabel, pollutedLines, totalLines, parsedNodes, bytes, securityLimit };
}

async function runParserStage(corpus, durationMs) {
  for (let i = 0; i < PARSER_WARMUP_ROUNDS; i += 1) {
    parseContent(corpus.content);
  }

  const run = runSyncLoop(durationMs, () => parseContent(corpus.content));
  const stats = summarize(run.samples);
  const nodesPerIteration = corpus.parsedNodes;
  const throughputPerSec = (stats.count * nodesPerIteration) / (run.elapsedMs / 1000);

  console.log(`[Parser] 协议解析（同步循环 · ${(run.elapsedMs / 1000).toFixed(2)}s）`);
  console.log(`   样本 ${stats.count} 次 · 单次 ${nodesPerIteration} 节点 · 吞吐 ${throughputPerSec.toFixed(0)} 节点/秒`);
  console.log(`   ${formatMsStat(stats)}`);
  console.log(`   CV ${stats.cvPct.toFixed(1)}% · 标准差 ${formatMs(stats.stddevMs)} ms`);

  return {
    iterations: stats.count,
    durationMs: run.elapsedMs,
    nodesPerIteration,
    throughputPerSec,
    ...stats
  };
}

async function runColdStage(benchConfig, opts) {
  console.log(`[Cold] 冷启动全链路编译（清缓存 · ${COLD_WARMUP_ROUNDS} 轮预热后测 ${opts.coldIterations} 轮）`);

  for (let i = 0; i < COLD_WARMUP_ROUNDS; i += 1) {
    profileCache.clear();
    await buildProfile(benchConfig, ENGINE_OPTIONS);
  }

  const samples = [];
  let yamlBytes = 0;
  let proxies = 0;

  for (let i = 0; i < opts.coldIterations; i += 1) {
    profileCache.clear();
    const t0 = performance.now();
    const result = await buildProfile(benchConfig, ENGINE_OPTIONS);
    samples.push(performance.now() - t0);
    yamlBytes = result && result.yamlStr ? Buffer.byteLength(result.yamlStr) : 0;
    proxies = result && Array.isArray(result.proxies) ? result.proxies.length : 0;
  }

  const stats = summarize(samples);
  const throughputPerSec = stats.count / (stats.meanMs / 1000);

  console.log(`   产物 ${formatBytes(yamlBytes)} · 保留节点 ${proxies} 个`);
  console.log(`   ${formatMsStat(stats)}`);
  console.log(`   CV ${stats.cvPct.toFixed(1)}% · 单份编译 ${(stats.meanMs / 1000).toFixed(2)}s · 吞吐 ${throughputPerSec.toFixed(2)} 份/秒`);

  return { iterations: stats.count, yamlBytes, proxies, throughputPerSec, ...stats };
}

async function runHotLatencyStage(benchConfig, opts) {
  // 前置：确保缓存已填充（冷启动阶段最后一轮已写入）
  await buildProfile(benchConfig, ENGINE_OPTIONS);

  const run = await runClosedLoop({
    durationMs: opts.durationMs,
    concurrency: 1,
    task: () => buildProfile(benchConfig, ENGINE_OPTIONS)
  });
  const stats = summarize(run.samples);

  console.log(`[Hot-Latency] 热缓存单并发延迟（${(run.elapsedMs / 1000).toFixed(2)}s）`);
  console.log(`   样本 ${stats.count} · 错误 ${run.errors}`);
  console.log(`   ${formatMsStat(stats)}`);
  console.log(`   CV ${stats.cvPct.toFixed(1)}% · 等价 QPS ${(stats.count / (run.elapsedMs / 1000)).toFixed(0)}`);

  return {
    iterations: stats.count,
    errors: run.errors,
    durationMs: run.elapsedMs,
    qps: stats.count / (run.elapsedMs / 1000),
    ...stats
  };
}

async function runHotThroughputStage(benchConfig, opts) {
  const run = await runClosedLoop({
    durationMs: opts.durationMs,
    concurrency: opts.concurrency,
    task: () => buildProfile(benchConfig, ENGINE_OPTIONS)
  });
  const stats = summarize(run.samples);
  const qps = stats.count / (run.elapsedMs / 1000);

  console.log(`[Hot-Load] 热缓存并发吞吐（并发 ${opts.concurrency} · ${(run.elapsedMs / 1000).toFixed(2)}s）`);
  console.log(`   QPS ${qps.toFixed(0)} · 完成 ${stats.count} · 错误 ${run.errors}`);
  console.log(`   ${formatMsStat(stats)}`);
  console.log(`   CV ${stats.cvPct.toFixed(1)}%`);

  return {
    concurrency: opts.concurrency,
    qps,
    errors: run.errors,
    durationMs: run.elapsedMs,
    ...stats
  };
}

/**
 * HTTP 压测客户端子进程入口：与服务端隔离到不同进程，
 * 避免客户端 socket 处理与响应序列化争抢同一事件循环导致 QPS 被低估。
 */
async function runHttpClientWorker(payload) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: payload.concurrency });
  const tally = new Map();
  let totalBytes = 0;

  try {
    const run = await runClosedLoop({
      durationMs: payload.durationMs,
      concurrency: payload.concurrency,
      task: async () => {
        const res = await httpGet({ port: payload.port, urlPath: payload.urlPath, agent });
        totalBytes += res.bytes;
        const key = `${res.status}/${res.cache}`;
        tally.set(key, (tally.get(key) || 0) + 1);
        if (res.status !== 200) {
          throw new Error(`HTTP ${res.status}`);
        }
      }
    });

    if (process.send) {
      process.send({
        stats: summarize(run.samples),
        errors: run.errors,
        elapsedMs: run.elapsedMs,
        totalBytes,
        tally: Array.from(tally.entries())
      });
    }
  } finally {
    agent.destroy();
  }
}

function spawnHttpClient(payload) {
  const { fork } = require('child_process');
  return new Promise((resolve, reject) => {
    const child = fork(__filename, ['--http-client', JSON.stringify(payload)], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });
    let settled = false;
    child.on('message', (message) => {
      settled = true;
      resolve(message);
    });
    child.on('error', (err) => {
      settled = true;
      reject(err);
    });
    child.on('exit', (code) => {
      if (!settled) {
        reject(new Error(`HTTP 压测客户端异常退出（code=${code}）`));
      }
    });
  });
}

/**
 * 冷启动并发风暴：清空缓存后同时发起 N 个同键请求。
 * Single-Flight 生效时墙钟应接近一次冷构建，而不是 N 倍；放大系数即该比值。
 */
async function runStampedeStage(benchConfig, opts, coldMeanMs) {
  const concurrency = opts.concurrency;
  const fanOut = () => Array.from({ length: concurrency }, () => buildProfile(benchConfig, ENGINE_OPTIONS));
  const rounds = 3;
  const walls = [];

  // 预热并发路径（JIT + 单飞表分支），结果丢弃
  profileCache.clear();
  await Promise.allSettled(fanOut());

  let fulfilledCount = 0;
  let rejectedCount = 0;
  let distinctResults = 0;

  for (let i = 0; i < rounds; i += 1) {
    profileCache.clear();
    const t0 = performance.now();
    const settled = await Promise.allSettled(fanOut());
    walls.push(performance.now() - t0);

    const fulfilled = settled.filter(item => item.status === 'fulfilled');
    fulfilledCount = fulfilled.length;
    rejectedCount = settled.length - fulfilled.length;
    // 所有复用方拿到的是同一份缓存结果，引用集合应为 1
    distinctResults = new Set(fulfilled.map(item => item.value && item.value.yamlStr)).size;
  }

  const sortedWalls = [...walls].sort((a, b) => a - b);
  const wallMs = sortedWalls[Math.floor(rounds / 2)];
  const amplification = coldMeanMs > 0 ? wallMs / coldMeanMs : 0;
  const serialWallMs = coldMeanMs * concurrency;

  console.log(`[Stampede] 冷启动并发风暴（清缓存后 ${concurrency} 个同键请求同时发起 · ${rounds} 轮取中位数）`);
  console.log(`   墙钟 ${formatMs(wallMs)} ms · 单次冷构建均值 ${formatMs(coldMeanMs)} ms · 放大系数 ${amplification.toFixed(2)}×`);
  console.log(`   若未合并预计 ${formatMs(serialWallMs)} ms → 实际 ${formatMs(wallMs)} ms`);
  console.log(`   成功 ${fulfilledCount} · 失败 ${rejectedCount} · 结果引用一致 ${distinctResults === 1 ? '是' : `否（${distinctResults} 种）`}`);
  console.log('   放大系数接近 1 表示 Single-Flight 已把并发冷启动合并为单次构建');

  return {
    concurrency,
    rounds,
    walls,
    wallMs,
    coldMeanMs,
    serialWallMs,
    amplification,
    fulfilled: fulfilledCount,
    rejected: rejectedCount,
    distinctResults
  };
}

/**
 * SWR Stale 窗口：cacheTtl = 0 让缓存发布后立即陈旧，
 * 前台持续拿到旧快照，后台按单飞节奏不断重建，用于观察 CPU 重活对前台尾延迟的侵蚀。
 */
async function runSwrStage(benchConfig, opts, coldMeanMs, hitP95Ms) {
  const swrConfig = {
    ...benchConfig,
    cacheTtl: 0,
    cacheStaleMaxAge: 60
  };

  profileCache.clear();
  // 首次构建走 Miss 并发布缓存，之后每个请求都会命中 stale
  await buildProfile(swrConfig, ENGINE_OPTIONS);

  const statusTally = new Map();
  const swrOptions = {
    ...ENGINE_OPTIONS,
    onCacheStatus: (status) => {
      statusTally.set(status, (statusTally.get(status) || 0) + 1);
    }
  };

  const run = await runClosedLoop({
    durationMs: opts.durationMs,
    concurrency: opts.concurrency,
    task: () => buildProfile(swrConfig, swrOptions)
  });
  const stats = summarize(run.samples);
  const qps = stats.count / (run.elapsedMs / 1000);
  const statuses = Object.fromEntries([...statusTally.entries()].sort());

  console.log(`[SWR] Stale 窗口并发（cacheTtl=0 · 并发 ${opts.concurrency} · ${(run.elapsedMs / 1000).toFixed(2)}s）`);
  console.log(`   QPS ${qps.toFixed(0)} · 完成 ${stats.count} · 错误 ${run.errors}`);
  console.log(`   ${formatMsStat(stats)}`);
  console.log(`   缓存状态 ${Object.entries(statuses).map(([k, v]) => `${k}=${v}`).join(' · ') || '无'}`);
  if (typeof hitP95Ms === 'number' && hitP95Ms > 0) {
    console.log(`   对照 HIT 并发 p95 ${formatMs(hitP95Ms)} ms → Stale 窗口 p95 ${formatMs(stats.p95Ms)} ms`
      + `（${(stats.p95Ms / hitP95Ms).toFixed(1)}×）`);
  }
  console.log('   cacheTtl=0 属极端设置：后台重建几乎不间断；常规 TTL 下该尾延迟只在刷新窗口出现');

  // 阶段结束后至多还剩一次后台重建，等它收敛再进入后续阶段，避免污染下一段测量
  await new Promise((resolve) => {
    setTimeout(resolve, Math.round(Math.max(coldMeanMs * 1.2, 200)));
  });

  return {
    concurrency: opts.concurrency,
    qps,
    errors: run.errors,
    durationMs: run.elapsedMs,
    statuses,
    hitP95Ms: typeof hitP95Ms === 'number' ? hitP95Ms : null,
    ...stats
  };
}

async function runHttpStage(corpus, opts, tmpDir) {
  const { startServer } = require('../src/targets/server');

  const configPath = path.join(tmpDir, 'server-config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    logLevel: 'silent',
    enableWarmup: false,
    autoRefreshInterval: 0,
    enableCache: true,
    // 热缓存读路径本身很轻，放开并发上限才能测出服务端真实承载能力
    maxConcurrentBuilds: 1024,
    security: {
      perSubscriptionMaxNodes: corpus.securityLimit,
      maxTotalNodes: corpus.securityLimit
    },
    outputMode: 'config',
    subscriptions: [{ url: corpus.corpusPath, tag: 'Bench' }]
  }), 'utf8');

  // 先清缓存，保证 HTTP 阶段的首次请求完成一次真实构建，后续请求全部命中缓存
  profileCache.clear();

  const server = startServer({
    port: 0,
    host: '127.0.0.1',
    configPath,
    silent: true,
    enableWarmup: false,
    registerSignalHandlers: false
  });

  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }

  const port = server.address().port;

  try {
    // 预热：首次请求触发构建，确保后续测量的是热缓存交付路径
    const warm = await httpGet({ port, urlPath: '/sub' });
    if (warm.status !== 200) {
      throw new Error(`HTTP 预热请求失败：状态码 ${warm.status}`);
    }

    const result = await spawnHttpClient({
      port,
      urlPath: '/sub',
      durationMs: opts.durationMs,
      concurrency: opts.concurrency
    });

    const stats = result.stats;
    const qps = stats.count / (result.elapsedMs / 1000);
    const statuses = Object.fromEntries([...result.tally].sort());

    console.log(`[HTTP] 服务端交付压测（并发 ${opts.concurrency} · ${(result.elapsedMs / 1000).toFixed(2)}s · GET /sub）`);
    console.log(`   QPS ${qps.toFixed(0)} · 完成 ${stats.count} · 错误 ${result.errors} · 传输 ${formatBytes(result.totalBytes)}`);
    console.log(`   ${formatMsStat(stats)}`);
    console.log(`   状态分布 ${Object.entries(statuses).map(([k, v]) => `${k}=${v}`).join(' · ') || '无'}`);
    console.log('   客户端运行在独立子进程，不与服务端争抢事件循环');

    return {
      concurrency: opts.concurrency,
      qps,
      errors: result.errors,
      durationMs: result.elapsedMs,
      totalBytes: result.totalBytes,
      statuses,
      ...stats
    };
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve());
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    });
  }
}

async function runMemoryStage(benchConfig, opts) {
  const gcAvailable = typeof global.gc === 'function';
  const sampleEvery = Math.max(1, Math.min(MEMORY_SAMPLE_EVERY, opts.memoryHotIterations));
  const samples = [];

  if (gcAvailable) global.gc();
  const startMem = process.memoryUsage();

  for (let i = 0; i < opts.memoryColdIterations; i += 1) {
    profileCache.clear();
    await buildProfile(benchConfig, ENGINE_OPTIONS);
    if (gcAvailable) global.gc();
    samples.push(process.memoryUsage().heapUsed);
  }

  for (let i = 0; i < opts.memoryHotIterations; i += 1) {
    await buildProfile(benchConfig, ENGINE_OPTIONS);
    if ((i + 1) % sampleEvery === 0) {
      if (gcAvailable) global.gc();
      samples.push(process.memoryUsage().heapUsed);
    }
  }

  if (gcAvailable) global.gc();
  const endMem = process.memoryUsage();

  const slope = linearSlope(samples);
  const heapDelta = endMem.heapUsed - startMem.heapUsed;
  const rssDelta = endMem.rss - startMem.rss;

  console.log(`[Memory] 内存稳定性（${opts.memoryColdIterations} 轮冷构建 + ${opts.memoryHotIterations} 轮热构建 · 采样 ${samples.length} 次）`);
  console.log(`   heapUsed ${formatBytes(startMem.heapUsed)} → ${formatBytes(endMem.heapUsed)} (${formatBytesSigned(heapDelta)})`);
  console.log(`   RSS ${formatBytes(startMem.rss)} → ${formatBytes(endMem.rss)} (${formatBytesSigned(rssDelta)})`);
  console.log(`   堆增长斜率 ${formatBytesSigned(slope)}/次采样`);
  console.log(gcAvailable
    ? '   GC 已启用（--expose-gc），采样的基线更稳定'
    : '   未启用 --expose-gc：数值包含 GC 时机抖动，建议用 npm run benchmark 执行');

  return {
    iterations: opts.memoryColdIterations + opts.memoryHotIterations,
    samples: samples.length,
    gcAvailable,
    heapStartBytes: startMem.heapUsed,
    heapEndBytes: endMem.heapUsed,
    heapDeltaBytes: heapDelta,
    rssStartBytes: startMem.rss,
    rssEndBytes: endMem.rss,
    rssDeltaBytes: rssDelta,
    heapSlopeBytesPerSample: slope
  };
}

// ─── 基线回归门禁 ────────────────────────────────────────────────────────────

const GATE_METRICS = [
  { path: 'parser.throughputPerSec', label: 'Parser 吞吐(节点/秒)', higherIsBetter: true, digits: 0 },
  { path: 'cold.meanMs', label: '冷启动均值(ms)', higherIsBetter: false, digits: 2 },
  // 热缓存单次命中在微秒级，p95 完全受计时器精度支配，不适合作为门禁指标；用并发 QPS 衡量更稳定
  { path: 'hotThroughput.qps', label: '热缓存并发 QPS', higherIsBetter: true, digits: 0 },
  { path: 'http.p95Ms', label: 'HTTP p95(ms)', higherIsBetter: false, digits: 3 },
  { path: 'http.qps', label: 'HTTP QPS', higherIsBetter: true, digits: 0 }
];

function readPath(target, dottedPath) {
  return dottedPath.split('.').reduce((node, key) => (node == null ? undefined : node[key]), target);
}

function displayWidth(text) {
  let width = 0;
  for (const char of text) {
    width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char) ? 2 : 1;
  }
  return width;
}

function padDisplay(text, width) {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

function compareWithBaseline(current, baseline, maxRegressionPct) {
  const rows = [];
  for (const metric of GATE_METRICS) {
    const currentValue = readPath(current.stages, metric.path);
    const baselineValue = readPath(baseline.stages, metric.path);
    if (typeof currentValue !== 'number' || typeof baselineValue !== 'number' || baselineValue === 0) {
      continue;
    }
    const deltaPct = ((currentValue - baselineValue) / Math.abs(baselineValue)) * 100;
    const regressionPct = metric.higherIsBetter ? -deltaPct : deltaPct;
    rows.push({
      label: metric.label,
      digits: metric.digits,
      baselineValue,
      currentValue,
      deltaPct,
      regressionPct,
      failed: regressionPct > maxRegressionPct
    });
  }
  return rows;
}

function printBaselineComparison(rows, maxRegressionPct) {
  console.log('\n[Baseline] 基线回归对比');
  if (rows.length === 0) {
    console.log('   基线与本次结果没有可比指标，已跳过对比');
    return;
  }

  const header = [padDisplay('指标', 22), padDisplay('基线', 14), padDisplay('本次', 14), padDisplay('变化', 12), '结论'];
  console.log(`   ${header.join('')}`);
  console.log(`   ${'-'.repeat(76)}`);

  for (const row of rows) {
    const sign = row.deltaPct >= 0 ? '+' : '';
    const line = [
      padDisplay(row.label, 22),
      padDisplay(row.baselineValue.toFixed(row.digits), 14),
      padDisplay(row.currentValue.toFixed(row.digits), 14),
      padDisplay(`${sign}${row.deltaPct.toFixed(1)}%`, 12),
      row.failed ? `超阈值（回退 ${row.regressionPct.toFixed(1)}%）` : '正常'
    ];
    console.log(`   ${line.join('')}`);
  }
  console.log(`   允许的最大回退：${maxRegressionPct}%`);
}

// ─── 结果输出 ────────────────────────────────────────────────────────────────

function printHeader(opts, gcAvailable) {
  const cpu = os.cpus()[0] ? os.cpus()[0].model.trim() : 'unknown';
  console.log('===============================================================');
  console.log(` Mihomo-Toolkit 基准与负载压测 (v${pkg.version})`);
  console.log('===============================================================');
  console.log(`环境   Node ${process.version} · ${process.platform}/${process.arch} · ${cpu} (${os.cpus().length} 核)`);
  console.log(`       GC ${gcAvailable ? '已启用' : '未启用（建议 npm run benchmark）'}`);
  console.log(`参数   语料 ${opts.source ? `source=${opts.source}` : `${opts.nodes} 节点 (seed=${opts.seed})`}`
    + ` · 阶段时长 ${(opts.durationMs / 1000).toFixed(1)}s · 并发 ${opts.concurrency}`
    + ` · 冷启动 ${opts.coldIterations} 轮`);
}

async function main() {
  // 隐藏入口：HTTP 压测客户端由父进程 fork 本文件启动，避免与服务端共享事件循环
  const clientFlagIndex = process.argv.indexOf('--http-client');
  if (clientFlagIndex >= 0) {
    await runHttpClientWorker(JSON.parse(process.argv[clientFlagIndex + 1]));
    return;
  }

  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const gcAvailable = typeof global.gc === 'function';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-bench-'));

  try {
    printHeader(opts, gcAvailable);

    console.log('\n[Corpus] 压测语料准备');
    const corpus = await prepareCorpus(opts, tmpDir);
    const validRatio = corpus.totalLines > 0 ? (corpus.parsedNodes / corpus.totalLines) * 100 : 0;
    console.log(`   来源 ${corpus.sourceLabel} · 体积 ${formatBytes(corpus.bytes)} · 有效行 ${corpus.totalLines}`);
    if (corpus.pollutedLines > 0) {
      console.log(`   故意注入脏数据 ${corpus.pollutedLines} 行（未知协议 / 重复行 / 非法端口 / 缺失主机 / 垃圾文本）`);
    }
    console.log(`   解析成功 ${corpus.parsedNodes} 个节点（占行数 ${validRatio.toFixed(1)}%）`);
    console.log(`   安全配额临时放宽至 ${corpus.securityLimit} 节点（生产默认单订阅 3000），仅用于压测`);

    const benchConfig = {
      subscriptions: [{ url: corpus.corpusPath, tag: 'Bench' }],
      security: {
        perSubscriptionMaxNodes: corpus.securityLimit,
        maxTotalNodes: corpus.securityLimit
      },
      outputMode: 'config'
    };

    const stages = {};
    stages.parser = await runParserStage(corpus, opts.durationMs);
    stages.cold = await runColdStage(benchConfig, opts);
    stages.hotLatency = await runHotLatencyStage(benchConfig, opts);
    stages.hotThroughput = await runHotThroughputStage(benchConfig, opts);
    stages.stampede = await runStampedeStage(benchConfig, opts, stages.cold.meanMs);
    stages.swr = await runSwrStage(benchConfig, opts, stages.cold.meanMs, stages.hotThroughput.p95Ms);

    if (opts.http) {
      stages.http = await runHttpStage(corpus, opts, tmpDir);
    } else {
      console.log('[HTTP] 已按 --no-http 跳过服务端压测');
    }

    stages.memory = await runMemoryStage(benchConfig, opts);

    const report = {
      schemaVersion: 1,
      tool: 'mihomo-toolkit-benchmark',
      version: pkg.version,
      timestamp: new Date().toISOString(),
      env: {
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        cpu: os.cpus()[0] ? os.cpus()[0].model.trim() : 'unknown',
        cores: os.cpus().length,
        gcExposed: gcAvailable
      },
      params: {
        nodes: opts.source ? null : opts.nodes,
        seed: opts.source ? null : opts.seed,
        source: opts.source || null,
        durationMs: opts.durationMs,
        concurrency: opts.concurrency,
        coldIterations: opts.coldIterations,
        memoryColdIterations: opts.memoryColdIterations,
        memoryHotIterations: opts.memoryHotIterations
      },
      corpus: {
        source: corpus.sourceLabel,
        bytes: corpus.bytes,
        lines: corpus.totalLines,
        parsedNodes: corpus.parsedNodes,
        validRatio
      },
      stages
    };

    console.log('\n===============================================================');
    if (opts.json) {
      const outPath = path.resolve(process.cwd(), opts.json);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      console.log(` 结果已写入 ${path.relative(process.cwd(), outPath) || outPath}`);
    }

    if (opts.baseline) {
      const baselinePath = path.resolve(process.cwd(), opts.baseline);
      if (!fs.existsSync(baselinePath)) {
        throw new Error(`--baseline 文件不存在：${baselinePath}`);
      }
      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      if (readPath(baseline, 'corpus.parsedNodes') !== corpus.parsedNodes
        || readPath(baseline, 'params.concurrency') !== opts.concurrency
        || readPath(baseline, 'params.durationMs') !== opts.durationMs) {
        console.log(' 警告：基线与本轮的语料规模/并发/时长不一致，对比结果仅供参考');
      }
      const rows = compareWithBaseline(report, baseline, opts.maxRegressionPct);
      printBaselineComparison(rows, opts.maxRegressionPct);
      const failures = rows.filter(row => row.failed);
      if (failures.length > 0) {
        process.exitCode = 1;
        console.log(` 结果：${failures.length} 项指标回退超过 ${opts.maxRegressionPct}%`);
      } else if (rows.length > 0) {
        console.log(` 结果：${rows.length} 项指标均在阈值内`);
      }
    } else {
      console.log(' 未提供 --baseline，跳过回归门禁；可用 --json <path> 导出本轮结果作为基线');
    }
    console.log('===============================================================');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error(`压测失败：${err && err.message ? err.message : err}`);
  process.exit(1);
});
