# M1 / M2 完成记录（v2.0-Alpha / v2.0-Beta）

> 已闭环里程碑的过程明细（逐条验收项与当时的实现细节），仅供追溯；仍生效的约束已提炼回 [ROADMAP.md](../../ROADMAP.md)，主线规划见该文件。

### 🟢 Milestone 1: v2.0-Alpha 稳定性加固与核心债务清零 (当前阶段 · 优先执行)
> **阶段目标**：清理审查中发现的所有核心逻辑缺陷、协议解析边界问题与架构坏味道，确保内核纯净与稳定。

- [x] **高危逻辑与配置意图对齐**：
  - [x] 修复 `customRules` 分流优先级与文档倒挂（从末尾提前至匹配首位，确保自定义私域规则不被内置规则拦截）；
  - [x] 修复 `isAllowedUrl` 同步白名单绕过问题，服务端预检引入完整主机名与 IP 安全校验。
- [x] **架构分层反向依赖清理**：
  - [x] 下沉基础网络与流量工具至独立基础设施层 (`src/infra/`)，解决 `scripts/verify-architecture.js` 报出的 `IO -> Core: ❌ 2` 违规。
- [x] **协议解析器健壮性与边界修复**：
  - [x] Shadowsocks 解析器修复：改用 `indexOf(':')` 提取密码（防密码包含冒号被截断），插件参数防等号截断并兼容 SIP003 内联插件；
  - [x] VMess 解析器修复：兼容 `tls: 1 / true` 多种真值形式，补齐 `net: tcp` 搭配 `type: http` 伪装头（Host/Path）提取；
  - [x] VLESS / Trojan 解析器修复：gRPC 路径兼容读取 `service-name` 与 `path` 别名。
- [x] **纯函数原则重塑与原地突变消除**：
  - [x] 消除 `cleaner.js:classifyNode` 中原地修改 `proxy.server / port / name` 的副作用；
  - [x] 消除 `kernel.js:applyCoreOptimize` 中原地修改代理节点属性的副作用；
  - [x] 修正机场订阅 Tag 隐式豁免广告清洗的逻辑越权缺陷（`subTagLower === k`）。
- [x] **代码去重与死代码清理**：
  - [x] 消除 `ingestion.js` 中多订阅与单 URL 两条路径之间超 130 行的重复代码；
  - [x] 剔除 `rename.js` 中未被业务调用的遗留死代码 `resolveNameCollisions`；
  - [x] 统一 `metadata.js` 与 `regions.js` 的地区事实源，统一看板节点假 IP 定义（`1.0.0.1` vs `127.0.0.1`）。
- [x] **安全隐私与凭证脱敏加固**：
  - [x] 补全终端 Logger 对 Hysteria 2 (`hy2://`)、TUIC (`tuic://`)、Socks 与 VMess 节点敏感凭据的脱敏正则。

---

### 🟡 Milestone 2: v2.0-Beta 宿主健壮性与生产级加固 (稳固下半场)
> **阶段目标**：加固 HTTP Server 与 CLI 的生产可用性，增强运行期容灾与排障体验。

- [x] **生产级 HTTP 服务平滑退出与并发保护**：
  - [x] 注册 `process.on('SIGTERM')` 与 `SIGINT` 信号监听，实现 Graceful Shutdown，等待进行中任务排空后再关闭；
  - [x] 停机退出条件收敛为「连接已全部关闭 ∧ 任务已全部排空」，补齐后台预热/定时刷新的排空等待（避免 `server.close` 回调在无入站连接时提前 resolve，令后台刷新写缓存中途被 kill）；
  - [x] 配置文件热重载增加防抖与并发读写保护，避免多请求并发解析或读取到编辑器未写完的中间态。
- [x] **资源流控与并发限制**：
  - [x] `dns-resolver.js` 引入并发限制队列（自实现信号量，零外部依赖，上限 16），解决域名裂变瞬间并发数百 DNS 查询导致套接字耗尽的问题；
  - [x] DoH 查询增加代理支持（复用 `fetchProxyPort` / `fetchProxyStrategy` 出口策略，经本地回环代理转发；与订阅抓取共用 `fetch-proxy.js` 的回环校验与分发器缓存）与并发竞速（已实现：AliDNS 与 Google DNS 双路并发，首个非空结果胜出，消除串行超时卡顿）。
- [x] **运维诊断与监控增强**：
  - [x] CLI 新增 `--dry-run` / `--validate` 模式：完整校验配置语法、订阅连通性与 DNS 不变式，且绝不写入任何磁盘产物；存在 DNS 不变式违规或订阅全部不可用时以退出码 1 失败关闭（可直接接入 CI）；
  - [x] 完善 `/healthz` 监控端点：在原有 `activeBuilds` / `maxConcurrentBuilds` 基础上新增 Profile SWR 缓存命中率（hits/misses/hitRate）与订阅健康度聚合视图（enabled / lastBuildAt / lastBuildOk / hasFailedSub / hasTerminalFailure）；逐条订阅明细留待 ingestion→engine 贯通为后续增强。
- [x] **运行环境与基准兼容**：
  - [x] 消除 `engine.js` 展开 include 时硬编码依赖 `process.cwd()` 的缺陷，支持 SDK 跨目录配置传递；
  - [x] 抽象并统一 `ProfileCache` 与 `SubStaleCacheMap` 的版本淘汰时序逻辑：抽出共享原语 `src/io/generation.js`（`GenerationSource` 单调递增序号源 + `isSuperseded` 超越判定），收敛两处手写代际机制与分叉的溢出策略（统一为超限抛错、杜绝回绕重号）。
