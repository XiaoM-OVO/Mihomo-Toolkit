/**
 * -----------------------------------------------------------------------------
 * 🧪 配置面一致性 (Config Surface Consistency)
 * -----------------------------------------------------------------------------
 * 本套件把 ARCHITECTURE.md「配置面设计约束」中的第 1/3 条从评审约定升级为机器强制：
 *
 *   反隐形    —— src 里读取的每个 `userConfig.X` 都必须在字段注册表里登记
 *                （否则就是「能配、但任何文档都查不到」的幽灵字段）
 *   反空承诺  —— config.example.yaml 与 index.d.ts 里出现的每个配置字段，
 *                都必须能在 src 里找到读取它的代码（否则就是「配了完全没用」）
 *   反漂移    —— 注册表里的每个字段都必须在 index.d.ts 中有类型声明
 *   挂载回归  —— 外挂配置文件的三个历史缺陷（路径基准 / 静默失败 / 缓存键不含内容）
 *
 * 这三条曾经全部失效：7 个隐形字段、20 个空承诺、1 个类型里的假 API 都是这么漏出去的。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { FIELDS, DEFAULTLESS_FIELDS, REMOTE_DENIED_FIELDS } = require('../src/data');
const {
  absolutizeMountPaths,
  readMountFile,
  computeMountDigest,
  resolveMountPath
} = require('../src/config/mounts');
const { expandIncludes } = require('../src/config/include');
const { resolveConfig } = require('../src/config');
const { buildProfileCacheKey } = require('../src/pipeline/engine');
const { hardenRemoteConfig } = require('../src/core/security/remote-config');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** 非配置字段：内部变量、注册表自身、运行期上下文（不是用户可写配置项） */
const NON_CONFIG_IDENTIFIERS = new Set([
  'catalog', 'registries', 'toRegistries', 'logger', 'withClassified',
  'subscriptions', // 在下面作为正式字段单独校验（此处避免与 io 层形参混淆）
  'security'       // 同上
]);

/** 收集 src 下全部 .js（排除字段注册表本身：它「声明」字段，不代表代码读取字段） */
function listSrcFiles(dir = SRC, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSrcFiles(full, acc);
    else if (entry.name.endsWith('.js') &&
             !full.includes(path.join('data', 'field-registry.js'))) acc.push(full);
  }
  return acc;
}

function readSrcCorpus() {
  return listSrcFiles().map(f => fs.readFileSync(f, 'utf8')).join('\n');
}

function tokenPattern(name) {
  return new RegExp('(^|[^A-Za-z0-9_])' + name + '([^A-Za-z0-9_]|$)');
}

test('🔍 反隐形 — src 读取的每个 userConfig 字段都已在注册表登记', () => {
  const declared = new Set(FIELDS.map(f => f.key));
  const ghosts = new Map();
  for (const file of listSrcFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /\b(?:userConfig|cfg)\.([A-Za-z_][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(src))) {
      const key = m[1];
      if (declared.has(key) || NON_CONFIG_IDENTIFIERS.has(key)) continue;
      if (!ghosts.has(key)) ghosts.set(key, new Set());
      ghosts.get(key).add(path.relative(ROOT, file));
    }
  }
  assert.deepStrictEqual(
    [...ghosts.keys()].sort(),
    [],
    `发现隐形字段（代码在读但注册表里查不到）：\n` +
    [...ghosts.entries()].map(([k, v]) => `  ${k}  ← ${[...v].join(', ')}`).join('\n')
  );
});

test('🔍 反空承诺 — config.example.yaml 里的每个键都是已登记字段', () => {
  const yaml = require('yaml');
  const parsed = yaml.parse(fs.readFileSync(path.join(ROOT, 'config.example.yaml'), 'utf8')) || {};
  const declared = new Set(FIELDS.map(f => f.key));
  const unknown = Object.keys(parsed).filter(k => !declared.has(k));
  assert.deepStrictEqual(unknown, [], `示例配置出现未登记字段：${unknown.join(', ')}`);
  assert.ok(Object.keys(parsed).length > 20, '示例配置解析结果异常（键太少）');
});

