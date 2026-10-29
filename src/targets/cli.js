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
const { isTrustedSynthetic } = require('../core/node-trust');
const { runListCommand } = require('./list');
const { buildExplainPayload, renderExplainReport } = require('./explain');
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
    .option('--dry-run', '诊断模式：执行完整流水线校验配置语法、订阅连通性与 DNS 不变式，但不写入任何磁盘产物')
    .option('--validate', '同 --dry-run：仅校验不落盘')
    .option('--prod', 'Simulate production environment (enables security locks)')
    .option('--debug', 'Enable debug output (verbose fetch logs, intermediate snapshots)')
    .option('-q, --quiet', 'Suppress logging output (same as --silent)')
    .option('--silent', 'Suppress all logging output')
    .option('--log-level <level>', 'Explicit log level: silent | error | warn | info | debug')
    .option('--explain', '只读激活摘要：输出组 / 规则 / 池的「激活 / 跳过 / 剪枝 / 为空」及原因（不写入任何磁盘产物）')
    .option('--json', '与 --explain 配合：以 JSON 输出激活摘要，便于脚本与回归基线消费');

  // 只读查询命令：list 反射当前配置下可引用的对象，不触发构建流水线
  let listRequest = null;
  program
    .command('list [domain]')
    .description('列出当前配置下可引用的对象（域: refs | presets | macros | pools | services）')
    .option('--json', '以 JSON 输出，便于脚本消费')
    .action((domain, listOptions) => {
      // 配置文件路径沿用根命令的 -c：commander 默认由父命令消费该选项，
      // 子命令再定义一份只会让用户写法与解析结果不一致。
      // `--json` 同理：根命令的同名旗标可能抢先消费，这里两处都认，保证写法一致。
      listRequest = {
        domain,
        config: program.opts().config,
        json: listOptions.json === true || program.opts().json === true
      };
    });

  // 根命令保留「只有选项、不指定子命令」的原有用法：没有根 action 时，
  // commander 一旦发现存在子命令就会对这类调用直接打印帮助并退出。
  program.action(() => {});

  program.parse(argv);

  if (listRequest) {
    return runListCommand(listRequest);
  }

  const options = program.opts();

  // 模式归一化
  const mode = normalizeOutputMode(options.mode);

  // 诊断模式：--dry-run 与 --validate 等价，仅校验不落盘；
  // --explain 同样只读（ROADMAP：默认只读不产出），只是在诊断之上多给一份激活摘要
  const dryRun = Boolean(options.dryRun || options.validate || options.explain);
  const explain = options.explain === true;
  // JSON 模式下 stdout 必须只承载结构化摘要
  const explainJson = explain && options.json === true;

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
        // 在读取现场立即展开 include 片段：CLI 自身（以及下游 engine）在订阅拉取阶段之前
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
  // --explain --json：stdout 必须只承载 JSON，常规日志一律降级（错误仍走 stderr）
  if (explainJson) {
    effectiveLevel = 'error';
  }

  const logger = createLogger({
    tag: 'CLI',
    level: effectiveLevel
  });

  const VALID_MODES = ['config', 'nodes', 'report'];
  if (!VALID_MODES.includes(mode)) {
    logger.error(`❌ 非法交付模式「${options.mode}」，可选模式: ${VALID_MODES.join(', ')}`);
    process.exit(1);
  }
  if (options.json === true && !explain) {
    logger.error('❌ --json 仅与 --explain 配合使用（list 子命令的 --json 请写在 list 之后）');
    process.exit(1);
  }
  if (explain && mode !== 'config') {
    logger.error('❌ --explain 仅支持 config 交付模式（组 / 规则 / 池的激活摘要只在完整配置构建中存在）');
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
      let buildOutcome = null;
      const buildOptions = {
        ...options,
        mode,
        production: !!options.prod,
        logger
      };
      if (dryRun) {
        // 诊断模式：绕过缓存强制现场构建（真实验证订阅连通性），且不写缓存、不落盘
        buildOptions.noCache = true;
        buildOptions.onBuildOutcome = (outcome) => { buildOutcome = outcome; };
      }

      const result = await buildProfile(userConfig, buildOptions);
      const { yamlStr, meta } = result;

      // 0. 诊断模式：完成全部校验后直接返回，绝不写入任何磁盘产物
      if (dryRun) {
        const violations = result.invariantViolations || [];
        const hasFailedSub = !!buildOutcome?.hasFailedSub;
        const hasTerminal = !!buildOutcome?.hasTerminalFailure;
        const usableSubCount = typeof buildOutcome?.usableSubCount === 'number'
          ? buildOutcome.usableSubCount
          : null;
        // 以「可用订阅数」为准判定整体可用性：部分订阅终态失效但仍有健康订阅时，不再误报全部不可用
        const allUnusable = usableSubCount !== null ? usableSubCount === 0 : hasTerminal;
        const subState = allUnusable
          ? '❌ 全部订阅不可用'
          : (hasFailedSub ? '⚠️ 部分订阅不可用' : '✅ 连通正常');
        const lines = [
          explain
            ? '🧪 诊断模式 (--explain)：只输出激活摘要，不写入任何磁盘产物'
            : '🧪 诊断模式 (--dry-run)：不写入任何磁盘产物',
          '├── 配置语法: ✅ 通过',
          `├── 订阅连通性: ${subState}`
        ];
        if (meta?.stats) {
          lines.push(`├── 节点规模: 总计 ${meta.stats.total} ➔ 有效交付 ${meta.stats.outputCount}`);
        }
        lines.push(`└── DNS 不变式: ${violations.length === 0 ? '✅ 无违规' : `❌ ${violations.length} 项违规`}`);

        if (explainJson) {
          // JSON 模式：stdout 只承载结构化摘要，诊断文本改走 stderr 之外（等级已降为 error，默认不输出）
          console.log(JSON.stringify(buildExplainPayload(result.explain || []), null, 2));
        } else {
          logger.info(lines.join('\n'));
          if (explain) {
            // 摘要与 logLevel 解耦：--explain 的产物就是这份摘要，不能被 --silent / warn 级日志吞掉
            console.log(renderExplainReport(result.explain || []));
          }
        }

        if (violations.length > 0 && logger.isLevelEnabled('warn')) {
          const vLines = ['⚠️ DNS 不变式明细:'];
          violations.forEach((v, idx) => {
            vLines.push(`${idx === violations.length - 1 ? '└──' : '├──'} [${v.id}] ${v.detail}`);
          });
          logger.warn(vLines.join('\n'));
        }

        if (violations.length > 0 || hasTerminal) {
          logger.error('❌ 诊断未通过：存在 DNS 不变式违规或订阅全部不可用');
          process.exit(1);
        }
        logger.success('✅ 诊断通过：配置语法、订阅连通性与 DNS 不变式均正常');
        return;
      }

      // 1. Report 模式：专门输出结构化健康与审计报告
      if (mode === 'report') {
        const targetOut = options.out || userConfig.output || 'report.json';
        const outPath = path.resolve(process.cwd(), targetOut);
        const reportData = result.report;
        fs.writeFileSync(outPath, JSON.stringify(reportData, null, 2), 'utf-8');
        logger.success(`🎉 审计报告已输出至: ${outPath}`);

        if (meta?.stats && logger.isLevelEnabled('info')) {
          const lines = [
            '📊 节点清洗与健康审计概览:',
            `├── 节点规模: 总计 ${meta.stats.total} ➔ 有效交付 ${meta.stats.outputCount}`,
            `├── 过滤剔除: 去重 ${meta.stats.dedupeCount} | 广告/无效 ${meta.stats.discardedCount}`,
            `└── 属性标记: 未知地区 ${meta.stats.unknownCount} | 说明节点 ${meta.stats.infoCount}`
          ];
          if (meta.stats.fissionCount > 0) {
            lines.splice(lines.length - 1, 0, `├── 🧬 裂变增殖: 产生 ${meta.stats.fissionCount} 个 IP 节点`);
          }
          logger.info(lines.join('\n'));
        }
        return;
      }

      // 2. 附加 -r 选项导出审计 JSON
      const reportTarget = options.report;
      if (reportTarget && (result.report || meta)) {
        const reportPath = path.resolve(process.cwd(), reportTarget);
        const extraReport = result.report || meta;
        if (result.invariantViolations && typeof extraReport === 'object') {
          extraReport.invariantViolations = result.invariantViolations;
        }
        fs.writeFileSync(reportPath, JSON.stringify(extraReport, null, 2), 'utf-8');
        logger.info(`💾 审计报告已另存至: ${reportPath}`);

        if (meta?.stats && logger.isLevelEnabled('info')) {
          const lines = [
            '📊 数据清洗统计概览:',
            `├── 节点规模: 总计 ${meta.stats.total} ➔ 最终输出 ${meta.stats.outputCount}`,
            `├── 过滤剔除: 去重 ${meta.stats.dedupeCount} | 广告/无效 ${meta.stats.discardedCount}`,
            `└── 属性标记: 未知地区 ${meta.stats.unknownCount} | 说明节点 ${meta.stats.infoCount}`
          ];
          if (meta.stats.fissionCount > 0) {
            lines.splice(lines.length - 1, 0, `├── 🧬 裂变增殖: 产生 ${meta.stats.fissionCount} 个 IP 克隆节点`);
          }
          logger.info(lines.join('\n'));
        }
      }

      // 3. 产物写入 (YAML)
      const defaultOut = mode === 'nodes' ? 'nodes.yaml' : 'config.yaml';
      const targetOut = options.out || userConfig.output || defaultOut;
      const outPath = path.resolve(process.cwd(), targetOut);
      fs.writeFileSync(outPath, yamlStr, 'utf-8');
      const isZeroNode = mode === 'config' && (!result.proxies || result.proxies.filter(p => !isTrustedSynthetic(p)).length === 0);
      const modeSuffix = isZeroNode ? ' (纯分流拦截模式)' : '';
      logger.success(`🎉 配置文件构建成功${modeSuffix} ➔ ${outPath}`);

      if (result.invariantViolations && result.invariantViolations.length > 0 && logger.isLevelEnabled('warn')) {
        const lines = [`⚠️ DNS 不变式自检发现 ${result.invariantViolations.length} 项违规:`];
        result.invariantViolations.forEach((v, idx) => {
          const isLast = idx === result.invariantViolations.length - 1;
          lines.push(`${isLast ? '└──' : '├──'} [${v.id}] ${v.detail}`);
        });
        logger.warn(lines.join('\n'));
      }
    } catch (err) {
      logger.error(`❌ 构建异常: ${err.message}`);
      process.exit(1);
    }
  })();
}

if (require.main === module) {
  run();
}

module.exports = { run };
