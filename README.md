# 🚀 Mihomo (Meta) 极简配置工具箱

一套专为 [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev) 和 [Mihomo Party](https://github.com/mihomo-party-org/mihomo-party) 设计的扩展脚本与 DNS 优化方案。

> ⚠️ **兼容性提醒**  
> 本项目专为 **Mihomo (Meta) 内核** 优化。不兼容原版 Clash（已停更）。  
> 不保证通用型，在其他客户端使用可能导致报错。

> 💡 **核心理念**：逻辑解耦 · UI 洁癖 · 全自动化维护

---

## ✨ 核心特性

### 🛠️ `proxy-group.js` — 自动化策略组扩展
这是一个**扩展脚本 (Extension Script)**，能动态重构机场订阅，生成科学的分流结构：
- **智能节点分类**：基于关键字自动将节点划分为港、台、日、韩、新、美及其他地区。
- **动态测速组**：每个地区自动生成 `url-test` 组，确保节点实时高可用。
- **业务导向分流**：
  - **🤖 OpenAI**：自动排除香港节点，仅使用支持地区的节点。
  - **🎮 游戏服务**：内置 Steam/Epic 商店规则，下载流量自动回流直连。
  - **🍎 Apple / Ⓜ️ Microsoft**：直连优先，兼顾更新速度。
  - **📺 Streaming / ✈️ Telegram**：专属策略组，支持手动切换地区或自动选择。
  - **🐟 漏网之鱼**：最后的 Match 兜底，给所有未知流量一个温暖的家。
- **纯净 UI**：自动去重，避免下拉菜单出现冗余项，视觉清爽。

### 🌐 `fake-ip.yaml` — 通用 DNS 方案
基于 **Fake-IP** 模式的 DNS 配置：
- **分流解析**：境内域名使用阿里/腾讯 DoH，境外使用 Google/Cloudflare DoH。
- **降低泄露风险**：启用 `respect-rules`，确保 DNS 解析严格遵循路由规则，防止常见场景下的DNS泄露。
- **节点解析优化**：独立设置 `proxy-server-nameserver`，缓解代理节点域名解析卡顿问题。

---

## 📅 更新记录

### [2026-05-27] 
- **⚖️ 协议变更**：项目授权协议由 MIT 迁移至 **GPL-3.0**。
- **🌐 DNS 性能与安全增强**：新增 `nameserver-policy` 分流策略，实现国内外 DNS 精细化解析。

---

## 🛠️ 如何使用

### 1. 脚本部署 (Clash Verge Rev)
1. 进入 **[订阅 / Profiles]** 界面。
2. 双击 **[新建 / Global Extend Script]**，打开js界面。
3. 将 `scripts/proxy-group.js` 的内容全部复制进去。
4. 刷新订阅，即可看到全新的策略组布局。

### 2. DNS 配置
1. 进入 **[设置 / Settings]** 界面（或直接修改配置文件）。
2. 打开 **[DNS覆写 / DNS Overwrite]** 界面，点击 **[高级 / ADVANCED ]**。
3. 将 `dns` 部分的内容替换为本项目提供的 `dns/fake-ip.yaml` 代码。
4. 建议开启 `Tun 模式` 以获得最佳解析效果。

> 💡“由于脚本中 `rule-providers` 依赖代理节点更新，请在初次导入后，请确保至少有一个代理节点能正常连接（可在“节点选择”组中手动指定），以便脚本通过代理拉取规则集。”

---

## 🔧 自定义指南

如果你需要调整节点识别规则，只需修改脚本顶部的 `regionMap`：

```javascript
const regionMap = {
  // 增加自定义前缀关键词
  hk: { name: "🇭🇰 香港节点", keywords: ["港", "香港", "🇭🇰", "HK", "Premium-HK"] },
  // ... 其他地区同理
};
```

---

## 🙏 鸣谢

本项目的诞生离不开以下开源项目与作者的无私奉献，特此致谢：

- **核心思路与灵感**：[iczrac/Parsers-for-clash](https://github.com/iczrac/Parsers-for-clash) （感谢提供最初的 Parser 脚本重构思路）
- **底层规则数据源**：[Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules)
- **内核及现代规则集**：[Mihomo (Meta)](https://github.com/MetaCubeX/mihomo) & [meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)
- **AI 协同**：本项目逻辑由人类架构，通过 Gemini、DeepSeek 等 AI 模型博弈对线压力测试而成。

---

## ⚠️ 免责声明

1. 本项目提供的所有脚本与配置仅供**个人网络调试、学习编程技术与研究网络架构**使用。
2. 请务必遵守您所在国家及地区的法律法规，**严禁将本项目用于任何非法用途**。
3. 因使用本项目（包括但不限于修改配置、造成数据泄露、网络异常或违反当地法律）所产生的任何直接或间接后果，**均由使用者本人自行承担**，项目作者不承担任何连带法律责任。
4. 本项目不提供任何代理服务，不涉及任何梯子节点的售卖与分享。

## 📄 许可

GNU GPL v3.0 — 自由使用、修改与分享，二次开发需保持开源并沿用本协议。