test('🔍 反空承诺 — index.d.ts 配置接口里的每个字段都是已登记字段', () => {
  const lines = fs.readFileSync(path.join(ROOT, 'index.d.ts'), 'utf8').split(/\r?\n/);
  const declared = new Set(FIELDS.map(f => f.key));
  const offenders = [];
  let current = null;
  for (const line of lines) {
    const open = line.match(/^export interface (PureConfig|ToolkitConfig|UserConfig)\b/);
    if (open) { current = open[1]; continue; }
    if (current && /^}/.test(line)) { current = null; continue; }
    if (!current) continue;
    const prop = line.match(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\??\s*:/);
    if (prop && !declared.has(prop[1])) offenders.push(`${current}.${prop[1]}`);
  }
  assert.deepStrictEqual(
    offenders.sort(),
    [],
    `类型契约承诺了不存在的字段（配了完全没用）：${offenders.join(', ')}`
  );
});

test('🔍 反漂移 — 注册表每个字段都在 index.d.ts 有类型声明', () => {
  const dts = fs.readFileSync(path.join(ROOT, 'index.d.ts'), 'utf8');
  const missing = FIELDS.filter(f => !tokenPattern(f.key).test(dts)).map(f => f.key);
  assert.deepStrictEqual(missing, [], `这些字段没有类型契约：${missing.join(', ')}`);
});

test('🔍 注册表自洽 — 无默认值字段必须是「代码内有兜底」而非「没人用」', () => {
  // 无默认值字段的存在理由必须是「代码里有兜底」：它必须真的被读取
  const corpus = readSrcCorpus();
  const unread = DEFAULTLESS_FIELDS
    .filter(f => !tokenPattern(f.key).test(corpus))
    .map(f => f.key);
  assert.deepStrictEqual(
    unread, [],
    `这些字段既无出厂默认值、又没有任何代码读取，应当删除：${unread.join(', ')}`
  );
});

test('📁 挂载回归 — 相对路径以配置文件所在目录为基准，而不是 cwd', () => {
  const base = path.join(os.tmpdir(), 'mtk-mount-base');
  const resolved = resolveMountPath('./svc.yaml', base);
  assert.equal(resolved, path.join(base, 'svc.yaml'));
  // 已经是绝对路径时保持原样
  const abs = path.join(base, 'abs.yaml');
  assert.equal(resolveMountPath(abs, 'C:\\somewhere\\else'), abs);
  // 空值 / 非字符串不产生路径
  assert.equal(resolveMountPath('', base), null);
  assert.equal(resolveMountPath(undefined, base), null);

  const cfg = absolutizeMountPaths({ servicesConfigFile: './svc.yaml', enableAI: true }, base);
  assert.equal(cfg.servicesConfigFile, path.join(base, 'svc.yaml'));
  assert.equal(cfg.enableAI, true, '绝对化不应损坏其它字段');
  // 无变化时返回原对象（不制造无意义的副本）
  const same = absolutizeMountPaths({ enableAI: true }, base);
  assert.equal(same.enableAI, true);
});

