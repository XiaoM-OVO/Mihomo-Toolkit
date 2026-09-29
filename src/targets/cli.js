#!/usr/bin/env node
/**
 * -----------------------------------------------------------------------------
 * Target: CLI 命令行构建工具 (mihomo-tk / mtk / mihomo-toolkit)
 * -----------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { program } = require('commander');
const { buildProfile } = require('../pipeline/engine');

function run(argv = process.argv) {
  program
    .name('mihomo-tk')
    .description('Mihomo-Toolkit (MTK) - 自动化节点清洗与策略组构建引擎')
    .version(require('../../package.json').version)
    .option('-u, --url <url>', 'Subscription URL or local config file path')
    .option('-o, --out <path>', 'Output file path (default: config.yaml / nodes.yaml / report.json)')
    .option('-t, --type <mode>', 'Output mode: "config" (default), "nodes" (clean proxies only), or "report" (audit JSON)', 'config')
    .option('-p, --passthrough', 'Preserve raw subscription rules/dns in config mode (only replace proxies)', false)
    .option('-c, --config <path>', 'User config JSON/YAML file path (optional)')
    .option('-r, --report <path>', 'Save extra audit report to a JSON file (optional)')
    .option('-m, --meta <path>', 'Alias for -r, --report')
    .option('--prod', 'Simulate production environment (enables security locks)')
    .option('--debug', 'Enable debug output (verbose fetch logs, intermediate snapshots)');

  program.parse(argv);
  const options = program.opts();

  // 模式归一化
  let mode = (options.type || 'config').toLowerCase();
  if (mode === 'full') mode = 'config';
  if (mode === 'cleaner' || mode === 'pure') mode = 'nodes';
  if (mode === 'meta' || mode === 'audit') mode = 'report';

  const VALID_MODES = ['config', 'nodes', 'report'];
  if (!VALID_MODES.includes(mode)) {
    console.error(`[CLI] Error: Invalid mode "${options.type}". Must be one of: ${VALID_MODES.join(', ')}`);
    process.exit(1);
  }

  return (async () => {
    try {
      let userConfig = {};

      if (options.config) {
        const configPath = path.resolve(process.cwd(), options.config);
        if (!fs.existsSync(configPath)) {
          throw new Error(`Config file not found: ${configPath}`);
        }
        const content = fs.readFileSync(configPath, 'utf-8');
        if (options.config.endsWith('.yaml') || options.config.endsWith('.yml')) {
          userConfig = yaml.parse(content) || {};
        } else {
          userConfig = JSON.parse(content);
        }
        console.log(`[CLI]     📄 已加载配置文件: ${options.config}`);
      }

      // 透传开关
      if (options.passthrough) {
        userConfig.passthrough = true;
      }

      console.log(`[CLI]     🚀 开始构建流程 (交付模式: ${mode}${userConfig.passthrough ? ' + passthrough' : ''})...`);
      const buildOptions = {
        ...options,
        type: mode,
        production: !!options.prod
      };

      const result = await buildProfile(userConfig, buildOptions);
      const { yamlStr, meta } = result;

      // 1. Report 模式：专门输出结构化健康与审计报告
      if (mode === 'report') {
        const targetOut = options.out || userConfig.output || 'report.json';
        const outPath = path.resolve(process.cwd(), targetOut);
        const reportData = result.report || (typeof result.yamlStr === 'string' && result.yamlStr.startsWith('{') ? JSON.parse(result.yamlStr) : (meta || result));
        fs.writeFileSync(outPath, JSON.stringify(reportData, null, 2), 'utf-8');
        console.log(`[CLI]     💾 审计报告已输出至: ${outPath}`);

        if (meta?.stats) {
          console.log(`\n=== 📊 节点清洗与健康审计 ===`);
          console.log(`总节点数: ${meta.stats.total} | 有效输出: ${meta.stats.outputCount}`);
          console.log(`去重剔除: ${meta.stats.dedupeCount} | 广告/无效: ${meta.stats.discardedCount}`);
          console.log(`未知地区: ${meta.stats.unknownCount} | 信息节点: ${meta.stats.infoCount}`);
          if (meta.stats.fissionCount > 0) console.log(`🧬 裂变增殖: 产生了 ${meta.stats.fissionCount} 个 IP 节点`);
          console.log(`=============================\n`);
        }
        return;
      }

      // 2. 附加 -r / -m 选项导出审计 JSON
      const reportTarget = options.report || options.meta;
      if (reportTarget && (result.report || meta)) {
        const reportPath = path.resolve(process.cwd(), reportTarget);
        const extraReport = result.report || meta;
        fs.writeFileSync(reportPath, JSON.stringify(extraReport, null, 2), 'utf-8');
        console.log(`[CLI]     💾 审计报告已另存至: ${reportPath}`);

        if (meta.stats) {
          console.log(`\n=== 📊 数据清洗统计 ===`);
          console.log(`总节点数: ${meta.stats.total} | 最终输出: ${meta.stats.outputCount}`);
          console.log(`去重剔除: ${meta.stats.dedupeCount} | 广告/无效: ${meta.stats.discardedCount}`);
          console.log(`未知地区: ${meta.stats.unknownCount} | 信息节点: ${meta.stats.infoCount}`);
          if (meta.stats.fissionCount > 0) console.log(`🧬 裂变增殖: 产生了 ${meta.stats.fissionCount} 个 IP 克隆节点`);
          console.log(`=======================\n`);
        }
      }

      // 3. 产物写入 (YAML)
      const defaultOut = mode === 'nodes' ? 'nodes.yaml' : 'config.yaml';
      const targetOut = options.out || userConfig.output || defaultOut;
      const outPath = path.resolve(process.cwd(), targetOut);
      fs.writeFileSync(outPath, yamlStr, 'utf-8');
      console.log(`[CLI]     ✅ 构建产物已输出至: ${outPath}`);
    } catch (err) {
      console.error(`[CLI]     ❌ Error:`, err.message);
      process.exit(1);
    }
  })();
}

if (require.main === module) {
  run();
}

module.exports = { run };
