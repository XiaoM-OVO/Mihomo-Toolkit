# M3 前期完成记录（Phase A / B 批次 1–4）

> 已完成条目的过程明细，仅供追溯。其中 `customGroups`、组内 `rules`、六个服务清单字段等写法已在 10.12 DSL 收口中被删除或改名；当前写法以 [CONFIGURATION.md](../../CONFIGURATION.md) 为准，主线进展见 [ROADMAP.md](../../ROADMAP.md)。

- [x] **声明式策略拓扑与装配解耦 (Declarative Topology Engine)**：
  - [x] 破除双硬编码与强耦合：服务元数据归 `catalog.js`，装配规则归拓扑引擎，解决“修改策略组逻辑需改两处甚至改源码”的痛点；
  - [x] 声明式自定义策略组：允许用户在 `config.yaml` 中通过 `customGroups` 自定义策略组（原生静态字段透传，配合 `match` 动态节点筛选配方与 `exclude` 黑名单）；
  - [x] 规则与图标联动：支持在组声明中关联 `rules` 与 `emoji`/`icon`，全自动挂载分流与展示层渲染。
- [x] **图标系统模型统一重构 (Icon Registry)**：
  - [x] 消除 `icon` 字段概念混淆（国旗 Emoji vs 本地图片 vs 远程 URL），建立统一的图标资产管理规范；
  - [x] 支持策略组骨架组图标自定义配置覆盖 (`groupIcons`)；
  - [x] 策略组与节点命名模式联动，支持完全去除 Emoji 的纯净模式 (`groupIconMode: 'none'`)。
- [x] **服务编目纯声明化与元数据全生命周期管理 (Catalog SSOT & Lifecycle)**：
  - [x] 消除魔术字符串与隐式契约：引入 `@download`、`@service`、`@self` 语义宏动态绑定大类聚合目标；
  - [x] 专项服务规则纯声明化：重构 Telegram 等专项规则为静态 `process` 字典与 `rules` 数组，杜绝命令式闭包；
  - [x] 聚合组与专项组全量属性投影：注册表输出 `aggregates` 与 `specialized` 全生命周期属性（含外观、分流规则、Providers、进程列表与拓扑配方），不再绕路读取底层常量；
  - [x] 游戏子规则集声明驱动按需激活与防幽灵组：`gameServices` 精准激活所需 Provider，未声明平台不下载不注入，自定义游戏安全归并聚合组，杜绝未定义策略组污染；
  - [x] 彻底清理向后兼容过渡垫片与遗留别名，全仓贯彻零历史包袱原则。
- [x] **策略组双范式分层收敛（Phase B · 批次 1-4 全部闭环完成）**：
  - 以统一 `groups` 声明清单（内置组逐条 `ref` 引用 + 自定义声明同列一表）替代全部 `enableX` 建组开关与 6 个服务清单字段；声明即激活、注释即关闭（开关只管分池与折叠，DSL 只管组）；
  - 彻底取消用户面「六维」组织概念（降级为引擎内部特征池标签与目录条目属性）；详见 [M3.B 规格归档](m3-spec.md)。
