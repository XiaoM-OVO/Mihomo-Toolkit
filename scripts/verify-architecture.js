/**
 * -----------------------------------------------------------------------------
 * 架构分层契约与循环依赖自动化静态校验脚本 (Architecture Invariant Checker)
 * -----------------------------------------------------------------------------
 * 扫描范围：src/**\/*.js
 * 排除规则：仅关注内部模块间 require('./...')，外部 npm 依赖与 Node 内置模块不参与分层统计
 */

const fs = require('fs');
const path = require('path');

function walk(dir) {
  let res = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) res = res.concat(walk(full));
    else if (f.endsWith('.js')) res.push(full);
  }
  return res;
}

const files = walk('src');
const adj = new Map();
const edges = [];

for (const file of files) {
  const normFile = file.replace(/\\/g, '/');
  adj.set(normFile, []);
  const code = fs.readFileSync(file, 'utf8');
  const matches = [...code.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)];
  for (const m of matches) {
    const rel = m[1];
    let resolved = path.normalize(path.join(path.dirname(normFile), rel)).replace(/\\/g, '/');
    if (fs.existsSync(resolved + '.js')) resolved += '.js';
    else if (fs.existsSync(resolved + '/index.js')) resolved += '/index.js';
    else if (fs.existsSync(resolved)) {
      // e.g. package.json
    }
    adj.get(normFile).push(resolved);
    edges.push({ from: normFile, to: resolved });
  }
}

// 1. 环路检测 (DFS Cycle Detection)
const visited = new Set();
const inStack = new Set();
const cycles = [];

function dfs(node, pathArr) {
  visited.add(node);
  inStack.add(node);
  pathArr.push(node);

  for (const n of (adj.get(node) || [])) {
    if (!visited.has(n)) {
      dfs(n, pathArr);
    } else if (inStack.has(n)) {
      const idx = pathArr.indexOf(n);
      cycles.push(pathArr.slice(idx).concat(n));
    }
  }

  pathArr.pop();
  inStack.delete(node);
}

for (const file of files) {
  const norm = file.replace(/\\/g, '/');
  if (!visited.has(norm)) {
    dfs(norm, []);
  }
}

// 2. 分层统计
function getLayer(filePath) {
  const parts = filePath.split('/');
  if (parts[0] === 'src') {
    if (parts.length === 2) return 'facade'; // src/index.js
    return parts[1]; // config, core, data, infra, io, pipeline, strategy, targets
  }
  return 'root';
}

const layerMatrix = {};
for (const e of edges) {
  const fromLayer = getLayer(e.from);
  const toLayer = getLayer(e.to);
  const key = `${fromLayer} -> ${toLayer}`;
  if (!layerMatrix[key]) layerMatrix[key] = [];
  layerMatrix[key].push(`${e.from} -> ${e.to}`);
}

console.log('=================================================================');
console.log('📊 Mihomo-Toolkit 源码分层与依赖关系全景图');
console.log('=================================================================');
console.log(`扫描文件总数: ${files.length} 个`);
console.log(`内部依赖总数: ${edges.length} 条边\n`);

console.log('--- 分层依赖关系分布 (按调用方向归类) ---');
for (const [k, list] of Object.entries(layerMatrix).sort()) {
  console.log(`[${k}] (${list.length} 条):`);
  list.forEach(item => console.log(`  • ${item}`));
}

console.log('\n=================================================================');
console.log('🔍 循环依赖 (Cycles) 检验结果');
console.log('=================================================================');
if (cycles.length === 0) {
  console.log('✅ 零环路 (Zero Cycles)：全仓 100% 满足有向无环图 (DAG) 拓扑结构。');
} else {
  console.log(`❌ 发现 ${cycles.length} 个环路:`);
  cycles.forEach(c => console.log('  ' + c.join(' -> ')));
}

