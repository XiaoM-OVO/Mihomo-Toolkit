/**
 * 节点深度清洗、安全拦截与属性提取器
 *
 * 负责广告与引流节点拦截、虚假IP与假密码过滤、倍率/线路/入口识别打标。
 */

const { escapeRegex, matchNodeRegion, extractCity } = require('./geo');
const { getEnhancedRegionDefs } = require('./shared/regions');
const { FEATURE_ICONS, FEATURE_TEXT_MAP } = require('./shared/icons');
const { looksLikeDomain } = require('./fission');
const { getTransportType } = require('./transport');
const { buildServiceCatalog } = require('../config/catalog');

const REGEX_ALL_FLAGS = /\p{Regional_Indicator}{2}/gu;
const REGEX_INFO_NODE = /剩余流量|套餐到期|到期时间|有效时间|过期|更新公告|重置|维护|不可用|扣费|节点说明|防失联|官网|地址|Q群|电报|Tg群|距离下次/i;
const REGEX_FORBID_DL_STR = '(?:禁止|禁|严禁|请勿|勿|不要|不能|拒绝|屏蔽|防)(?:BT|PT|P2P|下载|测速|迅雷)|(?:仅限|仅供)(?:网页|日常|聊天)|\\b(?:No|Block|Ban)[\\s\\-_]*(?:BT|PT|Torrent|Download)\\b';
const REGEX_CLEANUP = new RegExp(`${REGEX_FORBID_DL_STR}|(?:https?:\\/\\/|www\\.)?[a-zA-Z0-9][-a-zA-Z0-9]{1,62}\\.(?:com|net|org|cc|me|vip|pro|top|xyz|club)`, 'ig');
const REGEX_FORBID_DL = new RegExp(REGEX_FORBID_DL_STR, 'i');

