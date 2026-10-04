#!/usr/bin/env node
/**
 * -----------------------------------------------------------------------------
 * Target: CLI 命令行构建工具 (mihomo-toolkit)
 * -----------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { program } = require('commander');
const { buildProfile, normalizeOutputMode } = require('../pipeline/engine');
const { absolutizeMountPaths } = require('../config/mounts');
const { expandIncludes } = require('../config/include');
const { createLogger } = require('../core/logger');
const pkg = require('../../package.json');

function run(argv = process.argv) {
  program
    .name('mihomo-toolkit')
    .description(`Mihomo-Toolkit v${pkg.version} - 自动化节点清洗与策略组构建引擎`)
    .version(pkg.version)
    .option('-u, --url <url>', 'Subscription URL or local config file path')
    .option('-o, --out <path>', 'Output file path (default: config.yaml / nodes.yaml / report.json)')
    .option('-m, --mode <mode>', 'Output mode: "config" (default), "nodes" (clean proxies only), or "report" (audit JSON)', 'config')
    .option('-c, --config <path>', 'User config JSON/YAML file path (optional)')
    .option('-r, --report <path>', 'Save extra audit report to a JSON file (optional)')
    .option('--prod', 'Simulate production environment (enables security locks)')
    .option('--debug', 'Enable debug output (verbose fetch logs, intermediate snapshots)')
    .option('-q, --quiet', 'Suppress logging output (same as --silent)')
    .option('--silent', 'Suppress all logging output')
    .option('--log-level <level>', 'Explicit log level: silent | error | warn | info | debug');

  program.parse(argv);
  const options = program.opts();

  // 模式归一化
  const mode = normalizeOutputMode(options.mode);

  // 1. 预读取配置文件（探测 logLevel 并修正时序，避免在静默/告警级别下泄露启动标头）
  let userConfig = {};
  let configPath = null;
  let configLoadError = null;

  if (options.config) {
    configPath = path.resolve(process.cwd(), options.config);
    if (!fs.existsSync(configPath)) {
      configLoadError = new Error(`Config file not found: ${configPath}`);
    } else {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        if (options.config.endsWith('.yaml') || options.config.endsWith('.yml')) {
          userConfig = yaml.parse(content) || {};
        } else {
          userConfig = JSON.parse(content);
        }
        // 外挂配置文件路径以「配置文件所在目录」为基准转绝对路径：
        // 否则从别的工作目录运行 CLI 时，相对路径会静默失效。
        userConfig = absolutizeMountPaths(userConfig, path.dirname(configPath));
        // 在读取现场立即展开 include 片段：CLI 自身（以及下游 engine）在订阅抓取阶段之前
        // 就要读取 subscriptions / output / logLevel 等字段，若等到 resolveConfig 才展开，
        // 这些字段就会在片段里「配了等于没配」。基准目录必须是配置文件所在目录。
        userConfig = expandIncludes(userConfig, path.dirname(configPath));
      } catch (err) {
        configLoadError = err;
      }
    }
  }

  // 2. 判定生效日志等级：CLI 参数 > 配置文件 logLevel > 默认 'info'
  let effectiveLevel = 'info';
  if (options.silent || options.quiet) {
    effectiveLevel = 'silent';
  } else if (options.debug) {
    effectiveLevel = 'debug';
  } else if (options.logLevel) {
    effectiveLevel = String(options.logLevel).toLowerCase();
  } else if (userConfig.logLevel) {
    effectiveLevel = String(userConfig.logLevel).toLowerCase();
  }

  const logger = createLogger({
    tag: 'CLI',
    level: effectiveLevel
  });

  const VALID_MODES = ['config', 'nodes', 'report'];
  if (!VALID_MODES.includes(mode)) {
    logger.error(`Invalid mode "${options.mode}". Must be one of: ${VALID_MODES.join(', ')}`);
    process.exit(1);
  }

  return (async () => {
    try {
      if (configLoadError) {
        throw configLoadError;
      }

      logger.info(`🛠️ Mihomo-Toolkit v${pkg.version}`);
      if (options.config) {
        logger.info(`📄 已加载配置文件: ${options.config}`);
      }

      logger.info(`🚀 开始执行配置流水线 (交付模式: ${mode})`);
      const buildOptions = {
        ...options,
        mode,
        production: !!options.prod,
        logger
      };

      const result = await buildProfile(userConfig, buildOptions);
      const { yamlStr, meta } = result;

      // 1. Report 模式：专门输出结构化健康与审计报告
      if (mode === 'report') {
        const targetOut = options.out || userConfig.output || 'report.json';
        const outPath = path.resolve(process.cwd(), targetOut);
        const reportData = result.report;
        fs.writeFileSync(outPath, JSON.stringify(reportData, null, 2), 'utf-8');
        logger.success(`🎉 审计报告已输出至: ${outPath}`);

        if (meta?.stats && logger.isLevelEnabled('info')) {
          console.log(`\n=== 📊 节点清洗与健康审计 ===`);
          console.log(`总节点数: ${meta.stats.total} | 有效输出: ${meta.stats.outputCount}`);
          console.log(`去重剔除: ${meta.stats.dedupeCount} | 广告/无效: ${meta.stats.discardedCount}`);
          console.log(`未知地区: ${meta.stats.unknownCount} | 信息节点: ${meta.stats.infoCount}`);
          if (meta.stats.fissionCount > 0) console.log(`🧬 裂变增殖: 产生了 ${meta.stats.fissionCount} 个 IP 节点`);
          console.log(`=============================\n`);
        }
        return;
      }

      // 2. 附加 -r 选项导出审计 JSON
      const reportTarget = options.report;
      if (reportTarget && (result.report || meta)) {
        const reportPath = path.resolve(process.cwd(), reportTarget);
        const extraReport = result.report || meta;
        fs.writeFileSync(reportPath, JSON.stringify(extraReport, null, 2), 'utf-8');
        logger.info(`💾 审计报告已另存至: ${reportPath}`);

        if (meta?.stats && logger.isLevelEnabled('info')) {
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
      const isZeroNode = mode === 'config' && (!result.proxies || result.proxies.filter(p => !p.isSyntheticInfo).length === 0);
      const modeSuffix = isZeroNode ? ' (纯分流拦截模式)' : '';
      logger.success(`🎉 配置文件构建成功${modeSuffix} ➔ ${outPath}`);
    } catch (err) {
      logger.error(`构建异常:`, err.message);
      process.exit(1);
    }
  })();
}

if (require.main === module) {
  run();
}

module.exports = { run };
