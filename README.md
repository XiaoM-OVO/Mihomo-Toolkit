<div align="center">

# 🚀 Mihomo 极简配置工具箱

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Clash Verge Rev](https://img.shields.io/badge/Clash_Verge_Rev-Compatible-success)
![Mihomo](https://img.shields.io/badge/Core-Mihomo-orange)

**一套为 [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev) 设计的动态策略组扩展脚本与 DNS 优化方案**

「 **逻辑解耦** · **UI 清爽** · **自动化维护** 」

</div>

---

> ⚠️ **兼容性提醒**：本项目基于 **Mihomo 内核** 官方文档开发，**仅在 Clash Verge Rev 上完整测试**。理论上任何使用 Mihomo 内核的客户端都能运行，但未经实测，不保证其他客户端的兼容性。

## ✨核心特性

### 🧼 节点名称智能清洗与重组
- 自动识别地区、倍率、线路特征（IEPL/CN2/BGP 等），去除杂乱符号
- 自动为节点添加可视化图标：
  - 🤖 OpenAI / ChatGPT　|　♊ Google Gemini　|　🦀 Claude
  - 📺 流媒体访问　|　🎮 游戏/FullCone　|　⚡ Hysteria
  - 🛡️ AnyTLS　|　📱 WAP 优化　|　⏬ 下载/BT 专用　|　🆓 免费节点
- 同一地区多节点自动编号（如 `🇭🇰 香港节点 [01]`），UI 清爽一致

### 🛠️ `proxy-group.js` — 自动化策略组引擎
- **智能地区分类**：支持 20+ 国家和地区（含欧洲多国、印度、俄罗斯、澳大利亚、巴西等）。
- **动态隐藏空策略组**：无节点的地区组自动隐藏，UI 更美观。
- **负载均衡专用组**：为下载 / BT / 安卓应用等流量自动轮询低倍率节点，降低代理服务商风控风险。
- **AI 服务分流**：OpenAI / Gemini / Claude 自动指向有节点的地区，并优先选择连通性较好的区域。
- **BT/P2P 防封保护**：内置进程识别 + bt-trackers/peers 规则集，强制直连。
- **学术访问优化**：内置常见学术数据库规则集，自动选择低延迟欧美节点，改善外文文献访问体验。
- **游戏与下载优化**：Steam/Epic 商店直连跑满带宽，游戏服务可手动/自动代理。
- **流媒体 & 日常应用**：YouTube、Netflix、Bilibili、Telegram、GitHub 等一键分流。

### 🌐 `fake-ip.yaml` — DNS 优化方案
- 分流解析：境内域名用阿里/腾讯 DoH，境外用 Google/Cloudflare DoH
- 降低 DNS 泄露风险：启用 `respect-rules`，遵循路由规则
- 节点解析优化：独立设置 `proxy-server-nameserver`，缓解卡顿

---

## 🛠️ 如何使用

### 1. 部署脚本 (Clash Verge Rev)
1. 进入 **订阅 / Profiles** 界面。
2. 双击 **全局拓展脚本 / Global Extend Script**，打开编辑器。
3. 将 `scripts/proxy-group.js` 的全部内容复制进去。
4. **保存**后刷新订阅，即可看到全新的策略组布局。

### 2. DNS 配置
1. 进入 **设置 / Settings** → **DNS 覆写 / DNS Overwrite** → **高级 / ADVANCED**。
2. 将 `dns/fake-ip.yaml` 中的 `dns` 部分替换原有配置。
3. 建议开启 **Tun 模式** 以获得最佳解析效果。

> 💡 首次使用请确保至少有一个代理节点能正常连接（脚本会通过 **🚀 自动选择** 测速组拉取规则集）。

---

## 🔧 自定义指南

### 调整节点识别关键词
打开脚本顶部的 `regionReplacements` 数组，按需增删地区识别规则。  
例如新增“泰国”：
```js
{ reg: /泰国|TH|Thailand/i, name: "泰国", icon: "🇹🇭" }
```

### 修改 AI 服务使用的地区顺序
找到 `aiProxies` 数组（脚本中已根据可用地区动态生成），若想固定顺序，可替换为：
```js
const aiProxies = ["🇺🇸 美国节点", "🇯🇵 日本节点", "🇸🇬 新加坡节点"];
```

### 切换规则顺序方案
脚本底部 `rules` 数组中有注释说明：
- 默认：**方案 A（直连优先）**
- 若需代理优先，注释方案 A，取消注释方案 B。

---

## 🙏 鸣谢

- **核心思路与灵感**：[iczrac/Parsers-for-clash](https://github.com/iczrac/Parsers-for-clash)
- **内核及现代规则集**：[Mihomo (Meta)](https://github.com/MetaCubeX/mihomo) & [meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)
- **AI 协同**：由人类架构，通过 Gemini、DeepSeek 等 AI 模型对线压力测试而成。

---

## ⚠️ 免责声明

1. 本项目提供的所有脚本与配置仅供**个人网络调试、学习编程技术与研究网络架构**使用。
2. 请务必遵守您所在国家及地区的法律法规，**严禁将本项目用于任何非法用途**。
3. 因使用本项目（包括但不限于修改配置、造成数据泄露、网络异常或违反当地法律）所产生的任何直接或间接后果，**均由使用者本人自行承担**，项目作者不承担任何连带法律责任。
4. 本项目不提供任何代理服务，不涉及任何代理服务节点的售卖与分享。

## 📄 许可

本项目采用 [MIT 许可证](LICENSE)。