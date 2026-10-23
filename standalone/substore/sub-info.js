/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: Sub-Store 订阅信息节点操作脚本（三行拆分版）
 * 
 * @author     XiaoM-OVO
 * @repository https://github.com/XiaoM-OVO/mihomo-toolkit
 * @license    MIT
 * -----------------------------------------------------------------------------
 * 
 * 适用于：Sub-Store 订阅管理平台（节点操作 -> 脚本操作）
 * 核心职责：提取、计算与格式化展示订阅流量与到期状态，清洗旧伪节点并置顶。
 * 最佳实践：挂载于「单订阅」的节点操作中，在多订阅合并之前执行。
 * 
 * ┌─ 可选配置参数（参数优先级：脚本参数 $arguments > 订阅 URL Hash 参数 > 默认配置）
 * │  infoPrefix      前缀文字（默认自动取当前订阅名，如 MySub）
 * │  infoPrefixWrap  前缀包裹符号，如 [] / () / 【】 / (())；设为 '' 表示不包裹
 * │  hideExpire      隐藏到期日信息节点（设为 true 或直接加 #hideExpire）
 * │  noFlow          跳过向上游网络抓取流量信息（仅依赖 Sub-Store 现有数据/自定义链接）
 * │  keepStaleNodes  未获取到流量信息时，是否保留上一轮的旧信息节点（默认 false 清理）
 * │  resetDay        每月固定重置流量日期（1 - 31 的整数）
 * │  startDate       重置周期起始日期（格式：YYYY-MM-DD，与 cycleDays 搭配）
 * │  cycleDays       重置周期天数（正整数，如 30）
 * │  lowFlowBytes    自定义流量告急字节阈值（正整数，默认 5368709120 即 5GB）
 * │  lowFlowRatio    自定义流量告急比例阈值（0 - 1 之间的小数，默认 0.05 即 5%）
 * │  insecure        抓取流量头时忽略证书校验（默认 false）
 * │  flowUrl         自定义抓取流量头目标 URL（覆盖原订阅 URL）
 * │  flowUserAgent   自定义抓取流量使用的 User-Agent
 * └────────────────────────────────────────────────────────────────────────────────────
 * 
 * ┌─ 输出信息节点预览（不可连通的伪节点，仅供客户端展示）
 * │  🏷️ [Tag] 剩余流量：128.50 GB / 500.00 GB (25.7%)  / 🪫 流量告急：...
 * │  📅 [Tag] 套餐到期：2025-12-31 (余 280 天)        / ⚠️ 即将到期：...
 * │  🔄 [Tag] 距离重置剩余：15 天                      （距到期 > 30 天时展示）
 * │  🛑 [Tag] 套餐到期：2025-01-01 (已失效 12 天)
 * └────────────────────────────────────────────────────────────────────────────────────
 */

// ── 默认配置 ─────────────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  infoPrefix: '',       // 默认留空，自动读取订阅名
  infoPrefixWrap: '[]', // 默认使用方括号包裹前缀
  hideExpire: false,    // 默认展示到期时间
  noFlow: false,        // 默认允许在无缓存时向网络请求流量信息
  keepStaleNodes: false,// 默认未拉取到流量时清除旧信息节点，防陈旧数据误导
  lowFlowBytes: 5 * 1024 * 1024 * 1024, // 5GB 告急阈值
  lowFlowRatio: 0.05    // 5% 告急比例
}

// ── 1. 基础纯工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 安全解析脚本入参（兼容对象形式与 QueryString 字符串形式）
 */
function parseScriptArgs(rawArgs) {
  if (!rawArgs) return {}
  if (typeof rawArgs === 'object' && !Array.isArray(rawArgs)) return rawArgs
  if (typeof rawArgs === 'string') {
    const res = {}
    for (const pair of rawArgs.split('&')) {
      if (!pair) continue
      const eqIdx = pair.indexOf('=')
      if (eqIdx === -1) {
        res[safeDecodeURIComponent(pair.trim())] = true
      } else {
        const key = safeDecodeURIComponent(pair.slice(0, eqIdx).trim())
        const val = safeDecodeURIComponent(pair.slice(eqIdx + 1).trim())
        res[key] = val === '' ? true : val
      }
    }
    return res
  }
  return {}
}

/**
 * 严格布尔解析器（仅转换合法的真假表达，空值退回 defaultVal）
 */
