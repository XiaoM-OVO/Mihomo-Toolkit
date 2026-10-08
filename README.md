<div align="center">

# 🛠️ Mihomo-Toolkit

**一套为 Mihomo 内核生态设计的高性能自动化节点清洗与动态策略组构建引擎**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Mihomo](https://img.shields.io/badge/Core-Mihomo-orange)](https://github.com/MetaCubeX/mihomo)
[![Version](https://img.shields.io/badge/Version-v2.0.0--dev-9cf)](https://github.com/XiaoM-OVO/Mihomo-Toolkit/releases)
[![Tests](https://img.shields.io/badge/Tests-211%20Passed-brightgreen)](test/)

「 **自动清洗 · 物理去重 · 动态拓扑 · 容灾兜底 · 零维护** 」

> ⚠️ **开发中版本 · `v2.0.0-dev`**：本项目尚未发布正式版，接口与配置可能随时调整，暂不建议用于生产环境。

</div>

---

## 📌 快速导航

- [📂 项目结构](#-项目结构)
- [✨ 核心特性](#-核心特性)
- [🚀 快速开始](#-快速开始)
- [🎯 三大交付形态](#-三大交付形态)
- [🖥️ 详细部署指南](#️-详细部署指南)
- [⚙️ 配置详解](#️-配置详解)
- [🏗️ 系统架构白皮书](ARCHITECTURE.md)
- [❓ 常见问题](#-常见问题)

---

## 📂 项目结构

```text
mihomo-toolkit/
├── 🧠 src/                     # 核心引擎源码
│   ├── index.js               # 🌟 全库唯一顶层门面 (Facade)，导出完整公共 API
│   │
│   ├── pipeline/              # 🚀 交付流水线 (与交付形态 1:1 映射)
│   │   ├── engine.js          # 全流程总调度引擎 (生命周期早退与 Checkpoint 截断)
│   │   ├── config.js          # 完整配置装配流水线
│   │   ├── nodes.js           # 纯净节点清洗流水线 (去重/打标/重命名)
│   │   ├── report.js          # 健康审计报告流水线 (生成结构化 JSON)
│   │   └── strategy.js        # 策略拓扑与分流规则注入流水线
│   │
│   ├── targets/               # 🔌 宿主环境终端适配器 (轻量适配层)
│   │   ├── cli.js             # 命令行工具 (mihomo-toolkit)
│   │   └── server.js          # 常驻 HTTP 订阅服务 (/sub, /healthz, 鉴权)
│   │
│   ├── core/                  # 🧮 节点清洗核心算法层 (Pure & Deterministic)
│   │   ├── cleaner.js         # 垃圾拦截、倍率线路提取、属性智能分类打标
│   │   ├── dedupe.js          # 底层物理网络指纹提取与特征去重
│   │   ├── transport.js       # 统一传输层门面 (Host/SNI/Path提取、Host注入与协议识别)
│   │   ├── geo.js             # 地区智能正则匹配与落地城市精准提取
│   │   ├── rename.js          # 模板变量解析、Emoji 注入与悬空分隔符安全擦除
│   │   ├── fission.js         # 域名并发 DNS 解析与多 IP 独立节点裂变增殖
│   │   ├── chinese-convert.js # 简繁中文递归转换与无依赖回退降级
│   │   ├── chinese-sync.js    # 节点名/策略组名/成员引用/分流规则四路简繁同步
│   │   └── shared/            # 地区大区字典表 (regions.js) 与 图标字典 (icons.js)
│   │
│   ├── strategy/              # 🌐 策略组拓扑与内核优化层
│   │   ├── dashboard.js       # 看板合成、多订阅流量与到期聚合中心
│   │   ├── topology.js        # 六维服务大区折叠与动态测速策略组装配
│   │   ├── rules.js           # 规则集 (Rule-Providers) 与分流路由组装
│   │   ├── registries.js      # 六维服务注册表管理模块 (委托至 config/catalog)
│   │   ├── prune.js           # DAG 递归空组级联淘汰与殉葬规则清理
│   │   ├── presentation.js    # 展示层终末装配器 (按 groupIconMode 统一挂载在线图标与赋予徽标)
│   │   ├── dns.js             # Fake-IP / DoH 防泄漏 DNS 方案覆写注入
│   │   └── kernel.js          # TUN 网卡、Sniffer 嗅探器及内核性能调优
│   │
│   ├── io/                    # 📡 外部世界通信层 (唯一允许副作用的底层)
│   │   ├── fetcher.js         # 安全 HTTP 抓取调度与 Stale 容灾兜底缓存
│   │   ├── sub-processor.js   # 多订阅并发抓取、URI 分流、单订阅说明过滤与树状日志
│   │   ├── cache.js           # 内存级 LRU-TTL 缓存管理器 (带 MAX_ENTRIES 防泄漏)
│   │   ├── ssrf.js            # SSRF 深度校验、私网拦截与 Token 脱敏
│   │   ├── limits.js          # 资源超限拦截 (URL 上限、配置大小、节点总数防御)
│   │   ├── fetch-proxy.js     # 本地代理调度封装 (undici ProxyAgent)
│   │   └── parsers/           # Vless / VMess / Trojan / Shadowsocks / YAML 全格式解析器
│   │
│   ├── config/                # ⚙️ 配置策略层 (操作者改什么)
│   │   ├── defaults.js        # 出厂默认配置（由只读数据层的字段注册表派生）
│   │   ├── catalog.js         # 🌟 领域服务编目 (SSOT)、六维内置基准与增量深度合并引擎
│   │   ├── include.js         # 通用配置片段挂载 include（主文件优先 / 递归 / 环路防护）
│   │   └── index.js           # resolveConfig 合并器（注册表驱动的只增不减基线合并）
│   │
│   └── data/                  # 📦 只读运行基础层 (程序所有 / 用户只读，最底层)
│       ├── field-registry.js  # 字段注册表 SSOT：有哪些字段 / 默认值 / 合并语义 / 信任级
│       └── security-baselines.js # 安全基线词典：受保护域名、骨架豁免组、fake-ip-filter 保底名单
│
├── test/                      # 🧪 自动化测试套件 (211 个全绿用例)
├── config.example.yaml        # 极简扁平化配置模板
├── index.d.ts                 # 完整 TypeScript 类型契约声明
├── package.json               # 项目依赖与多命令配置
└── ARCHITECTURE.md            # 系统架构设计白皮书
```

---

## ✨ 核心特性

- 🧹 **节点深度清洗**：基于底层物理网络特征指纹（Fingerprint）精准去重，自动剔除引流广告，提取倍率、线路与落地城市，多订阅来源智能打标。
- 🌍 **动态大区折叠**：热门地区自动独立建组测速，小众冷门节点动态折叠归入大洲组，避免数十个单节点策略组刷屏。
- 🔀 **开箱即用分流**：内置 AI 助手 (ChatGPT/Claude/Gemini)、流媒体 (YouTube/Netflix/Disney+)、游戏平台 (Steam/Epic)、社交与学术等分流体系。
- 🗡️ **DAG 级联空组剪枝**：基于有向无环图深度遍历，节点为空的策略组自动级联淘汰，关联分流规则自动殉葬注销，彻底杜绝内核崩溃与黑洞路由。
- 📊 **彩色状态看板**：提取订阅头流量与到期时间，合成双列网格虚拟信息节点，面板内直观展示剩余流量、到期预警与重置倒计时。
- 🛡️ **生产级安全与容灾**：SSRF 纵深拦截（含逐跳重定向校验与响应限长）、交付契约白名单（订阅控制面字段绝不进入产物）、DNS 净化沙箱与 INV 不变式自检，自带 Stale 容灾兜底缓存（网络抖动时平滑复用上次成功数据，节点绝不掉线）。
- 🔤 **简繁中文四路同步**：繁体节点名全链路自动识别，节点名、策略组名、组内引用、路由规则四路简繁严格统一。

---

## 🚀 快速开始

### 方式一：终端命令行（推荐本地与 CI/CD 自动化）

无需全局安装，克隆后直接用项目入口运行：

```bash
git clone https://github.com/XiaoM-OVO/Mihomo-Toolkit.git && cd Mihomo-Toolkit
npm install

# 1. 直接拉取订阅，生成完整 Mihomo 配置文件
node src/targets/cli.js -u "https://example.com/sub.yaml" -o config.yaml

# 2. 或者使用 config.yaml 统一管理多订阅与高级规则
npm run build
```

### 方式二：常驻 HTTP 订阅服务（适合自建 VPS 或局域网）

将 Mihomo-Toolkit 部署为私有订阅转换 API：

#### 1. Docker 容器化部署（VPS 推荐）

仓库已内置开箱即用的轻量 Alpine Dockerfile 与 `docker-compose.yml`：

```bash
# 准备配置文件
cp config.example.yaml config.yaml

# 启动容器（映射本地 3000 端口，含自动健康检查）
docker compose up -d
```

#### 2. Node.js 本地直接启动

```bash
# 启动本地服务（默认 127.0.0.1:3000，自动读取根目录 config.yaml）
npm start

# 或自定义监听与配置文件
HOST=0.0.0.0 PORT=8080 CONFIG_PATH=/path/to/my-config.yaml AUTH_TOKEN=your-token npm start
```

启动后即可在客户端直接订阅：`http://127.0.0.1:3000/sub`。

**⚠️ 服务端安全姿态（务必阅读）**

| 场景 | 行为 |
| :--- | :--- |
| 默认监听 `127.0.0.1` | 仅本机可访问，`?url=` / `?config=` 参数可用 |
| 监听非回环地址（如 `HOST=0.0.0.0`）**且未配置 `authToken`** | **fail-closed**：自动拒绝 `?url=` / `?config=` 参数请求（返回 403），无参数的 `/sub`（走本地 config.yaml 订阅清单）仍可用 |
| 监听非回环地址且已配置 `authToken` | 参数入口放行，但所有 `/sub` 请求必须携带 `?token=xxx` 或 `Authorization: Bearer xxx` |
| `?config=` 拉取的远程配置 | 视为**不可信输入**：仅允许引用 http(s) 订阅源，且 DNS 控制面与本地资源类字段会被剥夺（见下文安全模型） |

其余硬性限制：单次最多 20 个订阅 URL、远程配置 ≤ 1MB、单订阅响应体 ≤ 8MB（流式截断）、单次构建节点总量 ≤ 5000、单订阅 ≤ 3000 节点、并发构建上限 8（超出返回 503）。

#### 3. 内存缓存、后台静默预热与强制刷新

常驻服务模式内置高性能 LRU-TTL 内存缓存，带来零延迟响应与上游容灾保活：

- ⚡ **极速响应**：日常客户端拉取直接命中内存缓存，平均响应时间 < 20ms。
- 🔥 **后台自动预热 (Warm-up & Cron)**：
  - `enableWarmup: true`：服务启动即在后台异步执行首份配置抓取与洗白，首位请求用户无需等待。
  - `autoRefreshInterval: 3600`：设置后台定时轮询周期（秒），静默更新内存缓存；若抓取失败自动降级保留上一份有效缓存，客户端永不断流。
- 🔄 **强制穿透刷新 (`?refresh=1`)**：
  - 请求附带 `?refresh=1`（或 `?force=1`）可跳过读缓存，实时向远端拉取最新节点并同步覆写内存缓存。
  - **防爆盾冷却 (`refreshCooldown: 15`)**：在冷却期（默认 15 秒）内重复发起强制刷新将被安全拦截，直接秒回刚才生成的最新缓存，杜绝高频连击导致机场封禁 IP。

### 方式三：与 Clash Verge Rev 搭配使用

建议采用以下两种稳定方式之一，避免客户端沙箱编译超大单体脚本：
1. **本地订阅方式（推荐）**：启动 `npm start` 常驻服务，在 Clash Verge Rev 中添加新订阅为 `http://127.0.0.1:3000/sub`，完全当做普通远程订阅使用。
2. **计划任务直写配置**：在 `config.yaml` 中配置 `output` 路径指向 Verge 的 profiles 目录，通过系统计划任务（Windows Task Scheduler / Cron）定时执行 `node src/targets/cli.js -c config.yaml` 自动写入。

---

## 🎯 三大交付形态 (`-m, --mode`)

系统彻底摆脱了复杂的两阶段胶水，聚焦三种纯粹的最终交付物：

| 交付模式 (`-m`) | 输出交付物 | 核心契约与行为 | 典型场景 |
| :--- | :--- | :--- | :--- |
| **`config`**<br>*(默认全量交付)* | **完整即用型 Mihomo YAML 配置** | 默认全新组装：洗节点 ➔ 状态看板 ➔ 六维策略组 ➔ 分流规则 ➔ 内核优化一条龙。自动执行节点专属 DNS 资产依赖保活，宿主控制面保持纯净。 | 直接提供给内核、软路由或客户端使用。 |
| **`nodes`** | **纯净清洗节点数组** | 契约绝对纯粹：**仅交付洗白后的 `{ proxies: [...] }` 列表**，绝不越界输出任何策略组或外围规则。 | 导入 Sub-Store、节点池二次加工。 |
| **`report`** | **健康审计与统计报告 (JSON)** | 纯粹输出清洗统计（总数、有效保留、去重数、广告拦截数、未知地区数）与健康元数据。 | CI/CD 自动化质检、订阅节点质量监控。 |

---

## 🖥️ 详细命令行用法

```text
Usage: mihomo-toolkit [options]

Mihomo-Toolkit - 自动化节点清洗与策略组构建引擎

Options:
  -V, --version        输出版本号
  -u, --url <url>      订阅链接或本地配置文件路径 (若 config 中已有 subscriptions 则可省略)
  -o, --out <path>     输出文件路径 (默认: config.yaml / nodes.yaml / report.json)
  -m, --mode <mode>    交付输出模式: "config" (默认), "nodes" (纯节点), 或 "report" (审计报告)
  -c, --config <path>  指定自定义 YAML/JSON 配置文件
  -r, --report <path>  在生成配置的同时，顺手将审计报告另存为指定 JSON 文件
  --prod               生产环境模式 (开启严格安全锁，强制禁止敏感凭据明文打印)
  --debug              开启详细调试日志 (展示 fetch 过程及中间状态)
  -h, --help           显示帮助信息
```

### 常用命令范例：

```bash
# 1. 常用：拉取订阅并生成完整分流配置
node src/targets/cli.js -u "https://airport.com/sub" -o config.yaml

# 2. 提纯：只要干净的节点数组 (Sub-Store 专用)
node src/targets/cli.js -u "https://airport.com/sub" -m nodes -o nodes.yaml

# 3. 质检：导出节点健康度审计报告
node src/targets/cli.js -u "https://airport.com/sub" -m report -o audit.json

# 4. 生成配置的同时，顺便落一份审计报告
node src/targets/cli.js -u "https://airport.com/sub" -r report.json
```

---

## ⚙️ 配置详解 (`config.yaml`)

整个系统采用**完全扁平化设计**，没有复杂的嵌套作用域，所有开关直接在根级配置。完整配置模板请参考 [`config.example.yaml`](config.example.yaml)：

```yaml
# 1. 交付形态与输出
outputMode: "config"            # config (完整配置) | nodes (纯节点) | report (审计报告)
output: "./dist/config.yaml"    # 输出路径

# 2. 抓取与容灾
fetchProxyPort: 7890            # 抓取代理端口（留空直连）
fetchProxyStrategy: "auto"      # direct (直连) | proxy (代理) | auto (失败自动走代理重试)
fetchRetry: 2                   # 失败重试次数 (5xx/超时重试，4xx快速失败)
fetchStaleTtl: 24               # 网络故障时复用旧缓存兜底时长 (小时)

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
enableNodeRename: true           # 节点重命名开关 (设为 false 原样保留节点名，不影响地区识别)
showFeatureIcon: true            # 是否追加 🚀/4K 等特征 Emoji
removeInfoNodes: true            # 自动剔除订阅原生流量假节点 (避免与合成看板冲突)

# 5. 策略组与分流
enableAI: true                   # 独立 ChatGPT / Claude / Gemini 策略组
enableStreaming: true            # 独立 Netflix / YouTube / Disney+ 策略组
enableSocial: true               # 独立 Telegram / Twitter 策略组
enableGame: true                 # 独立游戏平台策略组
isolateHighMulti: true           # 大倍率节点专属隔离组 (防偷跑流量)

# 6. 内核优化
overwriteDns: true               # 注入 Fake-IP / DoH 防泄漏 DNS
overwriteTun: true               # 注入 TUN 虚拟网卡配置
enableCoreOptimize: true         # 开启客户端指纹伪装与 TCP 并发优化
```

---

## 🔐 安全模型与信任边界

本工具的核心前提是：**订阅是不可信的第三方输入**。因此所有外部输入都按「能力最小化」处理。

### 信任分级

| 输入来源 | 信任级 | 被允许的能力 |
| :--- | :--- | :--- |
| `config.yaml` / `-c` 指定的本地配置 | **可信** | 可声明 DNS 控制面、本机资源路径、策略编排偏好 |
| CLI `-u <本地文件>` | **可信**（本机操作者显式指定） | 同上 |
| 订阅源（远程 URL / 内联 `uri`） | **不可信** | 只能提供节点数据面；控制面字段一律剥离 |
| 服务端 `?config=<远程URL>` | **不可信** | 只能提供订阅源与策略编排偏好；DNS 控制面、本机资源、本地代理类字段被剥夺 |

### 不可信输入的处置机制

1. **交付契约白名单**（`src/core/security/control-plane.js`）
   `config` 模式的产物顶层键只能由本工具生成：生成前重置 + 交付前白名单收口，双重保证
   `external-controller` / `secret` / `script` / `tunnels` / `geox-url` / `hosts` 等字段
   既不会被订阅继承，也不会在关闭某个覆写开关时残留。
2. **控制面净化审计 + 资产闭包**（`src/io/sub-processor.js::applySubscriptionGuards`）
   多订阅与单 URL 两条路径共用同一套网关：审计并记录越权字段；只收编「指向自身节点资产域」的
   Hosts / Nameserver-Policy / Fake-IP-Filter 依赖，其余丢弃。闭包强度可用 `assetClosure` 调为
   `strict`（仅白名单域名）或 `off`（完全不继承）。
3. **DNS 净化沙箱与 INV 不变式**（`src/strategy/dns.js` + `src/core/security/dns-sanitizer.js`）
   引导层强制纯 IP、解析链剥离 `#skip-cert-verify` 等危险修饰符、私网与 fake-ip 自环地址拦截、
   `nameserver-policy` 保留键不可被订阅覆盖、`dns.listen` 非回环一律回退（需 `dnsAllowNonLoopback: true` 显式放行）。
   受保护域名基线（`github.com` / `paypal.com` / CA 与公共 DNS 等 60 余个域）覆盖「用户 hosts」与「节点资产闭包」
   两条独立通道；可用 `protectedDomains` **追加**自己的关键域名（只增不减，远程 `?config=` 无法写入）。
   config 交付前会执行 INV-1~INV-9 自检，违规项通过 `result.invariantViolations` 暴露并打印告警。
4. **远程配置能力剥夺**（`src/core/security/remote-config.js`）
   处理不可信配置的调用方可直接复用该纯函数；`buildProfile` 的 `userConfig` 参数按契约视为可信输入。
5. **SSRF 与资源限制**（`src/io/ssrf.js` / `src/io/fetcher.js` / `src/io/limits.js`）
   协议白名单、私网/回环/CGNAT/云元数据拦截、DNS 解析结果复核、重定向逐跳校验、
   响应体流式限长、订阅数/配置大小/节点总量/单订阅节点量配额、并发构建上限。

### 已知边界与残余风险（如实告知）

- **受保护域名清单是枚举式的**：`src/data/security-baselines.js` 覆盖常见高危域名，但不可能穷尽长尾。
  非清单内的域名，订阅只要能把自己的节点 `server` 指向该域名，就能为其下发 hosts 映射。
  处置：用 `protectedDomains` 追加自己的关键域名（只增不减），或 `assetClosure: strict` + `assetDomainAllowlist`，或 `assetClosure: off`。
- **SSRF 校验与实际连接之间存在 DNS 解析窗口**（TOCTOU / DNS Rebinding）：校验依赖系统解析器结果，
  未做 IP 固定（pinning）。对抗恶意 DNS 服务器时该窗口理论上可利用。
- **`?config=` 的能力剥夺是黑名单式**：清单外的「未来新控制面字段」不会被自动剥夺。
  公开部署建议直接 `enableUrlParams: false` 或强制 `authToken`。
- **DNS 出口修饰符策略分级**：订阅来源剥离全部危险修饰符；用户本地声明的解析链仅剥离
  `#skip-cert-verify` 等致命项，`#proxy` / `#h3` / `#interface` 保留并在审计中上报。

---

## ❓ 常见问题

<details>
<summary><b>Q: 我只想保留订阅原本给我的节点名字，不想被脚本改名，但又想用策略组分流，怎么配？</b></summary>

只需在 `config.yaml` 中配置 `enableNodeRename: false` 即可！
底层的地区识别、倍率提取、线路特征分析依然会照常运行并精准把节点送入对应的策略组，绝不破坏节点原名。
</details>

<details>
<summary><b>Q: 为什么我拉取订阅时偶尔报错 403 / 502，但节点没有消失？</b></summary>

这是本系统的 **Stale 容灾兜底机制**在生效。当远程订阅网络抖动或超时时，系统会自动重试；若依然失败，会自动激活最近一次成功抓取的本地缓存快照（默认保留 24h），并在控制台打印告警，保障你设备上的节点永远可用。
</details>

<details>
<summary><b>Q: 为什么产物里看不到订阅原本的 <code>log-level</code> / <code>mode</code> / <code>dns</code> / <code>hosts</code> 等顶层字段了？</b></summary>

这是**交付契约白名单**在生效（安全设计，非 Bug）。`config` 交付形态的产物顶层键只能由本工具生成，
订阅携带的任何控制面字段都会被剥离并在日志中报告（`🛡️ 交付契约: 已剥离 N 个非工具自有顶层字段`）。
需要额外字段时请在本地 `config.yaml` 中用对应功能开关声明（如 `enableIPv6`、`logLevel`、`dnsDirect`、`hosts`），
本地配置属于可信来源，具备完整能力。
</details>

<details>
<summary><b>Q: 我把服务监听到 0.0.0.0 之后，<code>?url=</code> 参数返回 403？</b></summary>

这是**默认安全（fail-closed）**行为：常驻服务具备「发起外部请求 + 读取本地订阅文件」的能力，
暴露到非回环地址且没有鉴权时，任何人都会得到一个开放订阅中继。此时必须配置 `authToken`
（`AUTH_TOKEN` 环境变量或 config.yaml 中的 `authToken`）才会放行参数化请求。
</details>

<details>
<summary><b>Q: 如何在 Clash Verge Rev 中使用？</b></summary>

推荐直接在后台常驻服务中运行 `npm start`，然后在 Clash Verge Rev 中将订阅链接设置为 `http://127.0.0.1:3000/sub`；或者通过计划任务定时执行 `node src/targets/cli.js -c config.yaml` 直接生成写入 Verge 的配置 profile 路径，客户端零计算负担。
</details>

---

## 🙏 鸣谢

- 基础内核：[Mihomo](https://github.com/MetaCubeX/mihomo)
- 规则集：[meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) & [anti-AD](https://github.com/privacy-protection-tools/anti-AD)
- 图标库：[Orz-3/mini](https://github.com/Orz-3/mini) & [Koolson/Qure](https://github.com/Koolson/Qure) & [lige47/lige_icon](https://github.com/lige47/lige_icon)
- 简繁转换：[opencc-js](https://github.com/nk2028/opencc-js)
- **AI 协同**：由本人架构与拍板，Gemini 负责主体编码，DeepSeek 参与代码审查与重构建议，多轮迭代打磨而成。

## ⚠️ 免责声明

1. 本项目提供的代码、脚本与配置仅供**个人进行计算机网络调试、路由规则学习与研究网络连通性架构**使用。
2. 请严格遵守您所在国家及地区的法律法规，**严禁将本项目用于任何非法或违反当地法律的用途**。
3. 因使用本项目所产生的任何直接或间接后果，**均由使用者本人自行承担**。作者及贡献者不承担任何技术或法律连带责任。
4. 本项目仅为代码工具，**不提供任何形式的代理服务**，也不涉及任何网络节点的售卖、分发与推广。

## 📜 开源协议

本项目基于 [MIT License](LICENSE) 许可协议开源。
