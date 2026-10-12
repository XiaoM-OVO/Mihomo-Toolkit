/**
 * 节点深度清洗、安全拦截与属性提取器
 *
 * 负责广告与引流节点拦截、虚假IP与假密码过滤、倍率/线路/入口识别打标。
 */

const { matchNodeRegion, extractCity } = require('./geo');
const { getEnhancedRegionDefs } = require('./shared/regions');
const { looksLikeDomain } = require('./fission');
const { getTransportType } = require('./transport');
const { buildServiceCatalog } = require('../config/catalog');
const ipaddr = require('ipaddr.js');
const {
  REGEX_INFO_NODE,
  REGEX_NOTICE_KEYWORD,
  REGEX_EXPLICIT_NOTICE,
  REGEX_FORBID_DL,
  REGEX_CLEANUP,
  REGEX_FAKE_IPV4,
  REGEX_FAKE_IPV6,
  REGEX_PRIVATE_OR_LOOPBACK,
  REGEX_DUMMY_AUTH,
  REGEX_AD_TYPO,
  REGEX_AD_PROMO,
  REGEX_AD_PRICE,
  TAG_MAP,
  REGEX_ENTRY_CITY,
  REGEX_MULTI,
  ARCH_AVOID_SET,
  REGEX_TECH_LINE,
  REGEX_FLUFF_LINE,
  LINE_MAP,
  CARRIER_SHORT_MAP,
  CARRIER_COMBO_MAP,
  getLineQualityWeight,
  STATIC_FEATURE_RULES
} = require('../data/cleaner-rules');

function dedupe(arr) {
  return [...new Set(arr)];
}

