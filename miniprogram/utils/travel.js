/**
 * 交通耗时估算
 * - 两个点位之间给出 步行 / 公交地铁 / 打车 三种方式的预计时间
 * - 如果 routes.js 里已经有这两个点之间的实测交通段（高德路线规划结果），直接用实测的
 *   道路里程和分钟数，并标记 real: true，界面上显示「实测」小标签
 * - 其余情况：直线距离 × 道路绕行系数，再按各方式的速度折算（起终点都在市区，误差可以接受）
 */

const { distance, formatDistance } = require('./geo');
const { ROUTES } = require('../data/routes');
const { PLACES } = require('../data/places');

const PLACE_MAP = {};
PLACES.forEach((p) => {
  PLACE_MAP[p.id] = p;
});

/** 三种交通方式：key 存进 storage，icon 复用 assets 里已有的小圆点图标 */
const MODES = [
  { key: 'walk', name: '步行', color: '#2c6b63', icon: '/assets/marker/leg-walk.png' },
  { key: 'transit', name: '公交/地铁', color: '#3a6ea5', icon: '/assets/marker/leg-transit.png' },
  { key: 'taxi', name: '打车', color: '#8b6f47', icon: '/assets/marker/leg-taxi.png' }
];
const MODE_MAP = {};
MODES.forEach((m) => {
  MODE_MAP[m.key] = m;
});

// 直线 → 道路的绕行系数（河/铁路/单行会让实际路程比直线长）
const ROAD_FACTOR = 1.28;
// 步行 74 米/分钟：和 routes.js 里实测的步行段基本一致（1036 米 14 分钟）
const WALK_METERS_PER_MIN = 74;
// 打车 430 米/分钟 + 起步等待 1 分钟
const TAXI_METERS_PER_MIN = 430;
const TAXI_WAIT_MIN = 1;
// 公交/地铁 200 米/分钟 + 候车换乘 10 分钟
const TRANSIT_METERS_PER_MIN = 200;
const TRANSIT_WAIT_MIN = 10;

/** 两个点位的无序键：调换顺序后仍能命中同一条实测路段 */
function pairKey(a, b) {
  return [a, b].sort().join('|');
}

/** routes.js 里已有的实测交通段，做双向索引 */
const REAL_LEGS = {};
ROUTES.forEach((route) => {
  (route.legs || []).forEach((leg) => {
    const key = pairKey(leg.from, leg.to);
    if (REAL_LEGS[key]) return;
    REAL_LEGS[key] = {
      from: leg.from,
      to: leg.to,
      mode: leg.mode,
      distance: leg.distance,
      minutes: leg.minutes,
      text: leg.text,
      path: leg.path || null
    };
  });
});

/** 分钟数格式化：不足 1 小时按分钟，超过按小时 + 分钟 */
function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} 小时 ${rest} 分钟` : `${h} 小时`;
}

/** 按道路里程折算某一种方式的分钟数 */
function minutesFor(mode, meters) {
  if (mode === 'walk') return Math.max(1, Math.round(meters / WALK_METERS_PER_MIN));
  if (mode === 'taxi') return Math.max(2, Math.round(meters / TAXI_METERS_PER_MIN + TAXI_WAIT_MIN));
  return Math.max(4, Math.round(meters / TRANSIT_METERS_PER_MIN + TRANSIT_WAIT_MIN));
}

/**
 * 生成两点之间的完整交通信息
 * 返回 null 表示点位不存在或起终点相同
 */
function buildLeg(fromId, toId) {
  const a = PLACE_MAP[fromId];
  const b = PLACE_MAP[toId];
  if (!a || !b || fromId === toId) return null;

  const key = pairKey(fromId, toId);
  const real = REAL_LEGS[key] || null;
  const straight = distance(a.latitude, a.longitude, b.latitude, b.longitude);
  const meters = real && real.distance ? real.distance : Math.round(straight * ROAD_FACTOR);

  const modes = MODES.map((mode) => {
    const realThis = !!(real && real.mode === mode.key);
    const minutes = realThis && real.minutes ? real.minutes : minutesFor(mode.key, meters);
    return {
      key: mode.key,
      name: mode.name,
      color: mode.color,
      icon: mode.icon,
      minutes,
      text: `约 ${formatMinutes(minutes)}`,
      short: `${minutes} 分`,
      // 实时公交（高德）只给了其中一种方式，其余是估算；有实测就标出来
      real: realThis,
      // 很近的距离坐公交并不划算，界面上给它加个提示
      weak: mode.key === 'transit' && meters < 1000,
      distanceText: formatDistance(meters)
    };
  });

  const realMode = modes.filter((m) => m.real)[0] || null;
  const recommended = realMode
    ? realMode.key
    : meters < 1200
      ? 'walk'
      : meters < 6000
        ? 'transit'
        : 'taxi';
  const recommendedMode = modes.filter((m) => m.key === recommended)[0] || modes[0];

  return {
    key,
    fromId,
    toId,
    fromName: a.name,
    toName: b.name,
    fromEmoji: a.emoji,
    toEmoji: b.emoji,
    distance: meters,
    distanceText: formatDistance(meters),
    modes,
    // 默认推荐的方式（实测 > 距离启发式），用户在行程页可以改
    modeKey: recommendedMode.key,
    modeName: recommendedMode.name,
    modeColor: recommendedMode.color,
    modeMinutes: recommendedMode.minutes,
    // 有实测路径时用真实路径画线
    path: real && real.path ? real.path : null,
    real: !!real,
    estimated: !real
  };
}

/** 取某一段在指定方式下的信息；modeKey 非法时退回推荐方式 */
function pickMode(leg, modeKey) {
  const found = leg.modes.filter((m) => m.key === modeKey)[0];
  return found || leg.modes[0];
}

/** 折线点：有实测路径走实测，没有就两端直线（地图上会显示成一条直线） */
function legPoints(leg, fromPlace, toPlace) {
  if (leg.path && leg.path.length > 1) {
    return leg.path.map((pt) => ({ latitude: pt[1], longitude: pt[0] }));
  }
  if (!fromPlace || !toPlace) return [];
  return [
    { latitude: fromPlace.latitude, longitude: fromPlace.longitude },
    { latitude: toPlace.latitude, longitude: toPlace.longitude }
  ];
}

/** 一段的中点（用来把交通方式的小图标放在两点之间） */
function legMidpoint(leg, fromPlace, toPlace) {
  if (leg.path && leg.path.length > 2) {
    const mid = leg.path[Math.floor(leg.path.length / 2)];
    return { latitude: mid[1], longitude: mid[0] };
  }
  if (!fromPlace || !toPlace) return null;
  return {
    latitude: (fromPlace.latitude + toPlace.latitude) / 2,
    longitude: (fromPlace.longitude + toPlace.longitude) / 2
  };
}

module.exports = {
  MODES,
  MODE_MAP,
  PLACE_MAP,
  pairKey,
  buildLeg,
  pickMode,
  legPoints,
  legMidpoint,
  formatMinutes
};