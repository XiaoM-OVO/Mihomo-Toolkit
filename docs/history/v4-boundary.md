# 谱系与取代边界（v4 统一内核取代 3.x 单脚本线）

> 历史决策记录，固化取代边界与命名口径；主线规划见 [ROADMAP.md](../../ROADMAP.md)。

## 谱系与取代边界（v4 统一内核取代 3.x 单脚本线）

> **决策背景**：`next` 分支上的统一内核将取代 `main` 的单脚本构建流程（builder 模式），取代动作在正式发版时一次性完成。本节固化边界与命名口径。

### 能力边界：保留 / 砍掉 / 收敛

| 3.x 单脚本线 | v4 统一内核 | 处理方式 |
| :--- | :--- | :--- |
| `cli.js` / `server.js` | `src/targets/cli.js` / `server.js` | 保留能力，实现重写 |
| `worker.js` 与 esbuild 打包（`build:worker`） | 无对应产物 | **砍掉**：不再提供 Cloudflare Worker 部署产物 |
| 三产物构建 `build:full` / `build:pure` / `build:toolkit` | 单产物 `build` / `build:nodes` / `build:report` | **砍掉**：不再按产物分裂构建 |
| `scripts/inject-shared.cjs` 跨产物注入共享逻辑 | `src/` 分层单一事实源 | **收敛**：共享字段不再逐产物复制，脚本职责单一化 |
| `substore/` 适配脚本 | 保留资产，不再排期 | **不承诺原生适配**：现 `nodes` 模式可继续作为外部二次加工入口 |

### 用户侧影响（发版说明中需显式交代）

1. **Cloudflare Worker 部署路径退场**：不再提供 Worker 产物，依赖该路径的用户需改用 CLI 或 server 宿主。
2. **入口文件位置变更**：根目录 `cli.js` / `server.js` 迁入 `src/targets/`，引用 `main` 分支原始文件路径的脚本与文档链接会失效。

### 发布命名谱系与版本代际共识

1. **单脚本时代 tag 冻结与 LTS 维护**：`v1.x`、`v2.0.0`–`v2.8.0`、`v3.0.0`–`v3.3.3`、`builder/`、`pure/`、`toolkit/` 历史 tag 永久保留作为追溯锚点。当 `next` 分支合并至 `main` 后，3.x 单脚本正式转入维护模式（仅限重大安全与缺陷修复，不再承载新架构特性）。
2. **统一内核确立为 4.x 代际**：为彻底避免与历史 `v2.x`/`v3.x` 标签撞车，并符合破坏性架构重构升级的语义化版本规范，新 7 层洋葱架构统一内核正式确立为 **v4.0.0** 代际（内部研发代号 `v2.0.0-alpha` 正式归档并升格为 `v4.0.0-alpha`）。
3. **版本单点真值（SSOT）**：`package.json`、`src/pipeline/config.js` (`pkgVersion`)、`src/pipeline/report.js` (`VERSION`) 与文档统一同步为 `4.0.0-alpha`；待 M3 拓扑 DSL 引擎与全链路验收完成合入 `main` 时，正式切为 `v4.0.0`。