// 虚假/私网/回环与占位 IP 判定
const REGEX_FAKE_IPV4 = /^(?:0\.|127\.|10\.|192\.168\.|169\.254\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(?:1[6-9]|2\d|3[01])\.|(?:1\.1\.1\.1|8\.8\.8\.8)(?:$|:))/;
const REGEX_FAKE_IPV6 = /^(?:\[?(?:::1|0*(?::0*)*:0*1)\]?(?:$|:)|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i;

// 入口城市关键词
const ENTRY_CITIES = ['深','深圳','广','广州','上海','沪','京','北京','杭','杭州','四川','川','渝','重庆','辽','莞','东莞','苏','江苏','无锡','鲁','徐','湘','宁','南京','汉','武汉','穗','港','香港','台','台湾','日本','日','新加坡','英国','英','韩国','韩','美国','美','Ingress'];
const EXIT_REGIONS = ['港','台','美','日','韩','新','英','德','法','俄','印','澳','狮城','多伦多','芝加哥','中','台湾','日本','新加坡','上海','沪','广','深','Exit','Destination'];

const entryPattern = ENTRY_CITIES.map(escapeRegex).join('|');
const exitPattern = EXIT_REGIONS.map(escapeRegex).join('|');
const REGEX_ENTRY_CITY = new RegExp(`(${entryPattern})(?:\\s*(?:-|->|—|=|>)\\s*(?=${exitPattern})|(?=${exitPattern}))`, 'i');

// 识别节点倍率 (如 x0.5, 1.5x, 倍率: 2.0)
const REGEX_MULTI = /(?<![a-zA-Z])(?:倍率\s*:?\s*(\d+(?:\.\d+)?)|[xX×]\s*(\d+(?:\.\d+)?)(?:\s*倍率)?|(\d+(?:\.\d+)?)\s*(?:[xX×]|倍率)(?!\s*\d))/i;

// 识别线路类型与营销标识
const REGEX_TECH_LINE = /(IEPL|IPLC|BGP|CN2|GIA|CMI|CMIN2|CUG|PCCW|9929|4837|AWS|GCP|Oracle|Azure|Hinet|Zenlayer|三网|电联|移联|电移|移动|联通|电信|CTCUCM|CTCUM|CTCU|CUCT|CMCU|CUCM|CTCM|CMCT|专线)/gi;
const REGEX_TECH_LINE_TEST = new RegExp(REGEX_TECH_LINE.source, 'i');
const REGEX_FLUFF_LINE = /(高速|极速|优化|起飞|VIP|Premium|Pro|Plus|标准|基础|高级|节点)/gi;
const REGEX_FLUFF_LINE_TEST = new RegExp(REGEX_FLUFF_LINE.source, 'i');

const LINE_MAP = { CTCUCM: '三网', CTCUM: '三网', CTCU: '电联', CUCT: '电联', CMCU: '移联', CUCM: '移联', CTCM: '电移', CMCT: '电移' };
const CN_MAP = { 移动: '移', 联通: '联', 电信: '电' };

const TAG_MAP = {
  深: '深', 深圳: '深', SZX: '深', 广: '广', 广州: '广', CAN: '广',
  上海: '沪', 沪: '沪', PVG: '沪', SHA: '沪', 京: '京', 北京: '京',
  PEK: '京', PKX: '京', 杭: '杭', 杭州: '杭', HGH: '杭',
  四川: '川', 川: '川', 渝: '渝', 重庆: '渝', 东莞: '莞', 莞: '莞',
  南京: '宁', 宁: '宁', 成都: '蓉', 武汉: '汉', 汉: '汉', 鲁: '鲁', 苏: '苏', 江苏: '苏',
  港: '港', 香港: '港', 台: '台', 台湾: '台', 日: '日', 日本: '日', 新加坡: '新',
  韩: '韩', 韩国: '韩', 英: '英', 英国: '英', 美: '美', 美国: '美'
};

function dedupe(arr) {
  return [...new Set(arr)];
}

/**
 * 基础节点名称清洗（去除零宽字符、非国旗 Emoji、空白折叠）
 * @param {string} rawName
 * @returns {string}
 */
function sanitizeNodeName(rawName) {
  if (!rawName || typeof rawName !== 'string') return '';
  let name = rawName.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\t\r\n]/g, '');
  name = name.replace(/\p{Extended_Pictographic}/gu, m => {
    const cp = m.codePointAt(0);
    if (cp >= 0x1F1E6 && cp <= 0x1F1FF) return m; // 国旗
    if (cp === 0x1F3E0) return m; // 🏠 家宽
    return '';
  });
  name = name.replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '');
  name = name.replace(/[\u2190-\u21FF\u2460-\u24FF\u2500-\u27BF\u2B00-\u2BFF]/g, ' ');
  return name.replace(REGEX_CLEANUP, '').trim();
}

/**
 * 三网/两网运营商压缩
 */
function compressLineArr(arr) {
  const FULL_SET = new Set(['电信', '移动', '联通']);
  const SHORT_MAP = { 电信: '电', 移动: '移', 联通: '联' };
  const atomSet = new Set(Object.values(SHORT_MAP));
  const comboMap = {
    电联: new Set(['电', '联']),
    移联: new Set(['移', '联']),
    电移: new Set(['电', '移']),
    三网: new Set(['移', '联', '电'])
  };

  const deduped = dedupe(arr);
  const carrierItems = [];
  const nonCarrierItems = [];

  for (const item of deduped) {
    if (FULL_SET.has(item) || atomSet.has(item)) {
      carrierItems.push(SHORT_MAP[item] || item);
    } else {
      nonCarrierItems.push(item);
    }
  }

  if (carrierItems.length === 0) return nonCarrierItems;

  const currentAtoms = new Set(carrierItems);
  for (const [comboName, atomGroup] of Object.entries(comboMap)) {
    if (Array.from(atomGroup).every(atom => currentAtoms.has(atom))) {
      return [comboName, ...nonCarrierItems];
    }
  }
  return [...carrierItems, ...nonCarrierItems];
}

/**
 * 提取节点属性 (倍率、入口城市、线路特征)
 * @param {string} name
 * @param {object} [userConfig={}]
 */