function toArray(val) {
  if (Array.isArray(val)) return val;
  if (val == null) return [];
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

/**
 * 基础节点名称清洗（去除零宽字符、非国旗 Emoji、空白折叠与广告/禁止下载词）
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
 * @param {Array<string>} arr
 * @returns {Array<string>}
 */
function compressLineArr(arr) {
  const deduped = dedupe(arr);
  const carrierItems = [];
  const nonCarrierItems = [];
  const carrierAtoms = new Set(Object.values(CARRIER_SHORT_MAP));

  for (const item of deduped) {
    if (CARRIER_SHORT_MAP[item] || carrierAtoms.has(item)) {
      carrierItems.push(CARRIER_SHORT_MAP[item] || item);
    } else {
      nonCarrierItems.push(item);
    }
  }

  if (carrierItems.length === 0) return nonCarrierItems;

  const currentAtoms = new Set(carrierItems);
  const sortedCombos = Object.entries(CARRIER_COMBO_MAP).sort((a, b) => b[1].size - a[1].size);
  for (const [comboName, atomGroup] of sortedCombos) {
    if (Array.from(atomGroup).every(atom => currentAtoms.has(atom))) {
      return [comboName, ...nonCarrierItems];
    }
  }
  return [...carrierItems, ...nonCarrierItems];
}

/**
 * 提取节点属性 (倍率、入口城市、线路特征与质量权重)
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
    // 排除系统架构与指令集关键词 (如 x64, x86, x32)
    if (!m1 && !m.includes('倍') && (ARCH_AVOID_SET.has(m2) || ARCH_AVOID_SET.has(m3))) {
      return m;
    }
    const num = parseFloat(m1 || m2 || m3);
    if (!isNaN(num) && num >= 0 && num <= 50) {
      attrs.multiNum = num;
      if (num !== 1) attrs.multiStr = `x${num}`;
      if (userConfig.lowMultiThreshold > 0 && num <= userConfig.lowMultiThreshold) {
        attrs.isLowMulti = true;
      }
      return '';
    }
    return m;
  });

  // 3. 提取线路类型
  cleanName = cleanName.replace(REGEX_TECH_LINE, match => {
    let key = match.toUpperCase();
    if (key === 'AS9929') key = '9929';
    else if (key === 'AS4837') key = '4837';
    let short = LINE_MAP[key];
    if (!short) {
      const cnKey = Object.keys(CARRIER_SHORT_MAP).find(k => match.includes(k));
      if (cnKey) short = cnKey;
    }
    if (short) attrs.lineArr.push(short);
    else if (key.length >= 2) attrs.lineArr.push(key);
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
  attrs.bestLineWeight = getLineQualityWeight(attrs.cleanLines + fluffStr);

  return { attrs, cleanName };
}

/**
 * 用户显式黑名单判定：节点名关键词 / 服务器字段命中即拦截。
 * 优先级高于白名单——显式拒绝不应被白名单关键词放行。
 * @param {object} proxy
 * @param {string} rawName
 * @param {object} [userConfig={}]
 * @returns {string} 拦截原因或空字符串
 */
function matchUserBlacklist(proxy, rawName, userConfig = {}) {
  const nameLower = (rawName || '').toLowerCase();
  const serverLower = (proxy?.server || '').toLowerCase();
  const keywords = toArray(userConfig.blockKeywords).map(k => String(k).toLowerCase()).filter(Boolean);
  const servers = toArray(userConfig.blockServers).map(s => String(s).toLowerCase()).filter(Boolean);
  if (keywords.some(k => nameLower.includes(k))) return '黑名单关键词';
  if (servers.some(s => serverLower.includes(s))) return '黑名单服务器';
  return '';
}

/**
 * 解析并判定主机地址是否为合法的私网、局域网或回环地址 (用于 _keepName 放行校验)
 * 必须解析为有效 IP 且属于受限网段，格式错误的非法前缀坚决拒绝
 * @param {string} server
 * @returns {boolean}
 */
function isPrivateOrLoopbackServer(server) {
  if (!server || typeof server !== 'string') return false;
  const s = server.trim().replace(/^\[|\]$/g, '');
  if (s.toLowerCase() === 'localhost') return true;
  if (!ipaddr.isValid(s)) return false;
  try {
    const addr = ipaddr.parse(s);
    const range = addr.range();
    const ALLOWED_RANGES = [
      'loopback',
      'private',
      'carrierGradeNat', // 100.64.0.0/10 (Tailscale / CGNAT)
      'linkLocal',       // 169.254.0.0/16 or fe80::/10
      'uniqueLocal'      // fc00::/7 (IPv6 ULA)
    ];
    return ALLOWED_RANGES.includes(range);
  } catch {
    return false;
  }
}

/**
 * 判定主机地址与端口是否为结构性无效/占位服务
 * @param {string} server
 * @param {number|string} [port]
 * @returns {boolean}
 */
function isFakeServerAddress(server, port) {
  const s = String(server || '').trim();
  const portNum = port != null && port !== '' ? Number(port) : null;
  const isFakePort = portNum === null || !Number.isInteger(portNum) || portNum <= 0 || portNum > 65535;
  const isFakeIp = !s
    || s === 'localhost'
    || REGEX_FAKE_IPV4.test(s)
    || REGEX_FAKE_IPV6.test(s);
  return !s || isFakePort || isFakeIp;
}

/**
 * 判定节点是否为原生公告/说明候选节点
 * @param {object} proxy
 * @param {string} [rawName]
 * @returns {boolean}
 */
function isNoticeNode(proxy, rawName) {
  if (!proxy || typeof proxy !== 'object') return false;
  if (proxy.isSyntheticInfo) return false;
  const name = rawName || proxy._rawName || proxy.name || '';
  if (!name) return false;

  // 1. 明确的纯流量/到期横幅标题 (无论挂在什么 server/port 下均判定为说明)
  if (REGEX_EXPLICIT_NOTICE.test(name)) return true;

  // 2. 一般公告/说明词必须同时伴随无效/占位网络参数，绝不误杀具备真实代理参数的节点
  const isNotice = REGEX_INFO_NODE.test(name) || REGEX_NOTICE_KEYWORD.test(name);
  if (!isNotice) return false;

  return isFakeServerAddress(proxy.server, proxy.port);
}

/**
 * 拦截与阻断判定
 * @param {object} proxy
 * @param {string} rawName
 * @param {object} [userConfig={}]
 * @param {object} [options={}]
 * @returns {string} 拦截原因或空字符串
 */
function checkNodeBlockReason(proxy, rawName, userConfig = {}, options = {}) {
  const server = String(proxy?.server || '').trim();
  const portNum = proxy?.port != null && proxy?.port !== '' ? Number(proxy.port) : null;
  const isFakePort = portNum === null || !Number.isInteger(portNum) || portNum <= 0 || portNum > 65535;

  // 1. 硬结构校验：server 不能为空，普通/特殊代理必须具备 1~65535 的合法整数端口
  if (!server || isFakePort) return '假IP';

  // 2. 假 IP / 回环 / 占位 IP 判定
  const isFakeIp = server === 'localhost'
    || REGEX_FAKE_IPV4.test(server)
    || REGEX_FAKE_IPV6.test(server);

  if (isFakeIp) {
    // 仅在显式声明 _keepName 且 server 真实解析为合法的局域网/私网/回环地址时放行自建内网节点
    if (!proxy?._keepName || !isPrivateOrLoopbackServer(server)) {
      return '假IP';
    }
  }

  // 3. 弱口令 / 虚拟占位鉴权判定
  // normal、special 与 _keepName 均必须满足非占位弱口令要求，绝无豁免
  const isDummyAuth = REGEX_DUMMY_AUTH.test(proxy?.uuid || proxy?.password || '');
  if (isDummyAuth) {
    return '假密码';
  }

  // 白名单/特殊节点或 keepName 节点已通过上述硬结构校验，豁免后续广告词检查
  if (options.isSpecial || proxy?._keepName) {
    return '';
  }

  // 4. 广告词与推销判定 (仅对 normal 节点生效)
  const isAdTypo = REGEX_AD_TYPO.test(rawName)
    || (REGEX_AD_PROMO.test(rawName) && REGEX_AD_PRICE.test(rawName));

  if (isAdTypo) return '广告词';

  return '';
}

/**
 * 编译全量特征规则列表（包含静态特征基线、AI 服务注册表、流媒体注册表与自定义服务）
 * @param {object} [userConfig={}]
 * @returns {Array<{ reg: RegExp, tag: string, pool?: string, groupName?: string }>}
 */
function getFeatureRules(userConfig = {}) {
  const rules = [...STATIC_FEATURE_RULES];

  // 动态服务编目特征规则注入 (统一由 catalog 单一事实来源驱动)
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
 * 判定节点在当前配置下归属的隔离分类（家宽、高倍率、下载、实验）
 * @param {object} item 或包含 tags 与 attrs 的对象
 * @param {object} [userConfig={}]
 * @returns {string} 'residential' | 'highMulti' | 'download' | 'experimental' | ''
 */
function getIsolationBucket(item, userConfig = {}) {
  if (!item) return '';
  const tags = item.tags || [];
  const multi = item.attrs?.multiNum ?? 1;
  const highMultiThreshold = userConfig.highMultiThreshold ?? 2.5;

  if (userConfig.enableResidential && tags.includes('residential')) {
    return 'residential';
  }
  if (userConfig.isolateHighMulti && multi > highMultiThreshold) {
    return 'highMulti';
  }
  if (userConfig.isolateDownload && tags.includes('download')) {
    return 'download';
  }
  if (userConfig.isolateExperimental && tags.includes('experimental')) {
    return 'experimental';
  }
  return '';
}

/**
 * 核心节点分类打标函数 (纯函数)
 * @param {object} proxy
 * @param {object} [userConfig={}]
 * @param {object} [options={}]
 * @returns {object} 分类结果
 */
function classifyNode(proxy, userConfig = {}, options = {}) {
  // 1. 拒绝 null、数组、非对象等无效输入
  if (!proxy || typeof proxy !== 'object' || Array.isArray(proxy)) {
    return { skip: true, rawName: '', blockReason: '无效节点数据' };
  }
  const rawName = proxy._rawName || proxy.name || '';
  const defs = options.regionDefs || getEnhancedRegionDefs();

  // 2. 检查用户显式黑名单 (最高优先级，任何节点类型包括 synthetic/notice/whitelist 均不得豁免)
  const blacklistReason = matchUserBlacklist(proxy, rawName, userConfig);
  if (blacklistReason) {
    return { skip: true, rawName, blockReason: blacklistReason };
  }

  // 3. 分流节点类型：synthetic、notice candidate、special、normal
  // 3.1 虚拟看板节点优先处理
  if (proxy.isSyntheticInfo) {
    if (userConfig.enableDashboard === false) {
      return { skip: true, rawName, blockReason: '看板关闭' };
    }
    proxy.server = '127.0.0.1';
    proxy.port = 80;
    return { isInfo: true, isSyntheticInfo: true, proxy, rawName, groupKey: 'info' };
  }

  // 3.2 原生信息说明节点 (公告候选)
  if (isNoticeNode(proxy, rawName)) {
    if (userConfig.removeInfoNodes !== false) {
      return { skip: true, rawName, blockReason: '信息说明' };
    }
    return { isInfo: true, proxy, rawName, groupKey: 'info' };
  }

  // 3.3 白名单与特殊节点判定
  const tempNameLower = rawName.toLowerCase();
  const subTagLower = (proxy._subTag || '').toLowerCase();
  const whitelist = toArray(userConfig.whitelistKeywords).map(k => String(k).toLowerCase()).filter(Boolean);

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

  // 4. 差异化校验：normal 与 special 均必须满足硬结构校验
  const blockReason = checkNodeBlockReason(proxy, rawName, userConfig, {
    regionDefs: defs,
    featureRules: options.featureRules,
    isSpecial
  });
  if (blockReason) {
    return { skip: true, rawName, blockReason };
  }

  // 若为通过硬结构校验的合法 special 节点，豁免广告拦截与模板重命名，直接交付
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

  // 5. 字符清洗与属性提取
  const sanitized = sanitizeNodeName(rawName);
  const isForbidDownload = REGEX_FORBID_DL.test(rawName);
  const { attrs, cleanName } = extractNodeAttributes(sanitized, userConfig);

  // 6. 地区与城市匹配
  let regionInfo = matchNodeRegion(sanitized, defs, userConfig);
  if (!regionInfo) regionInfo = matchNodeRegion(cleanName, defs, userConfig);

  let destCity = '';
  if (regionInfo && regionInfo.city) {
    destCity = extractCity(rawName, regionInfo);
  }

  // 7. 特征提取与打标
  const tags = new Set();
  const featurePools = [];

  // 网络层 IPv6 识别：当 server 字段是物理 IPv6 地址时自动识别
  if (proxy.server) {
    const cleanServer = String(proxy.server).trim().replace(/^\[|\]$/g, '');
    if (cleanServer.includes(':') && ipaddr.isValid(cleanServer)) {
      try {
        if (ipaddr.parse(cleanServer).kind() === 'ipv6') {
          tags.add('ipv6');
        }
      } catch {}
    }
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
  const tagList = Array.from(tags);
  const isolateBucket = getIsolationBucket({ tags: tagList, attrs }, userConfig);

  return {
    proxy,
    rawName,
    regionInfo,
    destCity,
    tags: tagList,
    featurePools,
    protocol,
    transportTag,
    attrs,
    groupKey,
    isolateBucket,
    isUnknownRegion,
    keepName: !!proxy?._keepName,
    customGroups: Array.isArray(proxy?._customGroups) ? proxy._customGroups : [],
    airportTag: proxy?._subTag || userConfig.airportTag || ''
  };
}

/**
 * 判定单个节点是否为显而易见的无服务能力占位/提示节点
 * 仅用于订阅有效性前置拦截（防止“续费/到期/公告”占位节点把失效订阅误判为成功）
 * 必须结合“假IP/假端口/无真实代理特征”与“提示性名称”双重特征，绝不误杀真实节点
 * @param {object} proxy
 * @returns {boolean}
 */
function isNoticePlaceholderNode(proxy) {
  if (!proxy || typeof proxy !== 'object') return false;
  if (proxy.isSyntheticInfo) return false;
  const rawName = proxy._rawName || proxy.name || '';
  const isFakeServer = isFakeServerAddress(proxy.server, proxy.port);
  const isNoticeName = REGEX_EXPLICIT_NOTICE.test(rawName)
    || REGEX_INFO_NODE.test(rawName)
    || REGEX_NOTICE_KEYWORD.test(rawName);

  return isFakeServer && isNoticeName;
}

/**
 * 判定订阅返回的节点列表是否全部为占位/提示节点（即无任何有效可用节点）
 * @param {Array<object>} proxies
 * @returns {boolean}
 */
function hasOnlyPlaceholderNodes(proxies) {
  if (!Array.isArray(proxies) || proxies.length === 0) return true;
  return proxies.every(p => isNoticePlaceholderNode(p));
}

module.exports = {
  sanitizeNodeName,
  extractNodeAttributes,
  checkNodeBlockReason,
  getFeatureRules,
  classifyNode,
  getIsolationBucket,
  isPrivateOrLoopbackServer,
  isNoticeNode,
  isNoticePlaceholderNode,
  hasOnlyPlaceholderNodes
};
