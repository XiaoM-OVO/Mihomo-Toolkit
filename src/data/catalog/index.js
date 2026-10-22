/**
 * -----------------------------------------------------------------------------
 * Data: 编目静态基线汇总 (Catalog Baseline Index)
 * -----------------------------------------------------------------------------
 * data 层只读事实；运行期投影由 config/catalog.js 负责。
 */

'use strict';

const DEFAULT_REPOS = require('./repos').DEFAULT_REPOS;
const { DEFAULT_AGGREGATES, CATEGORY_DEFAULTS } = require('./defaults');
const { SPECIAL_SERVICES, ADS_GROUPS, DOWNLOAD_GROUPS, SKELETON_GROUP_DEFS } = require('./groups');

const BUILTIN_SERVICES = {
  ...require('./services/ai'),
  ...require('./services/streaming'),
  ...require('./services/social'),
  ...require('./services/game'),
  ...require('./services/dev'),
  ...require('./services/system')
};

module.exports = {
  DEFAULT_REPOS,
  DEFAULT_AGGREGATES,
  CATEGORY_DEFAULTS,
  SPECIAL_SERVICES,
  ADS_GROUPS,
  DOWNLOAD_GROUPS,
  SKELETON_GROUP_DEFS,
  BUILTIN_SERVICES
};
