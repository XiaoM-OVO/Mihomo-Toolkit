<div align="center">

# 🛠️ Mihomo-Toolkit 动态路由策略组脚本

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Clash Verge Rev](https://img.shields.io/badge/Clash_Verge_Rev-Compatible-success)
![Mihomo](https://img.shields.io/badge/Core-Mihomo-orange)
![Version](https://img.shields.io/badge/version-2.4.0-brightgreen)

**一套为 Mihomo 内核生态客户端设计的通用动态网络路由与策略组配置方案**

「 **自动清洗** · **动态分组** · **智能分流** · **零维护** 」

</div>

---

> ⚠️ **环境说明**：本项目主要在 **Clash Verge Rev / Nyanpasu / FlClash** 等支持 JavaScript 覆写的 Mihomo 客户端上进行测试。理论上兼容所有支持 JS 预处理的 Mihomo UI。

## 📸 运行预览

<p align="center">
  <img src="https://github.com/user-attachments/assets/1ca6488b-21ba-4a69-9db5-1944290ad2aa" width="48%" />
  <img src="https://github.com/user-attachments/assets/21522b23-99d4-4922-9987-51569c1cc394" width="48%" />
  <br>
  <em>左：自动化策略组布局 | 右：节点清洗细节</em>
</p>

## 📌 快速导航
- [🚀 快速开始](#-快速开始)
- [✨ 核心特性](#-核心特性)
- [⚙️ 配置详解](#️-用户配置详解)
- [🧹 图标与分组说明](#-节点清洗与分组结构)
- [❓ 常见问题](#-常见问题)

---

## 🚀 快速开始

### 1. 获取脚本
从 [GitHub 仓库](https://github.com/XiaoM-OVO/mihomo-toolkit) 下载最新版 `mihomo-toolkit.js` 文件。

### 2. 客户端应用（以 Clash Verge Rev 为例）
1. 进入 `配置 (Profiles)` 页面。
2. 右键点击你的订阅 -> 选择 `拓展脚本 (Script)`。
3. 将脚本内容完整粘贴进去，保存并刷新订阅即可。
> 💡 **推荐**：使用右下角的 `全局拓展脚本` 功能，可实现多个订阅共享同一套规则与脚本。

### 3. 个性化配置（可选）
编辑脚本开头的 `USER_CONFIG` 对象，按需调整开关（`true` 为开启，`false` 为关闭）。

---

## ✨ 核心特性

- 🧹 **深度节点清洗与去重**：底层物理节点智能去重，精准剔除冗余广告、倍率符号，统一命名风格，自动打上功能图标（如 🤖 AI、📺 流媒体、🏠 家宽等）。
- 🌍 **动态地区折叠**：自动提取节点地区。小众地区（节点数不足阈值）将自动收纳至“欧洲”、“东南亚”、“美洲”或“其他”大区，告别面板杂乱。
- 🔀 **全场景智能分流**：内置涵盖 广告拦截、AI (GPT/Gemini/Claude)、学术、游戏、影音、社交、加密货币 等数十种常用分流规则。
- 🎨 **在线图标与 UI 净化**：支持一键擦除原生 Emoji，并为所有策略组动态注入在线精美图标（内置多套主流图标库）。
- 🗑️ **DAG 级联清理引擎**：自动诊断并斩首空策略组，并向下级联清理殉葬的分流规则与孤儿规则集，确保配置文件极致纯净。
- ⚡ **极致性能调优**：深度接管 Mihomo 内核核心参数，支持 TUN/DNS/Sniffer 覆写，开启 TCP 并发、TLS 指纹伪装与 Fake-IP 持久化。

---

## ⚙️ 用户配置详解

在脚本顶部的 `USER_CONFIG` 中，你可以自由定制属于你的网络环境：

### 1. 基础与常用分流
| 开关变量 | 默认值 | 功能说明 |
|:---|:---:|:---|
| `enableScript` | `true` | 🟢 **总开关**，设为 `false` 则原样输出订阅，不做任何修改 |
| `enableAdBlock` | `true` | 🚫 **广告拦截**：网页及 APP 广告屏蔽 |
| `enableAI` | `true` | 🤖 **AI 助手**：OpenAI / Gemini / Claude 独立策略组 |
| `enableGitHub` | `true` | 🐱 **GitHub**：开发者常用分流 |
| `enableTelegram` | `true` | ✈️ **Telegram**：独立分流（自动适配各平台进程） |
| `enableScholar` | `true` | 🎓 **学术研究**：Google Scholar 等学术站点 |
| `enableNetflix` | `true` | 🎬 **Netflix**：奈飞流媒体分流 |
| `enableBilibili` | `true` | 📺 **哔哩哔哩**：港澳台番剧加速 |
| `enableGame` | `true` | 🎮 **游戏平台**：Steam, Epic 等加速 |

### 2. 专项场景增强
| 开关变量 | 默认值 | 功能说明 |
|:---|:---:|:---|
| `enableTikTok` | `false` | 🎵 **TikTok**：自动过滤香港节点，确保护播 |
| `enableCrypto` | `false` | 🪙 **加密货币**：Binance 等主流交易平台分流 |
| `enablePayPal` | `false` | 💳 **PayPal**：金融支付分流（推荐直连优先） |
| `enableDomesticGroup` | `false` | 🇨🇳 **中国分流**：新增专门的“中国”策略组 |
| `enableResidential` | `false` | 🏠 **家宽分流**：自动优选住宅/ISP 节点（AI/流媒体首选） |

### 3. 路由逻辑与面板优化
| 参数变量 | 默认值 | 功能说明 |
|:---|:---:|:---|
| `proxyFirst` | `true` | 🧭 **路由偏好**：`true`(代理优先)；`false`(直连优先) |
| `osType` | `"windows"` | 💻 **设备类型**：可选 `windows`/`mac`/`linux`/`all`，用于进程规则 |
| `enableIPv6` | `false` | 🌐 **IPv6 总开关**：控制全局 IPv6（无 IPv6 环境请务必关闭） |
| `removeInfoNodes` | `false` | 🗑️ **纯净节点**：彻底删除流量说明/到期时间等通知类节点 |
| `hideGarbageGroup` | `false` | 🙈 **隐藏垃圾桶**：强制不在面板显示“🗑️ 未知识别”策略组 |

### 4. 核心性能与策略组高级参数
| 参数变量 | 默认值 | 功能说明 |
|:---|:---:|:---|
| `useMRS` | `true` | 🚀 **规则集格式**：`true` 二进制高性能 MRS，`false` 兼容型 YAML |
| `minorNodeThreshold`| `3` | 📊 **小众地区阈值**：同地区节点数 `>= 3` 独立建组，否则折叠至大区 |
| `regionGroupType` | `"url-test"` | ⚙️ **地区组行为**：可选 `url-test`(自动测速), `select`(手动), `fallback`(故障转移) |
| `enableRegionHashLB`| `false` | ⚖️ **地区哈希负载均衡**：为主流地区自动创建一致性哈希负载均衡池（适合需 IP 会话保持的场景，如网银、游戏） |

### 5. 底层核心配置覆写与体验优化
> 💡 开启后脚本会强制接管客户端原有配置，获取最佳内核性能与分流体验。

| 开关变量 | 默认值 | 功能说明 |
|:---|:---:|:---|
| `overwriteTun` | `true` | 🖧 **覆写 TUN**：强制优化虚拟网卡配置，严防真实 IP 泄漏 |
| `overwriteDns` | `true` | 📡 **覆写 DNS**：强制使用 Fake-IP + 纯净分流 DNS 体系 |
| `overwriteSniffer` | `true` | 🔎 **覆写嗅探**：开启深度包检测，解决流媒体/CDN 分流不准问题 |
| `enableCoreOptimize` | `true` | ⚙️ **覆写体验**：开启节点记忆、统一延迟、TCP 并发与指纹伪装等内核高级特性 |

### 6. UI 面板与策略组图标设置
| 参数变量 | 默认值 | 功能说明 |
|:---|:---:|:---|
| `groupIconMode` | `"emoji"` | 🎨 **图标模式**：`"emoji"`(仅保留原生Emoji，兼容性最佳)，`"icon"`(清除Emoji，在线拉取精美图标)，`"both"`(我全都要)|

---

## 🧹 节点清洗与分组结构

### 🏷️ 节点图标字典
脚本清洗节点时，会自动识别并打上以下特征图标：

| 图标 | 含义 | 图标 | 含义 |
|:---:|:---|:---:|:---|
| 🤖 | OpenAI / ChatGPT | 🛡️ | AnyTLS / 安全协议 |
| ♊ | Google Gemini | 📱 | WAP 移动优化网络 |
| 🦀 | Anthropic Claude | ⏬ | 下载 / BT 专用（低倍率节点） |
| 📺 | 流媒体访问解锁 (NF/DP 等) | 🆓 | 免费 / 公益节点 |
| 🎮 | 游戏加速 / FullCone | 🏠 | 住宅 IP / 家宽 / 双ISP |
| ⚡ | HY2 / TUIC / 高速协议 | 🗑️ | 清洗失败 / 未知节点 |

### 📂 动态生成的策略组 (Proxy-Groups)
根据你的订阅内容和开关设置，面板会自动呈现以下精简结构：

*   **📍 核心控制台**：`📍 手动选择`、`🚀 自动选择`、`♻️ 故障转移`。
*   **🌍 地区独立组**：如 `🇭🇰 香港`、`🇹🇼 台湾`、`🇯🇵 日本`、`🇸🇬 新加坡`、`🇺🇸 美国` 等（节点数 ≥ 阈值自动生成）。
*   **🗺️ 大区折叠组**：不足阈值的小众节点，自动收纳至 `🇪🇺 欧洲`、`🏝️ 东南亚`、`🌵 美洲` 或 `🌐 其他节点`。
*   **📱 应用场景组**：根据开启的配置生成 `🤖 ChatGPT`、`🎬 Netflix`、`✈️ Telegram` 等。
*   **⚙️ 高级功能组**：`🏠 家宽专用`、`⏬ 下载策略`、`🇨🇳 中国分流`、`🌐 IPv6控制台` 等。

---

## ❓ 常见问题

<details>
<summary><b>Q1: 为什么我的部分节点不见了，或者都跑到了“其他 / 欧洲 / 东南亚”组？</b></summary>
<br>
A: 脚本具备<b>小众地区折叠功能</b>。由 <code>minorNodeThreshold</code>（默认: 3）控制。如果某个国家的节点少于 3 个，脚本为了保持面板整洁，会将其合并到对应的大洲组（如“欧洲节点”）。如果你希望所有国家都独立建组，请将该阈值设为 <code>1</code> 或 <code>0</code>。
</details>

<details>
<summary><b>Q2: 为什么开启 IPv6 (enableIPv6: true) 后无法上网？</b></summary>
<br>
A: 请确认您的本地宽带/移动网络是否支持原生的 IPv6 协议。如果不确定或不支持，<b>请务必将 <code>enableIPv6</code> 保持为 <code>false</code></b>，否则会导致部分优先解析 IPv6 的网站无法打开。
</details>

<details>
<summary><b>Q3: 我不想在面板看到“🗑️ 未知识别”这个组怎么办？</b></summary>
<br>
A: 在配置文件中，将 <code>hideGarbageGroup</code> 设置为 <code>true</code>，即可全局隐藏垃圾桶策略组。
</details>

<details>
<summary><b>Q4: Telegram 进程规则为什么不生效？</b></summary>
<br>
A: 请检查 <code>osType</code> 是否匹配你当前的系统（可选: <code>windows</code> / <code>mac</code> / <code>linux</code> / <code>all</code>）。不同操作系统的 Telegram 进程名称有所不同，脚本会根据该变量自动适配。
</details>

<details>
<summary><b>Q5: 什么是“地区哈希负载均衡 (enableRegionHashLB)”？</b></summary>
<br>
A: 开启后，脚本会为所有独立成组的地区（节点数达标）自动创建一致性哈希 (Consistent-Hashing) 组。同一个来源 IP 的所有请求会固定打到同一个节点上，缓解“IP频繁跳动导致网银风控或游戏掉线”的问题。该组默认在面板<b>隐藏</b>，由对应地区策略组自动调用。
</details>

<details>
<summary><b>Q6: 如何去除面板策略组中的 Emoji 并替换为精美在线图标？</b></summary>
<br>
A: 脚本默认使用兼容性极佳的 <code>emoji</code> 模式。如果你的客户端支持在线图标渲染（如 Clash Verge Rev），请在配置区的第 7 项中，将 <code>groupIconMode</code> 设为 <code>"icon"</code>，保存刷新后即可自动加载美观的在线彩色 Icon。
</details>

<details>
<summary><b>Q7: 规则集拉取失败，提示网络错误？</b></summary>
<br>
A: 检查网络是否能访问 Github 相关域名。你可以修改 <code>ruleProviderCDN</code> 变量，将其替换为其他可用的 CDN 镜像源（如 <code>https://cdn.jsdelivr.net/gh</code> 等）。
</details>

---

## 🙏 鸣谢与组件来源

- **核心思路与灵感**：[iczrac/Parsers-for-clash](https://github.com/iczrac/Parsers-for-clash)
- **内核及现代规则集**：[Mihomo (Meta)](https://github.com/MetaCubeX/mihomo) & [meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)
- **精美图标合集**：[Orz-3/mini](https://github.com/Orz-3/mini) & [Koolson/Qure](https://github.com/Koolson/Qure)
- **AI 协同**：由人类架构，通过 Gemini、DeepSeek、Claude 等 AI 模型多轮对线压力测试而成。

## ⚠️ 免责声明

1. 本项目提供的代码、脚本与配置仅供**个人进行计算机网络调试、路由规则学习与研究网络连通性架构**使用。
2. 请严格遵守您所在国家及地区的法律法规，**严禁将本项目用于任何非法或违反当地法律的用途**。
3. 因使用本项目所产生的任何直接或间接后果，**均由使用者本人自行承担**。作者及贡献者不承担任何技术或法律连带责任。
4. 本项目仅为代码工具，**不提供任何形式的代理服务**，也不涉及任何网络节点的售卖、分发与推广。

## 📄 许可协议

本项目采用 [MIT 许可证](LICENSE)。

---

<div align="center">
  Made with ❤️ by XiaoM-OVO
</div>