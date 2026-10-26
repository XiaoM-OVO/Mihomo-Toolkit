const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const layers = fs.readdirSync(SRC, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory()
      ? walk(path.join(dir, entry.name))
      : [path.join(dir, entry.name)]);
}

const srcFiles = walk(SRC).filter(file => file.endsWith('.js'));
const errors = [];

const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const arch = read('ARCHITECTURE.md');
const readme = read('README.md');
const defaults = read('DEFAULTS.md');

// 1. ARCHITECTURE.md 的层级数声明
const archMatch = arch.match(/划分为\s*(\d+)\s*(?:个)?层(?:级)?/);
if (!archMatch) {
  errors.push('ARCHITECTURE.md 未声明层级数');
} else if (Number(archMatch[1]) !== layers.length) {
  errors.push(`ARCHITECTURE.md 声明 ${archMatch[1]} 层，实际 ${layers.length} 层`);
}

// 2. README 架构表必须覆盖每一层
for (const layer of layers) {
  if (!readme.includes(`src/${layer}/`)) {
    errors.push(`README.md 架构表缺少 src/${layer}/`);
  }
}

// 3. ARCHITECTURE.md 的文件树必须覆盖每一个源文件
for (const file of srcFiles) {
  if (!arch.includes(path.basename(file))) {
    errors.push(`ARCHITECTURE.md 文件树缺少 ${path.relative(ROOT, file)}`);
  }
}

// 4. README 声明的源文件数量必须与实际一致
const countMatch = readme.match(/全仓\s*(\d+)\s*个源文件/);
if (!countMatch) {
  errors.push('README.md 未声明源文件数量');
} else if (Number(countMatch[1]) !== srcFiles.length) {
  errors.push(`README.md 声明 ${countMatch[1]} 个源文件，实际 ${srcFiles.length} 个`);
}

// 5. README 的 CLI 参数速查必须覆盖 cli.js 的全部选项
const cliSource = read('src/targets/cli.js');
for (const optionLine of cliSource.split('\n').filter(line => line.includes('.option('))) {
  for (const flag of optionLine.match(/--[a-z][a-z-]*/g) || []) {
    if (!readme.includes(flag)) {
      errors.push(`README.md 命令行参数缺少 ${flag}`);
    }
  }
}

// 6. DEFAULTS.md 第一节基线必须与默认产物 golden 一致
const golden = JSON.parse(read('test/fixtures/default-output.golden.json'));
const baseline = [
  ['策略组', golden['proxy-groups'].length],
  ['路由规则', golden.rules.length],
  ['Rule-Provider', Object.keys(golden['rule-providers']).length]
];
for (const [label, actual] of baseline) {
  const row = defaults.match(new RegExp(`^\\|\\s*${label}\\s*\\|\\s*(\\d+)\\s*\\|`, 'm'));
  if (!row) {
    errors.push(`DEFAULTS.md 缺少「${label}」基线行`);
  } else if (Number(row[1]) !== actual) {
    errors.push(`DEFAULTS.md 声明${label} ${row[1]}，实际 ${actual}`);
  }
}

// 7. 契约文档与历史记录中的相对链接必须真实存在
const mdFiles = [
  'README.md', 'ARCHITECTURE.md', 'CONFIGURATION.md', 'DEFAULTS.md', 'ROADMAP.md',
  ...walk(path.join(ROOT, 'docs'))
    .filter(file => file.endsWith('.md') && !file.endsWith('changelog-legacy.md'))
    .map(file => path.relative(ROOT, file))
];
for (const file of mdFiles) {
  const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const match of content.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|file:|#)/.test(target)) continue;
    const localPath = path.resolve(path.dirname(path.join(ROOT, file)), target.split('#')[0]);
    if (!fs.existsSync(localPath)) {
      errors.push(`${file} 存在失效链接: ${target}`);
    }
  }
}

if (errors.length) {
  console.error('❌ 文档一致性校验失败：');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`✅ 文档一致性通过（${layers.length} 层 / ${srcFiles.length} 个源文件 / 基线 ${baseline.map(([, n]) => n).join('·')}）`);
