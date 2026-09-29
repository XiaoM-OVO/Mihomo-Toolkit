/**
 * Mihomo-Toolkit 高性能与高颜值分级日志系统
 * 支持:
 * 1. 五级日志过滤: silent(0), error(1), warn(2), info(3), debug(4)
 * 2. 作用域微标 (Tag) 定宽对齐与子模块命名空间 (IO, Cleaner, Strategy, CLI, Server 等)
 * 3. 多行树形图换行自动对齐缩进 (保持 ├── └── 视觉美感)
 * 4. 敏感信息自动脱敏 (redactLogs: Token, 密码, 认证参数)
 * 5. 零依赖 ANSI 语法高亮与终端降级 (支持 NO_COLOR 及非 TTY 自动剥离色彩)
 */

const LOG_LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  boldRed: '\x1b[1;31m',
  green: '\x1b[32m',
  boldGreen: '\x1b[1;32m',
  yellow: '\x1b[33m',
  boldYellow: '\x1b[1;33m',
  blue: '\x1b[34m',
  boldBlue: '\x1b[1;34m',
  magenta: '\x1b[35m',
  boldMagenta: '\x1b[1;35m',
  cyan: '\x1b[36m',
  boldCyan: '\x1b[1;36m',
  white: '\x1b[37m'
};

const TAG_ABBR = {
  Cleaner: 'Clean',
  Strategy: 'Strat',
  Server: 'Server',
  IO: 'IO',
  CLI: 'CLI',
  Fetcher: 'Fetch',
  Builder: 'Build',
  Config: 'Config'
};

const TAG_COLORS = {
  CLI: ANSI.magenta,
  Server: ANSI.magenta,
  IO: ANSI.cyan,
  Fetcher: ANSI.cyan,
  Fetch: ANSI.cyan,
  Cleaner: ANSI.yellow,
  Clean: ANSI.yellow,
  Strategy: ANSI.blue,
  Strat: ANSI.blue,
  Config: ANSI.cyan,
  Success: ANSI.boldGreen,
  Error: ANSI.boldRed,
  Warn: ANSI.boldYellow
};

function formatTimestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function redactText(text) {
  if (typeof text !== 'string') return text;
  return text
    // Redact query params: token, auth, password, secret, key
    .replace(/([?&](?:token|auth|password|key|secret)=)[^&\s]+/gi, '$1***')
    // Redact Authorization headers: Bearer xxx
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1***')
    // Redact userinfo: http(s)://user:password@host
    .replace(/(https?:\/\/)([^:@\s]+:[^@\s]+@)/gi, '$1***@')
    // Redact Proxy URIs: ss://xxx@, vless://xxx@, trojan://xxx@
    .replace(/(ss:\/\/[^@\s]+@)/gi, 'ss://***@')
    .replace(/(vless:\/\/[^@\s]+@)/gi, 'vless://***@')
    .replace(/(trojan:\/\/[^@\s]+@)/gi, 'trojan://***@');
}

class Logger {
  /**
   * @param {object} options
   * @param {string} [options.level='info'] - silent | error | warn | info | debug
   * @param {string} [options.tag='CLI'] - 模块标签
   * @param {boolean} [options.timestamps=true] - 是否显示时间戳
   * @param {boolean} [options.colors] - 是否启用颜色 (默认根据 TTY 和 NO_COLOR 探测)
   * @param {boolean} [options.redact=true] - 是否自动脱敏
   * @param {number} [options.tagWidth=12] - 标签对齐总宽度
   * @param {Function} [options.out] - 自定义日志输出通道 (msg, level) => void
   */
  constructor(options = {}) {
    this.tag = options.tag || 'CLI';
    this.timestamps = options.timestamps !== false;
    this.redact = options.redact !== false;
    this.tagWidth = options.tagWidth || 12;
    this.out = options.out || null;

    const hasNoColor = typeof process !== 'undefined' && (!!process.env.NO_COLOR || process.env.TERM === 'dumb');
    const isTTY = typeof process !== 'undefined' && process.stdout && Boolean(process.stdout.isTTY);
    this.enableColors = options.colors !== undefined ? Boolean(options.colors) : (!hasNoColor && isTTY);

    this.setLevel(options.level || 'info');
  }

  setLevel(levelName) {
    const norm = String(levelName || 'info').toLowerCase();
    this.levelName = norm;
    this.level = LOG_LEVELS[norm] ?? LOG_LEVELS.info;
  }

