<div align="center">

# 🛠️ Mihomo-Toolkit 动态路由策略组脚本

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Clash Verge Rev](https://img.shields.io/badge/Clash_Verge_Rev-Compatible-success)
![Mihomo](https://img.shields.io/badge/Core-Mihomo-orange)
![Version](https://img.shields.io/badge/version-2.1.3-brightgreen)

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
- [⚙️ 配置详解](#️-用户配置详解)
- [🧹 节点清洗说明](#-节点清洗图标说明)
- [❓ 常见问题](#-常见问题)

## ✨ 特性

- **自动节点清洗**：去除多余符号、倍率标识、线路信息，统一命名风格，并添加功能图标（AI、流媒体、游戏等）。
- **动态策略组**：根据节点地区自动生成香港、台湾、日本、新加坡、美国、欧洲等策略组，支持 `url-test` / `select` / `fallback` 三种行为。
- **智能分流**：内置广告拦截、AI 服务（OpenAI/Gemini/Claude）、学术网站、游戏平台、影音娱乐、社交、加密货币等常用分流规则。
- **零维护**：订阅节点变化后自动重新分组，无需手动调整配置。
- **灵活配置**：提供 30+ 开关选项，可自由开启/关闭功能、调整路由偏好、设备类型、IPv6、TUN/DNS/Sniffer 覆写等。
- **高性能**：支持 MRS 格式规则集，减少内存占用，提升规则匹配速度。

## 🚀 快速开始

### 1. 获取脚本

从 [GitHub 仓库](https://github.com/XiaoM-OVO/mihomo-toolkit) 下载 `mihomo-toolkit.js` 文件。

### 2. 在客户端中应用
- **Clash Verge Rev**: 
  1. 进入 `配置 (Profiles)` 页面。
  2. 右键点击你的订阅 -> `拓展脚本 (Script)`。
  3. 将脚本内容替换进去，刷新订阅。
  4. (推荐) 使用右下角的 `全局拓展脚本` 功能，可以实现多个订阅共享同一个脚本。

### 3. 个性化配置（可选）

编辑 `mihomo-toolkit.js` 文件开头的 `USER_CONFIG` 对象，按需调整开关和参数。所有选项均有详细注释。

## ⚙️ 用户配置详解

`USER_CONFIG` 位于脚本顶部，分为六大类，默认推荐配置可直接使用。

### 1. 脚本总控

| 变量 | 说明 |
|------|------|
| `enableScript` | 🟢 总开关，设为 `false` 则原样输出订阅，不做任何修改。 |

### 2. 常用功能分流

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `enableAdBlock` | `true` | 🚫 **广告拦截**：网页及 APP 广告屏蔽 |
| `enableAI` | `true` | 🤖 **AI 助手**：OpenAI / Gemini / Claude 独立策略组 |
| `enableGitHub` | `true` | 🐱 **GitHub**：开发者常用分流 |
| `enableTelegram` | `true` | ✈️ **Telegram**：独立分流（支持各平台进程规则） |
| `enableScholar` | `true` | 🎓 **学术研究**：Google Scholar 等学术站点 |
| `enableYouTube` | `true` | ▶️ **YouTube**：全球最大视频平台独立分流 |
| `enableNetflix` | `true` | 🎬 **Netflix**：奈飞流媒体分流 |
| `enableDisney` | `false` | 🪄 **Disney+**：迪士尼流媒体分流 |
| `enableBilibili` | `true` | 📺 **哔哩哔哩**：港澳台番剧加速 |
| `enableGame` | `true` | 🎮 **游戏平台**：Steam、Epic 等加速 |
| `enableSystemServices` | `true` | 🪟 **系统服务**：Microsoft / Apple / Google 云端服务 |

### 3. 专项场景分流

| 变量 | 说明 |
|------|------|
| `enableTikTok` | 🎵 **TikTok**：自动过滤香港节点，确保护播 |
| `enableSpotify` | 🎧 **Spotify**：音乐流媒体独立分流 |
| `enableSocial` | 💬 **海外社交**：Twitter / Facebook / Instagram / Discord |
| `enableCrypto` | 🪙 **加密货币**：Binance 等主流交易平台 |
| `enablePayPal` | 💳 **PayPal**：金融支付分流（推荐直连优先） |
| `enableDomesticGroup` | 🇨🇳 **中国分流**：新增专门的“中国分流”策略组 |
| `enableResidential` | 🏠 **家宽分流**：自动优选住宅/ISP 节点（AI/流媒体首选） |

### 4. 路由逻辑与设备优化

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `proxyFirst` | `true` | 🧭 **路由偏好**：`true`(代理优先)；`false`(直连优先) |
| `osType` | `"windows"` | 💻 **设备类型**：可选 `windows`/`mac`/`linux`/`all`，影响进程规则 |
| `enableQUICReject` | `false` | ⚡ **屏蔽 QUIC**：强制降级至 TCP，减少 UDP 丢包导致的卡顿 |
| `enableIPv6` | `false` | 🌐 **IPv6 总开关**：控制全局 IPv6 路由（无环境请务必关闭） |
| `removeInfoNodes` | `false` | 🗑️ **纯净节点**：彻底过滤流量/到期时间等营销节点名称 |

### 5. 核心性能与策略组高级参数

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `useMRS` | `true` | 🚀 **性能模式**：使用二进制 MRS 规则集（高性能），`false` 使用 YAML(高兼容) |
| `regionGroupType` | `"url-test"` | ⚙️ **地区组行为**：`url-test`(自动)，`select`(手动)，`fallback`(故障转移) |
| `testInterval` | `300` | 🕒 **测速间隔**：单位为秒，控制自动测速的频率 |
| `testTolerance` | `50` | ⚖️ **切换阈值**：延迟差低于此值时不频繁切换节点，保持连接稳定 |
| `testURL` | `...` | 🔗 **测速地址**：延迟测试使用的 URL 地址 |
| `ruleProviderCDN` | `...` | 🌐 **规则集 CDN**：规则拉取失败时可更换镜像源 |

### 6. 底层核心配置覆写

| 变量 | 说明 | 推荐场景 |
|------|------|------|
| `overwriteTun` | 🖧 **覆写 TUN**：强制优化虚拟网卡配置，严防流量泄漏 | 全局代理且关注隐私/极致防泄漏 |
| `overwriteDns` | 📡 **覆写 DNS**：强制使用 Fake-IP + 纯净分流 DNS 体系 | 遇到 DNS 污染或网页解析异常时开启 |
| `overwriteSniffer` | 🔎 **覆写嗅探**：开启深度包检测，识别真实域名 | 解决流媒体、CDN 节点分流不准的问题 |

## 🧹 节点清洗图标说明

脚本会自动为节点名称添加以下图标：

| 图标 | 含义 |
|------|------|
| 🤖 | OpenAI / ChatGPT |
| ♊ | Google Gemini |
| 🦀 | Anthropic Claude |
| 📺 | 流媒体解锁（Netflix、Disney+ 等） |
| 🎮 | 游戏 / FullCone |
| ⚡ | Hysteria 协议 / 高速 |
| 🛡️ | AnyTLS / 安全协议 |
| 📱 | WAP 移动优化 |
| ⏬ | 低倍率节点 / 下载专用 |
| 🆓 | 免费 / 公益节点 |
| 🗑️ | 清洗失败节点 |
| 🏠 | 住宅 IP / 家宽 / 双ISP |

## 📂 生成的策略组结构

执行脚本后，`proxy-groups` 将包含以下组（自动按节点存在情况显示）：

### 核心控制组
- `📍 手动选择`：所有地区组 + 自动选择 + 故障转移 + DIRECT + 信息节点
- `🚀 自动选择`：自动测速选优（所有标准节点）
- `♻️ 故障转移`：地区组 + DIRECT 按顺序回退

### 地区分组（动态生成）
- `🇭🇰 香港节点` / `🇹🇼 台湾节点` / `🇯🇵 日本节点` / `🇰🇷 韩国节点` / `🇸🇬 新加坡节点` / `🇺🇸 美国节点` / `🇪🇺 欧洲节点` / `🏝️ 东南亚节点` / `🇨🇳 大陆节点` / `🌐 其他节点` / `🗑️ 未知识别`

### 应用分组（可选）
- AI 三组：`🤖 OpenAI` / `♊ Gemini` / `🦀 Claude`
- 影音：`▶️ YouTube` / `🎬 Netflix` / `🪄 Disney+` / `📺 哔哩哔哩`
- 社交：`💬 社交平台` / `✈️ Telegram` / `🎵 TikTok`
- 开发：`🐱 GitHub`
- 金融：`💳 PayPal` / `🪙 加密货币`
- 其他：`🎓 学术网站` / `🎮 游戏服务` / `🎧 Spotify` / `🪟 Microsoft` / `🔍 Google` / `🍎 Apple` / `🚫 广告拦截`

### 高级组
- `🏠 家宽专用`（需开启 `enableResidential`）
- `⚖️ 负载均衡` 及 `⚖️ 负载均衡轮询池`（存在下载类节点时）
- `🇨🇳 中国分流`（需开启 `enableDomesticGroup`）
- `🌐 IPv6控制台`（需开启 `enableIPv6`）

### 最终兜底
- `🐟 漏网之鱼`：根据 `proxyFirst` 决定代理优先还是直连优先。

## 📜 规则集与分流逻辑

脚本会自动拉取 [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) 中的规则集，并根据开关组合生成 `rules` 和 `rule-providers`。

- **基础规则**：内网地址、BT 下载、直连域名与 IP。
- **功能规则**：广告、AI、学术、游戏、影音等（按开关动态包含）。
- **进程规则**：Telegram、BT 下载工具、IDM 等（根据 `osType` 适配）。
- **CN 分流顺序**：`proxyFirst = true` 时先走非 CN 规则，反之先走 CN 规则，确保国内流量直连。
- **最终 MATCH**：落入“漏网之鱼”策略组。

## 🔧 覆写配置说明

开启 `overwriteTun` / `overwriteDns` / `overwriteSniffer` 后，脚本会强制替换客户端原有配置，以获得最佳兼容性和分流准确性。若您有自己的高级配置，可以关闭对应开关。

## ❓ 常见问题

### Q1：节点没有正确分类，都进了“未知识别”？
- 检查节点名称是否包含地区关键词（如“香港”、“HK”、“Japan”等），若不包含，脚本无法识别。您可以手动修改节点名或在 `REGION_DEFS` 中添加自定义正则。

### Q2：开启 IPv6 后无法上网？
- 请确认您的本地网络环境是否支持 IPv6。多数家庭宽带无原生 IPv6，请将 `enableIPv6` 设为 `false`。同时检查 TUN 模式下的 `strict-route` 是否与 IPv6 冲突。

### Q3：负载均衡策略组未出现？
- 需要至少一个节点名称包含“下载”/“BT”图标（脚本自动识别低倍率节点），或您手动添加了相关关键词。

### Q4：Telegram 进程规则不生效？
- 请确保 `osType` 设置正确（Windows 下为 `windows`，macOS 为 `mac`，Linux 为 `linux`）。不同客户端的进程名可能略有差异，您可自行修改规则。

### Q5：如何让某些流量强制直连？
- 将对应规则的目标策略组改为 `DIRECT`，或利用 `enableDomesticGroup` 配合规则集实现更细粒度控制。

### Q6：规则集更新失败？
- 检查网络是否能访问 `raw.githubusercontent.com` 或您配置的 CDN。可以更换 `ruleProviderCDN` 为其他镜像源。

## 🙏 鸣谢与组件来源

- **核心思路与灵感**：[iczrac/Parsers-for-clash](https://github.com/iczrac/Parsers-for-clash)
- **内核及现代规则集**：[Mihomo (Meta)](https://github.com/MetaCubeX/mihomo) & [meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)
- **AI 协同**：由人类架构，通过 Gemini、DeepSeek 等 AI 模型对线压力测试而成。


## ⚠️ 免责声明

1. 本项目提供的所有代码、脚本与配置仅供**个人进行计算机网络调试、路由规则学习与研究网络连通性架构**使用。
2. 请务必严格遵守您所在国家及地区的法律法规，**严禁将本项目用于任何非法或违反当地法律的用途**。
3. 因使用本项目（包括但不限于修改配置、导致流量异常、网络安全故障或违反服务商条款）所产生的任何直接或间接后果，**均由使用者本人自行承担**。项目作者及贡献者不承担任何技术或法律上的连带责任。
4. 本项目仅为代码工具，**不提供任何形式的代理服务**，也不涉及任何网络节点的售卖、分发与推广。

## 📄 许可

本项目采用 [MIT 许可证](LICENSE)。

---

<div align="center">
  Made with ❤️ by XiaoM-OVO
</div>