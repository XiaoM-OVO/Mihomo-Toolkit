# 🏗️ Mihomo-Toolkit 架构设计文档

本文档阐述 Mihomo-Toolkit 当前代码库的**系统分层、数据流转、核心算法实现机理、配置系统契约与已知系统局限**。所有描述均以 `src/` 实际实现代码及单元测试为唯一事实标准。

---

## 一、 系统定位与架构原则

Mihomo-Toolkit 是一个面向 Mihomo (Clash.Meta) 的代理节点清洗、重命名与分流配置生成工具。系统围绕以下核心工程原则构建：

1. **计算与 I/O 分离**：
   - 核心层（`core/`、`strategy/`）专注于纯算法计算与数据转换，相同的输入必须得到确定性的输出；
   - 所有网络请求、文件读写等具有副作用的操作收敛在 `io/`、`config/` 和 `targets/`。
2. **单一事实来源 (SSOT)**：
   - 字段规范、默认值与信任级别统一在 `src/data/field-registry.js` 声明；
   - 服务定义基准统一在 `src/config/catalog.js` 维护。
3. **输入不可信与安全收敛 (Fail-Closed)**：
   - 外部订阅源与远程请求参数一律视为不可信数据，默认剥离所有可能控制宿主环境或改变网络监听面的特权字段。
4. **务实求真，技术债务透明化**：
   - 架构设计力求分层清晰，但对当前版本存在的依赖妥协与架构缺陷（如尚未下沉的基础工具库依赖）在文档中予以明确记录，不掩盖、不夸大。

---

## 二、 模块分层与依赖拓扑

系统逻辑上划分为 8 个层级，调用关系总体保持自顶向下：

```text
┌────────────────────────────────────────────────────────┐
│ 1. Targets (宿主入口层)                                 │
│    • CLI (src/targets/cli.js)                          │
│    • HTTP Server (src/targets/server.js)               │
└───────────────────────────┬────────────────────────────┘
                            │ 驱动调用
┌───────────────────────────▼────────────────────────────┐
│ 2. Pipeline (流程编排层)                                │
│    • engine.js (总调度与生命周期)                      │
│    • ingestion.js (抓取清洗)   • envelope.js (数据包装)│
│    • nodes.js (纯节点产物)     • strategy.js (策略组)   │
│    • config.js (全量配置装配)  • report.js (审计数据)  │
└─────────────┬────────────────────────────┬─────────────┘
              │                            │
      ┌───────▼───────────┐        ┌───────▼───────────┐
      │ 3. Strategy (策略)│        │ 4. Core (算法核心)│
      │    • topology.js  │        │    • cleaner.js   │
      │    • rules.js     │        │    • dedupe.js    │
      │    • prune.js     │        │    • rename.js    │
      │    • dns.js       │        │    • sort.js      │
      │    • dashboard.js │        │    • transport.js │
      │    • kernel.js    │        │    • security/*   │
      └───────┬───────────┘        └───────┬───────────┘
              │                            │
              └─────────────┬──────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 5. IO (外部世界边界 - 副作用层)                         │
│    • fetcher.js (HTTP 请求)    • cache.js (内存缓存)   │
│    • ssrf.js (网络安全过滤)    • parsers/* (协议解析)  │
│    • dns-resolver.js (DNS解析) • limits.js (配额防御)  │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 6. Config (配置装载与合并)                             │
│    • index.js (配置求解器)    • catalog.js (服务编目) │
│    • include.js (片段展开)    • mounts.js (外挂读盘)  │
│    • defaults.js (出厂默认值)                          │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 7. Data (只读运行基础层 - 静态基线与字典)              │
│    • field-registry.js (字段字典与信任元数据)          │
│    • security-baselines.js (不可变安全基线与受保护域)  │
│    • cleaner-rules.js (地区、线路、清洗正则词库)       │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ 8. Infra (基础设施无状态基元层 - 通用纯计算)           │
│    • ip.js (IP/CIDR 分类与 FQDN 语法校验)              │
│    • sub-info.js (订阅响应头元信息解析与换算)          │
└────────────────────────────────────────────────────────┘
```

