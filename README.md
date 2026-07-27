<div align="center">

# 🛠️ Mihomo-Toolkit

**一套为 Mihomo 内核生态客户端设计的通用动态网络路由与策略组配置方案**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Mihomo](https://img.shields.io/badge/Core-Mihomo-orange)](https://github.com/MetaCubeX/mihomo)
[![Toolkit](https://img.shields.io/badge/Toolkit-v3.3.0-blue)](CHANGELOG.md)
[![Pure_Script](https://img.shields.io/badge/Pure_Script-v1.2.0-blueviolet)](CHANGELOG.md)

「 **自动清洗 · 动态分组 · 智能分流 · 零维护** 」

---

## 📸 运行预览

<p align="center">
  <img src="https://github.com/user-attachments/assets/1ca6488b-21ba-4a69-9db5-1944290ad2aa" width="48%" />
  <img src="https://github.com/user-attachments/assets/21522b23-99d4-4922-9987-51569c1cc394" width="48%" />
  <br>
  <em>左：自动化策略组布局 | 右：节点清洗细节</em>
</p>

</div>

## 📌 快速导航
- [✨ 核心特性](#-核心特性)
- [🚀 快速开始](#-快速开始)
- [🧩 纯净节点清洗脚本](#-纯净节点清洗脚本)
- [🖥️ 详细部署指南](#️-详细部署指南)
- [⚙️ 配置详解](#️-配置详解)
- [🧹 节点清洗与分组结构](#-节点清洗与分组结构)
- [❓ 常见问题](#-常见问题)

---

## ✨ 核心特性

- 🧩 **注册表驱动架构**：六维自定义服务注册表（AI / 流媒体 / 社交 / 游戏 / 系统 / 学术），填入定义即启用，无需触碰脚本逻辑。
- 🧹 **深度清洗去重**：去除冗余广告/倍率，拦截纯文本引流节点，保留落地城市。
- 🌍 **动态地区折叠**：小众地区自动归入大洲组，支持 Emoji 国旗动态捕获冷门国家。
- 🔀 **全场景分流**：内置广告、AI、游戏、影音、社交、金融等 20+ 常用分流，支持自定义规则与远程规则集注入。
- 🎨 **协议与状态图标**：支持展示节点底层协议（🦊/🛸/🐴等）及业务解锁状态。
- 🏷️ **机场标签前缀**：多机场订阅合并时自动/手动标注节点来源，面板来源一目了然。
- 🗑️ **DAG 级联清理**：自动删减空策略组与孤儿规则，保持内核配置纯净。
- ⚡ **性能防漏**：BT 直连防封、精准 TLS 指纹伪装、流量审计、TUN/DNS/Sniffer 等深度优化。
- 🔍 **智能 IP 溯源**：纯净版清洗脚本支持接入 ip-api 批量高并发解析，精准纠正 CDN 或虚假定位节点。
- 🧬 **智能节点裂变**：纯净版脚本支持将域名节点通过 DNS 解析裂变为多个 IP 实体节点（支持 IPv4/IPv6 过滤与数量上限控制），有效应对单域名多 IP、CDN 调度或需物理 IP 直连的高精度分流场景。
 - 🖥️ **全场景部署**：提供 `CLI 命令行`（`cli.js`）、`本地 HTTP 服务`（`server.js`）与 `Cloudflare Worker`（`worker.js`）三种运行入口，适配终端调试、自建订阅 API、边缘网络加速等多种使用场景

---

## 🚀 快速开始

选择适合你的使用场景，三种方式各取所需：

### 方式一：客户端拓展脚本（推荐）
零部署，直接在 Mihomo 客户端中使用。从 [GitHub Releases](https://github.com/XiaoM-OVO/mihomo-toolkit/releases) 获取 `mihomo-toolkit.js`，粘贴到 Clash Verge Rev 等客户端的「扩展脚本」中即可。

### 方式二：本地 CLI 工具
适合本地终端或 CI/CD 自动化：

```bash
git clone https://github.com/XiaoM-OVO/mihomo-toolkit.git && cd mihomo-toolkit
npm install
node cli.js -u "https://example.com/sub.yaml" -o profile.yaml
```

### 方式三：自建订阅服务（Server）—— 适合部署在个人VPS或局域网设备
通过HTTP服务将Mihomo-Toolkit暴露为订阅链接，全平台设备可共用同一份配置：

> 📁 **先决条件**：根目录需存在 `config.yaml`（可参考项目中的 `config.example.yaml` 创建），或通过启动命令中的 `?url=` 参数动态传入订阅（详见下方部署说明）。

```bash
git clone https://github.com/XiaoM-OVO/mihomo-toolkit.git && cd mihomo-toolkit
npm install

# 使用默认配置启动（自动读取根目录 config.yaml）
npm start

# 或自定义端口和配置文件路径
PORT=8080 CONFIG_PATH=/path/to/config.yaml node server.js
```

启动后，将 `http://你的IP:3000/sub` 作为远程订阅链接填入Mihomo客户端即可。

### 方式四：边缘部署（Cloudflare Worker）—— 享受全球CDN加速
将脚本部署在Cloudflare边缘节点，随时随地获取配置：

```bash
# 1. 构建Worker单文件
npm run build:worker

# 2. 部署方式：
#    将 dist/worker.bundle.js 的全部内容复制到 Cloudflare Worker 仪表板中保存并部署即可。
#    （如需使用 Wrangler CLI 自动化部署，请参考 Cloudflare 官方文档配置 wrangler.toml）
```

> 💡 **提示**：Worker模式支持环境变量 `DEFAULT_CONFIG_URL`，可免去每次请求带参数，详见下方 [🖥️ 部署与运行](#️-部署与运行)。

---

## 🧩 纯净节点清洗脚本

独立节点清洗脚本 (`src/pure-nodes.js`)，将主脚本的节点处理核心逻辑解耦为 operator 格式。适用于 Sub-Store、Surge、Loon 等多环境，专为**仅需节点过滤/去重/重命名/IP溯源，不需要完整策略组体系**的场景设计。

### 功能对比

| 能力 | 主脚本 (mihomo-toolkit.js) | 清洗脚本 (pure-nodes.js) |
|------|---------------------------|--------------------------|
| 节点去重 / 垃圾拦截 | ✅ | ✅ |
| 倍率 / 线路 / 落地城市提取 | ✅ | ✅ |
| 协议图标 / 特征图标 | ✅ | ✅ |
| 节点标签前缀 | ✅ | ✅ |
| IP-API 补充定位检测 | ❌ | ✅ |
| 节点裂变 (域名→多IP) | ❌ | ✅ |
| 策略组 / 分流规则生成 | ✅ | ❌ |
| DNS / TUN / Sniffer 覆写 | ✅ | ❌ |
| 输出格式 | Mihomo 配置 | `array` 或 `object`(含 meta) |

### 快速使用

1. 以 Sub-Store 为例，进入「订阅管理」→ 选择目标订阅 →「编辑」→「节点操作」
2. 将 `src/pure-nodes.js` 内容粘贴到脚本编辑区
3. 可选：修改脚本顶部 `CONFIG` 对象配置（或通过 Sub-Store 外部传入 `userConfig`）
4. 保存并刷新订阅

### 配置要点

纯净版脚本的 `CONFIG` 对象位于文件顶部，以下列出最常用的核心参数，其余进阶选项（如重命名模板、IP检测细化开关等）已在脚本中附带详细中文注释。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `outputMode` | `"array"` | `"array"` 输出纯节点数组，`"object"` 额外返回 `meta` 元数据（含统计信息与分桶结果） |
| `enableDedupe` | `false` | 开启物理去重（基于 Server/Port/UUID 等多维度） |
| `removeInfoNodes` | `false` | 开启后直接删除“到期时间/剩余流量”等说明节点 |
| `blockKeywords` | `[]` | 黑名单关键词（命中即拦截），如 `["免费领取", "点击购买"]` |
| `blockServers` | `[]` | 黑名单服务器地址（命中即拦截），如 `["123.123.123.123"]` |
| `adTextThreshold` | `12` | 纯文本广告判定阈值（无数字/线路特征且长度超过此值视为广告，比主脚本默认 6 更宽松） |
| `enableAirportTag` | `false` | 开启后自动提取节点来源标签（多订阅合并时区分来源） |
| `renameTemplate` | 见脚本 | 节点重命名模板，支持 `{icon}`、`{region}`、`{isp}` 等变量自由组合 |
| `enableIpEnrich` | `false` | 开启 IP-API 补充检测（自动纠正 CDN/虚假定位，需注意免费版有频率限制） |
| `enableFission` | `false` | 开启域名裂变（将域名节点解析为多个 IP 实体节点，详见下方裂变配置） |

> 💡 **快速上手**：大多数情况下只需调整 `enableDedupe`（去重）和 `removeInfoNodes`（去掉说明节点）即可获得整洁的节点列表。如需精准定位，可开启 `enableIpEnrich`；如需裂变多 IP，请同时配置 `enableFission` 及相关参数。

---


## 🖥️ 详细部署指南

以下为三种运行环境的详细用法，CLI 工具和 HTTP 服务均已包含在项目源码中。

### 1. 🖥️ 本地 CLI 命令行工具

适合在本地终端运行，或配合 GitHub Actions 等 CI/CD 工具进行定时自动化构建。`mihomo-toolkit` CLI 工具允许你在本地终端、CI/CD 环境或任何 Node.js 运行时中，一键完成"节点清洗"与"策略构建"的自动化流水线。

**特性：**
- **灵活的运行模式**：支持单跑"纯净节点清洗"、单跑"主脚本策略构建"，或合并执行。
- **配置分离**：通过 `config.yaml` 或 CLI 参数覆盖，无需硬编码修改脚本。
- **本地与远程支持**：可拉取远程机场订阅链接，也可读取本地 YAML 文件。

### 基础调用

提供一个订阅链接或本地配置文件，并指定输出路径：

```bash
node cli.js -u "https://example.com/sub.yaml" -o final_config.yaml
```
> 如果未指定 `-t`（运行模式），默认将执行 `pure` 模式（仅清洗节点）。

### 快捷命令

如果你使用 `config.yaml` 作为配置文件，可以通过以下 npm 快捷命令简化日常操作：

| 命令 | 等价于 | 说明 |
|---|---|---|
| `npm run build` | `node cli.js -c config.yaml -t full` | 全流程：深度清洗 + 策略组构建（最常用） |
| `npm run build:pure` | `node cli.js -c config.yaml -t pure` | 仅深度清洗节点（含IP溯源/裂变） |
| `npm run build:toolkit` | `node cli.js -c config.yaml -t toolkit` | 主脚本清洗+策略组构建（跳过 pure 深度清洗） |
| `npm start` | `node server.js` | 启动本地 HTTP 服务 |
| `npm run dev` | `node --watch server.js` | 开发模式，文件变动自动重启 |
| `npm run build:worker` | `esbuild worker.js ...` | 编译 Cloudflare Worker 产物 |

### 命令参数详解

| 参数 | 简写 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `--url` | `-u` | 否* | 无 | 原始节点配置的数据源（仅单订阅时使用）。**注意：如果 `--config` 文件中配置了 `subscriptions`，则此参数可省略。** |
| `--output` | `-o` | 否 | `nodes.yaml` | 处理完成后的最终输出文件路径。 |
| `--type` | `-t` | 否 | `pure` | 运行模式选择。可选：`pure`（仅清洗）、`toolkit`（仅构建策略组）、`full`（全流程）。 |
| `--config` | `-c` | 否 | 无 | 自定义的外部 YAML/JSON 配置文件路径，用于覆盖内置配置及定义多订阅源。 |
| `--meta` | `-m` | 否 | 无 | (进阶) 指定一个 JSON 文件路径。开启后会强制输出模式为 Object，并将清洗过程的统计数据（去重数、无效节点数等）以及地区分组信息保存到该文件中。 |

### 🛠️ 运行模式详解 (`-t`)

本工具提供三种运行模式，满足各种定制化需求：

#### 1. `full` 模式
**行为**：一条龙服务。
**流程**：`解析原始订阅` -> `调用 pure-nodes 进行节点深度清洗` -> `调用 mihomo-toolkit 构建完整的策略组与分流系统` -> `输出给内核使用的最终配置文件`。
**使用场景**：日常更新个人专属配置，或自动化构建每日配置。

```bash
node cli.js -u ./raw-sub.yaml -t full -o final-config.yaml
```

#### 2. `pure` 模式 (仅清洗节点)
**行为**：只运行 `pure-nodes.js` 洗白节点，**不生成**任何策略组和路由规则。
**输出格式**：一个纯净的 YAML，仅包含 `proxies` 节点数组。
**使用场景**：你已经有了一套完美的主路由配置，只想借助本工具的“节点清洗、倍率过滤、IP 补全、重命名”功能提纯订阅，然后提供给其他工具（如 Sub-Store 或自建面板）使用。

```bash
node cli.js -u "https://example.com/sub.yaml" -t pure -o pure-proxies.yaml
```

#### 3. `toolkit` 模式 (主脚本全功能)
**行为**：直接运行 `mihomo-toolkit.js`，包含节点清洗（去重/重命名/地区匹配/倍率识别）和完整策略组构建。
**前提条件**：输入的订阅可以是原始状态，主脚本自带清洗能力。
**使用场景**：你不需要 pure-nodes 的 IP 溯源和节点裂变，只需主脚本的清洗+策略组体系（动态测速大区、流媒体分流、防漏 DNS 等）。注意：此模式下主脚本的重命名和清洗**都会执行**，跳过的只是 pure-nodes 的深度清洗。

```bash
node cli.js -u ./raw-sub.yaml -t toolkit -o final-config.yaml
```

### 📝 高级玩法：覆写配置

根目录下可以存在一个 `config.yaml` 文件（你也可以通过 `-c` 指定其他路径，或参考 `config.example.yaml`）。如果此文件存在，CLI 会在运行时读取其中的配置项，**合并/覆盖**到脚本内置的 `USER_CONFIG` 中。

这让你能够分离代码与配置。例如在 `config.yaml` 中写入：

```yaml
enableIPv6: true
enableAntiAD: true
renameTemplate: "[{airport}] {icon} {region} {index} {multi}"
```

CLI 在运行时就会自动使用上述设定，而完全不需要你去修改源码！

#### 🔀 脚本独立作用域配置（进阶）

如果你需要为清洗脚本（`pure-nodes.js`）和主脚本（`mihomo-toolkit.js`）分别设定不同的配置，你可以使用 `pureConfig` 和 `toolkitConfig` 两个特殊字段进行隔离：

```yaml
# 根目录的配置会同时应用于两个脚本（共享配置）
enableAirportTag: true
adTextThreshold: 10

# 多订阅合并 + 来源标签注入
subscriptions:
  - url: "https://example.com/sub1.yaml"
    tag: "AirportA"  # 会自动补全为 [AirportA] 并注入到节点名前
    # indexPrefix: "A"  # 可选：序号前缀，配置后按地区+前缀独立编号(如 A01)
  - url: "https://example.com/sub2.yaml"
    tag: "AirportB"
    # indexPrefix: "B"
  - url: "./local-nodes.yaml"

# 序号规则：有 indexPrefix → 按地区+前缀独立编号(如 A01/B01)，无 indexPrefix → 按地区统一编号(如 01/02)

pureConfig:
  # 这里的配置仅对纯净节点清洗脚本生效
  enableIpEnrich: true

toolkitConfig:
  # 这里的配置仅对主脚本策略构建生效
  enableNodeRename: false
```

> 💡 **防二次污染机制**：在 `full`（全自动流水线）模式下，由于清洗脚本已经对节点名进行了深度的打标与洗白，为了防止主脚本接手后进行二次重命名导致名字乱码，CLI 会**自动为 `mihomo-toolkit` 注入 `enableNodeRename: false`**。你可以通过在 `toolkitConfig` 里硬性写明 `enableNodeRename: true` 来覆盖这个智能保护机制。



### 2. 🌐 本地/云端 HTTP 服务 (Server)

适合本地长期挂机，或部署在个人的 **VPS 服务器** 上。它能在 `3000` 端口启动一个 HTTP 服务，实时处理外部发来的订阅请求。此模式支持向客户端注入 `Subscription-Userinfo` 流量面板信息（推荐使用 `pm2` 等工具进行守护运行）。

**启动方式：**

```bash
# 启动本地服务（默认端口 3000）
npm start

# 或自定义端口
PORT=8080 npm start

# 指定配置文件路径
CONFIG_PATH=/path/to/config.yaml npm start
```

启动后，你的订阅链接将变成：
`http://127.0.0.1:3000/sub`

**支持的请求方式：**
- 动态传参：`http://127.0.0.1:3000/sub?url=https://a.com/sub&url=https://b.com/sub`
- 远程配置：`http://127.0.0.1:3000/sub?config=https://gist.github.com/xxx/config.yaml`
- 默认配置：**前提是根目录已存在 `config.yaml`**（可参考 `config.example.yaml` 创建）；若文件不存在且未传参，服务会返回 400 错误提示。

### 3. ☁️ Cloudflare Worker 云端部署

将清洗引擎部署在 Cloudflare 边缘节点，随时随地在手机或电脑端使用。
由于采用了纯函数式架构，本项目已通过 `esbuild` 兼容 Cloudflare Worker。

**部署步骤：**

```bash
# 1. 编译构建 Worker 产物
npm run build:worker

# 2. 将 `dist/worker.bundle.js` 的内容复制到 Cloudflare Worker 中保存部署即可
```

**Worker 高级技巧**：
- 动态传参：`https://your-worker.dev/sub?url=xxx&url=yyy`
- 远程配置：`https://your-worker.dev/sub?config=https://gist.github.com/xxx/config.yaml`
- 默认配置：在 Cloudflare 控制台添加环境变量 `DEFAULT_CONFIG_URL`，填入你放在 GitHub Gist 或其他图床上的 `config.yaml` 的直链。这样你连请求参数都不用带，直接访问 Worker 域名就能获得洗白后的配置。

## ⚙️ 配置详解

📝 **完整配置**：请直接在 `src/mihomo-toolkit.js` 和 `src/pure-nodes.js` 顶部的 `USER_CONFIG` / `CONFIG` 对象中查看，所有配置项均有详尽的**中文注释**。

<details>
<summary><b>🏷️ 节点重命名模板变量 (renameTemplate)</b></summary>

您可以在 `USER_CONFIG.renameTemplate` 中自由组合以下变量，定制专属的节点名称格式：

**基础模板变量：**

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `{airport}` | 机场标签前缀（若开启了 `enableAirportTag`） | `[AirportA]` |
| `{icon}` | 国家/地区对应的国旗 Emoji | `🇺🇸` |
| `{region}` | 提取出的国家/地区中文简称 | `美国` |
| `{index}` | 节点标号（多节点自动编号） | ` 01`, ` 02` |
| `{features}` | 提取的修饰词/特性说明 | `家宽`, `BGP` |
| `{protocol}` | 底层协议特征 Emoji | `🦊` |
| `{in}` | 入口地区 / 接入点（专线中转） | `深`, `沪` |
| `{city}` | 落地城市名 | `洛杉矶` |
| `{multi}` | 节点倍率数值（纯数字） | `x1.5`, `x2.0` |
| `{line}` | 提取的线路特征（如 `BGP`、`CN2`、`家宽`） | `BGP` |
| `{transport}` | 传输层协议 | `WS`, `GRPC` |
| `{ip_stack}` | IP 栈类型（IPv6 / 双栈 / 空） | `双栈` |

> 💡 **高级玩法（函数定义）**：
> 如果您懂 JavaScript，您可以直接将 `USER_CONFIG.renameTemplate` 赋值为一个函数 `(vars, proxy) => string`，这样可以完全接管节点重命名的底层逻辑！

### 📝 扩展模板变量（仅限 `pure-nodes.js` 的 IP-API 模式）

纯净版脚本支持 IP-API 检测回填，因此在上述**基础模板变量**之外，额外提供以下变量（需开启 `enableIpEnrich`）：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `{isp}` | 运营商名称 | `Akamai` |
| `{asn}` | 自治系统编号 | `AS16509` |
| `{org}` | 组织机构 | `Amazon.com, Inc.` |
| `{asname}` | AS 名称 | `AMAZON-02` |

> 💡 基础模板变量（如 `{icon}`、`{region}`、`{ip_stack}` 等）在主脚本和纯净版中均受支持，无需额外开启。

</details>

<details>
<summary><b>⚙️ 常用开关速览（快速上手）</b></summary>

以下为脚本中最常调整的核心开关，其余参数均已在脚本中附带详细中文注释：

| 配置项 | 默认值 | 作用 |
|--------|--------|------|
| `proxyFirst` | `true` | 路由策略：`true` 为海外代理优先，`false` 为国内直连优先 |
| `enableDedupe` | `false` | 开启后基于底层参数（Server/Port/UUID等）物理去重 |
| `removeInfoNodes` | `false` | 开启后自动剔除“到期时间/剩余流量”等说明节点 |
| `enableAirportTag` | `false` | 开启后自动提取节点来源标签（多订阅合并时非常有用） |
| `minorNodeThreshold` | `3` | 小众地区独立建组的最小节点数（低于此值折叠至大洲组） |
| `lowMultiThreshold` | `0.99` | 倍率 ≤ 此值的节点自动标记为 `⏬` 下载节点（设为 `0` 关闭） |
| `testInterval` | `300` | 自动选择组的测速间隔（单位：秒） |
| `strictRegionMatch` | `false` | `true` 时仅匹配内置字典，`false` 时可动态捕获冷门国家 |
| `indexPrefix`（subscriptions 内）| _无_ | 序号前缀，配置后按地区+前缀独立编号（如 A01、B01）；不配置则按地区统一编号（如 01、02） |

</details>

<details>
<summary><b>🧩 自定义服务注册表 (v3.0 新增)</b></summary>

`CUSTOM_SERVICES` 是 v3.0 的核心升级——六维注册表让你无需修改脚本逻辑即可无限扩展新服务。只需两步：**① 在对应分类中填入定义** → **② 将 key 加入对应服务数组**，即可零侵入启用。

```javascript
const CUSTOM_SERVICES = {
  ai: {},          // 🤖 AI 助手：填入定义后将 key 加入 AI_SERVICES 数组
  streaming: {},   // 📺 流媒体：填入定义后将 key 加入 STREAMING_SERVICES 数组
  social: {},      // 💬 社交平台：填入定义后将 key 加入 SOCIAL_SERVICES 数组
  game: {},        // 🎮 游戏平台：填入 provider + rules
  system: {},      // 🪟 系统服务：填入 provider + rules
  dev: {}          // 🛠️ 开发者/学术：填入 provider
};
```

**注册表字段说明**（按分类不同有所差异）：

| 分类 | 必填字段 | 可选字段 |
|------|----------|----------|
| `ai` | `name`, `uiIcon`, `reg`, `provider`, `ruleSet`, `iconUrl`, `cleanName` | — |
| `streaming` | `name`, `cleanName`, `iconUrl`, `provider` | `reg`, `pool`（有则参与节点清洗与策略组构建） |
| `social` | `name`, `cleanName`, `iconUrl`, `provider` | — |
| `game` | `provider`, `rules` | — |
| `system` | `name`, `cleanName`, `iconUrl`, `provider`, `rules` | — |
| `dev` | `name`, `cleanName`, `iconUrl`, `provider` | — |

---

### 📺 示例 1：新增流媒体分流（HBO Max）

场景：HBO Max 的规则集在 `geosite/hbomax`，且节点名中经常带 "HBO" 字样，希望自动识别并优先走解锁节点。

```javascript
CUSTOM_SERVICES.streaming = {
  hbo: {
    name: "🎬 HBO Max",                     // 策略组显示名称
    cleanName: "HBO",                       // 清洗后保留的纯净名称
    iconUrl: "https://.../HBO.png",         // 策略组图标 URL
    provider: "geosite/hbomax",             // Mihomo 分流规则集
    reg: /\b(?:HBO|HBOMax|Max)\b/i,        // 节点名正则匹配（命中则打 📺 标签）
    pool: "hbo"                             // 节点桶名——命中 reg 的节点自动归入此桶，优先提供给 HBO 策略组
  }
};
// 启用：在 STREAMING_SERVICES 数组中追加 "hbo"
```

启用后效果：节点名含 "HBO" 的自动打上 📺 标签 → 归入 `hbo` 桶 → HBO Max 策略组优先使用这些节点，不足时回退到通用大区池。

---

### 🤖 示例 2：新增 AI 服务（DeepSeek）

场景：DeepSeek 在国内直连更稳定，但有海外节点时希望走代理。规则集在 `geosite/deepseek`，节点名含 "DeepSeek" 或 "DS"。

```javascript
CUSTOM_SERVICES.ai = {
  deepseek: {
    name: "🧠 DeepSeek",                    // 策略组显示名称
    uiIcon: "🧠",                           // 节点名上的特征图标
    reg: /\b(?:DeepSeek|DS)\b/i,           // 节点名正则（命中则展示 🧠 图标）
    provider: "geosite/deepseek",           // 分流规则集
    ruleSet: "deepseek",                    // rule-provider key（在 rules 中引用）
    iconUrl: "https://.../DeepSeek.png",    // 策略组图标 URL
    cleanName: "DeepSeek"                   // 清洗时保留的纯净名称
  }
};
// 启用：在 AI_SERVICES 数组中追加 "deepseek"
```

启用后效果：节点名含 "DeepSeek" 的打上 🧠 图标 → 自动生成 🧠 DeepSeek 策略组 → 优先走家宽/美日等 AI 友好地区，最后回退代理/DIRECT。

---

### 🎮 示例 3：新增游戏分流（原神 / Genshin）

场景：原神国际服需要走代理，国内服直连。只需提供 rule-provider 和分流规则数组。

```javascript
CUSTOM_SERVICES.game = {
  genshin: {
    provider: "geosite/hoyoverse",                            // Mihomo 分流规则集
    rules: [
      "RULE-SET,genshin,🎮 游戏服务",                          // 国际服走游戏组
      "DOMAIN-SUFFIX,hoyoverse.com,🎮 游戏服务",
      "DOMAIN-SUFFIX,mihoyo.com,DIRECT"                       // 米哈游国内站直连
    ]
  }
};
// 启用：game 分类无需加入数组，填入即自动生效（受 enableGame 总开关控制）
```

---

### 💬 示例 4：新增社交平台（Reddit）

场景：Reddit 走代理分流，无需节点清洗参与。

```javascript
CUSTOM_SERVICES.social = {
  reddit: {
    name: "👽 Reddit",
    cleanName: "Reddit",
    iconUrl: "https://.../Reddit.png",
    provider: "geosite/reddit"
  }
};
// 启用：在 SOCIAL_SERVICES 数组中追加 "reddit"
// 若希望 Reddit 独立建组（而非合并入 💬 社交平台），同时在 INDEPENDENT_SOCIAL 中追加 "reddit"
```

---

> 💡 **字段速查**：`provider` 支持两种格式——**① 路径片段** `geosite/xxx`（自动拼接 CDN 前缀，行为从路径推断）；**② 完整 URL** `https://example.com/rules.yaml`（直接使用，格式从扩展名推断，行为默认 `domain`）。规则集完整列表见 [meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat/tree/meta/geo/geosite)；`iconUrl` 推荐使用 `USER_CONFIG.iconRepoOrz` / `iconRepoKoolson` / `iconRepoLige47` 拼接图标文件名。

</details>

<details>
<summary><b>📋 自定义规则与规则集 (v3.0 新增)</b></summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CUSTOM_RULES` | `[]` | 原始分流规则数组，支持 `DOMAIN-SUFFIX`/`IP-CIDR`/`RULE-SET`/`PROCESS-NAME` 等任意格式，注入到 MATCH 之前，优先级高于所有内置规则 |
| `CUSTOM_RULE_PROVIDERS` | `{}` | 远程 rule-provider 注册表，必填 `url`/`behavior`/`format`，可选 `interval`/`path`/`proxy` |
| `CUSTOM_PROCESS_DIRECT_WIN/MAC/LIN` | `[]` | 追加进程直连名单（自动合并到内置 BT 进程之后） |
| `CUSTOM_PROCESS_PROXY_WIN/MAC` | `[]` | 追加进程强制走下载策略名单 |

</details>

<details>
<summary><b>📡 DNS 服务器配置 (v3.0 新增)</b></summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `dnsDefault` | `["223.5.5.5", "119.29.29.29"]` | 基础解析 DNS（UDP） |
| `dnsDirect` | `["https://223.5.5.5/dns-query", "https://120.53.53.53/dns-query"]` | 直连 DNS（DoH），国内域名解析 |
| `dnsProxy` | `["https://8.8.8.8/dns-query", "https://1.1.1.1/dns-query"]` | 代理 DNS（DoH），海外域名解析 |

> 💡 回国模式下直连/代理 DNS 会自动交换，无需手动调整。

</details>

---

## 🧹 节点清洗与分组结构

### 🏷️ 节点特征图标 (特性标签)

| 图标 | 含义 | 图标 | 含义 |
|------|------|------|------|
| 🤖 | OpenAI/ChatGPT | 🛡️ | AnyTLS / 安全协议 |
| ♊ | Google Gemini | 📱 | WAP 移动优化 |
| 🦀 | Anthropic Claude | ⏬ | 下载 / BT（低倍率） |
| 📺 | 流媒体解锁 | 🆓 | 免费/公益节点 |
| 🎮 | 游戏 / FullCone | 🏠 | 住宅 IP / 家宽 |
| ⚡ | HY2 / TUIC | 🗑️ | 未识别/清洗失败节点 |

### 🏷️ 底层协议图标 (需开启 `showProtocolIcon`)

| 图标 | 协议 | 图标 | 协议 |
|------|------|------|------|
| 🛩️ | SS / SSR | ⚡ | Hysteria / Hysteria2 |
| 🦊 | VMess | 💨 | TUIC |
| 🛸 | VLESS | 🕸️ | WireGuard |
| 🐎 | Trojan | 📡 | Snell |

### 📂 动态生成的策略组
- **核心**：`📍 手动选择`、`🚀 自动选择`、`♻️ 故障转移`
- **地区独立组**：节点数 ≥ 阈值时自动生成（如 `🇭🇰 香港`、`🇯🇵 日本`）
- **大区折叠组**：小众地区收纳至 `🇪🇺 欧洲`、`🏝️ 东南亚`、`🌵 美洲` 或 `🌐 其他节点`
- **应用场景组**：依配置生成 `🤖 ChatGPT`、`🎬 Netflix`、`▶️ YouTube`、`🪄 Disney+`、`🎵 TikTok`、`🎧 Spotify`、`✈️ Telegram` 等
- **高级功能组**：`🏠 家宽优选`、`⏬ 下载策略`、`🇨🇳 中国分流` 等

---

## ❓ 常见问题

<details>
<summary><b>Q: 节点清洗误杀了我的节点，怎么调？</b></summary>

无效节点判定的核心条件：节点名中<b>没有数字、技术词汇（IEPL/BGP/CN2等）和营销词汇（专线/高速/VIP等）</b>，且纯文本长度超过 <code>adTextThreshold</code>（默认 6）即拦截。

按推荐度排序三种自救：
1. 简单粗暴——调高 <code>adTextThreshold</code>（如 10~12），但会整体放宽拦截判定；
2. 精准放行——在 <code>REGEX_TECH_LINE</code> 或 <code>REGEX_FLUFF_LINE</code> 中添加节点关键词，让其通过广告判定；放行后若无地区匹配会自动归入「🗑️ 未知识别」；
3. 上户口——若节点名包含未被内置字典覆盖的地区名，可在 <code>REGION_DEFS</code> 中新增对应条目，避免放行后掉入垃圾桶。

</details>

<details>
<summary><b>Q: 节点去重 (<code>enableDedupe</code>) 会不会误杀正常节点？</b></summary>

不会。去重基于 <code>Server + Port + Type + Network + SNI + Host + Path + UUID</code> 组合键，只有底层完全一致的"注水"节点才会被剔除。同 IP 不同端口的节点不受影响。
</details>

<details>
<summary><b>Q: 为什么我的节点被标了 ⏬ 下载标签？</b></summary>

由 <code>lowMultiThreshold</code> 控制（默认 0.99）。节点名中的倍率（如 x0.5、x0.8）≤ 此值时自动判定为低倍率下载节点。如果不想自动标记，设为 0 即可关闭；如果想从普通池中移除这些节点，开启 <code>isolateDownload</code>。
</details>

<details>
<summary><b>Q: 脚本开启太多开关会不会影响性能？</b></summary>

不会。脚本只运行一次（在订阅刷新时），负责生成静态的 Mihomo 配置。最终影响性能的是生成后的策略组数量和规则条数，而非脚本开关数量。不过建议按需开启，避免生成空策略组和冗余 rule-provider。
</details>

<details>
<summary><b>Q: 分流规则不生效 / 一直走到漏网之鱼？</b></summary>

检查三步：① 对应的总开关（如 <code>enableStreaming</code>）是否开启，且目标服务 key 是否在对应的服务数组中（如 <code>STREAMING_SERVICES</code>）；② 对应 app 的策略组是否为空被 DAG 清理了（空组会被自动裁撤，导致规则回退到漏网之鱼）；③ <code>ruleProviderCDN</code> 是否可正常拉取规则集。
</details>

<details>
<summary><b>Q: 为什么策略组里多了/少了某个地区？</b></summary>

由 <code>minorNodeThreshold</code>（默认 3）和节点数量共同决定：够阈值独立建组，不够则折叠到大洲组；大洲组再不够则最终归入「🌐 其他节点」。设成 1 可以让所有地区强制独立建组，但面板会很臃肿。
</details>

<details>
<summary><b>Q: <code>osType: "all"</code> 和分别指定有什么区别？</b></summary>

<code>"all"</code> 会同时注入 Windows / macOS / Linux 三套进程规则，虽然省事但规则集会变胖。如果只在单一平台使用，指定具体系统可以精简规则。
</details>

<details>
<summary><b>Q: 如何新增一个自定义分流（如 HBO Max）？</b></summary>

v3.0 采用注册表架构，只需两步，无需触碰脚本逻辑：<br>
① <b>注册服务</b>：在 <code>CUSTOM_SERVICES.streaming</code> 中填入服务定义（name、provider、iconUrl 等）；<br>
② <b>启用</b>：将注册的 key 加入 <code>STREAMING_SERVICES</code> 数组即可。<br>
例如：<code>CUSTOM_SERVICES.streaming.hbo = { name: "HBO Max", cleanName: "HBO", iconUrl: "...", provider: {...} }</code>，然后 <code>STREAMING_SERVICES</code> 数组中加 <code>"hbo"</code>。<br>
更多字段说明见上方「自定义服务注册表」章节。
</details>

<details>
<summary><b>Q: 为什么脚本的 DNS / TUN 覆写没生效？</b></summary>

检查客户端的开关是否覆盖了脚本配置 —— 以 <b>Clash Verge Rev</b> 为例：

- **DNS 覆写**：客户端「设置」→「覆写」→「DNS」中的「启用」开关如果打开，会覆盖脚本的 <code>overwriteDns</code> 配置。<br>→ 请关闭客户端的 DNS 总开关，让脚本的 DNS 配置生效。
- **TUN 模式**：客户端「设置」→「覆写」→「TUN」开关如果打开，其中「严格路由」(strict-route) 等选项会覆盖脚本的 <code>overwriteTun</code> 配置。<br>→ 如需启用脚本的 TUN 严格路由防漏，请在客户端 TUN 设置中手动调整为与脚本一致或自行配置的参数。

> 💡 核心原则：脚本的覆写功能（<code>overwriteTun</code> / <code>overwriteDns</code>）是为「不使用客户端覆写」的场景设计的。两者同时开启时，以客户端界面设置为准。
</details>

<details>
<summary><b>Q: 开代理后部分国内网站变慢或打不开？</b></summary>

检查 <code>proxyFirst</code>：国内用户建议设为 <code>false</code>（直连优先），并开启 <code>enableDomesticGroup</code>。如果是因为 DNS 污染，确认 <code>overwriteDns</code> 已开启（默认开启的 Fake-IP 体系能有效防污染）。
</details>

<details>
<summary><b>Q: 多个订阅源混在一起，怎么区分节点来源？</b></summary>

开启 `enableAirportTag` 后，脚本支持多维度自动打标：
1. **关键词强制匹配**：在 `airportTag` 中填入机场名关键词（如 `"AirportA, AirportB"`），脚本会扫描节点名，只要命中就直接作为标签！
2. **正则智能提取**：如果没有命中关键词，脚本会通过 `airportTagReg` 设定的正则表达式进行自动提取（默认提取节点开头的 `[xxx]` 标识）。
3. **CLI 自动化流水线注入**：使用本项目的 CLI 命令行工具，在 `config.yaml` 的 `subscriptions` 数组中为不同订阅链接指定 `tag`，CLI 会在后台自动为它们批量注入标签前缀。

自动打标后，面板中的节点来源一目了然，再也不怕订阅混淆！如需更精细的归属识别（如运营商、ASN），可配合纯净版脚本的 IP-API 检测使用。

> 💡 **按订阅源独立编号**：默认按地区统一编号（如香港 01、02、03，跨机场连续）。如想让每个订阅源独立计数（如 L01、L02 / I01、I02），只需在 `subscriptions` 数组里为每个源指定 `indexPrefix`，即可在节点名中保留来源辨识度。

</details>

---

## 📦 更新日志
版本历史与详尽的更新说明请参阅 [CHANGELOG.md](CHANGELOG.md)。

## 🙏 鸣谢
- 灵感来源：[iczrac/Parsers-for-clash](https://github.com/iczrac/Parsers-for-clash)
- 基础内核：[Mihomo](https://github.com/MetaCubeX/mihomo)
- 规则集：[meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) & [anti-AD](https://github.com/privacy-protection-tools/anti-AD)
- 图标库：[Orz-3/mini](https://github.com/Orz-3/mini) & [Koolson/Qure](https://github.com/Koolson/Qure) & [lige47/lige_icon](https://github.com/lige47/lige_icon)
- **AI 协同**：由本人架构，Gemini，DeepSeek参与代码生成与审查，多轮对线压力测试迭代而成。

## 🐛 提交问题
如果在使用过程中遇到 BUG 或有好的建议，欢迎提交 [Issue](https://github.com/XiaoM-OVO/mihomo-toolkit/issues)。提交前请先查阅 [常见问题](#-常见问题)。

## ⚠️ 免责声明
1. 本项目提供的代码、脚本与配置仅供**个人进行计算机网络调试、路由规则学习与研究网络连通性架构**使用。
2. 请严格遵守您所在国家及地区的法律法规，**严禁将本项目用于任何非法或违反当地法律的用途**。
3. 因使用本项目所产生的任何直接或间接后果，**均由使用者本人自行承担**。作者及贡献者不承担任何技术或法律连带责任。
4. 本项目仅为代码工具，**不提供任何形式的代理服务**，也不涉及任何网络节点的售卖、分发与推广。

## 📄 许可
本项目采用 [MIT 许可证](LICENSE)。

---

<div align="center">
  Made with ❤️ by XiaoM-OVO
</div>
