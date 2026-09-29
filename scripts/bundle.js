/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 独立端分发产物打包器 (Target Bundler)
 * -----------------------------------------------------------------------------
 * 使用 esbuild 将模块化源码编译打包为单文件分发脚本：
 * 1. dist/verge.js     -> 适用于 Clash Verge Rev 扩展脚本（直接复制即用）
 * 2. dist/operator.js  -> 适用于 Sub-Store 节点操作脚本（直接复制即用）
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

async function bundle() {
  console.log('📦 正在构建独立端单文件分发产物...');

  // 1. 打包 Clash Verge Rev 扩展脚本 (dist/verge.js)
  await esbuild.build({
    entryPoints: [path.resolve(ROOT_DIR, 'src/targets/verge.js')],
    outfile: path.resolve(DIST_DIR, 'verge.js'),
    bundle: true,
    platform: 'node',
    target: 'es2020',
    format: 'cjs',
    external: ['opencc-js'], // opencc-js 作为可选依赖动态加载
    banner: {
      js: '/**\n * Mihomo-Toolkit: Clash Verge Rev 独立扩展脚本\n * 自动生成，请勿手工直接修改此文件。\n */\n'
    }
  });
  console.log('  ✔ dist/verge.js 构建完成 (适用于 Clash Verge Rev 扩展脚本)');

  // 2. 打包 Sub-Store 节点操作算子 (dist/operator.js)
  await esbuild.build({
    entryPoints: [path.resolve(ROOT_DIR, 'src/targets/operator.js')],
    outfile: path.resolve(DIST_DIR, 'operator.js'),
    bundle: true,
    platform: 'neutral',
    target: 'es2020',
    format: 'cjs',
    external: ['dns', 'fs', 'path', 'opencc-js'],
    banner: {
      js: '/**\n * Mihomo-Toolkit: Sub-Store 独立节点清洗算子\n * 自动生成，请勿手工直接修改此文件。\n */\n'
    }
  });
  console.log('  ✔ dist/operator.js 构建完成 (适用于 Sub-Store 节点操作)');

  console.log('🎉 独立端分发包全部构建完毕！');
}

if (require.main === module) {
  bundle().catch(err => {
    console.error('❌ 打包失败:', err);
    process.exit(1);
  });
}

module.exports = { bundle };