### 🛡️ 架构分层契约与零违规保证 (Architectural Invariants)
全仓模块严格满足单向 DAG 调用，经由 `scripts/verify-architecture.js` 自动化静态检验：
- `Core -> Config`:  ✅ 0 违规
- `Core -> IO`:      ✅ 0 违规
- `IO -> Core`:      ✅ 0 违规 (底层通信不反向依赖核心计算)
- `Data -> Other`:   ✅ 0 违规 (数据基线只读无外引)
- `Infra -> Other`:  ✅ 0 违规 (基础设施基元纯计算无内部依赖)

---

### 📂 代码库物理文件结构映射 (Physical Layout)

全库源码严格按照 7 层拓扑分布于 `src/` 各子目录中：

```text
src/
├── index.js                      # 🌟 全库唯一顶层门面 (Facade)，统一导出 Public API
│
├── 1. targets/                   # 🔌 Layer 1: 宿主环境终端适配器 (轻量交互层)
│   ├── cli.js                    # 命令行工具适配器 (mihomo-toolkit)
│   └── server.js                 # 常驻 HTTP 订阅服务 (/sub, /healthz, Token鉴权)
│
├── 2. pipeline/                  # 🚀 Layer 2: 交付流水线编排调度层 (与交付形态 1:1 映射)
│   ├── engine.js                 # 全流程总调度引擎 (生命周期早退与 Checkpoint 截断)
│   ├── ingestion.js              # 订阅并发抓取与安全网关 (净化/资产闭包/Stale回退)
│   ├── nodes.js                  # 纯净节点清洗流水线 (去重/打标/重命名)
│   ├── strategy.js               # 策略拓扑与分流规则组装
│   ├── config.js                 # 完整配置装配流水线
│   ├── report.js                 # 质量审计体检流水线 (JSON)
│   └── envelope.js               # 节点只读 Envelope 包装与旁路接入
│
├── 3. strategy/                  # 🌐 Layer 3: 策略组拓扑与内核优化层
│   ├── topology.js               # 六维大区折叠、动态测速与兜底策略组装配
│   ├── rules.js                  # 规则集 (Rule-Providers) 与分流路由组装
│   ├── presentation.js           # 策略组展示层装饰器 (在线图标/徽标挂载)
│   ├── prune.js                  # 有向无环图 (DAG) 递归空组级联淘汰与殉葬剪枝
│   ├── dashboard.js              # 看板状态合成 (流量/到期/信息节点网格化)
│   ├── registries.js             # 六维服务注册表管理模块 (委托 catalog)
│   ├── dns.js                    # Fake-IP / DoH 防泄漏 DNS 方案覆写注入
│   └── kernel.js                 # TUN 网卡、Sniffer 嗅探器及内核性能调优
│
├── 4. core/                      # 🧮 Layer 4: 节点清洗核心算法层 (Pure & Deterministic)
│   ├── cleaner.js                # 垃圾拦截、倍率线路提取、属性智能分类打标
│   ├── notice.js                 # 原生公告/续费通知/伪节点判定
│   ├── isolation.js              # 业务分类隔离判定 (家宽/高倍率/下载等)
│   ├── node-trust.js             # 节点进程内信任边界与内部 Synthetic 标记
│   ├── metadata.js               # 节点元数据提取与特征归一化
│   ├── dedupe.js                 # 物理网络指纹提取与去重
│   ├── transport.js              # 统一传输层门面 (Host/SNI/Path 提取与注入)
│   ├── geo.js                    # 地区智能正则匹配与落地城市精准提取
│   ├── rename.js                 # 分级命名计划、两阶段冲突仲裁与模板解析
│   ├── sort.js                   # 节点多维智能排序与确定性排列
│   ├── fission.js                # 域名并发 DNS 解析与多 IP 独立节点裂变
│   ├── logger.js                 # 纯核心日志管道与敏感凭据脱敏
│   ├── chinese-convert.js        # 简繁中文递归转换与无依赖回退
│   ├── chinese-sync.js           # 节点名/策略组/引用/规则四路简繁同步
│   ├── security/                 # 🛡️ 核心安全沙箱与策略判定
│   │   ├── control-plane.js      # 交付契约白名单与控制面剥离
│   │   ├── remote-config.js      # 远程可信配置剥离 (Fail-Closed)
│   │   ├── dns-sanitizer.js      # 节点专属 DoH/Hosts 资产闭包与净化
│   │   └── resolver-plan.js      # DNS 引导方案生成与 INV 不变式验证
│   └── shared/                   # 核心共享数据与工具
│       ├── regions.js            # 核心大区与地区代码字典
│       └── icons.js              # 策略组 Emoji 与图标常量映射
│
├── 5. io/                        # 📡 Layer 5: 外部世界通信层 (唯一允许副作用的底层)
│   ├── fetcher.js                # HTTP 请求调度与 Stale 容灾兜底缓存
│   ├── cache.js                  # 内存级 LRU-TTL 缓存管理器
│   ├── ssrf.js                   # SSRF 深度校验、私网拦截与防探测
│   ├── dns-resolver.js           # 异步 DNS 批量解析器 (用于 Fission 裂变)
│   ├── limits.js                 # 资源超限防御 (URL、配置大小、节点总数)
│   ├── fetch-proxy.js            # 本地代理调度封装 (undici ProxyAgent)
│   └── parsers/                  # 多协议代理节点与订阅解析器
│       ├── index.js              # 解析器统一聚合门面
│       ├── registry.js           # 协议解析器注册表
│       ├── vmess.js              # VMess 协议解析器
│       ├── vless.js              # VLESS 协议解析器
│       ├── trojan.js             # Trojan 协议解析器
│       ├── shadowsocks.js        # Shadowsocks 协议解析器
│       ├── hysteria2.js          # Hysteria2 协议解析器
│       ├── tuic.js               # TUIC 协议解析器
│       ├── socks.js              # SOCKS5 协议解析器
│       ├── http.js               # HTTP 代理协议解析器
│       └── base64.js             # Base64 订阅内容解码器
│
├── 6. config/                    # ⚙️ Layer 6: 配置策略层 (装载/合并/编目)
│   ├── index.js                  # resolveConfig 合并器 (只增不减基线合并)
│   ├── catalog.js                # 领域服务编目 (SSOT) 与六维服务基准
│   ├── defaults.js               # 出厂默认配置 (由 field-registry 派生)
│   ├── include.js                # 配置片段挂载 include (主文件优先/环路防护)
│   └── mounts.js                 # 外挂文件载入与存在性校验
│
├── 7. data/                      # 📦 Layer 7: 只读运行基础层 (静态基线与字典)
│   ├── index.js                  # 基础层统一导出
│   ├── field-registry.js         # 字段注册表 SSOT (定义/默认值/信任级别)
│   ├── security-baselines.js     # 安全基线 (受保护域名/豁免组/Fake-IP 保底)
│   └── cleaner-rules.js          # 节点清洗规则库 (地区/线路/阻断正则/权重)
│
└── 8. infra/                     # 🧱 Layer 8: 基础设施层 (无状态纯计算基元)
    ├── ip.js                     # IP/CIDR/域名语法校验与分类工具 (纯函数)
    └── sub-info.js               # 订阅元信息解析与流量换算工具 (纯函数)
```

