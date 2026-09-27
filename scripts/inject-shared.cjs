#!/usr/bin/env node
/**
 * =========================================================================
 * 🛠️ Mihomo-Toolkit | Shared Code Injector
 * -------------------------------------------------------------------------
 * 读取 src/_shared/*.js 中的代码生成函数，
 * 把生成的源码插入到目标文件的 INJECT_BEGIN ~ INJECT_END 标记之间。
 *
 * 用法:
 *   node scripts/inject-shared.cjs          # 执行注入并写回磁盘
 *   node scripts/inject-shared.cjs --check  # 仅检查是否已同步，未同步则退出码返回 1 (CI 专用)
 *
 * 支持具名标记严格匹配 (杜绝顺序错位隐患)：
 *   /* ↓↓↓↓↓ INJECT_BEGIN:ID ↓↓↓↓↓ *\/
 *     ... 这里的内容会被替换 ...
 *   /* ↑↑↑↑↑ INJECT_END:ID ↑↑↑↑↑ *\/
 * =========================================================================
 */

const fs   = require("fs");
const path = require("path");

const isCheckMode = process.argv.includes("--check");
const isDryRun    = isCheckMode || process.argv.includes("--dry-run");

// -------------------------------------------------------------------------
// 1. 加载 _shared 模块中的源码生成器
// -------------------------------------------------------------------------
const ROOT        = path.resolve(__dirname, "..");
const sharedPath  = path.join(ROOT, "src", "_shared", "region-defs.js");
const shared      = require(sharedPath);

// 启动时跑一遍自检，确保映射与正则有效
shared.validateMapping();

// -------------------------------------------------------------------------
// 2. 目标文件列表 & 注入点定义
// -------------------------------------------------------------------------
const targets = [
  // --- pure-nodes.js (模块级，具名标记) ---
  {
    id: "PURE_SHARED",
    target: path.join(ROOT, "src", "pure-nodes.js"),
    marker: "IN_PREFIX + REGION_DEFS + ENHANCE (pure-nodes 模块级)",
    generate: () => {
      const inPrefix = shared.generateInPrefixSource();
      const defs     = shared.generateRegionDefsSource(4);
      const enhance  = shared.generateEnhanceForEachSource("REGION_DEFS", 0);
      return [inPrefix, "const REGION_DEFS = [", defs, "];", "", enhance].join("\n");
    },
  },

  // --- mihomo-toolkit.js (operator() 函数内，具名标记) ---
  {
    id: "TOOLKIT_IN_PREFIX",
    target: path.join(ROOT, "src", "mihomo-toolkit.js"),
    marker: "IN_PREFIX (mihomo-toolkit 函数内 缩进=2)",
    generate: () => "  " + shared.generateInPrefixSource(),
  },
  {
    id: "TOOLKIT_REGION_DEFS",
    target: path.join(ROOT, "src", "mihomo-toolkit.js"),
    marker: "REGION_DEFS (mihomo-toolkit 函数内 缩进=4)",
    generate: () => {
      const defs = shared.generateRegionDefsSource(6); // 数组元素 6 空格
      return "  const REGION_DEFS = [\n" + defs + "\n    ];";
    },
  },
  {
    id: "TOOLKIT_ENHANCE",
    target: path.join(ROOT, "src", "mihomo-toolkit.js"),
    marker: "REGION_DEFS.forEach (mihomo-toolkit 函数内 缩进=2)",
    generate: () => {
      return shared.generateEnhanceForEachSource("REGION_DEFS", 2, { innerIndent: 2, withComments: true });
    },
  },
];

// -------------------------------------------------------------------------
// 3. 执行注入
// -------------------------------------------------------------------------
// 支持具名标记 `INJECT_BEGIN:ID` 与通用匿名标记 `INJECT_BEGIN`
const MARKER_REGEX = /^[ \t]*\/\* ↓↓↓↓↓ INJECT_BEGIN(?::([a-zA-Z0-9_\-]+))? ↓↓↓↓↓ \*\/\s*\r?\n[\s\S]*?\r?\n[ \t]*\/\* ↑↑↑↑↑ INJECT_END(?::\1)? ↑↑↑↑↑ \*\/[ \t]*/gm;

