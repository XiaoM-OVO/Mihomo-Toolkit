# 🗺️ Mihomo-Toolkit 2.x 版本演进路线图 (ROADMAP)

本文档制定 **Mihomo-Toolkit 2.x 系列的版本发布里程碑、功能演进方向与技术债务治理规划**。
系统底层架构与安全规范详见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

---

## 🎯 一、 2.x 里程碑规划 (Milestones)

```text
┌──────────────────────────────────────────────────────────────┐
│ Milestone 1: v2.0-GA 稳定性与安全收官 (Current / Finalizing) │
│ • 核心 Bug 修复、测试网络解耦 (55s➔3s)、全链路 SSRF 与沙箱收口 │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ Milestone 2: v2.1 声明式策略组与模型革新 (Next Major)        │
│ • 支持真正自定义新建策略组、服务单点激活、配置语义解耦         │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ Milestone 3: 节点深度能力与生态扩展 (Future)                 │
│ • 本地离线 IP/ASN 标签富化、规则集自动容灾回退               │
└──────────────────────────────────────────────────────────────┘
```

---

### 🟢 Milestone 1: v2.0 正式版收官与可靠性加固 (v2.0.0-GA)
> **目标**：持续加固系统安全性与稳定性，使内核达到高可靠生产标准。

- [x] **简繁转换模式全链路一致性**：修复 `engine.js` 在 `chineseConvertMode: 's2t'` 时误调用 `toSimplified` 的硬编码缺陷，补全双向转换回归用例。
- [x] **SSRF 协议白名单深度加固**：`validateUrlSsrf` 补齐协议校验，阻断恶意 302 重定向通过 `file:`、`ftp:` 等协议穿透网络边界。
- [x] **单元测试与外部网络环境解耦**：
  - 为 `test/fission.test.js` 引入 DNS 桩隔离，不再依赖公网 `dns.google`；
  - `src/io/dns-resolver.js` 补齐原生 DNS 查询超时控制器，消除外部网络超时挂起；
  - **全量测试总运行时间缩短至 3 秒以内**。
- [x] **未决 Timer 句柄清理**：`dnsResolveWithTimeout` 在 `Promise.race` 完成后及时清理定时器，避免高并发下 Node.js 定时器句柄积压。
- [x] **DAG 空组剪枝规则容错**：分流规则 target 增加 `.trim()` 处理，避免带空格规则（如 `RULE-SET, x , y`）在级联清理时脱靶残留。
- [x] **清洗层虚假与私网节点判定完备化**：`checkNodeBlockReason` 升级对 RFC 1918 (172.16-31)、CGNAT (100.64.x) 及 IPv6 私网/回环地址的识别拦截。
- [x] **Server 配置热重载状态缓存**：引入基于 `fs.statSync` 的 `mtimeMs` 变动检查，平稳期直接复用已解析配置，避免每个 `/sub` 请求重复进行同步 YAML 密集反序列化。
- [x] **分层单向流动架构纯净化**：移除 `src/io/sub-processor.js` 对上层 `src/strategy/dashboard.js` 的 fallback 反向 `require`，严格遵从依赖注入。

---

### 🟡 Milestone 2: 声明式策略组模型与配置体验革新 (v2.1.0)
> **目标**：打破预设拓扑限制，赋予用户自由编排任意策略组与规则链的能力。

- [x] **远程配置剥夺清单升级为白名单收敛 (Fail-Closed)**：
   - 从基于黑名单剥离全面升级为基于字段注册表 `trust: 'any'` 的显式白名单放行（fail-closed），有效收敛未来内核新字段可能带来的潜在越权风险；
   - 纠正 `output` 字段为 `trust: 'local'`，阻止远程配置操纵本地写盘目标路径；
   - 修复 DNS 不变式 (INV-8) 上下游上下文传递脱节与审计消费断层。
- [ ] **服务目录单点激活 (Single-Point Service Activation)**：
   - *当前现状*：用户在 `customServices` 添加服务后，还必须在 `aiServices` 或 `streamingServices` 中再次列出该 key 才能生效，容易产生漏配混淆。
   - *规划方案*：支持“声明即激活”，或在自定义项中增加 `active: true` 选项，简化配置书写。
- [ ] **声明式自定义策略组 (Declarative Custom Groups)**：
   - *当前现状*：`customNodeGroups` 仅支持将节点按特征塞入系统内置的大区或预设组，**无法新建全新的独立策略组**。
   - *规划方案*：设计声明式策略组语法，允许用户在 `config.yaml` 中像原生 Mihomo 配置一样定义任意名称、类型 (`select` / `url-test` / `fallback` / `load-balance`)、测速 URL、容差值及子组嵌套结构，由 DAG 引擎自动接管其生命周期与剪枝。

---

### 🔵 Milestone 3: 节点深度能力与生态扩展 (v2.2.0+)
> **目标**：在不破坏轻量级纯 JS 架构的前提下，探索高价值增量功能。

1. **本地离线 IP/ASN 标签补全**：
   - 探索采用体积极小的离线 GeoIP/ASN 纯 JS 数据库，仅为节点重命名提供 `{isp}`、`{asn}`、`{org}` 变量；严格排除需要网络调用的第三方在线 API，保障隐私与离线纯度。
