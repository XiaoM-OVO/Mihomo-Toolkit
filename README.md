<div align="center">

# 🛠️ Mihomo-Toolkit

**一套为 Mihomo 内核生态客户端设计的通用动态网络路由与策略组配置方案**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Clash Verge Rev](https://img.shields.io/badge/Clash_Verge_Rev-Compatible-success)](https://github.com/clash-verge-rev/clash-verge-rev)
[![Mihomo](https://img.shields.io/badge/Core-Mihomo-orange)](https://github.com/MetaCubeX/mihomo)
[![Version](https://img.shields.io/badge/version-2.7.0-brightgreen)](CHANGELOG.md)

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
- [⚙️ 配置详解](#️-配置详解)
- [🧹 图标与分组说明](#-节点清洗与分组结构)
- [❓ 常见问题](#-常见问题)

---

## ✨ 核心特性

- 🧹 **深度清洗去重**：去除冗余广告/倍率，拦截纯文本引流节点，保留落地城市。
- 🌍 **动态地区折叠**：小众地区自动归入大洲组，支持 Emoji 国旗动态捕获冷门国家。
- 🔀 **全场景分流**：内置广告、AI、游戏、影音、社交、金融等 20+ 常用分流。
- 🎨 **协议与状态图标**：支持展示节点底层协议（🦊/🛸/🐴等）及业务解锁状态。
- 🏷️ **机场标签前缀**：多机场订阅合并时自动/手动标注节点来源，面板来源一目了然。
- 🗑️ **DAG 级联清理**：自动删减空策略组与孤儿规则，保持内核配置纯净。
- ⚡ **性能防漏**：BT 直连防封、精准 TLS 指纹伪装、流量审计、TUN/DNS/Sniffer 深度优化。

---

## 🚀 快速开始

### 1. 下载脚本
从 [GitHub Releases](https://github.com/XiaoM-OVO/mihomo-toolkit/releases) 获取最新 `mihomo-toolkit.js`。

### 2. 客户端应用（以 Clash Verge Rev 为例）
- 进入「配置」页面，右键订阅 → **编辑拓展脚本**。
- 将脚本内容粘贴保存，点击「刷新订阅」即可生效。

> 💡 **全局脚本**：在 Clash Verge Rev 的「设置」-「全局拓展脚本」中粘贴，可使所有订阅共用同一份逻辑。

### 3. 个性化配置（可选）
打开脚本开头 `USER_CONFIG` 对象，按需开关（`true` 开启 / `false` 关闭）。如需添加自定义的新应用分流（例如 HBO、网易云等），请参阅下方 [常见问题](#-常见问题) 中的自定义分流教程。

---

## ⚙️ 配置详解

> 所有变量均在 `USER_CONFIG` 中，下方按功能模块分组。

<details>
<summary><b>🔧 基础全局配置</b></summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `enableScript` | `true` | 总开关 |
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
| `enableAI` | `true` | OpenAI/Gemini/Claude 独立组 |
| `enableTelegram` | `true` | Telegram 独立分流（自动适配各平台进程） |
| `enableYouTube` | `true` | YouTube 分流 |
| `enableNetflix` | `true` | Netflix 分流 |
| `enableBilibili` | `true` | 哔哩哔哩港澳台解锁 |
| `enableGame` | `true` | Steam/Epic/Riot/Blizzard/Nintendo 等游戏平台 |
| `enableSystemServices` | `true` | Microsoft/Apple/Google 框架服务 |

</details>

<details>
<summary><b>🧩 专项扩展（按需开启）</b></summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `enableAntiAD` | `false` | 激进去广告（anti-AD，强但易误杀） |
| `enableGitHub` | `true` | GitHub/GitLab 分流 |
| `enableScholar` | `true` | Google Scholar 等学术站 |
| `enableTikTok` | `false` | TikTok（自动过滤香港节点） |
| `enableSpotify` | `false` | Spotify 音乐流媒体 |
| `enableDisney` | `false` | Disney+ 流媒体 |
| `enableSocial` | `false` | Twitter/Meta/Discord 等社交 |
| `enableCrypto` | `false` | Binance 等加密货币 |
| `enablePayPal` | `false` | PayPal 金融支付 |
| `enableResidential` | `false` | 提取住宅/ISP 节点为高级备用 |
| `enableDomesticGroup` | `false` |「中国分流」策略组（搭配直连优先触发回国模式） |

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
| ✈️ | SS / SSR | ⚡ | Hysteria / Hysteria2 |
| 🦊 | VMess | 💨 | TUIC |
| 🛸 | VLESS | 🕸️ | WireGuard |
| 🐴 | Trojan | 🦈 | Snell |

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

检查三步：① 对应的 <code>enableXxx</code> 开关是否开启；② 对应 app 的策略组是否为空被 DAG 清理了（空组会被自动裁撤，导致规则回退到漏网之鱼）；③ <code>ruleProviderCDN</code> 是否可正常拉取规则集。
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

只需在脚本中搜索以下三个位置「打卡」即可，无需改动深层逻辑：<br>
① <b>建组</b>：搜索 <code>APP_GROUPS_REGISTRY</code>，按格式新增策略组条目；<br>
② <b>引流</b>：搜索 <code>FEATURE_MAP</code>，添加对应的规则集（<code>providers</code>）和分流路由（<code>rules</code>）；<br>
③ <b>美化</b>（可选）：搜索 <code>ICON_MAPPING</code>，为策略组配置在线图标。
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
- 图标库：[Orz-3/mini](https://github.com/Orz-3/mini) & [Koolson/Qure](https://github.com/Koolson/Qure)
- **AI 协同**：由本人架构，Gemini 代码生成，DeepSeek、Claude 参与代码审查与多轮对线压力测试而成。

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