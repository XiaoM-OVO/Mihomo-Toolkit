const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const layers = fs.readdirSync(SRC, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

const errors = [];

// 1. ARCHITECTURE.md 的层级数声明
const arch = fs.readFileSync(path.join(ROOT, 'ARCHITECTURE.md'), 'utf8');
const archMatch = arch.match(/划分为\s*(\d+)\s*(?:个)?层(?:级)?/);
if (!archMatch) {
  errors.push('ARCHITECTURE.md 未声明层级数');
} else if (Number(archMatch[1]) !== layers.length) {
  errors.push(`ARCHITECTURE.md 声明 ${archMatch[1]} 层，实际 ${layers.length} 层`);
}

// 2. README 架构表必须覆盖每一层
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
for (const layer of layers) {
  if (!readme.includes(`src/${layer}/`)) {
    errors.push(`README.md 架构表缺少 src/${layer}/`);
  }
}

// 3. ARCHITECTURE.md 的文件树也必须覆盖每一层
for (const layer of layers) {
  if (!arch.includes(`${layer}/`)) {
    errors.push(`ARCHITECTURE.md 文件树缺少 ${layer}/`);
  }
}

if (errors.length) {
  console.error('❌ 文档一致性校验失败：');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`✅ 文档一致性通过（${layers.length} 层全覆盖）`);