---

## 三、 三大交付形态与流水线流转 (Delivery Pipeline)

系统根据 `outputMode` 参数在流水线的不同检查点（Checkpoint）截断并交付产物：

```text
               外部请求 (CLI / HTTP Server / SDK 调用)
                                 │
                                 ▼
                     src/pipeline/engine.js
                   (配额检查、缓存匹配、并发单飞)
                                 │
                                 ▼
                    src/pipeline/ingestion.js
            (订阅并发拉取、协议解析、控制面字段安全剥离)
                                 │
                                 ▼
                      src/pipeline/nodes.js
             (清洗过滤、指纹去重、属性打标、意图重命名)
                                 │
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
   [mode == 'nodes']    [mode == 'report']    [mode == 'config']
            │                    │                    │
            ▼                    ▼                    ▼
      【Checkpoint 1】      【Checkpoint 2】     【Checkpoint 3】
     直接输出清洗后节点       生成结构化审计 JSON      组装策略拓扑与分流规则
     { proxies: [...] }     { total, valid, ... }   输出最终完整 Mihomo 配置
```

### 1. `nodes` 模式（纯节点输出）
- **交付内容**：仅输出符合 Mihomo 格式的 `{ proxies: [...] }` 代理对象列表。
- **处理链路**：完成广告词过滤、信息节点拦截、网络指纹去重、节点重命名与排序。
- **边界**：不输出任何 `proxy-groups` 或 `rules`，剥离订阅中的全部控制字段。