test('📁 挂载回归 — 文件缺失或格式不支持时报错，而不是静默返回空配置', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtk-mount-'));
  const missing = path.join(dir, 'nope.yaml');
  assert.throws(() => readMountFile(missing), /Config mount not found/);

  const weird = path.join(dir, 'svc.txt');
  fs.writeFileSync(weird, 'ai: {}\n');
  assert.throws(() => readMountFile(weird), /Unsupported config mount format/);

  const broken = path.join(dir, 'broken.yaml');
  fs.writeFileSync(broken, 'ai: [unclosed\n');
  assert.throws(() => readMountFile(broken), /Failed to load config mount/);

  // 正常路径仍然可用，且解析结果被展开
  const ok = path.join(dir, 'ok.yaml');
  fs.writeFileSync(ok, 'ai:\n  deepseek:\n    name: DeepSeek\n');
  assert.deepStrictEqual(readMountFile(ok), { ai: { deepseek: { name: 'DeepSeek' } } });

  // resolveConfig 透传同一行为（用户显式引用的文件读不到属于配置错误）
  assert.throws(
    () => resolveConfig({ servicesConfigFile: missing }),
    /Config mount not found/
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('📁 挂载回归 — 改动挂载文件内容会改变构建缓存键', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtk-digest-'));
  const pack = path.join(dir, 'services.yaml');
  fs.writeFileSync(pack, 'ai:\n  deepseek:\n    name: DeepSeek\n');
  const userConfig = { servicesConfigFile: pack, enableAI: true };

  const key1 = buildProfileCacheKey(userConfig, {});
  const digest1 = computeMountDigest(userConfig);
  assert.ok(key1 && digest1, '挂载源存在时应产生键与摘要');

  // 改内容（不改路径）→ 摘要变化 → 缓存键必须随之变化
  fs.writeFileSync(pack, 'ai:\n  deepseek:\n    name: DeepSeek-V3\n');
  const key2 = buildProfileCacheKey(userConfig, {});
  assert.notEqual(computeMountDigest(userConfig), digest1, '内容摘要未跟随文件变化');
  assert.notEqual(key2, key1, '缓存键未跟随挂载文件内容变化（会在 TTL 内返回旧产物）');

  // 无挂载源时摘要为空串，且不影响键的确定性
  assert.equal(computeMountDigest({ enableAI: true }), '');
  assert.equal(
    buildProfileCacheKey({ enableAI: true }, {}),
    buildProfileCacheKey({ enableAI: true }, {})
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('📁 挂载回归 — .js 挂载文件改动后无需重启即可生效', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtk-js-'));
  const pack = path.join(dir, 'services.js');
  fs.writeFileSync(pack, 'module.exports = { ai: { deepseek: { name: "v1" } } };\n');
  const first = readMountFile(pack);
  assert.equal(first.ai.deepseek.name, 'v1');

  fs.writeFileSync(pack, 'module.exports = { ai: { deepseek: { name: "v2" } } };\n');
  const second = readMountFile(pack);
  assert.equal(second.ai.deepseek.name, 'v2', 'require 缓存未清理，长驻服务永远读不到改动');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('🛡️ 配额不可远程放宽 — ?config= 无法通过 security 字段自我提权', () => {
  // 恶意远程配置试图把配额调到天上
  const hardened = hardenRemoteConfig({
    subscriptions: [{ url: 'https://example.com/sub.yaml' }],
    security: { maxTotalNodes: 99999999, maxSubscriptionUrls: 9999 }
  });
  assert.equal(hardened.ok, true);
  assert.equal(hardened.config.security, undefined, 'security 必须被远程剥夺');
  assert.ok(hardened.strippedKeys.includes('security'));

  // 而可信本地来源仍然可以正常收紧/放宽配额
  const local = resolveConfig({ security: { maxTotalNodes: 123 } });
  assert.equal(local.security.maxTotalNodes, 123);
});

test('📁 挂载回归 — include 片段与主文件共用 schema，冲突时主文件优先', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtk-inc-priority-'));
  const frag = path.join(dir, 'base.yaml');
  fs.writeFileSync(frag, 'logLevel: debug\n');

  // 片段 logLevel=debug，主文件 logLevel=info → 主文件值胜出
  const expanded = expandIncludes({ include: [frag], logLevel: 'info' }, dir);
  assert.equal(expanded.logLevel, 'info', '主文件未覆盖片段标量');
  // 主对象自身的 include 键保留到结果里（与 servicesConfigFile 保留行为一致）
  assert.deepStrictEqual(expanded.include, [frag]);

  // 端到端：resolveConfig 亦生效（绝对路径不受 cwd 影响）
  assert.equal(resolveConfig({ include: [frag], logLevel: 'info' }).logLevel, 'info');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('📁 挂载回归 — include 数组合并为并集去重且保留先出现顺序', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtk-inc-union-'));
  const frag = path.join(dir, 'base.yaml');
  fs.writeFileSync(frag, 'whitelistKeywords: ["x", "y"]\n');

  const expanded = expandIncludes({ include: [frag], whitelistKeywords: ['y', 'z'] }, dir);
  assert.deepStrictEqual(expanded.whitelistKeywords, ['x', 'y', 'z'], '数组未按并集去重 / 保序');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('📁 挂载回归 — include 支持递归，片段内相对路径以该片段目录为基准', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtk-inc-rec-'));
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub);
  // 主文件（dir）include ./sub/outer.yaml；outer.yaml（在 sub/）再 include ./inner.yaml。
  // 若内层相对路径错以主文件目录为基准，会找 dir/inner.yaml（不存在），此处即暴露。
  fs.writeFileSync(path.join(sub, 'outer.yaml'), 'include: ["./inner.yaml"]\n');
  fs.writeFileSync(path.join(sub, 'inner.yaml'), 'testURL: "https://inner.example/204"\n');

  const expanded = expandIncludes({ include: ['./sub/outer.yaml'] }, dir);
  assert.equal(expanded.testURL, 'https://inner.example/204');
  // 主文件的 include 保留；片段自身的 include 已被消费、不渗入结果
  assert.deepStrictEqual(expanded.include, ['./sub/outer.yaml']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('📁 挂载回归 — include 环路检测抛错且错误信息含环路链', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtk-inc-cycle-'));
  const a = path.join(dir, 'a.yaml');
  const b = path.join(dir, 'b.yaml');
  fs.writeFileSync(a, 'include: ["./b.yaml"]\n');
  fs.writeFileSync(b, 'include: ["./a.yaml"]\n');

  assert.throws(
    () => expandIncludes({ include: [a] }, dir),
    /Circular config include detected/
  );
  // 错误信息须能看出环路链
  assert.throws(() => expandIncludes({ include: [a] }, dir), new RegExp(`${path.sep}a\\.yaml`));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('📁 挂载回归 — include 片段缺失时显式抛错（fail-closed）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtk-inc-miss-'));
  const missing = path.join(dir, 'nope.yaml');
  assert.throws(() => expandIncludes({ include: [missing] }, dir), /Config mount not found/);
  assert.throws(() => resolveConfig({ include: [missing] }), /Config mount not found/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('📁 挂载回归 — 被嵌套的 include 片段内容变化同样刷新构建缓存键', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtk-inc-digest-'));
  const outer = path.join(dir, 'outer.yaml');
  const inner = path.join(dir, 'inner.yaml');
  fs.writeFileSync(outer, 'include: ["./inner.yaml"]\n');
  fs.writeFileSync(inner, 'customServices:\n  deepseek:\n    name: v1\n');

  const cfg = { include: [outer], enableAI: true };
  const digest1 = computeMountDigest(cfg, dir);
  const key1 = buildProfileCacheKey(cfg, {});
  assert.ok(digest1 && key1);

  // 只改「被外层片段嵌套」的内层文件：指纹与缓存键都必须随之变化
  fs.writeFileSync(inner, 'customServices:\n  deepseek:\n    name: v2\n');
  assert.notEqual(computeMountDigest(cfg, dir), digest1, '嵌套片段内容未计入挂载指纹');
  assert.notEqual(buildProfileCacheKey(cfg, {}), key1, '嵌套片段变化未刷新构建缓存键');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('🛡️ 远程配置 — include 属本地资源，?config= 无法借它读取本机文件', () => {
  assert.ok(REMOTE_DENIED_FIELDS.includes('include'), 'include 必须是远程剥夺字段');
  const hardened = hardenRemoteConfig({ include: ['./x.yaml'], enableAI: true });
  assert.equal(hardened.ok, true);
  assert.equal(hardened.config.include, undefined, 'include 未被远程剥离');
  assert.ok(hardened.strippedKeys.includes('include'));
});
