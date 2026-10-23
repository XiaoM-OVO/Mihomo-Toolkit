/**
 * -----------------------------------------------------------------------------
 * 自包含单文件脚本校验脚本 (Standalone Script Checker)
 * -----------------------------------------------------------------------------
 * 扫描范围：standalone/**\/*.js
 *
 * standalone/ 下的脚本不接入 src/ 的分层校验与单元测试，但它们是用户直接
 * 粘贴进客户端的交付物，一旦语法损坏或引入相对路径依赖就会静默失效。
 * 本脚本只守住两条最低不变量：
 *   1. 可解析：文件能从源码独立编译通过（语法级检查，不执行任何代码）；
 *   2. 自包含：不得出现 require('./...') / require('../...') 相对路径依赖，
 *      因为单文件被单独复制进客户端时，任何相对依赖都不可能存在。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const TARGET_DIR = path.join(ROOT, 'standalone');

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) result.push(...walk(full));
    else if (entry.endsWith('.js')) result.push(full);
  }
  return result;
}

const errors = [];

for (const file of walk(TARGET_DIR)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const code = fs.readFileSync(file, 'utf8');

  try {
    // 只编译不执行，捕获语法错误；filename 用于在报错信息中定位文件
    new vm.Script(code, { filename: rel });
  } catch (e) {
    errors.push(`${rel}：语法解析失败 —— ${e.message}`);
  }

  if (/require\(\s*['"]\.{1,2}\//.test(code)) {
    errors.push(`${rel}：存在相对路径 require，破坏单文件自包含承诺`);
  }
}

if (errors.length) {
  console.error('❌ 自包含脚本校验失败：');
  errors.forEach(e => console.error(`  - ${e}`));
  process.exit(1);
}

console.log('✅ 自包含脚本校验通过（语法可解析、无相对依赖）');