function extractNodeAttributes(name, userConfig = {}) {
  const attrs = { multiNum: 1.0, multiStr: '', entryStr: '', lineArr: [], isLowMulti: false };

  // 1. 提取入口城市
  let cleanName = name.replace(REGEX_ENTRY_CITY, (match, p1) => {
    const m = p1.replace(/[-|>至=\s]/g, '');
    attrs.entryStr = TAG_MAP[m.toUpperCase()] || TAG_MAP[m] || m;
    return '';
  });

  // 2. 提取倍率
  cleanName = cleanName.replace(REGEX_MULTI, (m, m1, m2, m3) => {
    const num = parseFloat(m1 || m2 || m3);
    if (!isNaN(num)) {
      attrs.multiNum = num;
      if (num !== 1) attrs.multiStr = `x${num}`;
      if (userConfig.lowMultiThreshold > 0 && num <= userConfig.lowMultiThreshold) {
        attrs.isLowMulti = true;
      }
    }
    return '';
  });

  // 3. 提取线路类型
  cleanName = cleanName.replace(REGEX_TECH_LINE, match => {
    const key = match.toUpperCase();
    let short = LINE_MAP[key];
    if (!short) {
      const cnKey = Object.keys(CN_MAP).find(k => match.includes(k));
      if (cnKey) short = cnKey;
    }
    if (short) attrs.lineArr.push(short);
    else if (match.length >= 2) attrs.lineArr.push(key);
    return '';
  });

  attrs.lineArr = compressLineArr(attrs.lineArr);

  // 4. 提取营销标识
  let fluffStr = '';
  cleanName = cleanName.replace(REGEX_FLUFF_LINE, match => {
    fluffStr += match.toUpperCase();
    return '';
  });

  attrs.cleanLines = dedupe(attrs.lineArr).join('/');
  const fullLineStr = attrs.cleanLines + fluffStr;
  attrs.bestLineWeight = /(IEPL|IPLC)/.test(fullLineStr) ? 1 :
                        /(GIA|CN2|9929|CMIN2)/.test(fullLineStr) ? 2 :
                        /(专线|VIP|PRO|高速|极速|优化|PREMIUM)/.test(fullLineStr) ? 3 :
                        /(BGP|CMI)/.test(fullLineStr) ? 4 :
                        /(中转|隧道)/.test(fullLineStr) ? 5 : 6;

  return { attrs, cleanName };
}

/**
 * 用户显式黑名单判定：节点名关键词 / 服务器字段命中即拦截。
 * 优先级高于白名单——显式拒绝不应被白名单关键词放行。
 */
function matchUserBlacklist(proxy, rawName, userConfig = {}) {
  const nameLower = (rawName || '').toLowerCase();
  const serverLower = (proxy?.server || '').toLowerCase();
  const keywords = (userConfig.blockKeywords || []).map(k => String(k).toLowerCase()).filter(Boolean);
  const servers = (userConfig.blockServers || []).map(s => String(s).toLowerCase()).filter(Boolean);
  if (keywords.some(k => nameLower.includes(k))) return '黑名单关键词';
  if (servers.some(s => serverLower.includes(s))) return '黑名单服务器';
  return '';
}

/**
 * 拦截与阻断判定
 */