function parseBool(val, defaultVal = false) {
  if (val === undefined || val === null) return defaultVal
  if (typeof val === 'boolean') return val
  const str = String(val).trim().toLowerCase()
  if (str === 'true' || str === '1') return true
  if (str === 'false' || str === '0') return false
  return defaultVal
}

/**
 * 安全解码 URI 组件，避免遇到非法编码字符时抛出异常
 */
function safeDecodeURIComponent(str) {
  if (typeof str !== 'string') return ''
  try {
    return decodeURIComponent(str)
  } catch {
    return str
  }
}

/**
 * 解析 URL 中的 Fragment（# 后的参数）
 * 对齐官方规范：优先解析 JSON 编码，失败则解析 Key-Value 键值对
 */
function parseUrlArgs(rawUrl = '') {
  const result = { cleanUrl: '', args: {} }
  if (!rawUrl || typeof rawUrl !== 'string') return result

  const line = rawUrl.trim().split(/[\r\n]+/)[0] || ''
  const hashIdx = line.indexOf('#')
  result.cleanUrl = hashIdx !== -1 ? line.slice(0, hashIdx) : line

  const hashPart = hashIdx !== -1 ? line.slice(hashIdx + 1) : ''
  if (!hashPart) return result

  // 1. 优先尝试解析 URL 编码的 JSON
  try {
    const parsed = JSON.parse(decodeURIComponent(hashPart))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      result.args = parsed
      return result
    }
  } catch {}

  // 2. 兼容传统的 a=1&b=2 格式
  for (const pair of hashPart.split('&')) {
    if (!pair) continue
    const eqIdx = pair.indexOf('=')
    if (eqIdx === -1) {
      result.args[safeDecodeURIComponent(pair)] = true
    } else {
      const key = safeDecodeURIComponent(pair.slice(0, eqIdx))
      const val = safeDecodeURIComponent(pair.slice(eqIdx + 1))
      result.args[key] = val === '' ? true : val
    }
  }
  return result
}

/**
 * 格式化前缀标签，自动剥离多余包裹符，支持任意长度包裹符对称对折包裹
 */
function formatTagPrefix(prefixText, wrapStr = '[]') {
  if (!prefixText) return ''
  const clean = String(prefixText).replace(/^[\[({【（<「『\s]+|[\s\])}】）>」』]+$/g, '').trim()
  if (!clean) return ''
  if (!wrapStr || typeof wrapStr !== 'string') return `${clean} `

  const half = Math.floor(wrapStr.length / 2)
  return half > 0 ? `${wrapStr.slice(0, half)}${clean}${wrapStr.slice(half)} ` : `${clean} `
}

/**
 * 规整时间戳为毫秒数（自适应 10 位秒级和 13 位毫秒级）
 */
function normalizeTimestampMs(ts) {
  if (!ts || isNaN(ts)) return 0
  const num = Number(ts)
  return num > 1e11 ? num : num * 1000
}

/**
 * 格式化时间为 YYYY-MM-DD（基于东八区北京时间，规避容器 UTC 时区早一天的问题）
 */
