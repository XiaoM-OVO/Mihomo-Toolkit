/**
 * -----------------------------------------------------------------------------
 * Data Layer: 默认 routing 顺序表 (Default Routing Order)
 * -----------------------------------------------------------------------------
 * 批次 3「两表模型」的单一真相源之一：`routing` 里「哪条流量、以什么顺序、去哪个组」。
 *
 * 本文件只描述**默认值**，不含任何组装逻辑：
 *   - `PRESET_DEFINITIONS` —— 预设名 → 展开方式（kind + 数据字段）
 *   - `DEFAULT_ROUTING`    —— 默认顺序（数组顺序即优先级）
 *
 * 设计约束：
 *   1. 顺序必须与 `DEFAULTS.md` 第三节的 59 条默认规则逐条等价
 *      （由 `test/pipeline/routing-expansion.test.js` 守护）；
 *   2. 这里不写死具体服务/规则集清单，只引用分类注册表与字段名，
 *      新增服务仍然只改 `src/config/catalog.js`；
 *   3. 用户配置里的 `routing` 与本表「按键合并、顺序以用户为准」的语义在
 *      `src/strategy/routing.js` 与 `ROADMAP.md` 第十节 10.4/10.6 定义。
 */

'use strict';

/**
 * 预设展开方式
 *
 * kind 取值（由 `src/strategy/routing.js` 解释）：
 *   - `subscription` 订阅直连段（局域网 + 订阅域名 + 可选 IPv6 / QUIC）
 *   - `ads`          广告拦截（`ADS_GROUPS` 逐条按开关）
 *   - `category`     分类注册表（AI / 流媒体 / 社交 / 游戏 / 系统）
 *   - `dev`          开发者与学术（逐服务开关）
 *   - `specialized`  专项服务（Crypto / PayPal / WebRTC / Telegram）
 *   - `process`      进程直连 + BT 追踪器 + 下载软件
 *   - `download`     游戏 / 安卓下载规则集
 *   - `domestic`     国内 / 海外路由方向
 *   - `final`        IPv6 兜底 + 流量审计 + MATCH
 */
const PRESET_DEFINITIONS = Object.freeze({
  subscription: Object.freeze({ kind: 'subscription', label: '订阅直连' }),
  ads: Object.freeze({ kind: 'ads', label: '广告拦截' }),
  ai: Object.freeze({
    kind: 'category', label: 'AI 助手',
    registry: 'ai', listField: 'aiServices', switchKey: 'enableAI'
  }),
  streaming: Object.freeze({
    kind: 'category', label: '流媒体',
    registry: 'streaming', listField: 'streamingServices', switchKey: 'enableStreaming'
  }),
  social: Object.freeze({
    kind: 'category', label: '社交平台',
    registry: 'social', listField: 'socialServices', switchKey: 'enableSocial'
  }),
  game: Object.freeze({
    kind: 'category', label: '游戏平台',
    registry: 'game', listField: 'gameServices', switchKey: 'enableGame'
  }),
  system: Object.freeze({
    kind: 'category', label: '系统服务',
    registry: 'system', listField: 'systemServices', switchKey: 'enableSystemServices'
  }),
  dev: Object.freeze({
    kind: 'dev', label: '开发者与学术',
    registry: 'dev', listField: 'devServices',
    switches: Object.freeze({ github: 'enableGitHub', scholar: 'enableScholar' })
  }),
  specialized: Object.freeze({ kind: 'specialized', label: '专项服务' }),
  process: Object.freeze({ kind: 'process', label: '进程直连与下载软件' }),
  download: Object.freeze({ kind: 'download', label: '下载规则集' }),
  domestic: Object.freeze({ kind: 'domestic', label: '国内 / 海外' }),
  final: Object.freeze({ kind: 'final', label: '兜底与 MATCH' })
});

/**
 * 默认顺序：数组顺序即优先级。
 *
 * 与旧实现的对应关系（`buildRoutingRules` 的段序）：
 *   订阅段 → 广告 → AI → 流媒体 → 社交 → 游戏 → 开发/学术 → 专项 → 系统
 *   → 进程/BT/下载软件 → 下载规则集 → 国内海外 → IPv6/审计/MATCH
 */
const DEFAULT_ROUTING = Object.freeze([
  Object.freeze({ preset: 'subscription' }),
  Object.freeze({ preset: 'ads' }),
  Object.freeze({ preset: 'ai' }),
  Object.freeze({ preset: 'streaming' }),
  Object.freeze({ preset: 'social' }),
  Object.freeze({ preset: 'game' }),
  Object.freeze({ preset: 'dev' }),
  Object.freeze({ preset: 'specialized' }),
  Object.freeze({ preset: 'system' }),
  Object.freeze({ preset: 'process' }),
  Object.freeze({ preset: 'download' }),
  Object.freeze({ preset: 'domestic' }),
  Object.freeze({ preset: 'final' })
]);

module.exports = {
  PRESET_DEFINITIONS,
  DEFAULT_ROUTING
};