// 按 target 分组
const byFile = new Map();
for (const cfg of targets) {
  const arr = byFile.get(cfg.target) || [];
  arr.push(cfg);
  byFile.set(cfg.target, arr);
}

let changedFiles = 0;
let totalPatches = 0;

for (const [target, configs] of byFile) {
  if (!fs.existsSync(target)) {
    for (const cfg of configs) {
      console.warn(`[inject] ⚠️ 跳过 (文件不存在): ${rel(target)} — ${cfg.marker}`);
    }
    continue;
  }

  const original = fs.readFileSync(target, "utf8");
  const queue    = configs.slice();
  const cfgMap   = new Map(configs.map(c => [c.id, c]));
  const matchedIds = new Set();
  const changedLogs = [];
  const warnLogs   = [];
  let   changed  = 0;

  const finalContent = original.replace(MARKER_REGEX, (match, namedId) => {
    let cfg = null;
    if (namedId) {
      cfg = cfgMap.get(namedId);
      if (!cfg) {
        warnLogs.push(`⚠️ 未知具名标记 — ${namedId}`);
        return match;
      }
      matchedIds.add(namedId);
    } else {
      // 兼容匿名标记：按顺序弹出未被具名匹配的下一个
      while (queue.length > 0) {
        const candidate = queue.shift();
        if (!matchedIds.has(candidate.id)) {
          cfg = candidate;
          break;
        }
      }
      if (!cfg) return match;
    }

    const insert  = cfg.generate();
    const beginMarker = `/* ↓↓↓↓↓ INJECT_BEGIN:${cfg.id} ↓↓↓↓↓ */`;
    const endMarker   = `/* ↑↑↑↑↑ INJECT_END:${cfg.id} ↑↑↑↑↑ */`;
    const wrapped = `${beginMarker}\n${insert}\n${endMarker}`;
    const equal   = match.trim() === wrapped.trim();
    if (!equal) {
      changedLogs.push(`🔄 ${cfg.marker}`);
      changed++;
      return wrapped;
    }
    return match; // 无变更时原样保留，避免引入细微空白差异
  });

  // 检查是否有配置项完全未在文件中匹配到标记
  for (const cfg of configs) {
    if (!matchedIds.has(cfg.id) && queue.includes(cfg)) {
      warnLogs.push(`⚠️ 缺 BEGIN/END 标记 — [${cfg.id}] ${cfg.marker}`);
    }
  }

  // 写回 (非 dry-run 模式下)
  if (changed > 0) {
    if (!isDryRun) {
      fs.writeFileSync(target, finalContent, "utf8");
    }
    console.log(`[inject] 📄 ${rel(target)}  (${changed} 处变更)${isDryRun ? " [DRY-RUN]" : ""}`);
    for (const l of changedLogs) console.log(`           ${l}`);
    changedFiles++;
    totalPatches += changed;
  } else {
    console.log(`[inject] 📄 ${rel(target)}  (未变动)`);
  }
  for (const l of warnLogs) console.log(`           ${l}`);
}

// -------------------------------------------------------------------------
// 4. 结束
// -------------------------------------------------------------------------
console.log("");
if (changedFiles > 0) {
  console.log(`[inject] 完成：${changedFiles} 个文件需变更，共 ${totalPatches} 处补丁。`);
  if (isCheckMode) {
    console.error(`[inject] ❌ CI 校验失败：检测到共享字典未注入同步，请在本地运行 npm run inject 后提交！`);
    process.exit(1);
  }
} else {
  console.log(`[inject] 全部已同步 (${targets.length} 个注入点)。`);
}

// -------------------------------------------------------------------------
// 工具函数
// -------------------------------------------------------------------------
function rel(p)    { return path.relative(ROOT, p); }