### 2. `report` 模式（清洗报告）
- **交付内容**：交付结构化的节点质量体检数据（JSON 格式）。
- **包含指标**：输入总数、有效保留数、重复剔除数、广告过滤数、未知地区数、裂变节点数等统计维度。

### 3. `config` 模式（完整配置交付 - 默认）
- **交付内容**：输出可直接供 Mihomo 内核启动运行的完整 YAML 配置文档。
- **处理链路**：在纯节点清洗的基础上，进一步执行：
  1. 订阅状态虚拟看板节点合成（流量、到期时间统计）；
  2. 预设策略组拓扑装配与节点分桶（AI、流媒体、各大区与测速组）；
  3. 路由分流规则（`rules`）与规则提供者（`rule-providers`）生成；
  4. 级联空组剪枝与孤儿规则清理；
  5. DNS 安全净化、防死锁引导与 Fake-IP 过滤注入；
  6. 输出前交付契约白名单收口（严格限制输出顶层键）。

---

## 四、 核心机制实现机理

### 1. 物理网络指纹去重 (`src/core/dedupe.js` & `transport.js`)
为了避免订阅中同服务器换名（如“香港专线01”、“香港VIP01”）导致的重复节点，系统通过提取物理连接关键特征计算哈希指纹：
- **指纹维度**：`Server`、`Port`、`Type`、`Network`、`SNI`、`Host`、`Path`、以及各协议专属鉴权凭证（如 Reality 的 `public-key`、`short-id`，Hysteria2 的 `ports`、`obfs` 等）。
- **处理机制**：同指纹节点只保留首个出现的条目，剔除项计入去重统计。

### 2. 分级命名计划与重名仲裁 (`src/core/rename.js`)
节点重命名避免原地并发修改，采用两阶段处理：
1. **意图计算 (`buildRenamePlan`)**：
   根据模板（如 `{regionIcon} {region} {indexPrefix}{index} [{multi}]`）和节点属性生成意图名称，并划分 4 级优先级：
   - **Tier 1**：保留原名节点（`keepName`）、特殊规则节点；
   - **Tier 2**：信息/公告及虚拟看板节点；
   - **Tier 3**：未识别出地区的原名节点；
   - **Tier 4**：常规按模板渲染节点。
2. **两阶段仲裁 (`applyRenamePlan`)**：
   高优先级节点先认领目标名；发生同名冲突时，按序号递增分配后缀（如 ` #2`、` #3`），确保不会抢占后续同名合规节点的原生位置。

### 3. 预设策略拓扑与 DAG 剪枝 (`src/strategy/topology.js` & `prune.js`)
- **策略组生成现状**：
  当前版本的策略组结构（主力组、各大区测速组、AI 组、流媒体组、下载隔离组等）基于业务预设代码生成，支持通过分类标签将节点注入对应预设组。
- **空组剪枝机制 (`prune.js`)**：
  在多层策略组引用场景下（如 `DIRECT` ➔ `ChatGPT` ➔ `美国节点`），当节点池缺少某些地区导致策略组为空时：
  1. 从物理节点与内核保留目标（`DIRECT`、`REJECT` 等）作为有效出口自底向上反向标记可达性；
  2. 剔除无法到达有效出口的空策略组；
  3. 通过深度优先遍历检测并剪断环路引用（避免内核启动死锁）；
  4. 遍历分流规则，若规则目标组被剔除，对应规则殉葬注销；若规则提供者无规则引用，作为孤儿一同清理。

