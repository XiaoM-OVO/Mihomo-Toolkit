<div align="center">

# 🛠️ Mihomo-Toolkit

**一套为 Mihomo 内核生态设计的自动化节点清洗与动态策略组构建工具**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Mihomo](https://img.shields.io/badge/Core-Mihomo-orange)](https://github.com/MetaCubeX/mihomo)
[![Version](https://img.shields.io/badge/Version-v4.0.0--alpha-9cf)](https://github.com/XiaoM-OVO/Mihomo-Toolkit/releases)
[![Tests](https://img.shields.io/badge/Tests-793%20Passed-brightgreen)](test/)

「 **自动清洗 · 物理去重 · 动态拓扑 · 容灾兜底** 」

> ⚠️ **开发中版本 · `v4.0.0-alpha`**：本项目当前处于下一代统一内核构建阶段（Milestone 1–3 已闭环，Milestone 4 发版收尾准备中），接口与配置可能微调，暂不建议直接用于生产环境。开发进展与演进规划请参阅 [开发路线图 (ROADMAP.md)](ROADMAP.md)。

</div>

---

## 📌 快速导航

- [✨ 核心特性](#-核心特性)
- [🎯 三大交付形态](#-三大交付形态)
- [🚀 快速开始与使用指南](#-快速开始与使用指南)
  - [1. 终端命令行 (CLI)](#1-终端命令行-cli)
  - [2. 常驻 HTTP 订阅服务](#2-常驻-http-订阅服务)
  - [3. 客户端无缝集成](#3-客户端无缝集成)
  - [4. 自包含单文件脚本（免部署）](#4-自包含单文件脚本免部署)
- [⚙️ 配置详解 (`config.yaml`)](#️-配置详解-configyaml)
- [🔐 安全模型与信任边界](#-安全模型与信任边界)
- [🏗️ 系统架构与分层导览](#️-系统架构与分层导览)
- [🗺️ 开发路线与演进规划](#️-开发路线与演进规划)
- [❓ 常见问题 (FAQ)](#-常见问题-faq)
- [📜 鸣谢与声明](#-鸣谢与声明)

---

## ✨ 核心特性

- 🧹 **节点特征清洗**：基于底层物理网络特征指纹（Fingerprint）去重，剔除引流广告，提取倍率、线路与落地城市，多订阅来源打标。
- 🌍 **动态大区折叠**：热门地区自动独立建组测速，小众冷门节点动态折叠归入大洲组，避免数十个单节点策略组刷屏。
- 🔀 **开箱即用分流**：内置 AI 助手 (ChatGPT/Claude/Gemini)、流媒体 (YouTube/Netflix/Disney+)、游戏平台 (Steam/Epic)、社交与学术等丰富分流规则。
- 🗡️ **DAG 级联空组剪枝**：基于有向无环图深度遍历，节点为空的策略组自动级联淘汰，关联分流规则自动级联注销，防范内核空策略组报错与黑洞路由风险。
- 📊 **彩色状态看板**：提取订阅头流量与到期时间，合成双列网格虚拟信息节点，面板内直观展示剩余流量、到期预警与重置倒计时。
- 🛡️ **安全与容灾防护**：SSRF 纵深拦截、交付契约白名单（订阅控制面字段不进入产物）、DNS 净化沙箱与 INV 不变式自检；内置 Stale 容灾兜底缓存（网络抖动时平滑复用上次成功数据，保障节点平稳可用）。
- 🔤 **简繁中文四路同步**：繁体节点名全链路自动识别，节点名、策略组名、组内引用、路由规则四路简繁严格统一。

---

## 🎯 三大交付形态

系统聚焦三种标准的最终交付物，通过 `-m, --mode` 参数或配置项 `outputMode` 自由切换：

| 交付模式 (`-m`) | 输出交付物 | 核心契约与行为 | 典型场景 |
| :--- | :--- | :--- | :--- |
| **`config`**<br>*(默认全量交付)* | **完整即用型 Mihomo 配置** | 全链路流水线：洗节点 ➔ 状态看板 ➔ 策略组拓扑 ➔ 分流规则 ➔ 内核优化。自动执行节点专属 DNS 资产依赖保活，宿主控制面保持纯净。 | 直接提供给内核、软路由或客户端使用。 |
| **`nodes`** | **纯净清洗节点列表** | 契约明确规范：**仅交付清洗后的 `{ proxies: [...] }` 列表**，不输出任何策略组或外围规则。 | 导入 Sub-Store、节点池二次加工。 |
| **`report`** | **健康审计与统计报告 (JSON)** | 输出结构化审计统计（总数、有效保留数、去重数、广告拦截数、未知地区数）与健康元数据。 | CI/CD 自动化质检、订阅节点健康度监控。 |

---

## 🚀 快速开始与使用指南

### 1. 终端命令行 (CLI)

适合本地快速转换、计划任务或 CI/CD 自动化流水线。克隆仓库后即可直接运行：

```bash
git clone https://github.com/XiaoM-OVO/Mihomo-Toolkit.git && cd Mihomo-Toolkit
npm install
```

#### 命令行参数速查

```text
Usage: mihomo-toolkit [options]
       mihomo-toolkit list [domain] [--json]
       mihomo-toolkit --explain [-c config.yaml] [--json]

Commands:
  list [domain]        只读列出当前配置下可引用的对象（域: refs | presets | macros | pools | services）

Options:
  -V, --version        输出版本号
  -u, --url <url>      订阅链接或本地配置文件路径 (若 config 中已有 subscriptions 则可省略)
  -o, --out <path>     输出文件路径 (默认: config.yaml / nodes.yaml / report.json)
  -m, --mode <mode>    交付输出模式: "config" (默认), "nodes" (纯节点), 或 "report" (审计报告)
  -c, --config <path>  指定自定义 YAML/JSON 配置文件
  -r, --report <path>  在生成配置的同时，顺手将审计报告另存为指定 JSON 文件
  --dry-run            诊断模式：完整校验配置语法、订阅连通性与 DNS 不变式，绝不落盘
  --validate           同 --dry-run（仅校验不落盘）
  --explain            只读激活摘要：输出组 / 规则 / 池的「激活 / 跳过 / 剪枝 / 为空」及原因，不落盘
  --json               与 --explain 配合：以 JSON 输出摘要（固定契约，可用于回归基线）
  --prod               生产环境模式 (开启严格安全锁，强制禁止敏感凭据明文打印)
  --debug              开启详细调试日志 (展示 fetch 过程及中间状态)
  -q, --quiet          关闭日志输出（同 --silent）
  --silent             关闭全部日志输出
  --log-level <level>  显式日志级别: silent | error | warn | info | debug
  -h, --help           显示帮助信息

List options:
  --json               以 JSON 输出 list 结果，便于脚本消费
  -c, --config <path>  同主命令；refs / pools / services 按该配置投影
```

#### 常用命令范例

```bash
# 场景 1：拉取订阅并生成完整分流配置
node src/targets/cli.js -u "https://airport.com/sub" -o config.yaml

# 场景 2：根据本地 config.yaml 统一配置多订阅并编译
npm run build

# 场景 3：纯节点提纯模式（Sub-Store 等二次加工专用）
node src/targets/cli.js -u "https://airport.com/sub" -m nodes -o nodes.yaml

# 场景 4：生成分流配置的同时，顺手导出一份健康质检报告
node src/targets/cli.js -u "https://airport.com/sub" -r report.json

# 场景 5：查询当前配置下可引用的组 / 预设 / 宏 / 池 / 服务
node src/targets/cli.js list refs
node src/targets/cli.js list services -c config.yaml

# 场景 6：排查「配了不生效 / 被剪了不知道」——只读激活摘要（不落盘）
node src/targets/cli.js --explain -c config.yaml
node src/targets/cli.js --explain --json -c config.yaml > explain.json

# 场景 7：结构化输出，交给脚本消费
node src/targets/cli.js list pools --json -c config.yaml
```

`list` 的 `--json` 输出契约固定为 `{ domain, configLoaded, count, items }`（`configLoaded` 表示是否通过 `-c` 加载了用户配置；`presets` / `macros` 是静态事实，不随配置变化）。各域字段：
- `refs`：`ref` / `name` / `type` / `kind`（`aggregate` 聚合组、`standalone` 可独立引用）/ `hidden` / `status`（`active` / `disabled`）
- `presets`：`preset` / `label` / `kind` / `registry`
- `macros`：`macro` / `aliases`
- `pools`：`pool` / `status`（`active` / `inactive`）/ `activation`（`always` 恒在、`onDemand` 按需）/ `hidden` / `isolate` / `builtin` / `gate`（未启用时给出开关名）/ `match`
- `services`：`service` / `name` / `category` / `hidden` / `refStatus`（`direct` 可独立引用、`aggregate-member` 聚合成员、`none` 仅可作 service 引用）/ `ref` / `memberOf`

`--explain --json` 的输出契约固定为 `{ version, counts, records }`：`counts` 为状态 / 类型计数，`records` 每条含 `kind`（`group` / `rule` / `pool` / `provider`）、`id`、`status`（`active` 激活、`skipped` 跳过、`pruned` 剪枝、`empty` 为空）、`code`（原因码）与 `detail`（人话说明），组 / 池可附带 `members`。`code` 是回归基线断言用的稳定字段，`detail` 允许增补措辞但不改变语义。

---

### 2. 常驻 HTTP 订阅服务

将 Mihomo-Toolkit 部署为私有订阅转换 API 服务，支持实时拉取、自动缓存与鉴权。

#### 部署方式 A：Docker 容器化部署（推荐）

仓库内置了轻量基于 Alpine 的 Dockerfile 与 `docker-compose.yml`：

```bash
# 1. 准备本地配置文件
cp config.example.yaml config.yaml

# 2. 一键启动容器（映射 3000 端口，包含自动健康检查）
docker compose up -d
```

> **生产环境安全建议**：把端口映射改为 `127.0.0.1:3000:3000`，由本机 Nginx / Caddy 反代对外；若必须直接暴露到公网，请务必同时配置 `authToken` 与 `allowedHosts`。`docker-compose.yml` 中已给出对应注释示例。

#### 部署方式 B：Node.js 本地/服务器直接启动

```bash
# 启动本地服务（默认监听 127.0.0.1:3000，自动读取根目录 config.yaml）
npm start

# 或通过环境变量自定义监听与配置
HOST=0.0.0.0 PORT=8080 CONFIG_PATH=/path/to/my-config.yaml AUTH_TOKEN=your-token npm start
```

启动后即可在客户端直接订阅：`http://127.0.0.1:3000/sub`。

#### 服务端安全姿态与配额

| 监听场景 | 安全行为与访问控制 |
| :--- | :--- |
| **监听 `127.0.0.1`（默认）** | 仅本机可访问，动态参数 `?url=` 与 `?config=` 入口开放可用 |
| **监听非回环地址（如 `0.0.0.0`）且未配置 `authToken`** | **fail-closed**：自动拒绝 `?url=` / `?config=` 参数请求（返回 403）；无参数的 `/sub`（走本地 `config.yaml` 订阅清单）仍可访问 |
| **监听非回环地址且配置了 `authToken`** | 参数入口放行，但所有 `/sub` 请求必须携带 `?token=xxx` 或 `Authorization: Bearer xxx` |
| **请求 `Host` 与 `allowedHosts`** | 未配置 `allowedHosts` 且监听非回环地址时，未鉴权请求的 `Host` 不参与 `subDomain` 直连推导（fail-closed，防缓存投毒与缓存膨胀）；已通过 `authToken` 鉴权的请求仍按 `Host` 自动嗅探。配置后仅命中规则的 Host 生效，`*.example.com` 与 `+.example.com` 均为 DOMAIN-SUFFIX 语义（含裸域与任意级子域） |
| **来源 IP 与 `trustedProxies`** | 仅当直连地址命中 `trustedProxies`（精确 IP / CIDR）时才采信 `X-Forwarded-For`，并从右向左跳过受信代理取真实客户端；未配置时一律使用直连地址，伪造转发头不会污染日志与限流判断 |
| **`?config=` 传入的远程配置** | 视为**不可信输入**：仅允许引用 http(s) 订阅源，且 DNS 控制面与本地资源类字段会被强制剥夺 |

> **Token 传递方式**：`?token=xxx` 会随完整 URL 落入 nginx / Caddy / CDN 等反代的访问日志与浏览器历史，HTTPS 只保护传输过程。客户端支持自定义请求头时请改用 `Authorization: Bearer xxx`；只能走 URL 时，请在反代日志格式中屏蔽查询串（如 nginx 的 `log_format` 去掉 `$request` 中的 `$args`）。本服务自身日志始终将 token 脱敏为 `***`。

#### 接入方式选型

`authToken` 与 `allowedHosts` 是两个独立开关，按部署场景组合即可，无需同时开启：

| 部署场景 | 推荐组合 |
| :--- | :--- |
| 反代后面 + 已配置 `authToken` | 不必配置 `allowedHosts`：已鉴权请求仍按 `Host` 自动嗅探，保留订阅域名直连规则自适应 |
| 公网直接暴露 | `authToken` + `allowedHosts` 双保险：凭据控访问，白名单把 `Host` 收敛到已知域名，彻底消除缓存键放大 |
| 客户端只会填 URL（Clash Verge Rev / FlClash） | 只能 `?token=xxx`（两个 GUI 均不支持自定义 `Authorization` 头），并在反代日志格式中屏蔽查询串 |
| curl / 脚本 / sing-box 等可设请求头 | `Authorization: Bearer xxx`，避免 token 进入 URL、浏览器历史与反代日志 |

> **硬性资源配额**：单次最多 20 个订阅 URL、远程配置 ≤ 1MB、单订阅响应体 ≤ 8MB（流式截断）、单次构建节点总量 ≤ 5000、单订阅 ≤ 3000 节点、并发构建上限 8（超限返回 503）。

<details>
<summary><b>🔍 进阶机制：内存缓存 (SWR)、后台静默预热与防穿透</b></summary>

常驻服务提供基于 LRU 的 Profile 内存缓存，采用参考 [RFC 5861](https://www.rfc-editor.org/rfc/rfc5861.html) 的 `stale-while-revalidate` (SWR) 机制：

1. **缓存状态模型**：
   - **Fresh (`HIT`)**：缓存年龄 `age <= cacheTtl`（默认 300s），直接返回缓存，零构建开销。
   - **Stale (`STALE`)**：超出 `cacheTtl` 但未超过 `cacheStaleMaxAge`（默认 24h），优先返回已有快照，同时异步触发后台 Revalidate。
   - **Degraded（降级）**：本次结果存在失败/终态失效订阅但仍有可用节点时，照常发布缓存并标记 `degraded`；其新鲜期强制收紧到 60s，到期后转入 Stale 触发后台重试，避免部分失败结果被长时间冻结。
   - **Miss (`MISS`)**：无缓存或超过最大可用年龄，执行完整构建。
   - **Bypass (`BYPASS`)**：禁用缓存或有效强制刷新时旁路直通。
2. **多订阅独立容灾与退避**：
   - 单条订阅失败不会阻塞整体缓存写入；仅当**所有**已评估订阅均终态失效（401 / 到期 / 流量耗尽）时才淘汰 Profile 快照。
   - **单一时钟**：Profile 快照的失效时刻取 `cacheStaleMaxAge` 与「所有旧缓存兜底（stale）输入的最晚可用时刻」的最小值。订阅 LKG 到期后节点立即剔除并给出提示，不会再出现「快照还剩 19h、输入早已失效」的空窗。
   - **两级退避**：瞬时失败（超时 / 连接重置 / 5xx）按 30s → 60s → 2m → 4m → 8m（上限 10m）独立指数退避；终态失效（401 / 到期 / 流量耗尽）直接进入 6h → 12h → 24h 长冷却（封顶，±20% 抖动）。退避期内优先复用其旧缓存，无旧缓存则快速失败，不再拖慢整轮构建。
   - 显式 `?refresh=1` 会绕过单订阅退避以主动探测恢复；后台预热/定时刷新仍遵守退避。
3. **并发合并 (Single-Flight) 与代际保护**：
   - 合并同一缓存键下的并发构建请求，避免重复拉取与计算。
   - 单调递增 Generation 代际检查，防止较早启动的慢任务覆盖新代际的成功缓存。
   - 后台刷新未成功发布（无可用订阅）时采用指数退避（10s ~ 60s）限制重试频率，成功发布后立即清除。
4. **后台自动预热与定时刷新**：
   - `enableWarmup: true`：服务启动后异步**只拉取并缓存原始订阅内容**（L1 快照，按订阅 URL 共享）。此时尚无客户端 Host，`subDomain` 无法确定，组装出的产物必然作废，因此预热不组装、不发布产物；客户端首次请求会命中新鲜 L1，只做一次按该 Host 的组装。
   - `autoRefreshInterval: 3600`：每隔 1 小时自动触发后台定时刷新（带防重叠锁，完整构建并按当前配置发布）。
   - **L1 原始订阅快照**的新鲜期复用 `cacheTtl`（默认 300s）；`?refresh=1` 与 `noCache` 会同时绕过 L1。
5. **强制穿透与冷却防护**：
   - 请求携带 `?refresh=1` 或 `?force=1` 时可强制回源刷新。
   - `refreshCooldown: 15`：默认 15 秒冷却时间，防范恶意频繁回源击穿源站。

> `/healthz` 的 `subscriptions` 字段会聚合输出 `degraded`、`usableSubCount`、`failedSubCount`、`staleSubCount` 等状态，便于监控部分订阅失效。

*注：该缓存仅保存在进程内存中，服务重启不持久化。*
</details>

---

### 3. 客户端无缝集成

#### 与 Clash Verge Rev 搭配使用

按设备条件二选一；两者输出规格一致，只是执行位置不同：

1. **本地订阅方式（推荐）**：启动 `npm start` 常驻服务，在 Clash Verge Rev 中添加新订阅为 `http://127.0.0.1:3000/sub`，完全当做普通远程订阅使用。
2. **计划任务直写配置**：在 `config.yaml` 中将 `output` 路径指向 Verge 的 profiles 目录，通过系统计划任务（Windows Task Scheduler / Cron）定时执行 `node src/targets/cli.js -c config.yaml` 自动写入。

> 若不想引入运行环境与常驻进程，可直接使用下节的[自包含单文件脚本](#4-自包含单文件脚本免部署)；代价是脚本在客户端沙箱内执行，设备性能较弱时编译超大单体会带来额外开销。

#### 与 Sub-Store 搭配使用

使用纯节点模式：`node src/targets/cli.js -u "订阅地址" -m nodes -o nodes.yaml`，生成的纯净代理数组可直接作为 Sub-Store 的本地/远程节点源进行聚合。

### 4. 自包含单文件脚本（免部署）

无需 Node.js 环境与 `npm install`：打开脚本链接复制全文（或使用 raw 链接），粘贴进客户端的「覆写 / 扩展脚本 / 节点操作」入口即可生效。三个脚本都是零依赖、独立自包含的 3.x 快照，与 `src/` 流水线并行维护、互不依赖。

| 脚本 | 适用场景 | 核心职责 |
| :--- | :--- | :--- |
| [standalone/src/mihomo-toolkit.js](standalone/src/mihomo-toolkit.js) | Mihomo 系客户端（Clash Verge Rev / FlClash 等）的扩展脚本 | 清洗、智能分流、策略组拓扑与图标组装的完整一体化交付 |
| [standalone/src/pure-nodes.js](standalone/src/pure-nodes.js) | Sub-Store / Surge / Loon / 浏览器等任意 JS 运行环境 | 纯节点处理：过滤、物理去重、重命名与多维排序 |
| [standalone/substore/sub-info.js](standalone/substore/sub-info.js) | Sub-Store「节点操作 → 脚本操作」 | 订阅流量与到期信息节点的提取、计算与置顶 |

> 定位说明与各脚本的完整配置项，请参阅 [谱系与取代边界](docs/history/v4-boundary.md)；这些脚本不参与 `src/` 的分层校验与单元测试，由 `npm run verify:standalone` 保证「语法可解析、无相对路径依赖」两条底线，属于冻结维护的独立资产。

---

## ⚙️ 配置详解 (`config.yaml`)

> 📖 **需要更深入地了解各个参数？**  
> 请查阅全新编写的 **[📘 配置全景字典与参数指南 (CONFIGURATION.md)](CONFIGURATION.md)**，涵盖 15 大分类、100+ 个参数的逐项破译、声明式策略组 DSL (`groups`) 与分流表 (`routing`) 的分工、DNS 依赖闭包 (`assetClosure`) 以及高可用容灾实战配方！

系统采用**完全扁平化设计**，无需理解复杂的嵌套结构，所有核心参数均在根级声明。完整配置模板请参阅 [`config.example.yaml`](config.example.yaml)：

> 下方示例中的未注释项是**推荐取值**，不等于字段默认值；字段默认值以 [CONFIGURATION.md](CONFIGURATION.md) 与 `src/data/field-registry.js` 为准。

```yaml
# 1. 交付形态与输出
outputMode: "config"            # config (完整配置) | nodes (纯节点) | report (审计报告)
output: "./dist/config.yaml"    # 输出路径

# 2. 拉取与容灾
# fetchProxyPort: 7890          # 本地拉取代理端口（取消注释即启用；留空=直连）
fetchProxyStrategy: "auto"      # direct (直连) | proxy (代理) | auto (失败自动走代理重试)；同时决定节点裂变 DoH 兜底的出口
fetchRetry: 2                   # 失败重试次数 (5xx/超时重试，4xx快速失败)
fetchStaleTtl: 24               # 网络故障时复用旧缓存兜底时长 (小时)
expireCutoffHours: 24           # 到期前 N 小时判定已停用 (默认 24，即到期时刻前 24h；0=关闭)
timezone: "local"               # 看板日期时区 (IANA 名称如 Asia/Shanghai；local=跟随系统)

# 3. 订阅清单 (支持多订阅并发聚合)
subscriptions:
  - url: "https://example.com/sub1"
    tag: "订阅A"
    # indexPrefix: "A"          # 编号前缀 (如 A01/B01)
    # resetDay: 19              # 每月固定重置流量日期
  - url: "https://example.com/sub2"
    tag: "订阅B"

# 4. 节点清洗与重命名
enableDedupe: true               # 开启底层物理指纹去重
enableNodeSort: true             # 开启节点多维智能排序 (按大区、隔离分类、线路质量、倍率升序排布)
enableNodeRename: true           # 节点重命名开关 (设为 false 原样保留节点名，不影响地区识别)
showFeatureIcon: true            # 是否追加 🚀/4K 等特征 Emoji
removeInfoNodes: true            # 自动剔除订阅原生流量假节点 (避免与合成看板冲突)

# 5. 策略组与分流
coreRegions:                     # 主力免折叠大区清单 (低于阈值也保证独立建组)
  - "cn"
  - "hk"
  - "tw"
  - "jp"
  - "kr"
  - "sg"
  - "us"
routing:                          # 分流表：顺序即优先级，表里没有的分类不会建组
  - preset: subscription
  - service: ad-block
  - preset: ai                    # 独立 ChatGPT / Claude / Gemini 策略组
  - preset: streaming             # 独立 Netflix / YouTube / Disney+ 策略组
  - preset: game                  # 独立游戏平台策略组
  - preset: dev
  - service: telegram
  - preset: system
  - preset: bt
  - preset: download
  - preset: domestic
  - preset: final
enableIsolation: true            # 开启节点隔离池（家宽 / 高倍率 / 实验），隔离成员从地区池剔除

# 6. 内核优化
overwriteDns: true               # 注入 Fake-IP / DoH 防泄漏 DNS
overwriteTun: true               # 注入 TUN 虚拟网卡配置
enableCoreOptimize: true         # 开启客户端指纹伪装与 TCP 并发优化
```

---

## 🔐 安全模型与信任边界

本工具遵循「最小特权」原则，将外部输入严格区分为不同信任等级进行分级管控：

### 信任分级

| 输入来源 | 信任级 | 处理原则与能力边界 |
| :--- | :--- | :--- |
| `config.yaml` / `-c` 指定的本地配置 | **可信** | 可声明 DNS 控制面、本机资源路径与策略编排偏好 |
| CLI `-u <本地文件>` | **可信**（本机操作者显式指定） | 具备与本地配置文件相同的功能权限 |
| 机场订阅源（远程 URL / 内联 `uri`） | **不可信** | 仅提取节点数据面；控制面字段与未知属性自动剥离 |
| 服务端 `?config=<远程URL>` | **不可信** | 仅放行基础策略编排偏好；DNS 控制面、本机文件与资源类字段自动剥离 |

### 核心安全防护机制

1. **交付契约白名单**（`src/core/security/control-plane.js`）：产物顶层键采用白名单收口机制，防范订阅源携带的 `external-controller`、`secret`、`hosts` 等控制面字段污染最终产物。
2. **控制面净化与资产闭包**（`src/pipeline/ingestion.js` + `src/core/security/dns-sanitizer.js`）：剥离非节点控制字段的同时，自动识别并继承节点服务器专用的 Hosts 映射与私有 DoH 解析策略，兼顾安全性与节点连通性。
3. **DNS 净化与不变式自检**（`src/strategy/dns.js` + `src/core/security/resolver-plan.js`）：引导层 DNS 纯 IP 化，过滤高危修饰符；交付前执行 INV 不变式自检，降低 Fake-IP 虚拟环路与解析异常风险。
4. **远程配置白名单收敛**（`src/core/security/remote-config.js`）：对 `?config=` 输入实施 fail-closed 白名单过滤，仅放行明确允许的安全字段，限制对宿主机资源的访问。
5. **SSRF 与资源配额防御**（`src/io/ssrf.js` / `src/io/pinned-agent.js` / `src/io/fetcher.js` / `src/io/limits.js`）：包含私网网段拦截、直连建连期 IP Pinning、重定向逐跳复核、响应体流式限长与单次构建节点配额限制，缓解网络探测与资源消耗风险。

> 📖 **进阶架构与威胁模型**：关于系统分层契约、安全沙箱算法及残余风险评估的完整技术推演，请参阅 [架构设计文档](ARCHITECTURE.md)。

---

## 🏗️ 系统架构与分层导览

本项目遵循现代洋葱分层架构（Onion Architecture）设计，将高频纯计算核心与底层 I/O 副作用隔离，自顶向下划分为 8 个逻辑层级：

| 逻辑层级 | 源码目录 | 核心职责与边界契约 |
| :--- | :--- | :--- |
| **Layer 1: Targets** | `src/targets/` | 宿主环境终端适配（CLI 命令行工具、常驻 HTTP 订阅服务、Token 鉴权） |
| **Layer 2: Pipeline** | `src/pipeline/` | 交付流水线总调度编排（生命周期早退、按 `outputMode` 截断、并发单飞） |
| **Layer 3: Strategy** | `src/strategy/` | 策略拓扑与规则组装（地区折叠、DAG 空组剪枝、Fake-IP/DNS 与内核优化） |
| **Layer 4: Core** | `src/core/` | 纯计算核心算法（物理网络指纹去重、属性打标、意图重命名、简繁四路同步） |
| **Layer 5: IO** | `src/io/` | 外部世界通信边界（唯一允许副作用底层：HTTP 拉取、SSRF 拦截、多协议解析） |
| **Layer 6: Config** | `src/config/` | 配置装载与合并（`resolveConfig` 求解器、服务编目 SSOT、配置片段挂载） |
| **Layer 7: Data** | `src/data/` | 只读运行基础基线（字段注册表 SSOT、不可变安全基线、清洗规则词库） |
| **Layer 8: Infra** | `src/infra/` | 基础设施无状态基元（IP/CIDR 校验、FQDN 判定、订阅元信息流量换算纯函数） |

> 📖 **完整文件树与拓扑推演**：关于全仓 97 个源文件的详细物理映射、调用拓扑、算法机理及已知技术债务，请详阅 [架构设计文档](ARCHITECTURE.md)。

---

## 🗺️ 开发路线与演进规划

本项目采用“稳定性先行、大动作新功能排后”的务实演进路线，划分为 4 个推进阶段：

- 🟢 **Milestone 1 (v2.0-Alpha)**：已闭环 —— 稳定性加固与核心债务清零（优先级倒挂、SSRF 穿透、IO 反向依赖、协议截断）；
- 🟡 **Milestone 2 (v2.0-Beta)**：已闭环 —— 优雅停机、DNS 并发流控、CLI `--dry-run` / `--validate`；
- 🔵 **Milestone 3 (v4.0.0-alpha)**：已闭环 —— 声明式策略拓扑 DSL 收口（`groups` + `routing` 两表、方向限定）、配置解耦与直连建连期 IP Pinning；
- 🟣 **Milestone 4 (v4.0-GA)**：正式发版 —— main 合流、默认产物基线锁定与迁移说明（不再扩展新功能面）。

> 📋 **详细任务跟踪**：47 项审查排查出的技术债务明细见 [技术债务归档](docs/history/debt-resolved.md)，里程碑规划见 [开发路线图](ROADMAP.md)；历史决策与实施记录见 [docs/ 索引](docs/README.md)。

---

## ❓ 常见问题 (FAQ)

<details>
<summary><b>Q: 我只想保留订阅原本给我的节点名字，不想被脚本改名，但又想用策略组分流，怎么配？</b></summary>

只需在 `config.yaml` 中配置 `enableNodeRename: false` 即可！
底层的地区识别、倍率提取、线路特征分析依然会照常运行并精准把节点送入对应的策略组，原样保留原始节点名称。
</details>

<details>
<summary><b>Q: 为什么我拉取订阅时偶尔报错 403 / 502，但节点没有消失？</b></summary>

这是本系统的 **Stale 容灾兜底机制**在生效。当远程订阅网络抖动或超时时，系统会自动重试；若依然失败，会自动激活最近一次成功拉取的本地缓存快照（默认保留 24h），并在控制台打印告警，保障订阅抖动时节点配置持续可用。
</details>

<details>
<summary><b>Q: 为什么产物里看不到订阅原本的 <code>log-level</code> / <code>mode</code> / <code>dns</code> / <code>hosts</code> 等顶层字段了？</b></summary>

这是**交付契约白名单**在生效（安全设计，非 Bug）。`config` 交付形态的产物顶层键只能由本工具生成，
订阅携带的任何控制面字段都会被剥离并在日志中报告（`🛡️ 交付契约：已剥离 N 个非工具自有顶层字段`）。
需要额外字段时请在本地 `config.yaml` 中用对应功能开关声明（如 `enableIPv6`、`logLevel`、`dnsDirect`、`hosts`），
本地配置属于可信来源，具备完整能力。
</details>

<details>
<summary><b>Q: 我把服务监听到 0.0.0.0 之后，<code>?url=</code> 参数返回 403？</b></summary>

这是**默认安全（fail-closed）**行为：常驻服务具备「发起外部请求 + 读取本地订阅文件」的能力，
暴露到非回环地址且没有鉴权时，任何人都会得到一个开放订阅中继。此时必须配置 `authToken`
（`AUTH_TOKEN` 环境变量或 `config.yaml` 中的 `authToken`）才会放行参数化请求。
</details>

<details>
<summary><b>Q: 如何在 Clash Verge Rev 中使用？</b></summary>

推荐直接在后台常驻服务中运行 `npm start`，然后在 Clash Verge Rev 中将订阅链接设置为 `http://127.0.0.1:3000/sub`；或者通过计划任务定时执行 `node src/targets/cli.js -c config.yaml` 直接生成写入 Verge 的配置 profile 路径，客户端零计算负担。
</details>

---

## 📜 鸣谢与声明

### 🙏 鸣谢

- 基础内核：[Mihomo](https://github.com/MetaCubeX/mihomo)
- 规则集：[meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) & [anti-AD](https://github.com/privacy-protection-tools/anti-AD)
- 图标库：[Orz-3/mini](https://github.com/Orz-3/mini) & [Koolson/Qure](https://github.com/Koolson/Qure) & [lige47/lige_icon](https://github.com/lige47/lige_icon)
- 简繁转换：[opencc-js](https://github.com/nk2028/opencc-js)
- **AI 协同**：由本人架构与拍板，Gemini 负责主体编码，DeepSeek 参与代码审查与重构建议，多轮迭代打磨而成。

### ⚠️ 免责声明

1. 本项目提供的代码、脚本与配置仅供**个人进行计算机网络调试、路由规则学习与研究网络连通性架构**使用。
2. 请严格遵守您所在国家及地区的法律法规，**严禁将本项目用于任何非法或违反当地法律的用途**。
3. 因使用本项目所产生的任何直接或间接后果，**均由使用者本人自行承担**。作者及贡献者不承担任何技术或法律连带责任。
4. 本项目仅为代码工具，**不提供任何形式的代理服务**，也不涉及任何网络节点的售卖、分发与推广。

### 📄 开源协议

本项目基于 [MIT License](LICENSE) 许可协议开源。
