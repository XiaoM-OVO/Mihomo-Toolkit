/**
 * -----------------------------------------------------------------------------
 * Mihomo-Toolkit: 构建结果内存 LRU-TTL 缓存管理器
 * -----------------------------------------------------------------------------
 * 职责：
 * 1. 提供常驻模式 (server) 下的内存级 profile 构建缓存
 * 2. 具备严格的容量上限 (MAX_ENTRIES) 与 LRU 淘汰策略，杜绝内存泄漏
 * 3. 具备 Fresh / Stale / Miss 三态查询与安全边界判断
 * 4. 具备严格单调递增代际序列号 (Generation ID)，防止并发异步构建写入倒挂
 * 5. 纯净解耦：结果数据与缓存元数据分离，不破坏产物对象
 */

'use strict';

const { GenerationSource, isSuperseded } = require('./generation');

/**
 * 安全解析正整数或零的持续时间参数（秒）
 * 严格防御 JavaScript 隐式类型转换陷阱（如 null ➔ 0, '' ➔ 0, false ➔ 0, true ➔ 1）
 * @param {any} val 输入配置值
 * @param {number} fallback 兜底默认值
 * @param {boolean} [allowZero=false] 是否允许零值
 * @returns {number} 解析后的有效秒数
 */
function parseSafeDurationSec(val, fallback, allowZero = false) {
  // 排除 null、undefined、布尔值、对象、Symbol 等非数字/字符串输入
  if (val === null || val === undefined || typeof val === 'boolean' || typeof val === 'object') {
    return fallback;
  }
  // 字符串必须去空格后非空
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return fallback;
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return fallback;
    if (num === 0) return allowZero ? 0 : fallback;
    if (num < 0) return fallback;
    return num;
  }
  // 纯数值类型
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return fallback;
    if (val === 0) return allowZero ? 0 : fallback;
    if (val < 0) return fallback;
    return val;
  }
  return fallback;
}

/**
 * 归一化缓存时间参数
 * @param {object} config
 * @returns {{ freshTtlMs: number, staleMaxAgeMs: number }}
 */
function normalizeCacheDurations(config = {}) {
  // freshTtl: 默认 300s，允许明确配置的 0
  const freshTtlSec = parseSafeDurationSec(config.cacheTtl, 300, true);
  // staleMaxAge: 默认 86400s (24h)，必须为正数（不允许 0）
  let staleMaxAgeSec = parseSafeDurationSec(config.cacheStaleMaxAge, 86400, false);

  // 约束：最大总年龄不得低于新鲜期
  if (staleMaxAgeSec < freshTtlSec) {
    staleMaxAgeSec = freshTtlSec;
  }

  return {
    freshTtlMs: freshTtlSec * 1000,
    staleMaxAgeMs: staleMaxAgeSec * 1000
  };
}

class ProfileCache {
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || 100;
    this.cacheMap = new Map();
    // 共享单调递增代际序号源（超限抛错，杜绝回绕重号）
    this._generation = new GenerationSource('ProfileCache');
    // SWR 命中率观测计数（进程生命周期内累计，供 /healthz 监控端点消费）
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * 生成全局严格单调递增的构建任务代际标识
   * @returns {number}
   */
  nextGeneration() {
    return this._generation.next();
  }

  /**
   * 获取缓存条目（旧 API 兼容层：只传数字 ttlMs 时维持传统硬过期行为）
   * @param {string} key
   * @param {number} ttlMs
   * @returns {{ result: any, remainingSec: number } | null}
   */
  get(key, ttlMs) {
    if (!key || !this.cacheMap.has(key)) return null;
    const entry = this.cacheMap.get(key);
    const now = Date.now();

    // 旧 API 行为：超过 ttlMs 直接物理删除并返回 null
    if (now - entry.timestamp > ttlMs) {
      this.cacheMap.delete(key);
      return null;
    }

    // 刷新访问顺序 (LRU: 先删后插移动到 Map 末尾)
    this.cacheMap.delete(key);
    this.cacheMap.set(key, entry);

    const remainingSec = Math.round((ttlMs - (now - entry.timestamp)) / 1000);
    return {
      result: entry.result,
      remainingSec
    };
  }

