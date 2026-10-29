/**
 * 我的行程（自选点位 + 排序 + 每段交通方式）
 * 存本地 storage：{ ids: [placeId...], modes: { 'a|b': 'walk'|'transit'|'taxi' }, updatedAt }
 * 这里只管数据，地图和排序界面在 pages/trip。
 */

const { PLACES } = require('../data/places');
const { pairKey, MODE_MAP } = require('./travel');

const STORAGE_KEY = 'trip_v1';
const MAX_STOPS = 20; // 地图上 num-1..num-20 的标记图；超过这个数就没法编号了

const PLACE_MAP = {};
PLACES.forEach((p) => {
  PLACE_MAP[p.id] = p;
});

function emptyTrip() {
  return { ids: [], modes: {} };
}

/** 清洗 storage 里的数据：丢掉不存在的点位、去重、限制数量、校验交通方式 key */
function normalize(raw) {
  const trip = emptyTrip();
  const src = raw || {};
  const seen = {};
  (src.ids || []).forEach((id) => {
    if (!PLACE_MAP[id] || seen[id]) return;
    if (trip.ids.length >= MAX_STOPS) return;
    seen[id] = true;
    trip.ids.push(id);
  });

  const modes = src.modes || {};
  Object.keys(modes).forEach((key) => {
    if (!MODE_MAP[modes[key]]) return;
    const ids = key.split('|');
    if (ids.length !== 2) return;
    // 只保留两个端点都还在行程里的交通方式
    if (!seen[ids[0]] || !seen[ids[1]]) return;
    trip.modes[key] = modes[key];
  });

  return trip;
}

function read() {
  if (typeof wx === 'undefined' || !wx.getStorageSync) return emptyTrip();
  try {
    return normalize(wx.getStorageSync(STORAGE_KEY));
  } catch (e) {
    return emptyTrip();
  }
}

function write(trip) {
  const next = normalize(trip);
  next.updatedAt = Date.now();
  if (typeof wx !== 'undefined' && wx.setStorageSync) {
    try {
      wx.setStorageSync(STORAGE_KEY, next);
    } catch (e) {
      // 存储满了也不该让页面崩掉，静默降级成"这次有效"
    }
  }
  return next;
}

function getTrip() {
  return read();
}

function count() {
  return read().ids.length;
}

function has(id) {
  return read().ids.indexOf(id) >= 0;
}

/** 行程里所有点位（按顺序返回原始 place 对象） */
function places() {
  return read()
    .ids.map((id) => PLACE_MAP[id])
    .filter(Boolean);
}

function add(id) {
  const trip = read();
  if (!PLACE_MAP[id]) return { trip, added: false, reason: 'unknown' };
  if (trip.ids.indexOf(id) >= 0) return { trip, added: false, reason: 'exists' };
  if (trip.ids.length >= MAX_STOPS) return { trip, added: false, reason: 'full' };
  trip.ids.push(id);
  return { trip: write(trip), added: true, reason: '' };
}

function remove(id) {
  const trip = read();
  const index = trip.ids.indexOf(id);
  if (index < 0) return { trip, removed: false };
  trip.ids.splice(index, 1);
  return { trip: write(trip), removed: true };
}

function toggle(id) {
  const trip = read();
  if (trip.ids.indexOf(id) >= 0) return remove(id);
  return add(id);
}

/** 把点位挪到新位置（toIndex 是移动后的下标，允许越界由这里夹紧） */
function move(id, toIndex) {
  const trip = read();
  const from = trip.ids.indexOf(id);
  if (from < 0) return trip;
  let to = Number(toIndex);
  if (isNaN(to)) return trip;
  to = Math.max(0, Math.min(trip.ids.length - 1, to));
  if (to === from) return trip;
  trip.ids.splice(from, 1);
  trip.ids.splice(to, 0, id);
  return write(trip);
}

/** 记录某两个点之间选择哪种交通方式 */
function setMode(a, b, mode) {
  const trip = read();
  if (!MODE_MAP[mode]) return trip;
  if (trip.ids.indexOf(a) < 0 || trip.ids.indexOf(b) < 0) return trip;
  trip.modes[pairKey(a, b)] = mode;
  return write(trip);
}

function modeOf(trip, a, b, fallback) {
  const saved = (trip.modes || {})[pairKey(a, b)];
  return MODE_MAP[saved] ? saved : fallback;
}

function clear() {
  return write(emptyTrip());
}

module.exports = {
  STORAGE_KEY,
  MAX_STOPS,
  getTrip,
  count,
  has,
  places,
  add,
  remove,
  toggle,
  move,
  setMode,
  modeOf,
  clear,
  normalize
};