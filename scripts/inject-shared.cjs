#!/usr/bin/env node
/**
 * =========================================================================
 * 🛠️ Mihomo-Toolkit | Shared Code Injector
 * -------------------------------------------------------------------------
 * 读取 src/_shared/*.js 中的代码生成函数，
 * 把生成的源码原样插入到目标文件中 /* INJECT_BEGIN / ~ /* INJECT_END *\/ 标记之间。
 *
 * 用法:  node scripts/inject-shared.cjs
 *
 * 每个目标文件的注入点由标记对界定：
 *   /* ↓↓↓↓↓ INJECT_BEGIN ↓↓↓↓↓ *\/     ← 开始标记（必须单独占一行）
 *     ... 这里的内容会被完全替换 ...
 *   /* ↑↑↑↑↑ INJECT_END ↑↑↑↑↑ *\/       ← 结束标记（必须单独占一行）
 *
 * 同一文件的多个注入点：
 *   - 按 targets 数组中的顺序依次匹配文件中出现的第 N 对 BEGIN/END 标记
 *   - 整个文件在内存中完成所有替换后一次性写入磁盘
 * =========================================================================
 */

const fs   = require("fs");
const path = require("path");

// -------------------------------------------------------------------------
// 1. 加载 _shared 模块中的源码生成器
// -------------------------------------------------------------------------
const ROOT        = path.resolve(__dirname, "..");
const sharedPath  = path.join(ROOT, "src", "_shared", "region-defs.js");
const shared      = require(sharedPath);

// 启动时跑一遍自检，确保 _REG_SOURCE_MAP 完整
shared.validateMapping();

// -------------------------------------------------------------------------
// 2. 目标文件列表 & 注入点定义
// -------------------------------------------------------------------------
const targets = [
  // --- pure-nodes.js (模块级，1 对标记) ---
  {
    target: path.join(ROOT, "src", "pure-nodes.js"),
    marker: "IN_PREFIX + REGION_DEFS + ENHANCE (pure-nodes 模块级)",
    generate: () => {
      const inPrefix = shared.generateInPrefixSource();
      const defs     = shared.generateRegionDefsSource(4);
      const enhance  = shared.generateEnhanceForEachSource("REGION_DEFS", 0);
      return [inPrefix, "const REGION_DEFS = [", defs, "];", "", enhance].join("\n");
    },
  },

  // --- mihomo-toolkit.js (operator() 函数内，3 对标记按文件中出现顺序) ---
  {
    target: path.join(ROOT, "src", "mihomo-toolkit.js"),
    marker: "IN_PREFIX (mihomo-toolkit 函数内 缩进=2)",
    generate: () => "  " + shared.generateInPrefixSource(),
  },
  {
    target: path.join(ROOT, "src", "mihomo-toolkit.js"),
    marker: "REGION_DEFS (mihomo-toolkit 函数内 缩进=4)",
    generate: () => {
      const defs = shared.generateRegionDefsSource(6); // 数组元素 6 空格
      return "  const REGION_DEFS = [\n" + defs + "\n    ];";
    },
  },
  {
    target: path.join(ROOT, "src", "mihomo-toolkit.js"),
    marker: "REGION_DEFS.forEach (mihomo-toolkit 函数内 缩进=2)",
    generate: () => {
      // 主脚本版本：内部 4 空格缩进 + 两条尾注释
      const src = shared.generateEnhanceForEachSource("REGION_DEFS", 0).split("\n");
      return [
        "  " + src[0].trim(),
        "    " + src[1].trim(),
        "    " + src[2].trim() + " // 用于最后擦除名字",
        "    " + src[3].trim() + "  // 用于判定节点归属",
        "    " + src[4].trim(),
        "  " + src[5].trim(),
      ].join("\n");
    },
  },
];

// -------------------------------------------------------------------------
// 3. 执行注入
// -------------------------------------------------------------------------
const BEGIN_MARKER  = "/* ↓↓↓↓↓ INJECT_BEGIN ↓↓↓↓↓ */";
const END_MARKER    = "/* ↑↑↑↑↑ INJECT_END ↑↑↑↑↑ */";
// 注意：容忍 BEGIN/END 标记行的前导空白（函数内缩进场景），
// 但替换后 BEGIN/END 标记行和 generate() 内容的缩进保持 generate() 输出原样。
const MARKER_REGEX  = new RegExp(
  `^[ \\t]*${escapeRegex(BEGIN_MARKER)}\\s*\\n[\\s\\S]*?\\n[ \\t]*${escapeRegex(END_MARKER)}\\s*?`,
  "gm"
);

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
  const changedLogs = [];
  const warnLogs   = [];
  let   changed  = 0;

  const finalContent = original.replace(MARKER_REGEX, (match) => {
    const cfg = queue.shift();
    if (!cfg) return match; // 多余的标记对保持不动
    const insert  = cfg.generate();
    const wrapped = `${BEGIN_MARKER}\n${insert}\n${END_MARKER}`;
    const equal   = match.trim() === wrapped.trim();
    if (!equal) {
      changedLogs.push(`🔄 ${cfg.marker}`);
      changed++;
    }
    return wrapped;
  });

  // 没替换到的 cfg 报告缺少标记
  for (const cfg of queue) {
    warnLogs.push(`⚠️ 缺 BEGIN/END 标记 — ${cfg.marker}`);
  }

  // 写回
  if (changed > 0) {
    fs.writeFileSync(target, finalContent, "utf8");
    console.log(`[inject] 📄 ${rel(target)}  (${changed} 处变更)`);
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
  console.log(`[inject] 完成：${changedFiles} 个文件变更，共 ${totalPatches} 处补丁。`);
} else {
  console.log(`[inject] 全部未变动 (${targets.length} 个注入点)。`);
}

// -------------------------------------------------------------------------
// 工具函数
// -------------------------------------------------------------------------
function rel(p)    { return path.relative(ROOT, p); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