  isLevelEnabled(levelName) {
    const val = LOG_LEVELS[String(levelName).toLowerCase()] ?? 0;
    return this.level >= val;
  }

  colorize(colorCode, text) {
    if (!this.enableColors || !colorCode) return text;
    return `${colorCode}${text}${ANSI.reset}`;
  }

  /**
   * 计算指定等级下的标签显示名称
   */
  resolveTag(levelType) {
    if (levelType === 'success') return 'Success';
    const base = this.tag;
    const abbr = TAG_ABBR[base] || base;

    if (levelType === 'debug') {
      return `${abbr}:DBG`;
    }
    if (levelType === 'warn') {
      return `${abbr}:WARN`;
    }
    if (levelType === 'error') {
      return `${abbr}:ERR`;
    }
    return base;
  }

  /**
   * 格式化并输出日志
   */
  write(levelType, args) {
    // 敏感信息脱敏与参数序列化
    const rawMsg = args.map(arg => {
      if (typeof arg === 'string') {
        return this.redact ? redactText(arg) : arg;
      }
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    const displayTag = this.resolveTag(levelType);
    const bracketTag = `[${displayTag}]`;
    const paddedTag = bracketTag.padEnd(this.tagWidth, ' ');

    // 确定标签色
    let tagColor = TAG_COLORS[displayTag] || TAG_COLORS[this.tag] || ANSI.cyan;
    if (levelType === 'debug') tagColor = ANSI.cyan;
    if (levelType === 'warn') tagColor = ANSI.boldYellow;
    if (levelType === 'error') tagColor = ANSI.boldRed;
    if (levelType === 'success') tagColor = ANSI.boldGreen;

    const coloredTag = this.colorize(tagColor, paddedTag);

    // 时间戳部分 (定宽 9 字符: "HH:mm:ss ")
    const timeStr = this.timestamps ? `${formatTimestamp()} ` : '';
    const coloredTime = this.timestamps ? this.colorize(ANSI.gray, timeStr) : '';

    // 多行树形分支对齐 (计算前缀纯文本长度以保持对齐)
    const prefixPlainLen = (this.timestamps ? 9 : 0) + this.tagWidth;
    const indentSpace = ' '.repeat(prefixPlainLen);

    const lines = rawMsg.split('\n');
    const formattedLines = lines.map((line, idx) => {
      if (idx === 0) {
        return `${coloredTime}${coloredTag} ${line}`;
      }
      return `${indentSpace} ${line}`;
    });

    const outputText = formattedLines.join('\n');

    if (typeof this.out === 'function') {
      this.out(outputText, levelType);
      return;
    }

    if (levelType === 'error') {
      console.error(outputText);
    } else if (levelType === 'warn') {
      console.warn(outputText);
    } else {
      console.log(outputText);
    }
  }

  debug(...args) {
    if (this.level >= LOG_LEVELS.debug) {
      this.write('debug', args);
    }
  }

  info(...args) {
    if (this.level >= LOG_LEVELS.info) {
      this.write('info', args);
    }
  }

  log(...args) {
    this.info(...args);
  }

  success(...args) {
    if (this.level >= LOG_LEVELS.info) {
      this.write('success', args);
    }
  }

  warn(...args) {
    if (this.level >= LOG_LEVELS.warn) {
      this.write('warn', args);
    }
  }

  error(...args) {
    if (this.level >= LOG_LEVELS.error) {
      this.write('error', args);
    }
  }

  /**
   * 衍生带有新命名空间的子 Logger (继承父级级别、色彩、脱敏配置)
   */
  child(childTag, overrides = {}) {
    return new Logger({
      level: this.levelName,
      timestamps: this.timestamps,
      colors: this.enableColors,
      redact: this.redact,
      tagWidth: this.tagWidth,
      out: this.out,
      ...overrides,
      tag: childTag
    });
  }
}

function createLogger(options = {}) {
  if (typeof options === 'string') {
    // 兼容历史调用 createLogger('[Builder]', 'info')
    const tag = options.replace(/^\[|\]$/g, '');
    const level = arguments[1] || 'info';
    return new Logger({ tag, level });
  }
  return new Logger(options);
}

module.exports = {
  Logger,
  createLogger,
  LOG_LEVELS,
  redactText
};
