# 🏗️ Mihomo-Toolkit 架构索引与模块契约

本文档定义了 Mihomo-Toolkit 模块化重构后的**分层架构、单向依赖规范、数据流水线以及各模块的公共接口契约**，作为后续开发与维护的唯一参考规范。

---

## 🧭 架构设计原则

1. **单一职责 (Single Responsibility)**：每个模块只专注于解决一个问题（如：去重、地区识别、DNS 覆写、协议解析）。
2. **单向依赖 (Unidirectional Dependency)**：高层调用低层，底层**严禁**反向引用高层。
   ```text
   targets (运行时适配器)
      │
      ▼
   pipeline (流程编排引擎)
      │
      ├──────────────────────┬──────────────────────┐
      ▼                      ▼                      ▼
   strategy (策略与拓扑)   core (清洗与纯算法)     io (网络与解析)
      │                      │                      │
      └──────────────────────┴──────────────────────┘
                             ▼
                    config (配置中心与默认值)
   ```
3. **环境无关与纯函数优先 (Pure & Universal)**：
   - `core/`、`strategy/`、`config/` 内严禁依赖 Node.js 专属 C++ 模块或特定运行时全局变量。
   - 输入相同的数据与配置，必产生确定性的输出。

---

## 🔄 全链路数据流水线 (Pipeline Flow)

一次完整的订阅转换与策略构建流程严格按照以下五个阶段进行：

```text
[输入] 远程 URL / 本地 YAML / URI 列表
  │
  ├─▶ 1. IO 阶段 (src/io/)
  │     • SSRF 防护校验与重试抓取 (ssrf.js)
  │     • 多协议/Base64/YAML 解析为标准节点数组 (parsers/)
  │     • 订阅流量与重置天数虚拟节点生成 (sub-info.js)
  │
  ├─▶ 2. Core 阶段 (src/core/)
  │     • 节点物理特征指纹提取与去重 (dedupe.js)
  │     • 广告/引流/失效节点前置拦截 (cleaner.js)
  │     • 地区与城市匹配 (geo.js)
  │     • 协议/特征/倍率/线路/入口提取并打标 (cleaner.js)
  │     • 节点重命名与模板渲染 (rename.js)
  │
  ├─▶ 3. Strategy 拓扑阶段 (src/strategy/)
  │     • 六维服务注册表初始化 (registries.js)
  │     • 动态大区折叠与策略组装配 (topology.js)
  │     • 路由分流规则与 Rule-Providers 组装 (rules.js)
  │     • DAG 级联空组递归斩首与规则清理 (prune.js)
  │
  ├─▶ 4. Strategy 覆写阶段 (src/strategy/)
  │     • Fake-IP / DoH 防泄漏策略注入 (dns.js)
  │     • TUN / Sniffer / 内核性能调优 (kernel.js)
  │
  └─▶ [输出] 结构化合法的 Mihomo 最终配置 (可直接序列化为 YAML)
```

---

## 📂 模块索引与公共接口契约

### 1. `src/config/` (配置中心)
* **`defaults.js`**
  - `DEFAULT_CONFIG: object`：全局默认配置项定义。
* **`index.js`**
  - `resolveConfig(userConfig?: object): object`
    - **入参**：用户自定义配置覆盖对象。
    - **出参**：深合并、补全默认值且保证数组/对象类型安全的最终配置。

---

### 2. `src/core/` (纯计算与清洗算法)
* **`core/shared/regions.js`**
  - `IN_PREFIX: string`：入口前缀正则片段。
  - `REGION_DEFS_RAW: Array<RegionDef>`：地区原始字典。
  - `CONTINENT_DEFS: Array<ContinentDef>`：六大洲折叠大区配置。
  - `getEnhancedRegionDefs(): Array<RegionDef>`：获取带有预编译正则的地区定义列表。
* **`core/shared/icons.js`**
  - `PROTOCOL_ICONS: Record<string, string>`：协议 Emoji 字典。
  - `FEATURE_ICONS: Record<string, string>`：特征 Emoji 字典。
  - `FEATURE_TEXT_MAP: Record<string, string>`：特征文字标签字典。
* **`core/dedupe.js`**
  - `getNodeFingerprint(proxy: object): string`：提取底层网络特征指纹。
  - `dedupeNodes(proxies: object[], options?: { onDuplicate?: Function }): object[]`：物理去重。
* **`core/geo.js`**
  - `matchNodeRegion(name: string, regionDefs?: object[], options?: object): object | null`：智能匹配地区。
  - `extractCity(name: string, regionDef: object): string`：提取落地城市。
* **`core/rename.js`**
  - `createSeparatorCleaners(separators?: string[]): { regAdjacent, regEdge }`：构建悬空分隔符清理正则。
  - `renderTemplate(template: string|Function, vars: object, proxy: object, cleaners?: object): string`：模板渲染与清理。
