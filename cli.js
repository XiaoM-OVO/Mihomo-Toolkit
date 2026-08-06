#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { program } = require('commander');
const { buildProfile } = require('./src/builder.js');

program
  .name('mihomo-toolkit')
  .description('Mihomo-Toolkit CLI runner')
  .version(require('./package.json').version)
  .option('-u, --url <url>', 'Subscription URL or local config file path (optional if config has subscriptions)')
  .option('-o, --out <path>', 'Output file path')
  .option('-t, --type <type>', 'Script to run: "pure", "full", or "toolkit"')
  .option('-c, --config <path>', 'User config JSON/YAML file path (optional)')
  .option('-m, --meta <path>', 'Force object outputMode and save meta info to a JSON file (optional)')
  .option('--prod', 'Simulate production environment (enables security locks)')
  .option('--debug', 'Enable debug output (verbose fetch logs, intermediate snapshots)')
  .parse(process.argv);

const options = program.opts();

// 校验 -t 参数,避免无效值静默跳过清洗与构建
const VALID_TYPES = ['pure', 'full', 'toolkit'];
if (options.type && !VALID_TYPES.includes(options.type)) {
  console.error(`[CLI] Error: Invalid -t type "${options.type}". Must be one of: ${VALID_TYPES.join(', ')}`);
  process.exit(1);
}

async function main() {
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
      console.log(`[CLI] Loaded user config from ${options.config}`);
    }

    if (options.meta) {
      userConfig.outputMode = "object";
    }

    // Call the builder
    console.log(`[CLI] Starting build process...`);
    const buildOptions = { ...options };
    if (buildOptions.prod) buildOptions.production = true;
    const { yamlStr, meta } = await buildProfile(userConfig, buildOptions);

    if (options.meta && meta) {
      const metaPath = path.resolve(process.cwd(), options.meta);
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      console.log(`[CLI] Saved meta object (buckets, stats, etc.) to ${metaPath}`);
      
      if (meta.stats) {
        console.log(`\n=== 📊 数据清洗统计 ===`);
        console.log(`总节点数: ${meta.stats.total} | 最终输出: ${meta.stats.outputCount}`);
        console.log(`去重剔除: ${meta.stats.dedupeCount} | 广告/无效: ${meta.stats.discardedCount}`);
        console.log(`未知地区: ${meta.stats.unknownCount} | 信息节点: ${meta.stats.infoCount}`);
        if (meta.stats.fissionCount > 0) console.log(`🧬 裂变增殖: 产生了 ${meta.stats.fissionCount} 个 IP 克隆节点`);
        console.log(`=======================\n`);
      }
    }
    
    const targetOut = options.out || userConfig.output || 'nodes.yaml';
    const outPath = path.resolve(process.cwd(), targetOut);
    fs.writeFileSync(outPath, yamlStr, 'utf-8');
    console.log(`[CLI] Saved result to ${outPath}`);

  } catch (err) {
    console.error(`[CLI] Error:`, err.message);
    process.exit(1);
  }
}

main();