console.log('\n=================================================================');
console.log('🛡️ 洋葱模型与架构红线检验结果');
console.log('=================================================================');
const coreToConfig = edges.filter(e => getLayer(e.from) === 'core' && getLayer(e.to) === 'config');
const coreToIo = edges.filter(e => getLayer(e.from) === 'core' && getLayer(e.to) === 'io');
const ioToCore = edges.filter(e => getLayer(e.from) === 'io' && getLayer(e.to) === 'core');
const dataOut = edges.filter(e => getLayer(e.from) === 'data' && getLayer(e.to) !== 'data');
const infraOut = edges.filter(e => getLayer(e.from) === 'infra' && getLayer(e.to) !== 'infra');

console.log(`• Core -> Config:  ${coreToConfig.length === 0 ? '✅ 0 违规' : '❌ ' + coreToConfig.length + ' 违规'}`);
console.log(`• Core -> IO:      ${coreToIo.length === 0 ? '✅ 0 违规' : '❌ ' + coreToIo.length + ' 违规'}`);
console.log(`• IO -> Core:      ${ioToCore.length === 0 ? '✅ 0 违规 (底层通信不反向依赖核心)' : '❌ ' + ioToCore.length + ' 条 (需关注)'}`);
console.log(`• Data -> Other:   ${dataOut.length === 0 ? '✅ 0 违规 (数据基线只读无外引)' : '❌ ' + dataOut.length + ' 违规'}`);
console.log(`• Infra -> Other:  ${infraOut.length === 0 ? '✅ 0 违规 (基础设施基元无外引)' : '❌ ' + infraOut.length + ' 违规'}`);

// 3. 组身份字面量防回潮：逻辑层不得再以中文组名作为身份判断
const { GROUP_IDENTITIES } = require('../src/data/catalog/identity');

/** 规范名的合法声明处：身份表本身与内置池名来源 */
const IDENTITY_SSOT_FILES = new Set([
  'src/data/catalog/identity.js',
  'src/data/default-pools.js'
]);

/** 与组名同字面、但语义无关的用户面词元：按「文件 + 字面量」精确豁免 */
const GROUP_LITERAL_ALLOWLIST = new Map([
  ['src/strategy/matcher.js', new Map([
    ['未知识别', '用户 DSL 匹配词（region 未知语义），不参与组身份判断']
  ])],
  ['src/data/default-routing.js', new Map([
    ['广告拦截', 'routing 预设显示标签，不参与组身份判断']
  ])]
]);

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const identityNames = [...new Set(Object.values(GROUP_IDENTITIES).map(def => def.name))];
const literalViolations = [];

for (const file of files) {
  const normFile = file.replace(/\\/g, '/');
  if (IDENTITY_SSOT_FILES.has(normFile)) continue;
  const allowed = GROUP_LITERAL_ALLOWLIST.get(normFile) || new Map();
  const code = stripComments(fs.readFileSync(file, 'utf8'));
  for (const name of identityNames) {
    if (allowed.has(name)) continue;
    const idx = code.indexOf(name);
    if (idx === -1) continue;
    literalViolations.push({
      file: normFile,
      line: code.slice(0, idx).split('\n').length,
      name
    });
  }
}

console.log('\n=================================================================');
console.log('🔒 组身份字面量 (Group Identity Literals) 检验结果');
console.log('=================================================================');
if (literalViolations.length === 0) {
  console.log('✅ 0 违规：逻辑层未出现已登记组名的中文字面量，身份统一走 data/catalog/identity。');
} else {
  console.log(`❌ 发现 ${literalViolations.length} 处组名字面量（请改用 groupName(GROUP_KEYS.xxx)）：`);
  for (const v of literalViolations) {
    console.log(`  • ${v.file}:${v.line}  「${v.name}」`);
  }
}

// 任一项失败即退出非零，避免 CI 中「只打印不拦截」
if (cycles.length > 0 || literalViolations.length > 0) {
  process.exitCode = 1;
}
