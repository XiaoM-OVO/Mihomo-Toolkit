/**
 * -----------------------------------------------------------------------------
 * Config Layer: 外挂配置文件装载 (Config Mounts)
 * -----------------------------------------------------------------------------
 * 集中处理「配置文件里引用另一个文件」这一件事，职责有四：
 *   1. **路径解析**：相对路径一律相对**配置文件所在目录**，而不是 `process.cwd()`
 *      （否则换个工作目录启动即静默失效：systemd / 定时任务 / 从别的目录跑 CLI）。
 *      SDK 调用方直接传对象、没有配置文件上下文时，以 cwd 为基准（唯一可能的选择）。
 *   2. **装载**：支持 .yaml/.yml/.json/.js/.cjs，失败即**显式报错**（fail-closed），
 *      不再返回 `{}` 让用户的配置无声消失
 *   3. **热更新**：`.js` 装载前清理 require 缓存，避免长驻服务永远读不到改动
 *   4. **内容摘要**：为构建缓存键提供挂载文件的内容指纹
 *      （旧实现只把路径字符串放进缓存键，改了文件在 TTL 内不生效）
 *
 * 新增挂载机制时，只需把字段名登记进 `MOUNT_PATH_KEYS`，上述四项会自动覆盖它。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('yaml');

/** 路径型外挂配置字段（值 = 文件路径）。新增 include 机制时在此登记。 */
const MOUNT_PATH_KEYS = ['servicesConfigFile'];

/** 受支持的挂载文件扩展名 */
const SUPPORTED_EXTS = ['.yaml', '.yml', '.json', '.js', '.cjs'];

/**
 * 把外挂配置里的相对路径解析为绝对路径。
 * @param {unknown} value 配置里的路径字符串
 * @param {string} [baseDir] 基准目录（应为配置文件所在目录）
 * @returns {string|null} 绝对路径；空值返回 null
 */
function resolveMountPath(value, baseDir) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir || process.cwd(), trimmed);
}

/**
 * 把配置对象里的挂载路径就地转为绝对路径。
 *
 * 在**读取配置文件的现场**调用（CLI `-c` / server 的 CONFIG_PATH）：
 * 那里是唯一确定「配置文件的目录」的地方，转换一次之后，
 * 下游任何工作目录都不会再影响解析结果。
 *
 * @param {object} userConfig
 * @param {string} baseDir 配置文件所在目录
 * @returns {object} 转换后的新对象（无变化时返回原对象）
 */
function absolutizeMountPaths(userConfig, baseDir) {
  if (!userConfig || typeof userConfig !== 'object' || !baseDir) return userConfig;
  let changed = false;
  const out = { ...userConfig };
  for (const key of MOUNT_PATH_KEYS) {
    const abs = resolveMountPath(out[key], baseDir);
    if (abs && abs !== out[key]) {
      out[key] = abs;
      changed = true;
    }
  }
  return changed ? out : userConfig;
}

/**
 * 读取并解析一个外挂配置文件。
 *
 * 与旧实现的关键差异：**失败不再静默**。文件不存在、扩展名不支持、解析异常
 * 都会抛出带明确路径的错误——用户显式引用的文件读不到属于配置错误，
 * 悄悄退化成「没有自定义服务」比报错危险得多。
 *
 * @param {string} fullPath 绝对路径
 * @returns {object} 解析结果
 * @throws {Error} 文件缺失 / 扩展名不支持 / 解析失败
 */
function readMountFile(fullPath) {
  const ext = path.extname(fullPath).toLowerCase();
  if (!SUPPORTED_EXTS.includes(ext)) {
    throw new Error(
      `Unsupported config mount format "${ext || '(none)'}": ${fullPath} ` +
      `(supported: ${SUPPORTED_EXTS.join(' / ')})`
    );
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Config mount not found: ${fullPath}`);
  }

  try {
    if (ext === '.js' || ext === '.cjs') {
      // 清理 require 缓存：长驻服务下 .js 挂载文件的改动必须能被读到
      try {
        delete require.cache[require.resolve(fullPath)];
      } catch (e) { /* 未解析过则无需清理 */ }
      const loaded = require(fullPath);
      return typeof loaded === 'function' ? (loaded() || {}) : (loaded || {});
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    if (ext === '.json') return JSON.parse(content) || {};
    return yaml.parse(content) || {};
  } catch (err) {
    throw new Error(`Failed to load config mount ${fullPath}: ${err.message}`);
  }
}

/**
 * 计算所有挂载源的内容指纹，供构建缓存键使用。
 *
 * 覆盖「路径 + 是否存在 + 内容」三者：只放路径字符串会让改动挂载文件在
 * `cacheTtl` 内不生效；带上内容后，改文件即刻产生新键。
 *
 * @param {object} userConfig
 * @param {string} [baseDir] 基准目录（默认 cwd；配置文件现场已转绝对路径时不需要）
 * @returns {string} 稳定摘要；无挂载源时返回空串
 */
function computeMountDigest(userConfig, baseDir) {
  if (!userConfig || typeof userConfig !== 'object') return '';
  const entries = [];
  for (const key of MOUNT_PATH_KEYS) {
    const fullPath = resolveMountPath(userConfig[key], baseDir);
    if (!fullPath) continue;
    let fingerprint = 'missing';
    try {
      if (fs.existsSync(fullPath)) {
        fingerprint = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
      }
    } catch (err) {
      fingerprint = `unreadable:${err.code || 'error'}`;
    }
    entries.push(`${key}:${fullPath}:${fingerprint}`);
  }
  if (entries.length === 0) return '';
  return crypto.createHash('sha256').update(entries.join('\n')).digest('hex');
}

module.exports = {
  MOUNT_PATH_KEYS,
  SUPPORTED_EXTS,
  resolveMountPath,
  absolutizeMountPaths,
  readMountFile,
  computeMountDigest
};
