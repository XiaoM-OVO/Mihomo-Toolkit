/**
 * -----------------------------------------------------------------------------
 * Data Layer: 节点清洗与打标只读规则词库 (Cleaner Rules Baseline)
 * -----------------------------------------------------------------------------
 * 本模块维护节点深度清洗、安全拦截、线路特征与属性识别的静态基线数据：
 *   - 入口城市、落地大区与单字缩写字典 (ENTRY_CITIES, EXIT_REGIONS, TAG_MAP)
 *   - 线路类型、复合运营商与质量权重表 (LINE_MAP, CARRIER_SHORT_MAP, LINE_QUALITY_TIERS)
 *   - 拦截与阻断正则基线 (假IP、弱密码、公告说明、广告词、禁止下载词)
 *   - 静态业务特征规则 (家宽住宅 ISP、游戏、免费、实验、IPv6 等)
 *   - 隔离分类排序优先级 (ISOLATION_SORT_ORDER)
 *
 * 分层契约：
 *   1. 纯只读数据，无环境与 I/O 依赖；
 *   2. 不依赖任何上层 (core / strategy / io / pipeline / config)。
 */

'use strict';

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// 1. 虚假 IP 与安全拦截基线
// =============================================================================

// 虚假/私网/回环与占位 IP 判定
const REGEX_FAKE_IPV4 = /^(?:0\.|127\.|10\.|192\.168\.|169\.254\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(?:1[6-9]|2\d|3[01])\.|(?:1\.1\.1\.1|1\.0\.0\.1|8\.8\.8\.8|8\.8\.4\.4|9\.9\.9\.9|114\.114\.114\.114|255\.255\.255\.255)(?:$|:))/;
const REGEX_FAKE_IPV6 = /^(?:\[?(?:::1?|0*(?::0*)*:0*1)\]?(?:$|:)|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i;

// 弱口令 / 虚拟占位鉴权判定
const REGEX_DUMMY_AUTH = /^(0{8}-0{4}-0{4}-0{4}-0{12}|123456|password|dummy)$/i;

// 信息说明与通知类占位节点判定
const REGEX_INFO_NODE = /剩余流量|套餐到期|到期时间|有效时间|过期|更新公告|重置|维护|不可用|扣费|节点说明|防失联|官网|地址|Q群|电报|Tg群|距离下次/i;

// 占位节点扩展通知词 (用于订阅有效性前置拦截 isNoticePlaceholderNode)
const REGEX_NOTICE_KEYWORD = /(?:续费|充值|到期|过期|用尽|耗尽|欠费|公告|说明|官网|防失联|通知|联系)/i;

// 广告词 / 变体引流词 / 套餐价格推销
const REGEX_AD_TYPO = /防.{0,3}失|失.{0,3}联|地.{0,3}[址止]|官.{0,3}[网罔]|发.{0,3}[布步]|交.{0,3}流[群组TGtg]|群.{0,3}组|Q.{0,2}群|TG.{0,2}群|客.{0,3}服|定.{0,3}制[联系群客]|定制节点/i;
const REGEX_AD_PROMO = /(?:特惠|促销|优惠|不限速|大促|套餐)/;
const REGEX_AD_PRICE = /(?:元|块|折|¥|售\s*\d+(?:\.\d+)?|价\s*\d+(?:\.\d+)?|\d+G)/i;

// 禁止下载 / BT 相关规则与清洗正则
const REGEX_FORBID_DL_STR = '(?:禁止|禁|严禁|请勿|勿|不要|不能|拒绝|屏蔽|防)(?:BT|PT|P2P|下载|测速|迅雷)|(?:仅限|仅供)(?:网页|日常|聊天)|\\b(?:No|Block|Ban)[\\s\\-_]*(?:BT|PT|Torrent|Download)\\b';
const REGEX_FORBID_DL = new RegExp(REGEX_FORBID_DL_STR, 'i');
const REGEX_CLEANUP = new RegExp(
  `${REGEX_FORBID_DL_STR}|(?:https?:\\/\\/|www\\.)[a-zA-Z0-9][-a-zA-Z0-9]*(?:\\.[a-zA-Z0-9][-a-zA-Z0-9]*)+(?:\\/[^\\s\\u4e00-\\u9fa5]*)?|\\b[a-zA-Z0-9][-a-zA-Z0-9]{0,62}\\.(?:com|net|org|cc|me|vip|pro|top|xyz|club|site|icu|info|io|link|shop)(?:\\/[^\\s\\u4e00-\\u9fa5]*)?`,
  'ig'
);

// =============================================================================
// 2. 入口城市与落地大区识别词库
// =============================================================================

// 入口城市关键词（按长度降序排布，长词优先贪婪匹配）
const ENTRY_CITIES = [
  '新加坡', '深圳', '广州', '上海', '北京', '杭州', '四川', '重庆', '东莞',
  '江苏', '南京', '武汉', '成都', '无锡', '香港', '台湾', '日本', '韩国',
  '英国', '美国', 'Ingress', 'SZX', 'CAN', 'PVG', 'SHA', 'PEK', 'PKX', 'HGH',
  '深', '广', '沪', '京', '杭', '川', '渝', '莞', '苏', '鲁', '徐', '湘',
  '宁', '汉', '穗', '蓉', '港', '台', '日', '新', '韩', '英', '美', '辽'
];

// 常见出口地区关键词（用于与入口城市形成边界断言）
const EXIT_REGIONS = [
  'Destination', '多伦多', '芝加哥', '新加坡', '澳大利亚', '俄罗斯', '香港',
  '台湾', '日本', '韩国', '美国', '英国', '德国', '法国', '印度', '狮城',
  '上海', '广州', '深圳', 'Exit', 'HKG', 'TYO', 'SIN', 'LAX', 'HK', 'TW',
  'JP', 'SG', 'US', 'KR', 'UK', 'DE', 'FR', '港', '台', '美', '日', '韩',
  '新', '英', '德', '法', '俄', '印', '澳', '中', '沪', '广', '深'
];

// 城市/代码 -> 单字规范标签映射表
const TAG_MAP = {
  深: '深', 深圳: '深', SZX: '深', 广: '广', 广州: '广', 穗: '广', CAN: '广',
  上海: '沪', 沪: '沪', PVG: '沪', SHA: '沪', 京: '京', 北京: '京',
  PEK: '京', PKX: '京', 杭: '杭', 杭州: '杭', HGH: '杭',
  四川: '川', 川: '川', 渝: '渝', 重庆: '渝', 东莞: '莞', 莞: '莞',
  南京: '宁', 宁: '宁', 成都: '蓉', 蓉: '蓉', 武汉: '汉', 汉: '汉', 鲁: '鲁', 苏: '苏', 江苏: '苏',
  港: '港', 香港: '港', 台: '台', 台湾: '台', 日: '日', 日本: '日', 新加坡: '新',
  韩: '韩', 韩国: '韩', 英: '英', 英国: '英', 美: '美', 美国: '美'
};

const SINGLE_EXIT_LOOKAHEAD = {
  日: '(?![常用期间程志照益本])',
  新: '(?![建春年线增华上线节点加北坡])',
  美: '(?![食味丽国西东])',
  台: '(?![平前后湾灣风])',
  港: '(?![口湾澳])',
  中: '(?![转间心])'
};

const entryPattern = ENTRY_CITIES.map(escapeRegex).join('|');
const exitPattern = EXIT_REGIONS.map(r => {
  const esc = escapeRegex(r);
  return SINGLE_EXIT_LOOKAHEAD[r] ? `${esc}${SINGLE_EXIT_LOOKAHEAD[r]}` : esc;
}).join('|');
const REGEX_ENTRY_CITY = new RegExp(`(${entryPattern})(?:\\s*(?:->|=>|~>|→|⇒|-|—|=|>|至)\\s*|\\s+)?(?=${exitPattern})`, 'i');

// =============================================================================
// 3. 倍率识别与指令架构词避让
// =============================================================================

// 识别节点倍率 (如 x0.5, 1.5x, 倍率: 2.0)
const REGEX_MULTI = /(?<![a-zA-Z0-9])(?:倍率\s*:?\s*(\d+(?:\.\d+)?)|[xX×]\s*(\d+(?:\.\d+)?)(?:\s*倍(?:率)?)?|(\d+(?:\.\d+)?)\s*(?:[xX×]|倍(?:率)?)(?!\s*\d))/i;

// 排除系统架构与指令集关键词 (如 x64, x86, x32)
const ARCH_AVOID_SET = new Set(['64', '86', '32']);

// =============================================================================
// 4. 线路类型、运营商与质量权重梯队
// =============================================================================

// 识别线路类型与营销标识 (CMIN2 优先于 CMI，AS9929 优先于 9929)
const REGEX_TECH_LINE = /(IEPL|IPLC|BGP|CN2|GIA|CMIN2|CMI|CUG|PCCW|AS9929|9929|AS4837|4837|AWS|GCP|Oracle|Azure|Hinet|Zenlayer|三网|电联|移联|电移|移动|联通|电信|CTCUCM|CTCUM|CTCU|CUCT|CMCU|CUCM|CTCM|CMCT|专线|中转|隧道)/gi;
const REGEX_TECH_LINE_TEST = new RegExp(REGEX_TECH_LINE.source, 'i');
const REGEX_FLUFF_LINE = /(高速|极速|优化|起飞|VIP|Premium|Pro|Plus|标准|基础|高级|节点)/gi;
const REGEX_FLUFF_LINE_TEST = new RegExp(REGEX_FLUFF_LINE.source, 'i');

// 复合运营商代码映射
const LINE_MAP = {
  CTCUCM: '三网',
  CTCUM: '三网',
  CTCU: '电联',
  CUCT: '电联',
  CMCU: '移联',
  CUCM: '移联',
  CTCM: '电移',
  CMCT: '电移'
};

// 基础运营商简称映射
const CARRIER_SHORT_MAP = {
  电信: '电',
  移动: '移',
  联通: '联'
};

// 组合运营商判定（三网优先于两网，大集合优先匹配）
const CARRIER_COMBO_MAP = {
  三网: new Set(['移', '联', '电']),
  电联: new Set(['电', '联']),
  移联: new Set(['移', '联']),
  电移: new Set(['电', '移'])
};

// 线路质量权重梯队 (1 ~ 6 级，越小质量越优)
const LINE_QUALITY_TIERS = [
  { tier: 1, reg: /(?:IEPL|IPLC)/i },
  { tier: 2, reg: /(?:GIA|CN2|9929|CMIN2)/i },
  { tier: 3, reg: /(?:专线|VIP|PRO|高速|极速|优化|PREMIUM)/i },
  { tier: 4, reg: /(?:BGP|CMI)/i },
  { tier: 5, reg: /(?:中转|隧道)/i }
];

/**
 * 计算线路质量权重 (1 ~ 6 级，越小越优)
 * @param {string} lineStr 清洗后的线路字符串与营销标识
 * @returns {number} 1 ~ 6
 */
function getLineQualityWeight(lineStr) {
  if (!lineStr || typeof lineStr !== 'string') return 6;
  for (const { tier, reg } of LINE_QUALITY_TIERS) {
    if (reg.test(lineStr)) return tier;
  }
  return 6;
}

// =============================================================================
// 5. 静态业务特征规则基线 (Static Feature Rules)
// =============================================================================

const STATIC_FEATURE_RULES = [
  // 1. 家宽/住宅
  {
    reg: /(?:家宽|住宅|宽带|原生|🏠|Residential|\b(?:ISP|Home|Netvigator|CTM|Hinet|Kbro|Seednet|APTG|Nuro|OCN|Plala|Singtel|StarHub|MyRepublic|ViewQwest|Comcast|Xfinity|Spectrum|Verizon|Cox)\b|HKT|HKBN|HGC|WTT|So[-_]?net)/i,
    tag: 'residential',
    pool: 'residential'
  },
  // 2. 游戏
  {
    reg: /(?:游戏|🎮)|\b(?:Game|FullCone)\b/i,
    tag: 'game',
    pool: 'game'
  },
  // 3. 免费 / 公益
  {
    reg: /(?:免费|白嫖|公益|🆓)/i,
    tag: 'free'
  },
  // 4. WAP / 移动优化
  {
    reg: /(?:📱)|\bWAP\b/i,
    tag: 'wap'
  },
  // 5. 蜂窝网络
  {
    reg: /(?:蜂窝|Cellular|移动网络)/i,
    tag: 'cellular'
  },
  // 6. CDN 中转
  {
    reg: /(?:CDN中转|中转CDN|CDN加速|☁️)/i,
    tag: 'CDN'
  },
  // 7. AWS / 云厂商
  {
    reg: /(?:\bAmazon\b|\bAWS\b|🛰️)/i,
    tag: 'AWS'
  },
  // 8. 实验节点
  {
    reg: /(?:测试|实验|备用|测速)/i,
    tag: 'experimental',
    pool: 'experimental'
  },
  // 9. 双栈
  {
    reg: /(?:双栈|DualStack)/i,
    tag: 'dualstack'
  },
  // 10. IPv6
  {
    reg: /\b(?:IPv6|v6(?![.\d]))\b/i,
    tag: 'ipv6'
  }
];

// =============================================================================
// 6. 隔离分类排序权重 (Isolation Sort Order)
// =============================================================================

const ISOLATION_SORT_ORDER = {
  '': 0,             // 标准大区主力节点
  std: 0,            // 标准大区主力节点别名
  residential: 1,    // 🏠 家宽优选
  download: 2,       // ⏬ 下载池
  experimental: 3,   // 🧪 实验节点
  highMulti: 4       // 🛑 高倍率节点沉底
};

module.exports = {
  escapeRegex,
  // 虚假 IP 与安全拦截
  REGEX_FAKE_IPV4,
  REGEX_FAKE_IPV6,
  REGEX_DUMMY_AUTH,
  REGEX_INFO_NODE,
  REGEX_NOTICE_KEYWORD,
  REGEX_AD_TYPO,
  REGEX_AD_PROMO,
  REGEX_AD_PRICE,
  REGEX_FORBID_DL_STR,
  REGEX_FORBID_DL,
  REGEX_CLEANUP,
  // 入口与落地
  ENTRY_CITIES,
  EXIT_REGIONS,
  TAG_MAP,
  REGEX_ENTRY_CITY,
  // 倍率
  REGEX_MULTI,
  ARCH_AVOID_SET,
  // 线路与运营商
  REGEX_TECH_LINE,
  REGEX_TECH_LINE_TEST,
  REGEX_FLUFF_LINE,
  REGEX_FLUFF_LINE_TEST,
  LINE_MAP,
  CARRIER_SHORT_MAP,
  CARRIER_COMBO_MAP,
  LINE_QUALITY_TIERS,
  getLineQualityWeight,
  // 特征规则
  STATIC_FEATURE_RULES,
  // 隔离排序
  ISOLATION_SORT_ORDER
};
