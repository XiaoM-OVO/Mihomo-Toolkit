<div align="center">

# 🛠️ Mihomo-Toolkit

**一套为 Mihomo 内核生态客户端设计的通用动态网络路由与策略组配置方案**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Clash Verge Rev](https://img.shields.io/badge/Clash_Verge_Rev-Compatible-success)](https://github.com/clash-verge-rev/clash-verge-rev)
[![Mihomo](https://img.shields.io/badge/Core-Mihomo-orange)](https://github.com/MetaCubeX/mihomo)
[![Version](https://img.shields.io/badge/version-3.0.0-brightgreen)](CHANGELOG.md)

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
  - [主脚本 (Clash Verge Rev)](#1-下载脚本)
  - [节点清洗脚本 (Sub-Store)](#-sub-store-节点清洗脚本)
- [⚙️ 配置详解](#️-配置详解)
- [🧹 图标与分组说明](#-节点清洗与分组结构)
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

---

## 🚀 快速开始

### 1. 下载脚本
从 [GitHub Releases](https://github.com/XiaoM-OVO/mihomo-toolkit/releases) 获取最新 `mihomo-toolkit.js`。

### 2. 客户端应用（以 Clash Verge Rev 为例）
- 进入「配置」页面，右键订阅 → **编辑拓展脚本**。
- 将脚本内容粘贴保存，点击「刷新订阅」即可生效。

> 💡 **全局脚本**：在 Clash Verge Rev 的「订阅」-「全局拓展脚本」中粘贴，可使所有订阅共用同一份逻辑。

### 3. 个性化配置（可选）
打开脚本开头 `USER_CONFIG` 对象，按需开关（`true` 开启 / `false` 关闭）。如需添加自定义的新应用分流（例如 HBO、网易云等），请参阅下方 [常见问题](#-常见问题) 中的自定义分流教程。

---

## 🧩 Sub-Store 节点清洗脚本

专为 [Sub-Store](https://github.com/sub-store-org/Sub-Store) 平台设计的独立节点清洗脚本 (`sub-store/pure-nodes.js`)，将主脚本的节点处理核心逻辑解耦为 operator 格式，适用于**仅需节点过滤/去重/重命名，不需要完整策略组与分流体系**的场景。

### 功能对比

| 能力 | 主脚本 (mihomo-toolkit.js) | 清洗脚本 (pure-nodes.js) |
|------|---------------------------|--------------------------|
| 节点去重 / 垃圾拦截 | ✅ | ✅ |
| 倍率 / 线路 / 落地城市提取 | ✅ | ✅ |
| 协议图标 / 特征图标 | ✅ | ✅ |
| 机场标签前缀 | ✅ | ✅ |
| 策略组 / 分流规则生成 | ✅ | ❌ |
| DNS / TUN / Sniffer 覆写 | ✅ | ❌ |
| 输出格式 | Mihomo 配置 | `array` 或 `object`(含 meta) |

### 快速使用

1. 在 Sub-Store 中进入「订阅管理」→ 选择目标订阅 →「编辑」→「节点操作」
2. 将 `sub-store/pure-nodes.js` 内容粘贴到脚本编辑区
3. 可选：修改脚本顶部 `CONFIG` 对象配置（或通过 Sub-Store 外部传入 `userConfig`）
4. 保存并刷新订阅

### 配置要点

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `outputMode` | `"array"` | `"array"` 纯节点数组（兼容常规流程），`"object"` 返回含 meta 元数据 |
| `blockKeywords` | `[]` | 自定义黑名单关键词（如 `["免费领取", "点击购买"]`） |
| `blockServers` | `[]` | 自定义黑名单服务器地址 |
| `adTextThreshold` | `12` | 广告文本阈值（比主脚本默认 6 更宽松，降低 Sub-Store 误杀率） |

> 💡 其他参数（`enableDedupe`、`keepDestinationCity`、`showProtocolIcon` 等）与主脚本同名配置语义一致。

---

## ⚙️ 配置详解

> 所有变量均在 `USER_CONFIG` 中，下方按功能模块分组。

<details>
<summary><b>🔧 基础全局配置</b></summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `enableScript` | `true` | 总开关 |
| `enableDebugLog` | `false` | 节点清洗日志开关 |
| `osType` | `"windows"` | 设备类型：`windows`/`mac`/`linux`/`all` |
| `proxyFirst` | `true` | `true` 代理优先，`false` 直连优先 |
| `defaultProxyMode` | `"auto"` | 默认策略：`auto`/`manual`/`fallback` |
| `enableIPv6` | `false` | 全局 IPv6（无物理 IPv6 请务必关闭） |
| `enableAirportTag` | `false` | 多机场订阅时自动/手动添加 `[标签]` 前缀 |
| `airportTag` | `""` | 手动指定标签关键词（逗号分隔），为空则自动检测 `[xxx]` |

</details>

<details>
<summary><b>🧽 节点清洗与处理</b></summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `enableDedupe` | `false` | 去重底层完全重复的注水节点 |
| `removeInfoNodes` | `false` | 过滤流量/到期等信息节点 |
| `keepDestinationCity` | `true` | 节点名后缀展示落地城市 |
| `showProtocolIcon` | `false` | 在节点名前展示底层协议图标(🦊 VMess等) |
| `strictRegionMatch` | `false` | 严格地区匹配(关闭则允许 Emoji 动态捕获冷门国家) |
| `adTextThreshold` | `6` | 纯文本广告拦截阈值(超过此长度的纯文字视作广告) |
| `lowMultiThreshold` | `0.99` | 倍率 ≤ 此值自动打上下载标签（0 关闭） |
| `isolateDownload` | `false` | 低倍率节点是否从普通池剔除 |

</details>

<details>
<summary><b>📱 核心分流开关</b></summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `enableAdBlock` | `true` | 广告拦截 |
| `enableAI` | `true` | AI 助手：OpenAI/Gemini/Claude/Copilot（具体 key 在 `AI_SERVICES` 数组中增删） |
| `enableTelegram` | `true` | Telegram 独立分流（自动适配各平台进程） |
| `enableStreaming` | `true` | 流媒体服务总开关（具体平台在 `STREAMING_SERVICES` 数组中增删，支持 YouTube/Netflix/Bilibili/Disney+/TikTok/Spotify/巴哈姆特/Pixiv/Twitch + 自定义） |
| `enableGame` | `true` | Steam/Epic/Riot/Blizzard/Nintendo 等游戏平台 |
| `enableSystemServices` | `true` | Microsoft/Apple/Google 框架服务 |
| `enableDomesticGroup` | `false` |「中国分流」策略组（搭配直连优先触发回国模式） |

</details>

<details>
<summary><b>🧩 专项扩展（按需开启）</b></summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `enableAntiAD` | `false` | 激进去广告（anti-AD，强但易误杀） |
| `enableGitHub` | `true` | GitHub/GitLab 分流 |
| `enableScholar` | `true` | Google Scholar 等学术站 |
| `enableSocial` | `false` | 海外社交平台（具体 key 在 `SOCIAL_SERVICES` 数组中增删，支持 Twitter/Facebook/Instagram/Discord + 自定义） |
| `enableCrypto` | `false` | Binance 等加密货币 |
| `enablePayPal` | `false` | PayPal 金融支付 |
| `enableResidential` | `false` | 提取住宅/ISP 节点为高级备用 |

</details>

<details>
<summary><b>🎨 策略组与 UI 面板</b></summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `minorNodeThreshold` | `3` | 小众地区独立建组阈值（低于此值折叠） |
| `regionGroupType` | `"url-test"` | 地区组行为：`url-test`/`select`/`fallback` |
| `enableRegionHashLB` | `false` | 为达标地区增加哈希负载均衡组 |
| `hideGarbageGroup` | `false` | 隐藏「未知识别」组 |
| `groupIconMode` | `"emoji"` | `"emoji"`/`"icon"`/`"both"` |

</details>

<details>
<summary><b>⚙️ 底层防漏与内核优化</b></summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `enableProcessDirect` | `true` | 指定进程强制直连（默认内置主流 BT 软件，支持自定义追加） |
| `enableTrafficAudit` | `true` | 流量审计，非 53/80/443 端口强制直连防断流 |
| `enableQUICReject` | `false` | 屏蔽 QUIC，防止 UDP 阻断 |
| `overwriteTun` | `true` | 覆写 TUN，强化路由与 IP 防漏 |
| `overwriteDns` | `true` | 覆写 DNS（Fake-IP + 防污染，回国模式自动交换 DNS） |
| `overwriteSniffer` | `true` | 覆写 Sniffer，防 SNI 阻断 |
| `enableCoreOptimize` | `true` | 开启节点记忆、精准指纹伪装、TCP 并发优化 |

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
- **高级功能组**：`🏠 家宽专用`、`⏬ 下载策略`、`🇨🇳 中国分流` 等

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

开启 `enableAirportTag` 后，脚本会自动提取节点名中的 `[xxx]` 方括号标识作为来源标签。推荐配合订阅转换工具，用正则将节点名开头（`^`）替换为 `[标签名]`，即可批量打标；若节点名不含方括号，也可通过 `airportTag` 手动指定匹配关键词（逗号分隔），脚本会按关键词检索并添加前缀。
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