* **`core/cleaner.js`** *(待构建)*
  - `classifyNode(proxy: object, userConfig: object): NodeClassificationResult`
    - 对单个节点进行安全检测、属性抽取、地区与特征分类打标。

---

### 3. `src/io/` (外部交互、网络与解析)
* **`io/ssrf.js`**
  - `isPrivateIp(ip: string): boolean`：判断是否为私网/回环 IPv4。
  - `isPrivateIPv6(ip: string): boolean`：判断是否为私网/特殊 IPv6。
  - `isAllowedUrl(url: string): boolean`：静态协议与主机名安全校验。
  - `validateUrlSsrf(url: string): Promise<boolean>`：包含 DNS 解析的动态 SSRF 拦截。
  - `redactUrl(url: string, showFull?: boolean): string`：敏感 Token 脱敏打印。
* **`io/parsers/`**
  - `parseContent(rawText: string): { proxies: object[] }`：全格式自动解析。
  - `parseVlessUri(uri: string): object | null`
  - `parseVmessUri(uri: string): object | null`
  - `parseTrojanUri(uri: string): object | null`
  - `parseSsUri(uri: string): object | null`
* **`io/sub-info.js`**
  - `parseSubscriptionInfo(subInfo: string): { upload, download, total, expire }`
  - `formatBytes(bytes: number, fractionDigits?: number): string`
  - `calcResetDays(options: { resetDay?: number }): number | null`
  - `generateInfoNodes(subInfo: string, tag: string, options?: object): { nodes: object[], expireDays: number }`

---

### 4. `src/strategy/` (策略拓扑与内核优化)
* **`strategy/registries.js`**
  - `createServiceRegistries(userConfig: object): { ai, streaming, social, game, dev, system }`：初始化并融合自定义注册表。
* **`strategy/dns.js`**
  - `applyDnsOverlay(config: object, userConfig: object): void`：注入 DNS / Fake-IP / 分流解析配置。
* **`strategy/kernel.js`**
  - `applyTunOverlay(config: object, userConfig: object): void`：注入 TUN 配置。
  - `applySnifferOverlay(config: object, userConfig: object): void`：注入 Sniffer 域名嗅探配置。
  - `applyCoreOptimize(config: object, userConfig: object): void`：注入性能优化与客户端指纹。
* **`strategy/rules.js`**
  - `buildRoutingRules(userConfig: object, registries: object, options?: object): { rules: string[], providers: object }`：构建分流规则与规则集资源。
* **`strategy/prune.js`**
  - `pruneEmptyGroups(params: { proxyGroups, proxies, rules, ruleProviders, exemptGroups?, maxIterations? }): object`：DAG 级联空组与殉葬规则清理。
* **`strategy/topology.js`** *(待构建)*
  - `buildProxyTopology(classifiedNodes: object[], userConfig: object, registries: object): { proxyGroups: object[] }`：生成完整策略组拓扑。

---

### 5. `src/pipeline/` (编排流水线) *(待构建)*
* **`pipeline/toolkit.js`**：连接 Core 清洗、Strategy 拓扑与 Kernel 覆写的全流程编排引擎。
* **`pipeline/pure.js`**：仅执行清洗、去重与重命名，输出干净节点数组的精简流水线。

---

### 6. `src/targets/` (多端适配入口) *(待构建)*
* **`targets/verge.js`**：导出 `main(config, extConfig)`，打包为单文件供 Clash Verge / 客户端扩展脚本使用。
* **`targets/operator.js`**：导出 `operator(proxies, targetPlatform)`，打包为单文件供 Sub-Store 节点操作使用。
* **`targets/server.js`**：常驻 HTTP 订阅服务器，供 VPS / 本地网络部署。
* **`targets/cli.js`**：终端与 CI/CD 自动化构建命令行工具。

---

## 🛡️ 开发防跑偏自检清单 (Checklist)

在编写或重构任何模块时，请严格对照以下 4 条底线：
1. **模块是否单向依赖？** 底层（如 `core/`）绝不能引用高层（如 `strategy/` 或 `pipeline/`）。
2. **是否把副作用（Side-Effect）隔离到了最外层？** 只有 `io/` 和 `targets/` 允许发起网络请求或读取磁盘；其余所有模块都必须是纯计算。
3. **是否引入了 Node 专属巨石依赖？** 准备打包给客户端单文件的核心代码，严禁引入 `fs`、`child_process` 或 C++ 原生扩展。
4. **测试是否新增且通过？** 每一个抽出的独立模块，在 `test/` 目录下必须拥有专属测试文件，且必须全绿通过。
