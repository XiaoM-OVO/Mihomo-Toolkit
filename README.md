<div align="center">

# 🛠️ Mihomo-Toolkit

**一套为 Mihomo 内核生态客户端设计的通用动态网络路由与策略组配置方案**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Clash Verge Rev](https://img.shields.io/badge/Clash_Verge_Rev-Compatible-success)](https://github.com/clash-verge-rev/clash-verge-rev)
[![Mihomo](https://img.shields.io/badge/Core-Mihomo-orange)](https://github.com/MetaCubeX/mihomo)
[![Version](https://img.shields.io/badge/version-2.5.0-brightgreen)](CHANGELOG.md)

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

- 🧹 **深度清洗去重**：去除冗余广告/倍率，保留落地城市，自动打标（🤖 AI、📺 流媒体、🏠 家宽等）
- 🌍 **动态地区折叠**：小众地区自动归入大洲组，面板干净
- 🔀 **全场景分流**：内置广告、AI、游戏、影音、社交、金融等 20+ 常用分流
- 🎨 **在线图标**：支持一键切换 Emoji / 精美在线图标
- 🗑️ **DAG 级联清理**：自动删减空策略组与孤儿规则
- ⚡ **性能防漏**：BT 直连防封、QUIC 屏蔽、TUN/DNS/Sniffer 深度优化

---

## 🚀 快速开始

### 1. 下载脚本
从 [GitHub Releases](https://github.com/XiaoM-OVO/mihomo-toolkit/releases) 获取最新 `mihomo-toolkit.js`。

### 2. 客户端应用（以 Clash Verge Rev 为例）
- 进入「配置」页面，右键订阅 → **编辑拓展脚本**。
- 将脚本内容粘贴保存，点击「刷新订阅」即可生效。

> 💡 **全局脚本**：在 Clash Verge Rev 的「设置」-「全局拓展脚本」中粘贴，可使所有订阅共用同一份逻辑。

### 3. 个性化配置（可选）
打开脚本开头 `USER_CONFIG` 对象，按需开关（`true` 开启 / `false` 关闭）。

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

</details>

<details>
<summary><b>🧽 节点清洗与处理</b></summary>

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `enableDedupe` | `false` | 去重底层完全重复的注水节点 |
| `removeInfoNodes` | `false` | 过滤流量/到期等营销节点 |
| `keepDestinationCity` | `true` | 节点名后缀展示落地城市 |
| `lowMultiThreshold` | `0.99` | 倍率 ≤ 此值自动打上下载标签（0 关闭） |
| `isolateDownload` | `true` | 下载节点是否从普通池剔除 |

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
| `enableGame` | `true` | Steam/Epic 等游戏平台 |
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
| `enableDomesticGroup` | `false` | 新增「中国分流」策略组 |

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
| `enableBTDirect` | `true` | BT/PT 进程强制直连防封号 |
| `enableQUICReject` | `false` | 屏蔽 QUIC，防止 UDP 阻断 |
| `overwriteTun` | `true` | 覆写 TUN，强化路由与 IP 防漏 |
| `overwriteDns` | `true` | 覆写 DNS（Fake-IP + 防污染） |
| `overwriteSniffer` | `true` | 覆写 Sniffer，防 SNI 阻断 |
| `enableCoreOptimize` | `true` | 开启节点记忆、TCP 并发、指纹伪装 |

</details>

---

## 🧹 节点清洗与分组结构

### 🏷️ 节点特征图标

| 图标 | 含义 | 图标 | 含义 |
|------|------|------|------|
| 🤖 | OpenAI/ChatGPT | 🛡️ | AnyTLS / 安全协议 |
| ♊ | Google Gemini | 📱 | WAP 移动优化 |
| 🦀 | Anthropic Claude | ⏬ | 下载 / BT（低倍率） |
| 📺 | 流媒体解锁 | 🆓 | 免费/公益节点 |
| 🎮 | 游戏 / FullCone | 🏠 | 住宅 IP / 家宽 |
| ⚡ | HY2 / TUIC / 高速 | 🗑️ | 未识别节点 |

### 📂 动态生成的策略组
- **核心**：`📍 手动选择`、`🚀 自动选择`、`♻️ 故障转移`
- **地区独立组**：节点数 ≥ 阈值时自动生成（如 `🇭🇰 香港`、`🇯🇵 日本`）
- **大区折叠组**：小众地区收纳至 `🇪🇺 欧洲`、`🏝️ 东南亚`、`🌵 美洲` 或 `🌐 其他节点`
- **应用场景组**：依配置生成 `🤖 ChatGPT`、`🎬 Netflix`、`✈️ Telegram` 等
- **高级功能组**：`🏠 家宽专用`、`⏬ 下载策略`、`🇨🇳 中国分流` 等

---

## ❓ 常见问题

<details>
<summary><b>Q: 某些节点消失了或跑到了“其他/欧洲/东南亚”组？</b></summary>
由 <code>minorNodeThreshold</code> 控制（默认 3）。若某国节点少于该值，会折叠到大洲组。设 <code>1</code> 或 <code>0</code> 可强制独立建组。
</details>

<details>
<summary><b>Q: 如何隐藏“🗑️ 未知识别”组？</b></summary>
将 <code>hideGarbageGroup</code> 设为 <code>true</code>。
</details>

<details>
<summary><b>Q: Telegram/下载器进程规则不生效？</b></summary>
检查 <code>osType</code> 是否与当前系统匹配（<code>windows</code>/<code>mac</code>/<code>linux</code>/<code>all</code>），进程名依赖该变量。
</details>

<details>
<summary><b>Q: 开启 BT 防漏后，普通下载也会直连吗？</b></summary>
不会。BT 客户端（qBittorrent 等）强制直连，而多线程下载器（IDM/FDM）仍走 <code>⏬ 下载策略</code> 代理池。
</details>

<details>
<summary><b>Q: 如何将 Emoji 替换为在线图标？</b></summary>
将 <code>groupIconMode</code> 设为 <code>"icon"</code>，刷新后自动加载。
</details>

<details>
<summary><b>Q: 规则集拉取失败怎么办？</b></summary>
修改 <code>ruleProviderCDN</code> 为可用镜像，如 <code>https://cdn.jsdelivr.net/gh</code> 或 <code>https://ghproxy.com/</code>。
</details>

<details>
<summary><b>Q: 国内用户使用注意事项？</b></summary>
建议将 <code>ruleProviderCDN</code> 替换为国内镜像，并确保 <code>enableIPv6</code> 为 <code>false</code>（如无原生 IPv6）。
</details>

---

## 📦 更新日志
版本历史请参阅 [CHANGELOG.md](CHANGELOG.md)。

## 🙏 鸣谢
- 核心思路：[iczrac/Parsers-for-clash](https://github.com/iczrac/Parsers-for-clash)
- 基础内核：[Mihomo](https://github.com/MetaCubeX/mihomo)
- 规则集：[meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) & [anti-AD](https://github.com/privacy-protection-tools/anti-AD)
- 图标库：[Orz-3/mini](https://github.com/Orz-3/mini) & [Koolson/Qure](https://github.com/Koolson/Qure)

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