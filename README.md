<div align="center">

# 🛠️ Mihomo-Toolkit 动态路由策略组脚本

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Clash Verge Rev](https://img.shields.io/badge/Clash_Verge_Rev-Compatible-success)
![Mihomo](https://img.shields.io/badge/Core-Mihomo-orange)

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

## 📦 版本说明

| 版本 | 文件名 | 适用人群 | 核心特性 |
|------|--------|----------|----------|
| **精简版** | `mihomo-toolkit.js` | 进阶用户 / 手工党 | 节点清洗、策略组构建、分流规则。**不干涉** DNS/TUN/Sniffer，需用户自行管理底层配置。 |
| **完整版** | `mihomo-toolkit-all.js` | 普通用户 / 追求省心 | **全自动一体化**。在精简版基础上，额外接管 TUN 严格路由、Fake-IP 黑名单模式、国内/国际 DNS 分流策略、TLS/HTTP 流量嗅探。开箱即用。 |

> ⚠️ **完整版注意**：该脚本会**覆盖**您现有的 DNS、TUN 及 Sniffer 配置。若您已有手动的底层优化（例如自建 DNS 策略、TUN 栈调整），请改用精简版或自行合并。

## ✨ 核心特性

### 🧼 节点标准化处理 (Node Processing)
- **结构化重命名**：自动识别地区、倍率、线路特征（IEPL/CN2 等），去除服务商名称等冗余杂质。
- **信息节点收容**：自动将“剩余流量/服务商通知”等非路由节点剥离，防止干扰正常代理选择。
- **未知节点容错**：无法识别的节点自动进入**🗑️ 未知识别**组，防止正则失效导致节点丢失。
- **可视化标注**：
  - 🤖 `OpenAI/ChatGPT` | ♊ `Gemini` | 🦀 `Claude` | 📺 `流媒体`
  - 🎮 `游戏/FullCone` | ⚡ `Hysteria` | 🛡️ `安全协议` | 📱 `WAP 优化`
  - ⏬ `下载/BT` | 🆓 `免费/公益` | 🗑️ `清洗失败节点`

### 🛠️ 动态策略引擎 (Dynamic Policy Group)
- **UI 空间管理**：自动扫描节点分布，**无节点的地区与功能组自动隐藏**，保持客户端面板极致清爽。
- **安全与流量控制**：
  - **低倍率隔离**：自动将低倍率节点剥离进“下载负载均衡池”，防止 P2P 下载或大流量测速消耗核心节点额度。
  - **P2P 阻断**：内置进程识别 + Tracker 规则集，严格阻断 BT/PT 流量进入代理隧道。
- **场景化智能分流**：
  - **AI & 学术**：针对 OpenAI / Gemini / Claude 及学术文献库，自动匹配高连通率区域节点。
  - **数字娱乐**：Steam / Epic 商店直连优化，跨区域流媒体（Netflix / YouTube / 特定区域服务）精准路由。

---

## 🚀 部署指南

### 方案 A：使用“完整版”一键接管（推荐小白使用）
1. 进入客户端的 **订阅 / Profiles** 界面。
2. 找到对应的配置，右键或点击扩展菜单，选择 **编辑规则 / 拓展脚本 (Extend Script)**。
3. 将 `mihomo-toolkit-all.js` 的内容完整复制粘贴。
4. **保存并重载配置**。脚本将全自动接管策略组、分流、DNS 及 TUN 模式。

### 方案 B：使用“精简版” + 模块化自定义（推荐进阶玩家）
1. 进入客户端的 **订阅 / Profiles** 界面，使用拓展脚本功能注入 `mihomo-toolkit.js`。
2. 进入客户端的 **设置 / Settings** -> **配置覆写 / Override**（或 DNS 设置区）。
3. 根据个人网络环境，手动配置 `DNS`（如 Fake-IP 映射）、`TUN` 严格路由及自定义 `Sniffer` 端口。

> 💡 **Tip**: 首次载入时，请确保当前网络畅通或已有可用节点，因为脚本需要通过 `🚀 自动选择` 策略组从云端拉取最新的 `geo` 规则集。

---

## 🔧 进阶自定义指南

通过修改脚本顶部的 `USER_CONFIG` 对象，您可以高度定制自己的分流行为：

```javascript
const USER_CONFIG = {    
  enableScript: true,        // 🌟 脚本总开关：设为 false 可一键无损停用本脚本
  enableAI: true,            // 是否开启 AI 服务独立分流
  enableGame: true,          // 是否开启游戏平台独立分流
  proxyFirst: false,         // 核心路由模式：false 为直连优先(性能最高)，true 为代理优先(全局接管)
  useMRS: true,              // 是否使用 Mihomo 高性能二进制规则格式(.mrs)
  osType: "windows",         // 客户端运行环境，用于匹配 P2P 下载进程名
  enableDomesticGroup: false // 是否开启特定回流组 (适用于需要访问特定地理限制服务的场景)
  // ... 更多开关请查看脚本源码
};
```
### 1. 调整 AI 节点匹配逻辑
若希望调整特定区域（如优先选择新加坡节点），可在脚本 `appGroups` 组装区修改地区数组顺序：
```js
const aiCore = ["🇸🇬 新加坡节点", "🇺🇸 美国节点", "🇯🇵 日本节点", ...].filter(...)
```

### 2. 下载流量隔离阈值
脚本默认将名称中包含 `< 1.0` 倍率的节点判定为下载节点。如需修改判断阈值（例如 0.5），请修改此处正则后的判断逻辑：
```js
if (num < 0.5) isLowMulti = true;
```

---

## 🙏 鸣谢与组件来源

- **核心思路与灵感**：[iczrac/Parsers-for-clash](https://github.com/iczrac/Parsers-for-clash)
- **内核及现代规则集**：[Mihomo (Meta)](https://github.com/MetaCubeX/mihomo) & [meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)
- **AI 协同**：由人类架构，通过 Gemini、DeepSeek 等 AI 模型对线压力测试而成。

---

## ⚠️ 免责声明

1. 本项目提供的所有代码、脚本与配置仅供**个人进行计算机网络调试、路由规则学习与研究网络连通性架构**使用。
2. 请务必严格遵守您所在国家及地区的法律法规，**严禁将本项目用于任何非法或违反当地法律的用途**。
3. 因使用本项目（包括但不限于修改配置、导致流量异常、网络安全故障或违反服务商条款）所产生的任何直接或间接后果，**均由使用者本人自行承担**。项目作者及贡献者不承担任何技术或法律上的连带责任。
4. 本项目仅为代码工具，**不提供任何形式的代理服务**，也不涉及任何网络节点的售卖、分发与推广。

## 📄 许可

本项目采用 [MIT 许可证](LICENSE)。