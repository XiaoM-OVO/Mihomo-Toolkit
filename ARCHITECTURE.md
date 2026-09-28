# 🏗️ Mihomo-Toolkit 架构索引与模块契约

本文档定义了 Mihomo-Toolkit 模块化重构后的**分层架构、单向依赖规范、数据流水线以及各模块的公共接口契约**，作为后续开发与维护的唯一参考规范。

---

## 🧭 架构设计原则

1. **单一职责 (Single Responsibility)**：每个模块只专注于解决一个问题（如：去重、地区识别、DNS 覆写、协议解析、看板合成）。
2. **单向依赖 (Unidirectional Dependency)**：高层调用低层，底层**严禁**反向引用高层。
   ```text
   targets (多端运行时适配器)
      │
      ▼
   pipeline (流程编排引擎: pure / toolkit / builder)
      │
      ├──────────────────────┬──────────────────────┐
      ▼                      ▼                      ▼
   strategy (策略与拓扑)   core (清洗与纯算法)     io (网络、容灾与解析)
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
  │     • SSRF 防护校验与重试抓取 (ssrf.js, fetcher.js)
  │     • 多协议/Base64/YAML 解析为标准节点数组 (parsers/)
  │     • 订阅流量与重置天数虚拟节点生成 (sub-info.js)
  │     • 资源限制与安全配额校验 (limits.js)
  │
  ├─▶ 2. Core 阶段 (src/core/)
  │     • 节点物理特征指纹提取与去重 (dedupe.js)
  │     • 广告/引流/失效节点前置拦截 (cleaner.js)
  │     • 域名并发多 IP 裂变增殖 (fission.js)
  │     • 地区与城市匹配 (geo.js)
  │     • 协议/特征/倍率/线路/入口提取并打标 (cleaner.js)
  │     • 节点重命名与模板渲染 (rename.js)
  │
  ├─▶ 3. Strategy 拓扑阶段 (src/strategy/)
  │     • 多订阅流量与到期状态看板合成 (dashboard.js)
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
  - `resolveConfig(userConfig?: object): object`：合并补全默认配置。

---

### 2. `src/core/` (纯计算与清洗算法)
* **`core/cleaner.js`**
  - `classifyNode(proxy: object, userConfig: object): NodeClassificationResult`：安全检测、属性抽取与打标。
* **`core/dedupe.js`**
  - `dedupeNodes(proxies: object[], options?: object): object[]`：物理特征去重。
* **`core/fission.js`**
  - `fissionNodeMultiIp(proxy: object, options?: object): Promise<object[]>`：域名并发多 IP 裂变增殖。
* **`core/geo.js`**
  - `matchNodeRegion(name: string, regionDefs?: object[], options?: object): object | null`：智能匹配地区。
  - `extractCity(name: string, regionDef: object): string`：提取落地城市。
* **`core/rename.js`**
  - `renderTemplate(template: string|Function, vars: object, proxy: object, cleaners?: object): string`：模板渲染与清理。

---

### 3. `src/io/` (外部交互、网络与解析)
* **`io/fetcher.js`**
  - `safeFetchText(url: string, options?: object): Promise<{ text, response, finalUrl }>`：安全抓取。
  - `fetchNodes(url: string, options?: object): Promise<{ content, subInfo }>`：抓取调度与 Stale 容灾降级。
* **`io/ssrf.js`**
  - `validateUrlSsrf(url: string): Promise<boolean>`：DNS 动态私网拦截。
  - `isAllowedUrl(url: string): boolean`：协议与地址快速合法性校验。
  - `redactUrl(url: string, showFull?: boolean): string`：敏感 Token 脱敏打印。
* **`io/limits.js`**
  - `validateRequestLimits(params: object): Error | null`：请求配额与资源限制防御。
* **`io/parsers/`**
  - `parseContent(rawText: string): { proxies: object[] }`：全格式自动解析。
* **`io/sub-info.js`**
  - `generateInfoNodes(subInfo: string, tag: string, options?: object): { nodes: object[], expireDays: number }`

---

### 4. `src/strategy/` (策略拓扑与内核优化)
* **`strategy/dashboard.js`**
  - `aggregateSubscriptions(collectedSubInfos: object[], options?: object): object`：多订阅流量与到期聚合。
  - `buildGlobalDashboardNodes(params: object): object[]`：双列网格高颜值全局看板节点。
* **`strategy/topology.js`**
  - `buildProxyTopology(classifiedNodes: object[], userConfig: object, registries: object): { proxyGroups: object[] }`：策略组装配。
* **`strategy/rules.js`**
  - `buildRoutingRules(userConfig: object, registries: object, options?: object): { rules: string[], providers: object }`：分流规则生成。
* **`strategy/dns.js`** 与 **`strategy/kernel.js`**：DNS 与 TUN / Sniffer 调优注入。
* **`strategy/prune.js`**：DAG 级联空组与殉葬规则清理。

---

### 5. `src/pipeline/` (编排流水线与交付矩阵)
* **`pipeline/nodes.js`**：纯节点清洗与打标流水线 (`runNodesPipeline`)，交付标准化节点数组 (`nodes`)。
* **`pipeline/config.js`**：端到端配置构建流水线 (`runConfigPipeline` / `buildProfile`)，交付完整即用型 Mihomo 配置 (`config`，支持 `passthrough` 透传模式)。
* **`pipeline/report.js`**：健康与审计报告流水线 (`buildAuditReport`)，交付结构化审计报告 (`report` JSON)。
* **`pipeline/strategy.js`**：策略组拓扑与分流规则注入流水线 (`runStrategyPipeline`)，供 Clash Verge Rev 等扩展脚本直接调用。
* **`src/index.js`**：全库顶层统一门面入口 (Facade)。

---

### 6. `src/targets/` (多端适配入口)
* **`targets/operator.js`**：导出 `operator(proxies, targetPlatform, userConfig)`，供 Sub-Store 使用。
* **`targets/verge.js`**：导出 `main(config, extConfig)`，供 Clash Verge Rev 扩展脚本使用。
* **`targets/cli.js`**：终端自动化构建命令行 (mtk / mihomo-tk / mihomo-toolkit)。
* **`targets/server.js`**：常驻 HTTP 订阅服务器。

---

## 🛡️ 开发防跑偏自检清单 (Checklist)

1. **模块是否单向依赖？** 底层（如 `core/`、`strategy/`）绝不能引用高层（如 `pipeline/` 或 `targets/`）。
2. **是否把副作用隔离到了最外层？** 只有 `io/` 和 `targets/` 允许发起网络请求或读取磁盘；其余所有模块都必须是纯计算。
3. **是否引入了 Node 专属巨石依赖？** 打包给客户端单文件使用的核心代码严禁引入 `fs` 或原生 C++ 扩展。
4. **测试是否全绿？** 每次改动执行 `npm test`，所有套件必须 100% 通过。
