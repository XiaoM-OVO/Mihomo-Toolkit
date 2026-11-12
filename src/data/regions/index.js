/**
 * -----------------------------------------------------------------------------
 * Data: 地区与大洲静态基线汇总 (Regions Baseline Index)
 * -----------------------------------------------------------------------------
 * data 层只读事实；运行时增强与投影由 core/shared/regions.js 负责。
 */

'use strict';

const { CONTINENT_DEFS, SUB_REGION_DEFS } = require('./continents');
const eastAsia = require('./zones/east-asia');
const southeastAsia = require('./zones/southeast-asia');
const southAsia = require('./zones/south-asia');
const americas = require('./zones/americas');
const europe = require('./zones/europe');
const middleEast = require('./zones/middle-east');
const africa = require('./zones/africa');
const oceania = require('./zones/oceania');

// 顺序决定排序优先级与节点桶名 (全量标准化规范契约，严格保持基线顺序)
const REGION_DEFS_RAW = [
  // 1. 大中华与东亚核心区
  eastAsia.cn,
  eastAsia.hk,
  eastAsia.mo,
  eastAsia.tw,
  eastAsia.jp,
  eastAsia.kr,

  // 2. 亚太/北美核心枢纽
  southeastAsia.sg,
  americas.us,

  // 3. 欧洲大区
  europe.uk,
  europe.de,
  europe.fr,
  europe.ru,
  europe.ua,
  europe.es,
  europe.nl,
  europe.ch,
  europe.it,
  europe.se,
  europe.ie,
  europe.pl,
  europe.fi,
  europe.is,
  europe.at,
  europe.cz,
  europe.hu,
  europe.gr,
  europe.pt,
  europe.no,
  europe.bg,
  europe.ro,
  europe.lv,
  europe.lt,
  europe.ee,
  europe.md,
  europe.cy,
  europe.ba,
  europe.mc,
  europe.va,
  europe.be,

  // 4. 南亚与东南亚扩展
  southAsia.in,
  southeastAsia.my,
  southeastAsia.th,
  southeastAsia.id,
  southeastAsia.ph,
  southeastAsia.vn,
  southeastAsia.la,

  // 5. 美洲扩展
  americas.ca,
  americas.ar,
  americas.br,
  americas.mx,
  americas.cl,
  americas.bz,
  americas.vg,

  // 6. 中东大区
  middleEast.ae,
  middleEast.tr,
  middleEast.sa,
  middleEast.il,
  middleEast.iq,
  middleEast.ir,
  middleEast.qa,
  middleEast.kz,
  middleEast.uz,

  // 7. 非洲大区
  africa.za,
  africa.ng,
  africa.eg,
  africa.sc,
  africa.ne,
  africa.ly,

  // 8. 大洋洲大区
  oceania.au
];

const REGIONS_BY_ID = Object.freeze({
  ...eastAsia,
  ...southeastAsia,
  ...southAsia,
  ...americas,
  ...europe,
  ...middleEast,
  ...africa,
  ...oceania
});

const REGION_ZONES = Object.freeze({
  eastAsia,
  southeastAsia,
  southAsia,
  americas,
  europe,
  middleEast,
  africa,
  oceania
});

module.exports = {
  CONTINENT_DEFS,
  SUB_REGION_DEFS,
  REGION_DEFS_RAW,
  REGIONS_BY_ID,
  REGION_ZONES
};