function checkNodeBlockReason(proxy, rawName, userConfig = {}, options = {}) {
  const server = (proxy?.server || '').trim();
  const isFakeServer = proxy?.port === 0
    || server === 'localhost'
    || REGEX_FAKE_IPV4.test(server)
    || REGEX_FAKE_IPV6.test(server);
  const isDummyAuth = /^(0{8}-0{4}-0{4}-0{4}-0{12}|123456|password|dummy)$/i.test(proxy.uuid || proxy.password || '');
  const isAdTypo = /防.{0,3}失|失.{0,3}联|地.{0,3}[址止]|官.{0,3}[网罔]|发.{0,3}[布步]|交.{0,3}流|群.{0,3}组|客.{0,3}服|定.{0,3}制/i.test(rawName)
    || (
      /(?:特惠|促销|优惠|不限速|大促|套餐)/.test(rawName) &&
      /(?:元|块|折|¥|售\s*\d+(?:\.\d+)?|价\s*\d+(?:\.\d+)?|\d+G)/i.test(rawName)
    );

  const adThreshold = userConfig.adTextThreshold ?? 6;
  const tempName = rawName.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\t\r\n]/g, '')
    .replace(REGEX_ALL_FLAGS, '')
    .replace(/[\[\]{}()<>【】]/g, '')
    .trim();

  const defs = options.regionDefs || getEnhancedRegionDefs();
  const hasValidRegion = defs.some(r => r._matchReg && r._matchReg.test(tempName));
  const featureRules = options.featureRules || getFeatureRules(userConfig);
  const hasFeature = featureRules.some(r => r.reg && r.reg.test(tempName));
  const hasDigit = /\d/.test(tempName);
  const hasTechLine = REGEX_TECH_LINE_TEST.test(tempName);
  const hasFluff = REGEX_FLUFF_LINE_TEST.test(tempName);

  const cleanText = tempName.replace(/\p{Extended_Pictographic}/gu, '').trim();
  const cleanLength = cleanText.length;
  const effectiveThreshold = hasValidRegion ? Math.max(adThreshold, 18) : adThreshold;

  if (isFakeServer) return '假IP';
  if (isDummyAuth) return '假密码';
  if (isAdTypo) return '广告词';
  if (cleanLength > effectiveThreshold && !hasDigit && !hasTechLine && !hasFluff && !hasFeature) {
    return `超长广告文本(>${effectiveThreshold})`;
  }
  if (!hasValidRegion && !hasFluff && cleanLength > 10 && !hasDigit && !hasTechLine && !hasFeature) {
    return '孤儿广告';
  }

  return '';
}

/**
 * 编译全量特征规则列表（包含静态特征、AI 服务注册表、流媒体注册表与自定义服务）
 * @param {object} userConfig
 * @returns {Array<{ reg: RegExp, tag: string, pool?: string, groupName?: string }>}
 */
function getFeatureRules(userConfig = {}) {
  const rules = [
    // 1. 家宽/住宅
    {
      reg: /(?:家宽|住宅|宽带|原生|🏠|Residential|ISP|Home|HKT|HKBN|HGC|WTT|Netvigator|CTM|Hinet|Kbro|Seednet|APTG|So[-_]?net|Nuro|OCN|Plala|Singtel|StarHub|MyRepublic|ViewQwest|Comcast|Xfinity|Spectrum|Verizon|Cox)/i,
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
      reg: /\b(?:IPv6|v6)\b/i,
      tag: 'ipv6'
    }
  ];

  // 11. 动态服务编目特征规则注入 (统一由 catalog 单一事实来源驱动)
  const catalog = userConfig.catalog || buildServiceCatalog(userConfig);

  // AI 助手特征规则（逆序 unshift，确保高优先级）
  if (userConfig.enableAI !== false) {
    const aiActive = catalog.getActiveServices('ai', userConfig);
    aiActive.slice().reverse().forEach(({ key, service }) => {
      if (service.reg) {
        rules.unshift({
          reg: service.reg,
          tag: service.tag || key,
          pool: service.pool || service.tag || key,
          groupName: catalog.getGroupName(service)
        });
      }
    });
  }

  // 流媒体服务特征规则
  if (userConfig.enableStreaming !== false) {
    const streamActive = catalog.getActiveServices('streaming', userConfig);
    streamActive.forEach(({ key, service }) => {
      if (service.reg) {
        rules.push({
          reg: service.reg,
          tag: service.tag || key,
          pool: service.pool || key,
          groupName: catalog.getGroupName(service)
        });
      }
    });
    // 通用流媒体兜底规则
    rules.push({
      reg: /(?:流媒体|解锁|📺)/i,
      tag: 'streaming'
    });
  }

  return rules;
}

/**
 * 核心节点分类打标函数
 * @param {object} proxy
 * @param {object} userConfig
 * @param {object} [options={}]
 */
