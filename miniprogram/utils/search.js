/**
 * 点位搜索
 * 关键词同时匹配：名称 > 标签 > 城市 / 分类 / 地址 / 简介。
 * 纯数据模块，不依赖 wx，方便在 node 里跑测试。
 */

const { PLACES, CATEGORY_MAP } = require('../data/places');
const { CITY_MAP } = require('../data/cities');

// 启动时把点位整理成可搜索的索引，避免每次输入都拼字符串
const INDEX = PLACES.map((p) => {
  const city = CITY_MAP[p.city] || {};
  const category = CATEGORY_MAP[p.category] || {};
  const tags = (p.tags || []).join(' ');
  return {
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    city: p.city,
    cityName: city.name || '',
    category: p.category,
    categoryName: category.name || '',
    durationMin: p.durationMin || 60,
    // 介绍卡片要用的字段（点开结果时直接拿，不用再回查 PLACES）
    summary: p.summary || '',
    intro: p.intro || '',
    openTime: p.openTime || '',
    address: p.address || '',
    tags: Array.isArray(p.tags) ? p.tags.slice() : [],
    nameText: String(p.name || '').toLowerCase(),
    tagText: tags.toLowerCase(),
    restText: [city.name, category.name, p.address, tags, p.summary, p.id]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  };
});

/** 命中权重：名称完全相同 > 名称开头 > 名称包含 > 标签 > 其它字段 */
function scoreOf(entry, keyword) {
  if (entry.nameText === keyword) return 100;
  if (entry.nameText.indexOf(keyword) === 0) return 80;
  if (entry.nameText.indexOf(keyword) >= 0) return 60;
  if (entry.tagText.indexOf(keyword) >= 0) return 40;
  if (entry.restText.indexOf(keyword) >= 0) return 20;
  return 0;
}

/**
 * 搜索点位
 * @param {string} keyword 关键词（中文/拼音 id 均可，忽略大小写与首尾空格）
 * @param {number} [limit=20] 最多返回几条
 * @returns {Array<{id,name,emoji,city,cityName,category,categoryName,durationMin,summary,intro,openTime,address,tags}>}
 */
function search(keyword, limit) {
  const key = String(keyword == null ? '' : keyword).trim().toLowerCase();
  if (!key) return [];

  const max = limit > 0 ? limit : 20;
  const hits = [];
  INDEX.forEach((entry) => {
    const score = scoreOf(entry, key);
    if (score) hits.push({ entry, score });
  });

  hits.sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length);
  return hits.slice(0, max).map((hit) => {
    const { entry } = hit;
    return {
      id: entry.id,
      name: entry.name,
      emoji: entry.emoji,
      city: entry.city,
      cityName: entry.cityName,
      category: entry.category,
      categoryName: entry.categoryName,
      durationMin: entry.durationMin,
      summary: entry.summary,
      intro: entry.intro,
      openTime: entry.openTime,
      address: entry.address,
      tags: entry.tags
    };
  });
}

module.exports = { search };