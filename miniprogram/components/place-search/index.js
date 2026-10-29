/**
 * 点位搜索框（可复用）
 * 地图页顶部的搜索浮层、行程页面板里的「搜索加点」都用它。
 *
 * 交互：输入 → 出结果列表 → 点某条结果先看「介绍卡片」（简介 / 开放时间 / 地址 / 标签）
 *      → 在卡片上「＋ 加入行程」（或再点一次移出）；也可以从卡片进详情页。
 * 状态始终与 trip_v1 同步。
 */

const { search } = require('../../utils/search');
const trip = require('../../utils/trip');

Component({
  properties: {
    placeholder: { type: String, value: '搜索景点、美食、酒店…' },
    autoFocus: { type: Boolean, value: false },
    limit: { type: Number, value: 20 }
  },

  data: {
    keyword: '',
    results: [],
    hasKeyword: false,
    focusFlag: false,
    // 点开某条结果后的介绍卡片（null = 还在看列表）
    card: null
  },

  methods: {
    onInput(e) {
      this.apply((e.detail && e.detail.value) || '');
    },

    /** 让输入框获得焦点（页面调 selectComponent('#xxx').focus() 用） */
    focus() {
      this.setData({ focusFlag: false }, () => {
        setTimeout(() => this.setData({ focusFlag: true }), 60);
      });
    },

    onBlur() {
      this.setData({ focusFlag: false });
    },

    onFocus() {
      this.triggerEvent('focus');
    },

    onConfirm() {
      this.triggerEvent('confirm');
    },

    /**
     * 按关键词重算结果，并标出每个点位在行程里的站号
     * @param {string} keyword
     * @param {{keepCard?: boolean}} [opts] keepCard: 加/移出后保留当前卡片
     */
    apply(keyword, opts) {
      const keepCard = !!(opts && opts.keepCard);
      const key = String(keyword == null ? '' : keyword).trim();
      if (!key) {
        this.setData({ keyword: '', results: [], hasKeyword: false, card: null });
        return;
      }

      const ids = trip.getTrip().ids;
      const results = search(key, this.data.limit).map((item) => {
        const index = ids.indexOf(item.id);
        return {
          id: item.id,
          name: item.name,
          emoji: item.emoji,
          cityName: item.cityName,
          categoryName: item.categoryName,
          durationMin: item.durationMin,
          summary: item.summary,
          intro: item.intro,
          openTime: item.openTime,
          address: item.address,
          tags: item.tags || [],
          tagsText: (item.tags || []).join(' / '),
          inTrip: index >= 0,
          tripNo: index >= 0 ? index + 1 : ''
        };
      });

      this.setData({
        keyword: key,
        results,
        hasKeyword: true,
        card: keepCard ? this.data.card : null
      });
      this.syncCard();
    },

    /** 让卡片里的「第 N 站」跟着最新结果走；结果里没有这条了就收起卡片 */
    syncCard() {
      const card = this.data.card;
      if (!card) return;
      const row = this.data.results.filter((r) => r.id === card.id)[0];
      this.setData({ card: row || null });
    },

    /** 外部改了行程后，让结果里的站号保持最新 */
    refresh() {
      if (this.data.hasKeyword) this.apply(this.data.keyword, { keepCard: true });
    },

    onClear() {
      this.apply('');
      this.triggerEvent('change', { id: '', added: false, removed: false, reason: 'clear' });
    },

    /** 点一条结果：先展示介绍卡片 */
    onOpen(e) {
      const id = e.currentTarget.dataset.id;
      const row = this.data.results.filter((r) => r.id === id)[0];
      if (row) this.setData({ card: row });
    },

    /** 卡片左上角「‹ 结果」：回到结果列表 */
    onBackToList() {
      this.setData({ card: null });
    },

    /** 卡片上的主按钮：加入 / 移出行程，跟地图页的「＋」逻辑一致 */
    onCardAdd() {
      const card = this.data.card;
      if (!card) return;

      const result = trip.toggle(card.id);
      if (result.reason === 'full') {
        wx.showToast({ title: `行程最多 ${trip.MAX_STOPS} 个点位`, icon: 'none' });
      } else if (result.added) {
        const index = result.trip.ids.indexOf(card.id);
        wx.showToast({ title: `已加入 · 第 ${index + 1} 站`, icon: 'none' });
      } else if (result.removed) {
        wx.showToast({ title: '已移出行程', icon: 'none' });
      }

      // keepCard：加完还留在卡片上，能直接看到站号变化；想看别的再点「‹ 结果」
      this.apply(this.data.keyword, { keepCard: true });
      this.triggerEvent('change', {
        id: card.id,
        added: !!result.added,
        removed: !!result.removed,
        reason: result.reason || ''
      });
    },

    /** 卡片上的「查看详情」：进点位详情页（含打卡 / 导航） */
    onCardDetail() {
      const card = this.data.card;
      if (!card) return;
      wx.navigateTo({ url: '/pages/detail/index?id=' + card.id });
    }
  }
});