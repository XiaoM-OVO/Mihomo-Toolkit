/**
 * -----------------------------------------------------------------------------
 * Data Layer: 默认 routing 顺序表 (Default Routing Order)
 * -----------------------------------------------------------------------------
 * 「两表模型」的单一真相源之一：`routing` 里「哪条流量、以什么顺序、去哪个组」。
 *
 * 本文件只描述**默认值**，不含任何组装逻辑：
 *   - `PRESET_DEFINITIONS` —— 预设名 → 展开方式（kind + 数据字段）
 *   - `DEFAULT_ROUTING`    —— 默认顺序（数组顺序即优先级）
 *
 * 核心语义：**表里出现即生效，没写就没有**。没有第二组开关来决定「这条规则要不要生成」，
 * 想要少一点分流就删掉对应条目；想只留一部分服务就用逐条 `{ service }` 取代整段预设。
 *
 * 设计约束：
 *   1. 顺序必须与 `DEFAULTS.md` 第三节的默认规则逐条等价
 *      （由 `test/pipeline/routing-expansion.test.js` 守护）；
 *   2. 预设只引用分类注册表，不写死服务清单——新增服务仍然只改 `src/data/catalog/services/`；
 *   3. 默认值本身就是配置：觉得默认不合理，直接改这张表并按 ROADMAP 10.8 第 1 条
 *      更新基线、在提交信息里说明变了什么/为什么。
 */

'use strict';

/**
 * 预设展开方式
 *
 * kind 取值（由 `src/strategy/routing.js` 解释）：
 *   - `subscription` 订阅直连段（局域网 + 订阅域名 + 可选 IPv6）
 *   - `quic`         QUIC 拦截（默认表不含；写进表即拦截）
 *   - `ads`          广告拦截（`ADS_GROUPS` 全部规则来源）
 *   - `category`     分类注册表（AI / 流媒体 / 社交 / 游戏 / 系统）下的全部服务
 *   - `dev`          开发者与学术分类下的全部服务
 *   - `specialized`  专项服务（Crypto / PayPal / WebRTC / Telegram）全部
 *   - `process`      自定义进程名单（默认直连，可用 `to` 改道；出厂名单为空）
 *   - `bt`           BT 客户端进程 + BT 追踪器（默认直连，可整段改道）
 *   - `download`     下载软件进程 + 游戏 / 安卓下载规则集（默认走「下载策略」）
 *   - `domestic`     国内 / 海外路由方向
 *   - `final`        IPv6 兜底 + 流量审计 + MATCH
 */
const PRESET_DEFINITIONS = Object.freeze({
  subscription: Object.freeze({ kind: 'subscription', label: '订阅直连' }),
  quic: Object.freeze({ kind: 'quic', label: 'QUIC 拦截' }),
  ads: Object.freeze({ kind: 'ads', label: '广告拦截' }),
  ai: Object.freeze({ kind: 'category', label: 'AI 助手', registry: 'ai' }),
  streaming: Object.freeze({ kind: 'category', label: '流媒体', registry: 'streaming' }),
  social: Object.freeze({ kind: 'category', label: '社交平台', registry: 'social' }),
  game: Object.freeze({ kind: 'category', label: '游戏平台', registry: 'game' }),
  system: Object.freeze({ kind: 'category', label: '系统服务', registry: 'system' }),
  dev: Object.freeze({ kind: 'dev', label: '开发者与学术', registry: 'dev' }),
  specialized: Object.freeze({ kind: 'specialized', label: '专项服务' }),
  process: Object.freeze({ kind: 'process', label: '自定义进程分流' }),
  bt: Object.freeze({ kind: 'bt', label: 'BT 客户端与追踪器' }),
  download: Object.freeze({ kind: 'download', label: '下载软件与下载规则集' }),
  domestic: Object.freeze({ kind: 'domestic', label: '国内 / 海外' }),
  final: Object.freeze({ kind: 'final', label: '兜底与 MATCH' })
});

/**
 * 默认顺序：数组顺序即优先级。
 *
 * 默认取舍（与 DEFAULTS.md 一致）：
 *   - 广告只挂 `ad-block`（anti-ad 需要自己加 `{ service: 'anti-ad' }`）
 *   - 专项只挂 Telegram（Crypto / PayPal / WebRTC 要自己加）
 *   - 社交整段默认不挂（`{ preset: 'social' }` 或逐条 `{ service }` 自行开启）
 *   - QUIC 拦截默认不挂
 *   - 自定义进程段默认不挂（BT 客户端由 `bt` 段覆盖，其余进程按需自行添加）
 */
const DEFAULT_ROUTING = Object.freeze([
  Object.freeze({ preset: 'subscription' }),
  Object.freeze({ service: 'ad-block' }),
  Object.freeze({ preset: 'ai' }),
  Object.freeze({ preset: 'streaming' }),
  Object.freeze({ preset: 'game' }),
  Object.freeze({ preset: 'dev' }),
  Object.freeze({ service: 'telegram' }),
  Object.freeze({ preset: 'system' }),
  Object.freeze({ preset: 'bt' }),
  Object.freeze({ preset: 'download' }),
  Object.freeze({ preset: 'domestic' }),
  Object.freeze({ preset: 'final' })
]);

module.exports = {
  PRESET_DEFINITIONS,
  DEFAULT_ROUTING
};