function classifyNode(proxy, userConfig = {}, options = {}) {
  const rawName = proxy._rawName || proxy.name || '';
  const defs = options.regionDefs || getEnhancedRegionDefs();

  // 1. 虚拟信息节点优先处理
  if (proxy.isSyntheticInfo) {
    if (userConfig.enableDashboard === false) {
      return { skip: true, rawName, blockReason: '看板关闭' };
    }
    proxy.server = '127.0.0.1';
    proxy.port = 80;
    return { isInfo: true, isSyntheticInfo: true, proxy, rawName, groupKey: 'info' };
  }

  // 2. 原生信息说明节点
  if (REGEX_INFO_NODE.test(rawName)) {
    if (userConfig.removeInfoNodes) {
      return { skip: true, rawName, blockReason: '信息说明' };
    }
    return { isInfo: true, proxy, rawName, groupKey: 'info' };
  }

  // 3. 用户黑名单（显式拒绝优先于白名单）与白名单、自定义特殊节点
  const blacklistReason = matchUserBlacklist(proxy, rawName, userConfig);
  if (blacklistReason) {
    return { skip: true, rawName, blockReason: blacklistReason };
  }

  const tempNameLower = rawName.toLowerCase();
  const subTagLower = (proxy._subTag || '').toLowerCase();
  const whitelist = (userConfig.whitelistKeywords || []).map(k => k.toLowerCase());

  let isSpecial = false;
  let specialTargetName = '';

  if (whitelist.some(k => tempNameLower.includes(k) || (subTagLower && subTagLower === k))) {
    isSpecial = true;
    specialTargetName = proxy.name;
  }

  if (!isSpecial && Array.isArray(userConfig.specialNodeRules) && userConfig.specialNodeRules.length > 0) {
    const match = userConfig.specialNodeRules.find(r => r.reg && r.reg.test(rawName));
    if (match) {
      isSpecial = true;
      specialTargetName = match.targetName || proxy.name;
    }
  }

  if (isSpecial) {
    proxy.name = specialTargetName || proxy.name;
    return {
      proxy,
      rawName,
      isSpecial: true,
      groupKey: 'special',
      tags: [],
      featurePools: [],
      attrs: { multiNum: 1.0, multiStr: '', entryStr: '', lineArr: [], cleanLines: '' }
    };
  }

  // 4. 垃圾与广告拦截判定
  const blockReason = checkNodeBlockReason(proxy, rawName, userConfig, { regionDefs: defs, featureRules: options.featureRules });
  if (blockReason) {
    return { skip: true, rawName, blockReason };
  }

  // 5. 字符清洗与属性提取
  const sanitized = sanitizeNodeName(rawName);
  const isForbidDownload = REGEX_FORBID_DL.test(rawName);
  const { attrs, cleanName } = extractNodeAttributes(sanitized, userConfig);

  // 6. 地区与城市匹配
  let regionInfo = matchNodeRegion(sanitizeNodeName(proxy.name), defs, userConfig);
  if (!regionInfo) regionInfo = matchNodeRegion(cleanName, defs, userConfig);

  let destCity = '';
  if (regionInfo && regionInfo.city) {
    destCity = extractCity(rawName, regionInfo);
  }

  // 7. 特征提取与打标
  const tags = new Set();
  const featurePools = [];

  // 网络层 IPv6 识别：当 server 字段是物理 IPv6 地址时自动识别
  if (proxy.server && !looksLikeDomain(proxy.server) && String(proxy.server).includes(':')) {
    tags.add('ipv6');
  }

  if (regionInfo) {
    const rules = options.featureRules || getFeatureRules(userConfig);
    for (const rule of rules) {
      if (rule.reg.test(rawName)) {
        tags.add(rule.tag);
        if (rule.pool && !featurePools.includes(rule.pool)) {
          featurePools.push(rule.pool);
        }
      }
    }

    // 低倍率 / 下载
    if (attrs.isLowMulti && !isForbidDownload) {
      tags.add('download');
      if (!featurePools.includes('download')) {
        featurePools.push('download');
      }
    }
  }

  const protocol = String(proxy.type || '').toLowerCase();
  const transportTag = getTransportType(proxy);

  const isUnknownRegion = !regionInfo;
  const groupKey = regionInfo ? (regionInfo.id || regionInfo.name) : 'unknown';

  return {
    proxy,
    rawName,
    regionInfo,
    destCity,
    tags: Array.from(tags),
    featurePools,
    protocol,
    transportTag,
    attrs,
    groupKey,
    isUnknownRegion
  };
}

module.exports = {
  sanitizeNodeName,
  compressLineArr,
  extractNodeAttributes,
  checkNodeBlockReason,
  getFeatureRules,
  classifyNode
};