function formatDateUtc8(timestampMs) {
  if (!timestampMs) return ''
  const date = new Date(timestampMs + 8 * 3600 * 1000)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 流量格式化（兼容 flowUtils.flowTransfer，异常或无环境时启用内置算法）
 */
function formatBytes(bytes, logger) {
  const sign = bytes < 0 ? '-' : ''
  const abs = Math.abs(bytes || 0)

  if (typeof flowUtils !== 'undefined' && typeof flowUtils.flowTransfer === 'function') {
    try {
      const res = flowUtils.flowTransfer(abs)
      if (typeof res === 'string') {
        return `${sign}${res.replace(/^-/, '')}`
      }
      if (res && typeof res === 'object' && res.value != null) {
        const cleanVal = String(res.value).replace(/^-/, '')
        return `${sign}${cleanVal} ${res.unit || ''}`.trim()
      }
    } catch (e) {
      logger?.warn?.(`[sub-info] flowUtils.flowTransfer 异常: ${e?.message || e}，启用内置算法`)
    }
  }

  if (abs === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let idx = 0
  let cur = abs
  while (cur >= 1024 && idx < units.length - 1) {
    cur /= 1024
    idx++
  }
  return `${sign}${cur.toFixed(2)} ${units[idx]}`
}

/**
 * 计算距离每月 resetDay 重置的天数（月末自适应对齐）
 */
function calculateResetDays(resetDay) {
  const day = parseInt(resetDay, 10)
  if (!day || isNaN(day) || day < 1 || day > 31) return null
  const DAY_MS = 86400000
  const now = new Date(Date.now() + 8 * 3600 * 1000)
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const todayMs = Date.UTC(y, m, now.getUTCDate())

  const lastDayThisMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const candidateMs = Date.UTC(y, m, Math.min(day, lastDayThisMonth))
  if (candidateMs > todayMs) {
    return Math.round((candidateMs - todayMs) / DAY_MS)
  }

  const lastDayNextMonth = new Date(Date.UTC(y, m + 2, 0)).getUTCDate()
  const nextCandidateMs = Date.UTC(y, m + 1, Math.min(day, lastDayNextMonth))
  return Math.round((nextCandidateMs - todayMs) / DAY_MS)
}

/**
 * 计算基于起始日期与周期的重置剩余天数（纯数学自然日对齐）
 */
function calculateCycleDays(startDateStr, cycleDays) {
  if (!startDateStr || !cycleDays || cycleDays <= 0) return null
  const parts = startDateStr.split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return null

  const DAY_MS = 86400000
  const now = new Date(Date.now() + 8 * 3600 * 1000)
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const startMs = Date.UTC(parts[0], parts[1] - 1, parts[2])
  if (isNaN(startMs)) return null

  if (todayMs < startMs) {
    return Math.round((startMs - todayMs) / DAY_MS)
  }

  const elapsedDays = Math.floor((todayMs - startMs) / DAY_MS)
  const passedCycles = Math.floor(elapsedDays / cycleDays)
  const nextCycleStartMs = startMs + (passedCycles + 1) * cycleDays * DAY_MS
  return Math.round((nextCycleStartMs - todayMs) / DAY_MS)
}

/**
 * 从原始节点名称中嗅探重置信息（支持天数、日期格式及“每月 X 号/日重置”）
 */
function sniffResetDaysFromProxies(proxies = []) {
  const isSynthetic = (p) => {
    if (!p) return true
    if (p.isSyntheticInfo === true) return true
    if (p.server === '1.0.0.1' && p.port === 80) return true
    return /^(?:🏷️|🪫|📅|⚠️|🛑|🔄)/.test(p?.name || '')
  }

  const candidate = proxies.find(p => !isSynthetic(p) && p?.name && /(?:流量)?重置|reset/i.test(p.name))
  if (!candidate) return null

  const rawName = String(candidate.name)
  const cleanName = rawName.replace(/^\[.*?\]\s*/, '').trim()

  // 1. 每月 X 号/日重置
  const monthlyMatch = cleanName.match(/每月\s*(\d{1,2})\s*(?:号|日)/i) || rawName.match(/每月\s*(\d{1,2})\s*(?:号|日)/i)
  if (monthlyMatch) {
    const day = parseInt(monthlyMatch[1], 10)
    const calc = calculateResetDays(day)
    if (calc != null) return calc
  }

  // 2. 剩余 N 天
  const daysMatch = cleanName.match(/(\d+)\s*(?:天|Days?)/i)
  if (daysMatch) return parseInt(daysMatch[1], 10)

  // 3. 具体日期格式 YYYY-MM-DD
  const dateMatch = cleanName.match(/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/)
  if (dateMatch) {
    const targetMs = new Date(dateMatch[0].replace(/\//g, '-')).getTime()
    if (!isNaN(targetMs)) {
      const diff = Math.ceil((targetMs - Date.now()) / (1000 * 3600 * 24))
      if (diff > 0) return diff
    }
  }
  return null
}

/**
 * 构造展示用的不可连通伪节点（标准 Shadowsocks）
 */
function createSyntheticProxy(name) {
  return {
    type: 'ss',
    server: '1.0.0.1',
    port: 80,
    cipher: 'aes-128-gcm',
    password: 'subinfo',
    isSyntheticInfo: true,
    name
  }
}

// ── 2. 流量数据解析与网络请求引擎 ──────────────────────────────────────────────────

/**
 * 纯原生解析 subscription-userinfo 响应头或对象
 * 标准格式: upload=123; download=456; total=789; expire=1234567890（同时兼容 & 分隔）
 */
function parseSubscriptionUserinfo(raw) {
  if (!raw) return null

  let total = 0
  let upload = 0
  let download = 0
  let expire = 0

  // 1. 若已经是结构化对象（Sub-Store 已解析数据）
  if (typeof raw === 'object') {
    total = Number(raw.total) || 0
    upload = Number(raw.upload ?? raw.usage?.upload) || 0
    download = Number(raw.download ?? raw.usage?.download) || 0
    expire = Number(raw.expire ?? raw.expires) || 0
  } else if (typeof raw === 'string') {
    // 2. 纯原生字符串正则解析（自闭环，兼容 ; 空白 , 以及 & 分隔符）
    const parseVal = (key) => {
      const match = raw.match(new RegExp(`(?:^|[;\\s,&])${key}=(\\d+)`, 'i'))
      return match ? Number(match[1]) : 0
    }
    upload = parseVal('upload')
    download = parseVal('download')
    total = parseVal('total')
    expire = parseVal('expire')
  } else {
    return null
  }

  if (total > 0 || upload > 0 || download > 0 || expire > 0) {
    return {
      total,
      upload,
      download,
      expire,
      expires: expire,
      usage: { upload, download }
    }
  }

  return null
}

/**
 * 统一网络请求流量头降级链（flowUtils -> $httpClient -> fetch）
 */
async function fetchRawFlowHeaders(url, proxy, userAgent, customFlowUrl, insecure, logger) {
  // A. 优先尝试 Sub-Store 内置 flowUtils（首参为订阅 URL，尾参为自定义 flowUrl）
  if (typeof flowUtils !== 'undefined' && typeof flowUtils.getFlowHeaders === 'function') {
    try {
      const fetchUrl = insecure && url ? `${url}#insecure` : url
      const flowInfo = await flowUtils.getFlowHeaders(
        fetchUrl,
        userAgent,
        undefined,
        proxy,
        customFlowUrl
      )
      if (flowInfo) {
        if (typeof flowUtils.normalizeFlowHeader === 'function') {
          const norm = flowUtils.normalizeFlowHeader(flowInfo, true)
          if (norm?.['subscription-userinfo']) return norm['subscription-userinfo']
        }
        return flowInfo
      }
    } catch (e) {
      logger?.warn?.(`[sub-info] flowUtils.getFlowHeaders 失败: ${e?.message || e}`)
    }
  }

  // B/C 降级链：若无 flowUtils，针对独立运行环境优先使用 customFlowUrl，无则使用 url
  const requestUrl = customFlowUrl || url
  if (!requestUrl || !/^https?:\/\//i.test(requestUrl)) return null

  const reqHeaders = {
    'User-Agent': userAgent || 'Clash.meta; mihomo; Sub-Store'
  }

  // B. 尝试标准 $httpClient 兜底
  if (typeof $httpClient !== 'undefined' && typeof $httpClient.get === 'function') {
    try {
      const res = await new Promise((resolve) => {
        $httpClient.get({
          url: requestUrl,
          headers: reqHeaders,
          timeout: 10000
        }, (err, resp) => {
          if (err || !resp?.headers) return resolve(null)
          const h = resp.headers
          resolve(h['subscription-userinfo'] || h['Subscription-Userinfo'] || null)
        })
      })
      if (res) return res
    } catch (e) {
      logger?.warn?.(`[sub-info] $httpClient 请求流量头异常: ${e?.message || e}`)
    }
  }

  // C. 尝试原生 fetch 兜底
  if (typeof fetch === 'function') {
    try {
      const resp = await fetch(requestUrl, {
        method: 'HEAD',
        headers: reqHeaders
      })
      const val = resp.headers.get('subscription-userinfo')
      if (val) return val
    } catch (e) {
      logger?.warn?.(`[sub-info] fetch HEAD 流量头异常: ${e?.message || e}`)
    }
  }

  return null
}

// ── 3. 核心流水线流程 ─────────────────────────────────────────────────────────────────

/**
 * 阶段 ①：解析与校验配置
 * 参数优先级：脚本参数 $arguments > 订阅 URL Hash 参数 > 默认配置
 */
function resolveConfig(proxies, context, logger) {
  const envArgs = parseScriptArgs(typeof $arguments !== 'undefined' ? $arguments : {})

  // 提取订阅名称与订阅对象（优先 context.sourceName，其次代理节点 subName）
  const sampleProxy = proxies.find(p => (p?.subName || p?._subName) && p?.server !== '1.0.0.1')
    || proxies.find(p => p?.subName || p?._subName)

  const subName = context?.sourceName
    || sampleProxy?.subName
    || sampleProxy?._subName
    || ''

  let sub = context?.source
  if (sub && typeof sub === 'object' && subName && sub[subName]) {
    sub = sub[subName]
  }

  const subUrl = sub?.url || ''
  const { cleanUrl, args: urlArgs } = parseUrlArgs(subUrl)

  // 严格保证优先级：DEFAULT_CONFIG < urlArgs < envArgs
  const merged = { ...DEFAULT_CONFIG, ...urlArgs, ...envArgs }

  let normResetDay = null
  if (merged.resetDay != null && merged.resetDay !== '') {
    const val = Number(merged.resetDay)
    if (Number.isInteger(val) && val >= 1 && val <= 31) normResetDay = val
    else logger?.warn?.(`[sub-info] ${subName || '订阅'} 的 resetDay (${merged.resetDay}) 非法，应为 1-31 的整数`)
  }

  let normCycleDays = null
  if (merged.cycleDays != null && merged.cycleDays !== '') {
    const val = Number(merged.cycleDays)
    if (Number.isInteger(val) && val > 0) normCycleDays = val
    else logger?.warn?.(`[sub-info] ${subName || '订阅'} 的 cycleDays (${merged.cycleDays}) 非法，应为正整数`)
  }

  let normStartDate = merged.startDate || ''
  if (normStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(normStartDate)) {
    logger?.warn?.(`[sub-info] ${subName || '订阅'} 的 startDate (${normStartDate}) 格式不合规，应为 YYYY-MM-DD`)
    normStartDate = ''
  }

  let normLowFlowBytes = DEFAULT_CONFIG.lowFlowBytes
  if (merged.lowFlowBytes != null && merged.lowFlowBytes !== '') {
    const val = Number(merged.lowFlowBytes)
    if (!isNaN(val) && val > 0) normLowFlowBytes = val
  }

  let normLowFlowRatio = DEFAULT_CONFIG.lowFlowRatio
  if (merged.lowFlowRatio != null && merged.lowFlowRatio !== '') {
    const val = Number(merged.lowFlowRatio)
    if (!isNaN(val) && val > 0 && val < 1) normLowFlowRatio = val
  }

  const rawPrefix = merged.infoPrefix || subName || sub?.name || ''
  const tag = formatTagPrefix(rawPrefix, merged.infoPrefixWrap)
  const autoResetDays = sniffResetDaysFromProxies(proxies)

  return {
    sub,
    subName,
    cleanUrl,
    tag,
    mergedArgs: merged,
    hideExpire: parseBool(merged.hideExpire, false),
    noFlow: parseBool(merged.noFlow, false),
    keepStaleNodes: parseBool(merged.keepStaleNodes, false),
    resetDay: normResetDay,
    cycleDays: normCycleDays,
    startDate: normStartDate,
    lowFlowBytes: normLowFlowBytes,
    lowFlowRatio: normLowFlowRatio,
    autoResetDays
  }
}

/**
 * 阶段 ②：获取流量数据（优先复用缓存，融合自定义流量链接与网络上游拉取）
 */
async function obtainFlowData(cfg, logger) {
  const { sub, subName, cleanUrl, noFlow, mergedArgs } = cfg

  // 2.1 检查 Sub-Store 是否已有结构化流量缓存（内存中直接命中）
  const cachedSources = [
    sub?.userinfo,
    typeof $substore !== 'undefined' && $substore?.subUserinfo
  ]
  for (const src of cachedSources) {
    const parsed = parseSubscriptionUserinfo(src)
    if (parsed) {
      logger?.info?.(`[sub-info] ${subName || '订阅'}: 复用现有结构化流量信息，跳过重复请求`)
      return parsed
    }
  }

  let mainFlowHeader = null
  let customFlowHeader = null
  const ua = mergedArgs.flowUserAgent || 'Clash.meta; mihomo; Sub-Store'

  // 2.2 向上游订阅链接抓取流量头（首参传订阅 cleanUrl，第 4 参传 flowUrl，对齐官方实现）
  if (!noFlow && (cleanUrl || mergedArgs.flowUrl)) {
    mainFlowHeader = await fetchRawFlowHeaders(
      cleanUrl,
      sub?.proxy,
      ua,
      mergedArgs.flowUrl,
      mergedArgs.insecure,
      logger
    )
  }

  // 2.3 处理 sub.subUserinfo（对齐官方：支持普通字符串或自定义 HTTP 链接）
  if (sub?.subUserinfo) {
    if (/^https?:\/\//i.test(sub.subUserinfo)) {
      logger?.info?.(`[sub-info] ${subName || '订阅'}: 正在请求自定义流量链接获取流量头...`)
      customFlowHeader = await fetchRawFlowHeaders(
        undefined,
        sub?.proxy,
        ua,
        sub.subUserinfo,
        mergedArgs.insecure,
        logger
      )
    } else {
      customFlowHeader = sub.subUserinfo
    }
  }

  // 2.4 规范化并合并头部数据
  const combinedHeaders = [customFlowHeader, mainFlowHeader].filter(Boolean)

  if (combinedHeaders.length > 0) {
    if (typeof flowUtils !== 'undefined' && typeof flowUtils.normalizeFlowHeader === 'function') {
      try {
        const norm = flowUtils.normalizeFlowHeader(combinedHeaders.join(';'), true)
        if (norm?.['subscription-userinfo']) {
          const parsed = parseSubscriptionUserinfo(norm['subscription-userinfo'])
          if (parsed) return parsed
        }
      } catch {}
    }

    for (const item of combinedHeaders) {
      const parsed = parseSubscriptionUserinfo(item)
      if (parsed) return parsed
    }
  }

  return null
}

/**
 * 阶段 ③：构建信息伪节点（纯函数逻辑）
 */
function buildInfoNodes(flow, cfg, logger) {
  const { total, upload, download, expire } = flow
  const {
    tag,
    subName,
    hideExpire,
    resetDay,
    startDate,
    cycleDays,
    lowFlowBytes,
    lowFlowRatio,
    autoResetDays
  } = cfg

  const nowMs = Date.now()
  const expireMs = normalizeTimestampMs(expire)
  const used = upload + download
  const remaining = total - used

  // 3.1 已过期处理
  if (expireMs > 0 && nowMs >= expireMs) {
    if (!hideExpire) {
      const dateStr = formatDateUtc8(expireMs)
      const expiredDays = Math.max(1, Math.floor((nowMs - expireMs) / (1000 * 3600 * 24)))
      return [createSyntheticProxy(`🛑 ${tag}套餐到期：${dateStr} (已失效 ${expiredDays} 天)`)]
    }
    logger?.warn?.(`[sub-info] ${subName || '订阅'} 已过期，但配置了 hideExpire，跳过输出`)
    return []
  }

  const nodes = []

  // 3.2 流量状态节点
  if (total > 0) {
    const percent = Math.max(0, Math.min(100, (remaining / total) * 100)).toFixed(1)
    const isLow = remaining <= lowFlowBytes || (remaining / total) <= lowFlowRatio
    const icon = isLow ? '🪫' : '🏷️'
    const label = isLow ? '流量告急' : '剩余流量'
    nodes.push(createSyntheticProxy(`${icon} ${tag}${label}：${formatBytes(remaining, logger)} / ${formatBytes(total, logger)} (${percent}%)`))
  } else if (used > 0) {
    nodes.push(createSyntheticProxy(`🏷️ ${tag}已用流量：${formatBytes(used, logger)}`))
  }

  // 3.3 到期时间节点
  let expireDays = -1
  if (expireMs > 0 && !hideExpire) {
    expireDays = Math.ceil((expireMs - nowMs) / (1000 * 3600 * 24))
    const dateStr = formatDateUtc8(expireMs)
    if (expireDays <= 3) {
      nodes.push(createSyntheticProxy(`⚠️ ${tag}即将到期：${dateStr} (仅剩 ${expireDays} 天，请及时续费)`))
    } else {
      nodes.push(createSyntheticProxy(`📅 ${tag}套餐到期：${dateStr} (余 ${expireDays} 天)`))
    }
  }

  // 3.4 计算重置剩余天数（流式多层优先级算法）
  let resetRemainingDays = null

  // 优先 A：外部 flowUtils 工具包（若存在）
  if (typeof flowUtils !== 'undefined') {
    const getDaysFn = flowUtils.getRemainingDays || flowUtils.getRmainingDays
    if (typeof getDaysFn === 'function') {
      try {
        resetRemainingDays = getDaysFn({ resetDay, startDate, cycleDays })
      } catch {}
    }
  }
  // 其次 B：startDate + cycleDays 独立周期算法
  if (resetRemainingDays == null && startDate && cycleDays) {
    resetRemainingDays = calculateCycleDays(startDate, cycleDays)
  }
  // 再次 C：每月固定 resetDay 算法
  if (resetRemainingDays == null && resetDay != null) {
    resetRemainingDays = calculateResetDays(resetDay)
  }
  // 兜底 D：从原有节点嗅探到的天数
  if (resetRemainingDays == null) {
    resetRemainingDays = autoResetDays
  }

  // 只有当距离到期大于 30 天或未设置到期时，才展示重置天数，避免信息冗余
  if (resetRemainingDays != null && (expireDays === -1 || expireDays > 30)) {
    nodes.push(createSyntheticProxy(`🔄 ${tag}距离重置剩余：${resetRemainingDays} 天`))
  }

  return nodes
}

/**
 * 阶段 ④：安全清洗旧信息节点并置顶（绝对防误杀原生节点）
 * @param {Array} proxies 原始节点列表
 * @param {Array} infoNodes 待置顶的新信息节点
 * @param {Boolean} shouldClean 是否清洗旧的伪信息节点（true: 过滤旧伪节点; false: 直接追加不清洗）
 */
function cleanAndPrependNodes(proxies, infoNodes = [], shouldClean = true) {
  if (!Array.isArray(proxies)) return [...infoNodes]

  // 安全模式：若不执行清理，直接把 infoNodes 拼在原始节点前，不丢失任何节点
  if (!shouldClean) {
    return [...infoNodes, ...proxies]
  }

  const REGEX_PURE_INFO = /^(\[.*?\]\s*)?(?:剩余流量|流量告急|已用流量|套餐到期|到期时间|有效时间|已过期|即将到期|即将过期|流量重置|(?:距离)?重置剩余)[:：\s]/i

  // 精准识别信息伪节点特征，避免误杀机场原生的通知或公告节点
  const isTargetSyntheticNode = (p) => {
    if (!p) return false
    if (p.isSyntheticInfo === true) return true
    if (p.server === '1.0.0.1' && p.port === 80) return true
    const name = String(p.name || '')
    if (/^(?:🏷️|🪫|📅|⚠️|🛑|🔄)\s+.*?(?:剩余流量|流量告急|已用流量|套餐到期|即将到期|距离重置剩余)/.test(name)) return true
    if (REGEX_PURE_INFO.test(name)) return true
    return false
  }

  const cleaned = proxies.filter(p => !isTargetSyntheticNode(p))
  return [...infoNodes, ...cleaned]
}

// ── 4. 主入口 Operator ───────────────────────────────────────────────────────────────
async function operator(proxies = [], targetPlatform, context = {}) {
  const logger = typeof $substore !== 'undefined' ? $substore : console
  const safeProxies = Array.isArray(proxies) ? proxies : []

  // 1. 解析配置
  const config = resolveConfig(safeProxies, context, logger)

  // 2. 获取流量数据
  const flow = await obtainFlowData(config, logger)
  if (!flow) {
    logger?.warn?.(`[sub-info] ${config.subName || '订阅'} 未获取到 subscription-userinfo 响应头或有效流量数据`)
    // 若 keepStaleNodes 为 true 则保留原样输出；若为 false 则清除旧伪信息节点
    return config.keepStaleNodes
      ? safeProxies
      : cleanAndPrependNodes(safeProxies, [], true)
  }

  // 3. 构建信息伪节点
  const infoNodes = buildInfoNodes(flow, config, logger)

  // 4. 清洗旧伪节点并置顶输出
  return cleanAndPrependNodes(safeProxies, infoNodes, true)
}

// ── 5. 模块导出（支持 Node.js 单元测试与环境复用） ───────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    operator,
    parseSubscriptionUserinfo,
    formatBytes,
    resolveConfig,
    obtainFlowData,
    buildInfoNodes,
    cleanAndPrependNodes
  }
}