### 4. 外部输入安全净化 (`src/core/security/`)
外部订阅本质上属于不可信数据，系统在多个节点设立防护防线：
- **控制面字段剥离 (`control-plane.js`)**：
  严格剥离订阅自带的特权控制键（如 `external-controller`、`secret`、`allow-lan`、`tun` 等），防止订阅接管本地运行环境。
- **远程配置降级 (`remote-config.js`)**：
  服务端接收到 `?config=<URL>` 时，基于 `field-registry.js` 中的 `trust: 'any'` 白名单进行收敛过滤，剥离本地读写字段（`include`、`output`）及特权 DNS 控制面字段。
- **DNS 安全配置沙箱 (`dns-sanitizer.js`)**：
  强制引导 DNS 采用纯 IP 地址以避免解析死锁；剥离 DoH 中的危险修饰符；默认强制 DNS 监听本地回环地址（`127.0.0.1`）。

### 5. 内存 SWR 缓存与请求合并 (`src/pipeline/engine.js` & `src/io/cache.js`)
为了减轻高频请求对订阅上游的压力：
- **SWR 状态流转**：
  - **Fresh**：在缓存有效期内，直接返回内存快照；
  - **Stale**：超出新鲜期但在陈旧容忍期内，立即下发旧快照，后台异步触发重新构建；
  - **Miss**：无缓存，同步执行构建。
- **Single-Flight 并发合并**：
  并发发起的相同缓存键请求会共享同一个构建 Promise，避免瞬时并发导致重复抓取上游。

---

## 五、 配置系统与外挂机制

配置系统支持单文件 `config.yaml` 或基于 `include` 的多片段挂载：

```yaml
# 主配置示例
logLevel: "info"
outputMode: "config"

# 通用片段挂载 (共用同一份 Schema)
include:
  - "./fragments/subscriptions.yaml"
  - "./fragments/rules.yaml"
```

1. **展开时机**：
   在 CLI 或 Server 读取配置的最前置阶段完成 `include` 递归展开，确保片段中包含的基础参数（如 `subscriptions`、`logLevel`）能够尽早生效。
2. **合并规则**：
   - 基础标量：主文件优先覆盖片段，靠后片段优先覆盖靠前片段；
   - 数组类型：并集去重（保持出现顺序）；
   - 相对路径：一律以**引用该片段的文件所在目录**为基准，避免跨目录执行失效。
3. **安全限制**：
   `include` 在远程 `?config=` 模式下被强制剥离，禁止远程请求读取本地文件系统。

---

## 六、 当前系统局限性与设计边界 (Known Limitations)

为了保持技术评估的客观性，以下为系统当前版本明确存在的局限与待攻坚点：

1. **策略组拓扑缺乏声明式自定义能力**：
   当前策略组的层级结构（各大区组、业务组、测速组等）完全在 `topology.js` 中硬编码构建。用户只能通过配置决定是否开启某预设组，或者把节点标签塞入预设组，**无法在 `config.yaml` 中像原生 Mihomo 那样自由声明一个全新独立的策略组及其嵌套关系**。
2. **服务目录需要双重激活**：
   在 `customServices` 中定义的新服务，仍需在激活列表（如 `aiServices`）中显式写明对应的 key 才能生效，尚未实现“声明即启用”。
3. **SSRF 防御存在 DNS Rebinding (TOCTOU) 风险**：
   `src/io/ssrf.js` 在验证阶段与后续实际建立网络连接阶段各执行一次独立 DNS 解析，未做 IP 固定（IP Pinning）。在面对恶意 DNS 动态切换回环 IP 的场景下理论上存在绕过窗口。
4. **宿主适配层较为简陋**：
   当前 `targets/` 仅提供了最基础的 CLI 与轻量 HTTP 服务端，对于更广泛的集成场景（如 Serverless / 边缘 Worker / 复杂进程守护）尚未形成标准化的适配接口。
