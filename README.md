<div align="center">

# 🛠️ Mihomo-Toolkit (MTK)

**一套为 Mihomo 内核生态设计的高性能自动化节点清洗与动态策略组构建引擎**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Mihomo](https://img.shields.io/badge/Core-Mihomo-orange)](https://github.com/MetaCubeX/mihomo)
[![Version](https://img.shields.io/badge/Version-v2.0.0--dev-9cf)](https://github.com/XiaoM-OVO/Mihomo-Toolkit/releases)
[![Tests](https://img.shields.io/badge/Tests-107%20Passed-brightgreen)](test/)

「 **自动清洗 · 物理去重 · 动态拓扑 · 容灾兜底 · 零维护** 」

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
│   │   ├── config.js          # 完整配置装配流水线 (支持 passthrough 透传)
│   │   ├── nodes.js           # 纯净节点清洗流水线 (去重/打标/重命名)
│   │   ├── report.js          # 健康审计报告流水线 (生成结构化 JSON)
│   │   ├── strategy.js        # 策略拓扑与分流规则注入流水线
│   │   └── index.js           # 流水线统一导出入口
│   │
│   ├── targets/               # 🔌 宿主环境终端适配器 (轻量适配层)
│   │   ├── cli.js             # 命令行工具 (mtk / mihomo-tk / mihomo-toolkit)
│   │   ├── server.js          # 常驻 HTTP 订阅服务 (/sub, /healthz, 鉴权)
│   │   ├── operator.js        # Sub-Store 节点操作目标
│   │   └── verge.js           # Clash Verge Rev 客户端扩展脚本目标
│   │
│   ├── core/                  # 🧮 节点清洗核心算法层 (Pure & Deterministic)
│   │   ├── cleaner.js         # 垃圾拦截、倍率线路提取、属性智能分类打标
│   │   ├── dedupe.js          # 底层物理网络指纹提取与特征去重
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
│   │   ├── registries.js      # 六维服务注册表向前兼容委托适配器 (委托至 config/catalog)
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
│   └── config/                # ⚙️ 配置中心 (单一事实来源 Source of Truth)
│       ├── defaults.js        # 系统内置全局默认配置字典
│       ├── catalog.js         # 🌟 领域服务编目 (SSOT)、六维内置基准与增量深度合并引擎
│       └── index.js           # resolveConfig 配置合并器与外部服务配置文件挂载
│
├── test/                      # 🧪 自动化测试套件 (99 个全绿用例)
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
- 🛡️ **生产级安全与容灾**：DNS 动态私网拦截防 SSRF，请求超限防御，自带 Stale 容灾兜底缓存（网络抖动时平滑复用上次成功数据，节点绝不掉线）。
- 🔤 **简繁中文四路同步**：繁体节点名全链路自动识别，节点名、策略组名、组内引用、路由规则四路简繁严格统一。

---

## 🚀 快速开始

### 方式一：终端命令行（推荐本地与 CI/CD 自动化）

无需复杂依赖，直接使用短命令 `mtk`（或 `mihomo-tk`）：

```bash
git clone https://github.com/XiaoM-OVO/mihomo-toolkit.git && cd mihomo-toolkit
npm install

# 1. 直接拉取订阅，生成完整 Mihomo 配置文件
npx mtk -u "https://example.com/sub.yaml" -o config.yaml

# 2. 或者使用 config.yaml 统一管理多订阅与高级规则
npm run build
```

### 方式二：常驻 HTTP 订阅服务（适合自建 VPS 或局域网）

将 Mihomo-Toolkit 部署为私有订阅转换 API：

```bash
# 启动本地服务（默认端口 3000，自动读取根目录 config.yaml）
npm start

# 或自定义端口与配置文件
PORT=8080 CONFIG_PATH=/path/to/my-config.yaml npm start
```

启动后即可在客户端直接订阅：`http://你的服务器IP:3000/sub`。

### 方式三：与 Clash Verge Rev 搭配使用

建议采用以下两种稳定方式之一，避免客户端沙箱编译超大单体脚本：
1. **本地订阅方式（推荐）**：启动 `npm start` 常驻服务，在 Clash Verge Rev 中添加新订阅为 `http://127.0.0.1:3000/sub`，完全当做普通远程订阅使用。
2. **计划任务直写配置**：在 `config.yaml` 中配置 `output` 路径指向 Verge 的 profiles 目录，通过系统计划任务（Windows Task Scheduler / Cron）定时执行 `mtk -c config.yaml` 自动写入。

---

## 🎯 三大交付形态 (`-t, --type`)

系统彻底摆脱了复杂的两阶段胶水，聚焦三种纯粹的最终交付物：

| 交付模式 (`-t`) | 输出交付物 | 核心契约与行为 | 典型场景 |
| :--- | :--- | :--- | :--- |
| **`config`**<br>*(默认全量交付)* | **完整即用型 Mihomo YAML 配置** | 1. 默认全新组装：洗节点 ➔ 状态看板 ➔ 六维策略组 ➔ 分流规则 ➔ 内核优化一条龙。<br>2. **`--passthrough` 透传模式**：原汁原味保留原订阅顶层 `rules/dns/tun` 等，仅将 `proxies` 替换为洗白后的节点！ | 直接提供给内核、软路由或客户端使用。 |
| **`nodes`** | **纯净清洗节点数组** | 契约绝对纯粹：**仅交付洗白后的 `{ proxies: [...] }` 列表**，绝不越界输出任何策略组或外围规则。 | 导入 Sub-Store、节点池二次加工。 |
| **`report`** | **健康审计与统计报告 (JSON)** | 纯粹输出清洗统计（总数、有效保留、去重数、广告拦截数、未知地区数）与健康元数据。 | CI/CD 自动化质检、机场节点质量监控。 |

---

## 🖥️ 详细命令行用法

```text
Usage: mtk [options]

Mihomo-Toolkit (MTK) - 自动化节点清洗与策略组构建引擎

Options:
  -V, --version        输出版本号
  -u, --url <url>      订阅链接或本地配置文件路径 (若 config 中已有 subscriptions 则可省略)
  -o, --out <path>     输出文件路径 (默认: config.yaml / nodes.yaml / report.json)
  -t, --type <mode>    交付输出模式: "config" (默认), "nodes" (纯节点), 或 "report" (审计报告)
  -p, --passthrough    仅在 config 模式生效：保留原订阅顶层 rules/dns 等规则，仅替换 proxies
  -c, --config <path>  指定自定义 YAML/JSON 配置文件
  -r, --report <path>  在生成配置的同时，顺手将审计报告另存为指定 JSON 文件
  --prod               生产环境模式 (开启严格安全锁，强制禁止敏感凭据明文打印)
  --debug              开启详细调试日志 (展示 fetch 过程及中间状态)
  -h, --help           显示帮助信息
```

### 常用命令范例：

```bash
# 1. 常用：拉取订阅并生成完整分流配置
mtk -u "https://airport.com/sub" -o config.yaml

# 2. 透传：保留原订阅自带的规则，仅洗白节点名与去重
mtk -u "https://airport.com/sub.yaml" -t config --passthrough -o config.yaml

# 3. 提纯：只要干净的节点数组 (Sub-Store 专用)
mtk -u "https://airport.com/sub" -t nodes -o nodes.yaml

# 4. 质检：导出节点健康度审计报告
mtk -u "https://airport.com/sub" -t report -o audit.json

# 5. 生成配置的同时，顺便落一份审计报告
mtk -u "https://airport.com/sub" -r report.json
```

---

## ⚙️ 配置详解 (`config.yaml`)

整个系统采用**完全扁平化设计**，没有复杂的嵌套作用域，所有开关直接在根级配置。完整配置模板请参考 [`config.example.yaml`](config.example.yaml)：

```yaml
# 1. 交付形态与输出
outputMode: "config"            # config (完整配置) | nodes (纯节点) | report (审计报告)
output: "./dist/config.yaml"    # 输出路径
passthrough: false              # [config模式] true=透传原配置规则，仅替换节点

# 2. 抓取与容灾
fetchProxyPort: 7890            # 抓取代理端口（留空直连）
fetchProxyStrategy: "auto"      # direct (直连) | proxy (代理) | auto (失败自动走代理重试)
fetchRetry: 2                   # 失败重试次数 (5xx/超时重试，4xx快速失败)
fetchStaleTtl: 24               # 网络故障时复用旧缓存兜底时长 (小时)

# 3. 订阅清单 (支持多订阅并发聚合)
subscriptions:
  - url: "https://example.com/sub1"
    tag: "机场A"
    # indexPrefix: "A"          # 编号前缀 (如 A01/B01)
    # resetDay: 19              # 每月固定重置流量日期
  - url: "https://example.com/sub2"
    tag: "机场B"

# 4. 节点清洗与重命名
enableDedupe: true               # 开启底层物理指纹去重
enableNodeRename: true           # 节点重命名开关 (设为 false 原样保留节点名，不影响地区识别)
showFeatureIcon: true            # 是否追加 🚀/4K 等特征 Emoji
removeInfoNodes: true            # 自动剔除机场原生流量假节点 (避免与合成看板冲突)

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

## ❓ 常见问题

<details>
<summary><b>Q: 我只想保留机场原本给我的节点名字，不想被脚本改名，但又想用策略组分流，怎么配？</b></summary>

只需在 `config.yaml` 中配置 `enableNodeRename: false` 即可！
底层的地区识别、倍率提取、线路特征分析依然会照常运行并精准把节点送入对应的策略组，绝不破坏节点原名。
</details>

<details>
<summary><b>Q: 为什么我拉取订阅时偶尔报错 403 / 502，但节点没有消失？</b></summary>

这是本系统的 **Stale 容灾兜底机制**在生效。当远程机场网络抖动或超时时，系统会自动重试；若依然失败，会自动激活最近一次成功抓取的本地缓存快照（默认保留 24h），并在控制台打印告警，保障你设备上的节点永远可用。
</details>

<details>
<summary><b>Q: 如何在 Clash Verge Rev 中使用？</b></summary>

推荐直接在后台常驻服务中运行 `npm start`，然后在 Clash Verge Rev 中将订阅链接设置为 `http://127.0.0.1:3000/sub`；或者通过计划任务定时执行 `mtk -c config.yaml` 直接生成写入 Verge 的配置 profile 路径，客户端零计算负担。
</details>

---

## 📜 开源协议

本项目基于 [MIT License](LICENSE) 许可协议开源。
