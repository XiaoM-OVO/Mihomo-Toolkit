<div align="center">

# 🎨 Mihomo 通用动态策略组脚本

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Clash Verge Rev](https://img.shields.io/badge/Clash_Verge_Rev-Compatible-success)
![Mihomo](https://img.shields.io/badge/Core-Mihomo-orange)

**一套为 Mihomo 内核生态客户端设计的通用动态策略组脚本与 DNS 优化方案**

「 **逻辑解耦** · **UI 清爽** · **自动化维护** 」

</div>

---

> ⚠️ **兼容性提醒**：本项目**仅在 Clash Verge Rev / Nyanpasu / Clash Party/ FlClash 上完整测试**。理论上任何使用 Mihomo 内核并支持 JS 脚本覆写的客户端都能运行，但未经实测，不保证其他客户端的兼容性。

## 📸 运行预览

<p align="center">
  <img src="https://github.com/user-attachments/assets/1ca6488b-21ba-4a69-9db5-1944290ad2aa" width="48%" />
  <img src="https://github.com/user-attachments/assets/21522b23-99d4-4922-9987-51569c1cc394" width="48%" />
  <br>
  <em>左：自动化策略组布局 | 右：节点清洗细节</em>
</p>

### 🧼 节点名称智能清洗与重组
- **结构化重命名**：自动识别地区、倍率、线路特征（IEPL/CN2 等），去除干扰杂质。
- **乱码自动收容**：自动拦截归类无法识别的节点至**🗑️ 未知识别**组。
- **可视化图标标注**：
  - 🤖 `OpenAI` | ♊ `Gemini` | 🦀 `Claude`
  - 📺 `流媒体` | 🎮 `游戏/FullCone` | ⚡ `Hysteria`
  - 🛡️ `AnyTLS` | 📱 `WAP 优化` | ⏬ `下载` | 🆓 `免费` | 🗑️ `清洗失败`
- **自动序列化**：同地区节点自动编号（如 `🇭🇰 香港节点 [01]`），告别乱码。

### 🛠️ 自动化策略组引擎 (`proxy-group.js`)
- **📦 动态 UI 与空间管理**
  - 支持 20+ 全球主流地区自动分类。
  - 无节点地区自动隐藏，保持面板清爽，告别满屏的空节点组。
- **🛡️ 网络行为优化**
  - **低倍率隔离**：自动将低倍率节点剥离进“下载负载均衡池”，防止测速消耗或日常误用。
  - **BT 安全隔离**：内置进程识别 + tracker/peer 规则集，阻断 P2P 流量走代理。
- **🧠 场景化智能分流**
  - **AI & 学术**：OpenAI / Gemini / Claude 及文献库自动匹配可用地区，优选连通性较高地区。
  - **游戏 & 下载**：Steam / Epic 商店自动直连，下载进程精准剥离。
  - **日常 & 流媒体**：YouTube、Netflix、B站、TG、GitHub 一键精准分流。

### 🌐 `fake-ip.yaml` — DNS 优化方案
- 分流解析：境内域名用阿里/腾讯 DoH，境外用 Google/Cloudflare DoH
- 降低 DNS 泄露风险：启用 `respect-rules`，遵循路由规则
- 节点解析优化：独立设置 `proxy-server-nameserver`，缓解卡顿

---

### 🛠️ 如何使用

> [!IMPORTANT]
> **请根据需求二选一**：方案 A 适合追求极致简便的用户；方案 B 适合希望手动管理 DNS 和 TUN 模式的进阶用户。

#### 方案 A：All-in-One 一键方案（推荐 ⭐️）
1. 进入 Clash Verge Rev 的 **订阅 / Profiles** 界面。
2. 点击界面右侧的**全局扩展脚本 / Global Extend Script**。
3. 将 `scripts/proxy-group-all.js` 的内容全部复制进去。
4. **保存并刷新**，脚本将全自动接管策略组、DNS、TUN 模式和嗅探。

#### 方案 B：模块化方案（适合进阶用户）
- **1. 部署脚本**
  1. 进入 **订阅 / Profiles** 界面。
  2. 点击界面右侧的 **全局拓展脚本 / Global Extend Script**。
  3. 将 `scripts/proxy-group.js` 的全部内容复制进去并保存。
  
- **2. DNS 覆写**
  1. 进入 **设置 / Settings** -> **DNS 覆写 / DNS Overwrite**。
  2. 点击 **高级 / ADVANCED** 图标。
  3. 将 `dns/fake-ip.yaml` 中的内容填入并保存，最后开启 DNS 覆写开关。


> 💡 首次使用请确保至少有一个代理节点能正常连接（脚本会通过 **🚀 自动选择** 测速组拉取规则集）。

---

### 🔧 自定义指南 (适配 v1.5.1 + )

为了保持脚本逻辑的严密性，请在修改前参考以下说明：

#### 1. 增减地区识别 (Region)
若您的节点列表包含特殊地区（如：泰国、土耳其），请修改脚本顶部的 **`REGION_DEFS`** 数组：
```js
// 在数组中添加一行，注意正则关键词和图标
{ id: "th", name: "泰国", icon: "🇹🇭", reg: /泰国|TH|Thailand/i }
```

#### 2. 调整 AI 服务的节点优先级
脚本会自动根据节点存复情况生成 AI 策略组。若想调整**自动排列的顺序**（例如让新加坡排在最前面），请修改代码中 `aiProxies` 的数组顺序：
```js
// 找到这行，把想要优先显示的地区往前挪
const aiProxies = safeList(["🇸🇬 新加坡节点", "🇺🇸 美国节点", "🇯🇵 日本节点", ...])
```

#### 3. 定义低倍率节点 (防偷跑)
脚本会自动识别并隔离低倍率节点至“下载池”。默认阈值是 **1.0**（低于 1 倍算低倍率）。若想微调（例如 0.5 倍以下才算），修改此处逻辑：
```js
// 找到这行，修改 num < 1 的数值
if (num < 0.5) isLowMulti = true;
```

#### 4. 切换分流方案 (直连优先 vs 代理优先)
在脚本底部的 `rules` 区域，我们提供了两套方案。默认开启 **方案 A**（国内流量直连，性能最佳）。
若需 **方案 B**（更激进的代理分流），请按代码注释进行“取消注释/注释”操作。

#### 5. 更新规则集
本脚本默认使用 `MetaCubeX` 的云端规则集。若需切换其他源，只需修改 **`REPO`** 变量和 **`RULE_PROVIDERS`** 字典。

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