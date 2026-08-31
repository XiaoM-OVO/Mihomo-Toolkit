/*
 * Sub-Store 操作脚本：mihomo-toolkit 风格订阅信息节点（三行拆分版）
 * 用法：在 Sub Store 里给订阅挂「操作脚本」，粘贴本文件内容。
 *
 * 订阅链接 URL 片段可选参数（加在 # 后）：
 *   #hideExpire               不显示到期日期
 *   #resetDay=19              每月 19 号重置流量（和下面二选一）
 *   #startDate=2026-01-01&cycleDays=30  每 30 天重置一次
 *   #insecure / #flowUrl / #flowUserAgent  透传给底层流量抓取
 *
 * 输出三行「假节点」（带 [订阅名] 前缀，仅展示，不会真实连接）：
 *   剩余流量：X / Y
 *   套餐到期：... (余 N 天)
 *   距离重置剩余：N 天   （仅当到期遥远或未知时显示）
 */
async function operator(proxies = [], targetPlatform, context) {
  const args = $arguments || {}
  const $ = $substore
  const { parseFlowHeaders, getFlowHeaders, flowTransfer, getRmainingDays, normalizeFlowHeader } = flowUtils
  const subName = proxies?.[0]?._subName || proxies?.[0]?.subName
  const sub = context?.source?.[subName]
  let subInfo

  // 1) 重新抓上游订阅，取 subscription-userinfo 响应头
  if (sub && (sub.source !== 'local' || ['localFirst', 'remoteFirst'].includes(sub.mergeSources))) {
    try {
      let url = String(sub.url || '').trim().split(/[\r\n]+/)[0] || ''
      const rawArgs = url.split('#')
      url = rawArgs[0]
      const urlArgs = {}
      if (rawArgs.length > 1) {
        for (const pair of rawArgs[1].split('&')) {
          const kv = pair.split('=')
          urlArgs[kv[0]] = kv[1] == null || kv[1] === '' ? true : decodeURIComponent(kv[1])
        }
      }
      if (!urlArgs.noFlow && /^https?/.test(url)) {
        const flowInfo = await getFlowHeaders(
          urlArgs.insecure ? `${url}#insecure` : url,
          urlArgs.flowUserAgent, undefined, sub.proxy, urlArgs.flowUrl
        )
        if (flowInfo) {
          const headers = normalizeFlowHeader(flowInfo, true)
          if (headers?.['subscription-userinfo']) subInfo = headers['subscription-userinfo']
        }
      }
    } catch (err) {
      $.error(`[sub-info] 获取 ${sub?.name} 流量信息失败: ${err?.message || err}`)
    }
  }

  // 2) 支持用 sub.subUserinfo 字段兜底（链接或字面量）
  if (sub?.subUserinfo) {
    try {
      let userInfo = sub.subUserinfo
      if (/^https?:\/\//.test(userInfo)) userInfo = await getFlowHeaders(undefined, undefined, undefined, sub.proxy, sub.subUserinfo)
      const headers = normalizeFlowHeader([String(userInfo), subInfo].filter(Boolean).join(';'), true)
      if (headers?.['subscription-userinfo']) subInfo = headers['subscription-userinfo']
    } catch (err) {
      $.error(`[sub-info] 自定义流量链接获取失败: ${err?.message || err}`)
    }
  }

  // 3) 删掉机场自带的“信息节点”（剩余/到期/重置/维护…），保留真实节点 —— 与 pure 同源
  const REGEX_INFO = /剩余|到期|套餐|流量|时间|有效|更新|官网|维护|群|发布|节点说明|失效|获取|网址|Q群|电报|Tg群|下次|关注|官方|签到|重置/i
  proxies = proxies.filter(p => !REGEX_INFO.test(p.name || ''))

  if (!subInfo) return proxies

  // 4) 解析流量
  const { expires, total, usage: { upload, download } } = parseFlowHeaders(subInfo)
  const used = upload + download
  const remaining = total - used
  const fmt = (n) => { const t = flowTransfer(Math.abs(n)); t.value = n < 0 ? '-' + t.value : t.value; return `${t.value} ${t.unit}` }
  const tag = subName ? `[${subName}] ` : ''

  // 5) 组装三条信息节点名
  const parts = []
  if (total > 0) {
    parts.push(`${tag}剩余流量：${fmt(remaining)} / ${fmt(total)}`)
  }

  let expireDays = -1
  if (expires > 0) {
    const d = new Date(expires * 1000)
    expireDays = Math.ceil((d - Date.now()) / (1000 * 3600 * 24))
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    parts.push(`${tag}套餐到期：${ds}${expireDays > 0 ? ` (余 ${expireDays} 天)` : ''}`)
  }

  let remainingDays = null
  try { remainingDays = getRmainingDays({ resetDay: args.resetDay, startDate: args.startDate, cycleDays: args.cycleDays }) } catch (e) {}
  if (remainingDays == null && !args.resetDay && !args.cycleDays) {
    const m = proxies.find(p => p.name && (String(p.name).includes('重置') || /reset/i.test(p.name)))
    if (m) {
      const dm = String(m.name).match(/(\d+)\s*(?:天|Days?)/i) || String(m.name).match(/距离重置剩余[:：]\s*(\d+)/i)
      if (dm) remainingDays = parseInt(dm[1], 10)
    }
  }
  // 与 builder 一致：到期临近（≤30 天）时不重复显示重置
  if (remainingDays != null && (expireDays === -1 || expireDays > 30)) {
    parts.push(`${tag}距离重置剩余：${remainingDays} 天`)
  }

  // 6) 一律用占位「假节点」，避免误连真节点；从后往前插入，保证顺序
  const base = { type: 'ss', server: '1.0.0.1', port: 80, cipher: 'aes-128-gcm', password: 'subinfo' }
  for (let i = parts.length - 1; i >= 0; i--) {
    proxies.unshift({ ...base, name: parts[i] })
  }
  return proxies
}