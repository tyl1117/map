const { PLACES, CATEGORY_MAP, CATEGORY_RADIUS } = require('../../data/places');
const { distance, formatDistance } = require('../../utils/geo');
const { HEROES } = require('../../data/photos');
const { getTrip, toggle: toggleTrip } = require('../../utils/trip');

const DEFAULT_RADIUS = 500; // 兜底：点位没配、分类也没配时用
const keyOf = (id) => 'checkin_' + id;

Page({
  data: {
    poi: null,
    category: null,
    heroStyle: '',
    // 打卡相关
    checked: false,
    checkinText: '',
    locating: true,
    denied: false,
    distanceMeters: -1,
    locationText: '定位中…',
    canCheckin: false,
    radiusText: '',
    // 我的行程：这个点位是否已加入、排第几站
    inTrip: false,
    tripNo: 0
  },

  onLoad(options) {
    const poi = PLACES.find((p) => p.id === options.id) || PLACES[0];
    const category = CATEGORY_MAP[poi.category];

    // 打卡范围：点位自带 radius 优先，其次按分类，最后 500 米兜底
    this.radius = poi.radius || CATEGORY_RADIUS[poi.category] || DEFAULT_RADIUS;

    const tags = poi.tags.filter((t) => t !== category.name);
    if (poi.draft) tags.push('待校准');

    this.setData({
      poi,
      category,
      tags,
      photo: HEROES[poi.id] || '',
      heroStyle: `background: ${category.color}`,
      radiusText: formatDistance(this.radius)
    });
    wx.setNavigationBarTitle({ title: poi.name });
    this.restoreRecord();
    this.refreshTrip();
    this.locate();
  },

  /** 从行程页/地图页回来时同步「加入行程」按钮状态 */
  onShow() {
    this.refreshTrip();
  },

  refreshTrip() {
    if (!this.data.poi) return;
    const no = getTrip().ids.indexOf(this.data.poi.id);
    this.setData({ inTrip: no >= 0, tripNo: no >= 0 ? no + 1 : 0 });
  },

  /** ＋/✓ 按钮：加入或移出「我的行程」 */
  onToggleTrip() {
    const poi = this.data.poi;
    if (!poi) return;
    const r = toggleTrip(poi.id);
    if (r.reason === 'full') {
      wx.showToast({ title: '行程已经满了（最多 20 个点）', icon: 'none' });
      return;
    }
    this.refreshTrip();
    wx.showToast({ title: r.added ? '已加入行程' : '已移出行程', icon: 'none' });
  },

  /** 读本地打卡记录（兼容早期只存时间戳的格式） */
  restoreRecord() {
    const rec = wx.getStorageSync(keyOf(this.data.poi.id));
    if (!rec) return;
    const at = typeof rec === 'number' ? rec : rec.at;
    this.setData({ checked: true, checkinText: this.formatTime(at) });
  },

  formatTime(ts) {
    const d = new Date(ts);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  /** 定位一次，算出到目标的距离 */
  locate() {
    const poi = this.data.poi;
    const radius = this.radius;
    this.setData({ locating: true, denied: false, locationText: '定位中…' });

    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        const meters = distance(res.latitude, res.longitude, poi.latitude, poi.longitude);
        const canCheckin = meters <= radius;
        this.setData({
          locating: false,
          distanceMeters: meters,
          canCheckin,
          locationText: canCheckin
            ? `${formatDistance(meters)} · 在打卡范围内`
            : `${formatDistance(meters)} · 超出 ${formatDistance(radius)} 范围`
        });
      },
      fail: () => {
        this.setData({
          locating: false,
          denied: true,
          distanceMeters: -1,
          locationText: '定位没打开（点这里开启）',
          canCheckin: false
        });
      }
    });
  },

  onRelocate() {
    if (this.data.denied) {
      this.openSetting();
      return;
    }
    this.locate();
  },

  openSetting() {
    wx.showModal({
      title: '需要定位权限',
      content: '打卡靠定位判断你是不是到了附近。可以在设置里打开定位，也可以手动打卡。',
      cancelText: '手动打卡',
      confirmText: '去设置',
      success: (r) => {
        if (r.confirm) {
          wx.openSetting({
            success: (s) => {
              if (s.authSetting['scope.userLocation']) this.locate();
            }
          });
        } else if (r.cancel) {
          this.markChecked(null, true);
        }
      }
    });
  },

  onCheckin() {
    if (this.data.checked) {
      wx.showToast({ title: '已经打过卡了', icon: 'none' });
      return;
    }
    if (this.data.locating) {
      wx.showToast({ title: '还在定位，稍等一下', icon: 'none' });
      return;
    }
    if (this.data.denied) {
      this.openSetting();
      return;
    }

    const meters = this.data.distanceMeters;
    if (meters >= 0 && meters <= this.radius) {
      this.markChecked(meters, false);
      return;
    }

    // 距离离谱（>30 公里）多半是开发者工具的默认模拟定位，顺手提示一下
    const hint =
      meters > 30000
        ? '\n\n如果你在开发者工具里测试，记得先设置「模拟定位」，或直接用真机预览。'
        : '';

    wx.showModal({
      title: '还差一点',
      content: `你距离「${this.data.poi.name}」约 ${formatDistance(meters)}，打卡范围是 ${formatDistance(this.radius)}。${hint}`,
      cancelText: '手动打卡',
      confirmText: '知道了',
      success: (r) => {
        if (r.cancel) this.markChecked(meters, true);
      }
    });
  },

  /** 写打卡记录：时间 + 距离 + 是否手动 */
  markChecked(meters, manual) {
    const poi = this.data.poi;
    const rec = {
      at: Date.now(),
      distance: meters === null || meters < 0 ? null : Math.round(meters),
      manual: !!manual
    };
    wx.setStorageSync(keyOf(poi.id), rec);
    this.setData({ checked: true, checkinText: this.formatTime(rec.at) });
    wx.showToast({ title: manual ? '已手动打卡' : '打卡成功', icon: 'success' });
  },

  onNavigate() {
    const poi = this.data.poi;
    wx.openLocation({
      latitude: poi.latitude,
      longitude: poi.longitude,
      name: poi.name,
      address: poi.address,
      scale: 16
    });
  }
});
