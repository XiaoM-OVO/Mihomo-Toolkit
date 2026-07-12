# Mihomo-Toolkit CLI 命令行工具

`mihomo-toolkit` CLI 工具允许你在本地终端、CI/CD 环境或任何 Node.js 运行时中，一键完成“节点清洗”与“策略构建”的自动化流水线。

## ✨ 特性

- **灵活的运行模式**：支持单跑“纯净节点清洗”、单跑“主脚本策略构建”，或合并执行。
- **配置分离**：通过 `config.yaml` 或 CLI 参数覆盖，无需硬编码修改脚本。
- **本地与远程支持**：可拉取远程机场订阅链接，也可读取本地 YAML 文件。

## 📦 安装与准备

请确保你已经安装了 [Node.js](https://nodejs.org/) (推荐 v18+)。

```bash
cd cli
npm install
```

## 🚀 快速使用

使用 `index.js` 启动 CLI 工具。

### 基础调用

提供一个订阅链接或本地配置文件，并指定输出路径：

```bash
node index.js -u "https://example.com/sub.yaml" -o final_config.yaml
```
> 如果未指定 `-t`（运行模式），默认将执行 `pure` 模式（仅清洗节点）。

### 进阶调用（多订阅合并与全自动打标）

如果你有多个订阅源想要合并，且想为它们分别打上来源标签。你可以直接编写一个 `config.yaml`（参考目录下的 `config.template.yaml`），并在其中定义 `subscriptions` 数组。
此时你**不需要**再提供 `-u` 参数：

```bash
node index.js -c config.yaml -o final_config.yaml
```

### 命令参数详解

| 参数 | 简写 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `--url` | `-u` | 否* | 无 | 原始节点配置的数据源（仅单订阅时使用）。**注意：如果 `--config` 文件中配置了 `subscriptions`，则此参数可省略。** |
| `--output` | `-o` | 否 | `nodes.yaml` | 处理完成后的最终输出文件路径。 |
| `--type` | `-t` | 否 | `pure` | 运行模式选择。可选：`pure`（仅清洗）、`toolkit`（仅构建策略组）、`full`（全流程）。 |
| `--config` | `-c` | 否 | 无 | 自定义的外部 YAML/JSON 配置文件路径，用于覆盖内置配置及定义多订阅源。 |
| `--meta` | `-m` | 否 | 无 | (进阶) 指定一个 JSON 文件路径。开启后会强制输出模式为 Object，并将清洗过程的统计数据（去重数、无效节点数等）以及地区分组信息保存到该文件中。 |

## 🛠️ 运行模式详解 (`-t`)

本工具提供三种的运行模式，满足各种定制化需求：

### 1. `full` 模式
**行为**：一条龙服务。
**流程**：`解析原始订阅` -> `调用 pure-nodes 进行节点深度清洗` -> `调用 mihomo-toolkit 构建完整的策略组与分流系统` -> `输出给内核使用的最终配置文件`。
**使用场景**：日常更新个人专属配置，或自动化构建每日配置。

```bash
node index.js -u ./my-nodes.yaml -t full -o profile.yaml
```

### 2. `pure` 模式 (仅清洗节点)
**行为**：只运行 `pure-nodes.js` 洗白节点，**不生成**任何策略组和路由规则。
**输出格式**：一个纯净的 YAML，仅包含 `proxies` 节点数组。
**使用场景**：你已经有了一套完美的主路由配置，只想借助本工具的“节点清洗、倍率过滤、IP 补全、重命名”功能提纯订阅，然后提供给其他工具（如 Sub-Store 或自建面板）使用。

```bash
node index.js -u "https://example.com/sub.yaml" -t pure -o pure-proxies.yaml
```

### 3. `toolkit` 模式 (仅构建策略组)
**行为**：跳过节点清洗，直接将输入的节点交由 `mihomo-toolkit.js` 构建分流。
**前提条件**：输入的 `url` 建议已经是相对干净的节点数组。
**使用场景**：你的节点已经经过上游清洗（或你觉得节点质量不错不需要提纯），现在只想借助本工具一键生成的“动态测速大区、五大流媒体分流、防漏网 DNS 体系”。注意：在此模式下，主脚本（`mihomo-toolkit.js`）内置的重命名功能**依旧有效**。

```bash
node index.js -u ./already-clean-nodes.yaml -t toolkit -o config-with-routing.yaml
```

## 📝 高级玩法：覆写配置

CLI 目录下可以存在一个 `config.yaml` 文件（你也可以通过 `-c` 指定其他路径）。如果此文件存在，CLI 会在运行时读取其中的配置项，并**合并/覆盖**到脚本内置的 `USER_CONFIG` 中。

这让你能够分离代码与配置。例如在 `config.yaml` 中写入：

```yaml
enableIPv6: true
enableAntiAD: true
renameTemplate: "[{airport}] {icon} {region} {index} {multi}"
```

CLI 在运行时就会自动使用上述设定，而完全不需要你去修改源码！

### 🔀 脚本独立作用域配置（进阶）

如果你需要为清洗脚本（`pure-nodes.js`）和主脚本（`mihomo-toolkit.js`）分别设定不同的配置，你可以使用 `pureConfig` 和 `toolkitConfig` 两个特殊字段进行隔离：

```yaml
# 根目录的配置会同时应用于两个脚本（共享配置）
enableAirportTag: true
adTextThreshold: 10

# 多订阅合并与自动打标机制
subscriptions:
  - url: "https://example.com/sub1.yaml"
    tag: "AirportA"  # 会在内部自动补全为 [AirportA] 并注入到原节点名前
  - url: "https://example.com/sub2.yaml"
    tag: "AirportB"
  - url: "./local-nodes.yaml"

pureConfig:
  # 这里的配置仅对纯净节点清洗脚本生效
  enableIpEnrich: true

toolkitConfig:
  # 这里的配置仅对主脚本策略构建生效
  enableNodeRename: false
```

> 💡 **防二次污染机制**：在 `full`（全自动流水线）模式下，由于清洗脚本已经对节点名进行了深度的打标与洗白，为了防止主脚本接手后进行二次重命名导致名字乱码，CLI 会**自动为 `mihomo-toolkit` 注入 `enableNodeRename: false`**。你可以通过在 `toolkitConfig` 里硬性写明 `enableNodeRename: true` 来覆盖这个智能保护机制。