  /**
   * SWR 三态查询方法
   * @param {string} key
   * @param {object} durations
   * @param {number} durations.freshTtlMs 新鲜期 (毫秒)
   * @param {number} durations.staleMaxAgeMs 最大可用总寿命 (毫秒)
   * @returns {{ status: 'fresh' | 'stale' | 'miss', result: any, remainingSec: number, entryCreatedAt: number, generation: number }}
   */
  getWithStatus(key, durations = {}) {
    if (!key || !this.cacheMap.has(key)) {
      this._misses++;
      return { status: 'miss', result: null, remainingSec: 0, entryCreatedAt: 0, generation: 0 };
    }

    const entry = this.cacheMap.get(key);
    const now = Date.now();
    const totalAgeMs = now - entry.timestamp;
    const { freshTtlMs = 300000, staleMaxAgeMs = 86400000 } = durations;

    // 1. 超过最大总年龄：进入淘汰/不可用区间 (Miss)
    if (totalAgeMs > staleMaxAgeMs) {
      this._misses++;
      return { status: 'miss', result: null, remainingSec: 0, entryCreatedAt: entry.timestamp, generation: entry.generation };
    }

    this._hits++;

    // 刷新访问顺序 (LRU: 先删后插移动到 Map 末尾)
    this.cacheMap.delete(key);
    this.cacheMap.set(key, entry);

    // 2. 状态判定：
    // 当 freshTtlMs === 0 时，立即进入 Stale
    // 否则在 totalAgeMs <= freshTtlMs 区间内为 Fresh
    if (freshTtlMs > 0 && totalAgeMs <= freshTtlMs) {
      const remainingSec = Math.max(0, Math.round((freshTtlMs - totalAgeMs) / 1000));
      return {
        status: 'fresh',
        result: entry.result,
        remainingSec,
        entryCreatedAt: entry.timestamp,
        generation: entry.generation
      };
    }

    // 3. 超过新鲜期但在最大总年龄内：Stale
    const remainingSec = Math.max(0, Math.round((staleMaxAgeMs - totalAgeMs) / 1000));
    return {
      status: 'stale',
      result: entry.result,
      remainingSec,
      entryCreatedAt: entry.timestamp,
      generation: entry.generation
    };
  }

  /**
   * 写入缓存
   * @param {string} key 缓存键
   * @param {any} result 纯净构建结果
   * @param {object} [meta={}]
   * @param {number} [meta.generation=0] 构建任务启动时持有的代际 ID，用于防老覆盖新
   * @returns {boolean} 是否实际写入成功
   */
  set(key, result, meta = {}) {
    if (!key) return false;

    const taskGeneration = meta.generation || 0;
    const existing = this.cacheMap.get(key);

    // 时序代际防护：若已有条目的代际号大于本次任务代际号，说明已被更新的任务覆写，忽略本次落后写入
    if (existing && isSuperseded(existing.generation, taskGeneration)) {
      return false;
    }

    const isUpdate = this.cacheMap.has(key);

    // 修复问题 1：如果是更新已存在的键，先物理删除旧键，确保重新 set 时被移至 Map 末尾（刷新 LRU）
    if (isUpdate) {
      this.cacheMap.delete(key);
    } else if (this.cacheMap.size >= this.maxEntries) {
      // 若是全新条目且已达容量上限，淘汰 Map 最前端最老条目
      const oldestKey = this.cacheMap.keys().next().value;
      this.cacheMap.delete(oldestKey);
    }

    this.cacheMap.set(key, {
      timestamp: Date.now(),
      generation: taskGeneration || this.nextGeneration(),
      result
    });

    return true;
  }

  has(key) {
    return this.cacheMap.has(key);
  }

  /**
   * 安全淘汰指定键：支持代际守护
   * - 若未提供有效 maxGeneration，执行无条件物理删除；
   * - 若提供 maxGeneration，仅允许删除代际号 <= maxGeneration 的条目（包括代次相等的边界）；
   * - 若现有条目代际号严格大于 maxGeneration (existing.generation > maxGeneration)，说明已被更新的任务覆写，拒绝误删并返回 false。
   * @param {string} key
   * @param {number} [maxGeneration] 允许删除的最大代际号（闭区间上限）。若缓存中条目 generation > maxGeneration，则拒绝删除并保留
   * @returns {boolean} 是否实际执行了删除
   */
  delete(key, maxGeneration) {
    if (!key || !this.cacheMap.has(key)) return false;
    if (typeof maxGeneration === 'number' && maxGeneration > 0) {
      const existing = this.cacheMap.get(key);
      if (isSuperseded(existing && existing.generation, maxGeneration)) {
        return false;
      }
    }
    return this.cacheMap.delete(key);
  }

  clear() {
    this.cacheMap.clear();
  }

  /**
   * 导出 SWR 缓存运行指标（进程生命周期累计），供 /healthz 监控消费
   * @returns {{ hits: number, misses: number, lookups: number, hitRate: number, size: number, maxEntries: number }}
   */
  getStats() {
    const lookups = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      lookups,
      hitRate: lookups > 0 ? Number((this._hits / lookups).toFixed(4)) : 0,
      size: this.cacheMap.size,
      maxEntries: this.maxEntries
    };
  }

  get size() {
    return this.cacheMap.size;
  }
}

const profileCache = new ProfileCache({ maxEntries: 100 });

module.exports = {
  ProfileCache,
  profileCache,
  normalizeCacheDurations
};