2. **nodes 纯节点交付形态的解析依赖增强**：
   - 针对部分机场通过 `nameserver-policy` 绑定私有 DoH 解析节点域名的场景，研究在 nodes 模式合并阶段直接改写节点 `server` 为物理 IP 并锁定 `sni`/`servername` 的无副作用保活机制。
3. **分流规则集 (Rule-Providers) 健康探测与多 CDN 降级池**：
   - 规则集订阅增加多源镜像切换逻辑（fastly.jsdelivr / cdn.jsdelivr / ghproxy），避免单点 CDN 异常导致内核规则拉取失败。

---

## 🛡️ 二、 技术债务与质量护栏

1. **反隐形守卫扫描增强**：
   - [`test/config-surface.test.js`](test/config-surface.test.js) 目前主要匹配 `userConfig.` 与 `cfg.` 读取，需权衡在不引起虚假误报的前提下，进一步覆盖解构变量形式的用户配置读取。
2. **配置字段准入铁律**：
   - 任何新增字段必须严格践行链路：`src/data/field-registry.js` (SSOT) ➔ `index.d.ts` ➔ `config.example.yaml` ➔ 单元测试覆盖。
3. **保持纯计算层零副作用**：
   - `src/core/` 与 `src/strategy/` 严禁引入任何磁盘与网络 I/O，所有测试套件执行耗时必须稳定保持在 5 秒以内。

---

## 📦 附录：v1 历史迁移与能力矩阵归档 (Archive)

> 注：本节记录从旧版 `mihomo-toolkit` 迁移至 `mihomo-toolkit-next` 的历史清账与决策留痕。**旧版全部 17 个功能区块已在 2026-10 阶段全数落定。**

### 1. 旧版区块迁移对照总表

| 旧版区块 | 迁移状态 | 处置决策说明 |
| :--- | :---: | :--- |
| ① 订阅源与节点注入 | ✅ **已恢复** | 支持多订阅并发拉取、URI 节点注入、单订阅开关控制 |
| ② 运行模式与输出 | 🔁 **已替代** | 原 `pure/toolkit/full` 三运行模式由全新标准 `outputMode: config / nodes / report` 统一替代 |
| ③ 部署与安全 | ✅ **已恢复** | 新增 `maxConcurrentBuilds`、流式 `maxSubscriptionBytes`、Token 恒定时间比较 |
| ④ 简繁转换 | ✅ **已恢复** | 依赖 `opencc-js`，全链路四路同步（节点名、策略组名、引用、分流规则） |
| ⑤ 节点清洗 | ✅ **已恢复** | 广告词拦截、倍率与线路提取、信息节点过滤、节点黑白名单（`blockKeywords` / `blockServers`） |
| ⑥ 节点重命名 | ✅ **已恢复** | 动态对齐补零序号、全量模板变量、悬空符号擦除；`customPrefix` 由 tag 系统替代 |
| ⑦ IP 补全检测 | ⏸️ **已暂缓** | 免费离线库无可靠“家宽/机房用途”字段，第三方在线 API 存在隐私泄露与网络抖动风险，暂缓引入 |
| ⑧ 节点裂变 | ✅ **已恢复** | 单域名多 IP 纯算法裂变、servername/sni 自动保活注入、黑名单关键词跳过 |
| ⑨ 注入节点分组 | ✅ **已恢复** | `specialNodeRules`、`customNodeGroups` 特殊规则支持 |
| ⑩ 策略组与地区分组 | ✅ **已恢复** | 六维大区折叠、动态测速组装配、高倍率/实验节点/家宽节点隔离、骨架组豁免 |
| ⑪ 核心分流开关 | ✅ **已恢复** | AI / 流媒体 / 社交 / 游戏 / 系统 / 广告拦截 / 直连 / QUIC / WebRTC 等全量矩阵 |
| ⑫ 服务注册表 | ✅ **已恢复** | 统一 Service Catalog SSOT，内置基准 + 用户 `customServices` 增量继承，支持外挂文件挂载 |
| ⑬ 进程级分流名单 | ✅ **已恢复** | 六平台全量进程分流名单齐备 |
| ⑭ 测速与规则集 | ✅ **已恢复** | 规则集镜像自定义、MRS/YAML 双格式支持，`geositeRepo` / `geoipRepo` 正式登记 |
| ⑮ DNS 解决方案 | ✅ **已恢复** | 纯 IP 破死锁、Fake-IP 智能聚合防自环、DoH 危险修饰符剥离、DNS INV-1~9 不变式自检 |
| ⑯ 内核防漏与覆写 | ✅ **已恢复** | TUN 虚拟网卡、Sniffer 嗅探器、内存级 TCP 并发调优与内核参数覆写 |
| ⑰ 双端差异化配置 | 🔁 **已废弃** | 新架构取消双端代码分叉，统一为单流水线交付引擎，原差异化字段随之废弃 |

### 2. 废弃字段明细记录
- `pureConfig` / `toolkitConfig`：双端概念取消，配置全面归一；
- `outputMode: array/object`、`outputGarbage`、`outputUnknown`：纯节点模式严格只输出标准的 `{ proxies: [...] }` 数组；
- `meta`：清洗审计报告升级为一级交付物（`outputMode: 'report'` 或 `-r` 导出）；
- `customPrefix`：由重命名模板变量 `{index}` + `indexPrefixMap` 统一覆盖；
- `dnsMergeMode`：已被三层纵深安全沙箱与只读安全基线体系全面取代。
