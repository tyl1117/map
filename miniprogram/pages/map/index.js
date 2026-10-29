const app = getApp();
const { CATEGORIES, PLACES, CATEGORY_MAP, CATEGORY_RADIUS } = require('../../data/places');
const { CITIES, CITY_MAP } = require('../../data/cities');
const { HEROES } = require('../../data/photos');
const { distance, formatDistance } = require('../../utils/geo');
const { getTrip, toggle: toggleTrip, MAX_STOPS } = require('../../utils/trip');

const MARKER_SIZE = { width: 30, height: 38 };
const DEFAULT_CITY = 'xiangtan';
const DEFAULT_RADIUS = 500;
const BUBBLE_MIN_SCALE = 13.5; // 小于这个缩放不显示图片气泡
const BUBBLE_MIN_GAP_PX = 128; // 两个点离得太近（屏幕像素）就不放气泡
const KEY_OF = (id) => 'checkin_' + id;

Page({
  data: {
    statusBarHeight: 20,
    cities: [],
    activeCity: DEFAULT_CITY,
    cityName: '湘潭',
    center: { latitude: 27.847, longitude: 112.9415 },
    scale: 12.5,
    categories: CATEGORIES,
    activeCategory: '',
    activeName: '全部',
    markerCount: 0,
    markers: [],
    bubbles: [],
    places: [],
    current: null,
    showCityPicker: false,
    empty: false,
    // 我的行程：已选点位数量（角标和入口按钮用）
    tripCount: 0,
    // 搜索浮层
    showSearch: false,
    // 底部详情面板（可上滑展开，小红书那种）
    sheetH: 0,
    sheetY: 0,
    dragging: false,
    expanded: false
  },

  onLoad(options) {
    const cities = CITIES.map((c) => ({
      ...c,
      count: PLACES.filter((p) => p.city === c.id).length
    }));

    // 详情面板的几何：收起时露出 300rpx，展开后距顶部 56px
    const sys = wx.getSystemInfoSync();
    this.winH = sys.windowHeight;
    this.rpx = sys.windowWidth / 750;
    // 展开后顶部留出状态栏 + 胶囊按钮的高度；面板本身高度 = 屏幕高 - 顶部间隙
    const topGap = (app.globalData.statusBarHeight || 20) + 48;
    this.topGap = topGap;
    this.expandedY = 0;
    this.sheetH = this.winH - topGap;
    this.collapsedY = this.sheetH - 320 * this.rpx;
    this.closedY = this.sheetH;

    this.viewScale = CITY_MAP[DEFAULT_CITY].scale;
    this.viewCenter = { ...CITY_MAP[DEFAULT_CITY].center };

    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      cities,
      sheetH: this.sheetH,
      sheetY: this.closedY
    });

    const cityId = options && CITY_MAP[options.city] ? options.city : DEFAULT_CITY;
    this.switchCity(cityId);
    setTimeout(() => this.syncView(true), 900);

    // ?focus=<id> 直接打开某个点位的卡片（分享 / 路线跳转用）
    if (options && options.focus) {
      const place = PLACES.find((p) => p.id === options.focus);
      if (place) {
        if (place.city !== this.data.activeCity) this.switchCity(place.city);
        this.openPlace(this.visiblePlaces.findIndex((p) => p.id === place.id));
        this.setData({ center: { latitude: place.latitude, longitude: place.longitude } });
      }
    }
  },

  /** 每次回到地图都同步一次行程状态（可能在详情页加过点位） */
  onShow() {
    this.refreshTrip();
  },

  /** 把「是否已加入行程 / 第几站」挂到点位对象上，列表和卡片共用 */
  withTripFlags(list) {
    const t = getTrip();
    return (list || []).map((p) => {
      const no = t.ids.indexOf(p.id);
      return no >= 0
        ? { ...p, inTrip: true, tripNo: no + 1 }
        : { ...p, inTrip: false, tripNo: 0 };
    });
  },

  /** 行程数量、底部列表角标、当前卡片按钮一起刷新 */
  refreshTrip() {
    const t = getTrip();
    const data = { tripCount: t.ids.length };
    if (this.data.places.length) {
      data.places = this.withTripFlags(this.data.places);
    }
    const current = this.data.current;
    if (current) {
      const no = t.ids.indexOf(current.id);
      data.current = no >= 0
        ? { ...current, inTrip: true, tripNo: no + 1 }
        : { ...current, inTrip: false, tripNo: 0 };
    }
    this.setData(data);
  },

  /** 底部列表 / 卡片上的「＋」：加入或移出行程 */
  onToggleTrip(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const id = ds.id;
    if (!id) return;
    const r = toggleTrip(id);
    if (r.reason === 'full') {
      wx.showToast({ title: `行程最多 ${MAX_STOPS} 个点位`, icon: 'none' });
      return;
    }
    this.refreshTrip();
    wx.showToast({ title: r.added ? '已加入行程' : '已移出行程', icon: 'none' });
  },

  /** 打开排序 / 行程地图页 */
  onGoTrip() {
    if (!this.data.tripCount) {
      wx.showToast({ title: '先点「＋」挑几个点位', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/trip/index' });
  },

  // ---------- 搜索点位：搜到就能直接加进行程 ----------
  openSearch() {
    this.setData(
      {
        showSearch: true,
        showCityPicker: false,
        current: null,
        expanded: false,
        sheetY: this.closedY
      },
      () => {
        this.lastBubbleKey = '';
        this.applyBubbles();
      }
    );
  },

  closeSearch() {
    this.setData({ showSearch: false });
  },

  /** 搜索结果里加了 / 移了点位，地图上的「＋」和左下角数量跟着变 */
  onSearchChange() {
    this.refreshTrip();
  },

  onSearchFocus() {},

  /** 当前城市的所有点位 */
  cityPlaces() {
    return PLACES.filter((p) => p.city === this.data.activeCity);
  },

  /** 切城市：换中心点、缩放、清空分类和卡片 */
  switchCity(cityId) {
    const city = CITY_MAP[cityId];
    if (!city) return;
    this.setData({
      activeCity: cityId,
      cityName: city.name,
      center: { ...city.center },
      scale: city.scale,
      activeCategory: '',
      activeName: '全部',
      showCityPicker: false,
      current: null,
      expanded: false,
      sheetY: this.closedY
    });
    const list = this.cityPlaces();
    this.visiblePlaces = list;
    this.renderMarkers('');
  },

  /** 按分类生成 marker（数据量小，直接全量重算） */
  renderMarkers(categoryKey) {
    const base = this.cityPlaces();
    const list = categoryKey ? base.filter((p) => p.category === categoryKey) : base;

    const markers = list.map((p, index) => ({
      id: index,
      latitude: p.latitude,
      longitude: p.longitude,
      // 彩色 pin 保持一致：远看也能靠颜色区分类型
      iconPath: `/assets/marker/${p.category}.png`,
      width: MARKER_SIZE.width,
      height: MARKER_SIZE.height,
      anchor: { x: 0.5, y: 1 },
      callout: {
        content: p.name,
        color: '#1d1c19',
        fontSize: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5ddce',
        bgColor: '#fffdf8',
        padding: 6,
        display: 'BYCLICK',
        textAlign: 'center'
      }
    }));

    this.visiblePlaces = list;
    this.baseMarkers = markers;
    this.lastBubbleKey = '';
    this.setData({
      markers,
      places: this.withTripFlags(list),
      activeCategory: categoryKey,
      activeName: categoryKey ? CATEGORY_MAP[categoryKey].name : '全部',
      markerCount: list.length,
      current: null,
      empty: list.length === 0
    });

    this.applyBubbles();
    this.applyView(categoryKey, list);
    setTimeout(() => this.syncView(true), 700);
  },

  /** 全部：回到城市默认视野；分类：自动框住该分类的点 */
  applyView(categoryKey, list) {
    if (!categoryKey || list.length === 0) {
      const city = CITY_MAP[this.data.activeCity];
      this.setData({ center: { ...city.center }, scale: city.scale });
      return;
    }

    if (list.length === 1) {
      this.setData({
        center: { latitude: list[0].latitude, longitude: list[0].longitude },
        scale: 15
      });
      return;
    }

    this.mapCtx = this.mapCtx || wx.createMapContext('map', this);
    this.mapCtx.includePoints({
      points: list.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
      padding: [150, 70, 320, 70]
    });
  },

  /** 城市切换面板 */
  toggleCityPicker() {
    const open = !this.data.showCityPicker;
    // 打开城市面板时先收起点位卡片，避免两层弹层叠在一起
    this.setData({ showCityPicker: open, current: open ? null : this.data.current });
  },

  onCityTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.activeCity) {
      this.setData({ showCityPicker: false });
      return;
    }
    this.switchCity(id);
  },

  onSwitchToXiangtan() {
    this.switchCity('xiangtan');
  },

  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key || '';
    if (key === this.data.activeCategory) return;
    this.renderMarkers(key);
  },

  onMarkerTap(e) {
    this.openPlace(e.detail.markerId);
  },

  /** 点图片气泡：和点图钉一样拉起面板 */
  onBubbleTap(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const mid = ds.mid;
    if (mid === undefined || mid === null || mid === '') return;
    this.openPlace(Number(mid));
  },

  /** 点原生 callout 也算点这个点 */
  onCalloutTap(e) {
    const d = e.detail || {};
    if (d.markerId === undefined || d.markerId === null) return;
    this.openPlace(d.markerId);
  },

  /** 底部列表点一下 = 选中该点位（列表是主要入口，比点小图钉好点） */
  onStripTap(e) {
    this.openPlace(Number(e.currentTarget.dataset.index));
  },

  /** 打开某个点位的卡片：只改卡片，不动地图 */
  openPlace(index) {
    const place = this.visiblePlaces && this.visiblePlaces[index];
    if (!place) return;
    const category = CATEGORY_MAP[place.category];
    const tripNo = getTrip().ids.indexOf(place.id) + 1;
    this.lastMarkerTapAt = Date.now();
    this.setData({
      // 卡片和城市面板互斥，避免两层弹层叠住
      showCityPicker: false,
      expanded: false,
      sheetY: this.collapsedY,
      current: {
        ...place,
        color: category.color,
        categoryName: category.name,
        radiusText: formatDistance(place.radius || CATEGORY_RADIUS[place.category] || DEFAULT_RADIUS),
        distanceText: this.cachedLocation ? this.distanceLine(place) : '定位中…',
        canCheckin: false,
        checkedAt: this.readCheckedAt(place.id),
        inTrip: tripNo > 0,
        tripNo: tripNo > 0 ? tripNo : 0
      }
    });
    this.locateForPlace(place);
  },

  /** 读本地打卡记录，返回格式化时间；没打过返回空串 */
  readCheckedAt(id) {
    const rec = wx.getStorageSync(KEY_OF(id));
    if (!rec) return '';
    return this.formatTime(typeof rec === 'number' ? rec : rec.at);
  },

  formatTime(ts) {
    const d = new Date(ts);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  /** 距目标多远的那一行文案 */
  distanceLine(place) {
    if (!this.cachedLocation) return '定位中…';
    const meters = distance(
      this.cachedLocation.latitude,
      this.cachedLocation.longitude,
      place.latitude,
      place.longitude
    );
    const radius = place.radius || CATEGORY_RADIUS[place.category] || DEFAULT_RADIUS;
    return meters <= radius
      ? `${formatDistance(meters)} · 在打卡范围内`
      : `${formatDistance(meters)} · 超出 ${formatDistance(radius)} 范围`;
  },

  /** 给当前卡片定位一次（有缓存就不重复拿） */
  locateForPlace(place) {
    const apply = (loc) => {
      this.cachedLocation = loc;
      const meters = distance(loc.latitude, loc.longitude, place.latitude, place.longitude);
      const radius = place.radius || CATEGORY_RADIUS[place.category] || DEFAULT_RADIUS;
      const current = this.data.current;
      if (!current || current.id !== place.id) return;
      this.setData({
        current: {
          ...current,
          distanceText: meters <= radius
            ? `${formatDistance(meters)} · 在打卡范围内`
            : `${formatDistance(meters)} · 超出 ${formatDistance(radius)} 范围`,
          canCheckin: meters <= radius
        }
      });
    };

    if (this.cachedLocation) {
      apply(this.cachedLocation);
      return;
    }
    wx.getLocation({
      type: 'gcj02',
      success: (res) => apply({ latitude: res.latitude, longitude: res.longitude }),
      fail: () => {
        this.cachedLocation = null;
        const current = this.data.current;
        if (current && current.id === place.id) {
          this.setData({ current: { ...current, distanceText: '定位没打开', canCheckin: false } });
        }
      }
    });
  },

  /** 上滑/下滑手势：拖动详情面板 */
  onSheetTouchStart(e) {
    const y = e.touches[0].clientY;
    // 展开状态下，只有从顶部「把手/标题」区域按下才拖动，正文留给滚动
    const inHead = y < this.topGap + 170;
    if (this.data.expanded && !inHead) {
      this.dragStartY = 0;
      return;
    }
    this.dragStartY = y;
    this.dragStartOffset = this.data.sheetY;
    this.dragMoved = 0;
    this.setData({ dragging: true });
  },

  onSheetTouchMove(e) {
    if (!this.dragStartY) return;
    const dy = e.touches[0].clientY - this.dragStartY;
    this.dragMoved = dy;
    const y = Math.max(this.expandedY, Math.min(this.collapsedY, this.dragStartOffset + dy));
    this.setData({ sheetY: y });
  },

  onSheetTouchEnd() {
    if (!this.dragStartY) return;
    const y = this.data.sheetY;
    const mid = (this.expandedY + this.collapsedY) / 2;
    const expand = y < mid;
    this.dragStartY = 0;
    this.setData({
      dragging: false,
      expanded: expand,
      sheetY: expand ? this.expandedY : this.collapsedY
    });
  },

  /** 点头部：展开 / 收起 */
  onSheetTap() {
    if (Math.abs(this.dragMoved || 0) > 8) {
      this.dragMoved = 0;
      return;
    }
    const expand = !this.data.expanded;
    this.setData({
      expanded: expand,
      sheetY: expand ? this.expandedY : this.collapsedY
    });
  },

  /** 面板里的打卡按钮 */
  onSheetCheckin() {
    const current = this.data.current;
    if (!current) return;
    if (current.checkedAt) {
      wx.showToast({ title: '已经打过卡了', icon: 'none' });
      return;
    }
    const radius = current.radius || CATEGORY_RADIUS[current.category] || DEFAULT_RADIUS;
    const meters = this.cachedLocation
      ? distance(this.cachedLocation.latitude, this.cachedLocation.longitude, current.latitude, current.longitude)
      : -1;

    const doCheck = (manual) => {
      wx.setStorageSync(KEY_OF(current.id), {
        at: Date.now(),
        distance: meters >= 0 ? Math.round(meters) : null,
        manual: !!manual
      });
      this.setData({ current: { ...this.data.current, checkedAt: this.formatTime(Date.now()) } });
      wx.showToast({ title: manual ? '已手动打卡' : '打卡成功', icon: 'success' });
    };

    if (meters >= 0 && meters <= radius) {
      doCheck(false);
      return;
    }
    wx.showModal({
      title: meters < 0 ? '没有定位' : '还差一点',
      content:
        meters < 0
          ? '拿不到定位，可以直接手动打卡。'
          : `你距离「${current.name}」约 ${formatDistance(meters)}，打卡范围是 ${formatDistance(radius)}。`,
      cancelText: '手动打卡',
      confirmText: '知道了',
      success: (r) => {
        if (r.cancel) doCheck(true);
      }
    });
  },

  onMapTap() {
    if (this.data.showCityPicker) {
      this.setData({ showCityPicker: false });
      return;
    }
    // 有的机型点 marker 会同时触发 map 的 tap，加个时间窗避免"闪一下就关"
    if (Date.now() - this.lastMarkerTapAt < 300) return;
    if (this.data.current) {
      this.setData({ current: null, expanded: false, sheetY: this.closedY }, () => {
        this.lastBubbleKey = '';
        this.applyBubbles();
      });
    }
  },

  onCloseCard() {
    this.setData({ current: null, expanded: false, sheetY: this.collapsedY });
  },

  onGoRoutes() {
    wx.navigateTo({ url: `/pages/routes/index?city=${this.data.activeCity}` });
  },

  onNavigate() {
    const current = this.data.current;
    if (!current) return;
    wx.openLocation({
      latitude: current.latitude,
      longitude: current.longitude,
      name: current.name,
      address: current.address,
      scale: 16
    });
  },

  /** 视野变化：用 mapCtx 拿真实缩放/中心（e.scale 在部分机型上拿不到） */
  onViewChange(e) {
    if (e && e.type && e.type !== 'end') return;
    this.syncView(true);
  },

  /** 同步当前地图的缩放和中心；applyBubbles=true 时顺便重算气泡 */
  syncView(applyBubble) {
    this.mapCtx = this.mapCtx || wx.createMapContext('map', this);
    this.mapCtx.getScale({
      success: (r) => {
        const sc = r && r.scale;
        if (!sc) return;
        if (!this.viewScale || Math.abs(sc - this.viewScale) > 0.05) {
          this.viewScale = sc;
          if (applyBubble) this.applyBubbles();
        }
      },
      fail: () => {}
    });
    this.mapCtx.getCenterLocation({
      success: (r) => {
        if (r && r.latitude) this.viewCenter = { latitude: r.latitude, longitude: r.longitude };
      },
      fail: () => {}
    });
  },

  /**
   * 图片气泡：放大到一定级别、且和其它点相距够远时才显示
   * 太挤的时候宁可不显示，避免糊成一团
   */
  applyBubbles() {
    const list = this.visiblePlaces || [];
    const scale = this.viewScale || this.data.scale || 13;
    const center = this.viewCenter || this.data.center;

    if (scale < BUBBLE_MIN_SCALE || !list.length) {
      if (this.data.bubbles.length || this.lastBubbleKey) {
        this.lastBubbleKey = '';
        this.setData({ bubbles: [] }, () => {
          this.setData({ markers: [] }, () => {
            setTimeout(() => this.setData({ markers: this.baseMarkers || [] }), 30);
          });
        });
      }
      return;
    }

    // 米 / 像素（城市尺度下够用）
    const metersPerPx = (156543.03392 * Math.cos((center.latitude * Math.PI) / 180)) / Math.pow(2, scale);
    const withPx = list.map((p) => ({
      place: p,
      x: ((p.longitude - center.longitude) * 111320 * Math.cos((center.latitude * Math.PI) / 180)) / metersPerPx,
      y: ((p.latitude - center.latitude) * 111320) / metersPerPx
    }));

    const keep = [];
    withPx.forEach((a, i) => {
      let minDist = Infinity;
      withPx.forEach((b, j) => {
        if (i === j) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < minDist) minDist = d;
      });
      if (minDist >= BUBBLE_MIN_GAP_PX) keep.push(a.place);
    });

    // marker 的 id 是数组下标，customCallout 的 marker-id 必须对上下标
    const indexById = {};
    list.forEach((p, i) => {
      indexById[p.id] = i;
    });

    const bubbles = keep
      .filter((p) => HEROES[p.id])
      .slice(0, 30)
      .map((p) => {
        const index = (this.visiblePlaces || []).findIndex((x) => x.id === p.id);
        return {
          mid: index,
          id: p.id,
          photo: HEROES[p.id]
        };
      });

    const ids = {};
    bubbles.forEach((b) => {
      ids[b.id] = true;
    });

    const markers = (this.baseMarkers || []).map((m) => {
      const place = (this.visiblePlaces || [])[m.id];
      if (!place || !ids[place.id]) return m;
      return {
        ...m,
        // 图片气泡挂在点下方；marker 本身还是彩色 pin
        customCallout: { display: 'ALWAYS', anchorX: 6, anchorY: 10 }
      };
    });

    // 显示集合没变就不 setData，避免地图重绘（也是之前抖动的来源）
    const key = bubbles.map((b) => b.id).join(',');
    if (key === this.lastBubbleKey) return;
    this.lastBubbleKey = key;

    // 气泡从有变无（或反过来）时，只改 markers 的 customCallout 有时不刷新，
    // 先把 markers 清空再写回，强制地图重建标记
    const had = this.data.bubbles.length > 0;
    const has = bubbles.length > 0;
    if (had !== has) {
      this.setData({ markers: [] }, () => {
        setTimeout(() => this.setData({ bubbles, markers }), 30);
      });
    } else {
      this.setData({ bubbles, markers });
    }
  },

  onLocate() {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.setData({
          center: { latitude: res.latitude, longitude: res.longitude },
          scale: 14
        });
      },
      fail: () => {
        const city = CITY_MAP[this.data.activeCity];
        this.setData({ center: { ...city.center }, scale: city.scale });
        wx.showModal({
          title: '定位不可用',
          content: '没有拿到定位权限，已回到城市中心。详情页可以手动打卡。',
          showCancel: false
        });
      }
    });
  }
});
