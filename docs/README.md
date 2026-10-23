# 文档索引

## 仍然生效的契约（根目录，路径保持稳定）

| 文档 | 内容 |
| :--- | :--- |
| [README.md](../README.md) | 项目概览、架构分层、快速开始 |
| [CONFIGURATION.md](../CONFIGURATION.md) | 用户配置契约（字段、语义、默认值） |
| [DEFAULTS.md](../DEFAULTS.md) | 默认产物基线（规模、59 条规则顺序、变更规则） |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | 分层架构与依赖规则 |
| [ROADMAP.md](../ROADMAP.md) | 当前状态、里程碑、M3.B 规格与候选改进 |

## 记录与明细（docs/）

| 文档 | 内容 |
| :--- | :--- |
| [history/milestones-v2-alpha-beta.md](history/milestones-v2-alpha-beta.md) | M1 / M2 完成记录（v2.0-Alpha / Beta），逐条验收明细 |
| [history/m3-early-completions.md](history/m3-early-completions.md) | M3 前期完成条目（Phase A / B 批次 1–4），含已作废写法 |
| [history/m3b-implementation.md](history/m3b-implementation.md) | M3.B 实施记录（10.10–10.19），含否决方案与选型依据 |
| [history/v4-boundary.md](history/v4-boundary.md) | v4 统一内核的取代边界与命名谱系 |
| [history/changelog-legacy.md](history/changelog-legacy.md) | v1 – v3.x 逐次更新记录归档（不再维护） |
| [debt.md](debt.md) | 技术债务与坏味道跟踪表 |

## 约定

- 根目录只放**仍然生效的契约**；过程记录、被否决的方案、一次性的外部评审建议一律放 `docs/`。
- 新增文档前先判断属于「契约」还是「记录」：契约进根目录，记录进 `docs/`，不要让记录回流。
- `ROADMAP.md` 只保留前瞻与规格；实施记录写完后移入 `docs/history/`，主线只留链接。
