/**
 * Roche 朋友圈插件 v0.8.8
 * 完全拟真微信朋友圈的沉浸式模拟
 * v0.8.8: 不再吞任何 click。长按后遮罩延迟 150ms 可点击，合成事件自然穿透。
 * v0.8.1: 关系网支持 user↔char 有向关系（user 可作为关系端点，下拉可选 user）；新增"记忆注入格式"自定义模板（变量 {now}/{userHandle}/{userName}/{charName}/{charHandle} 等，[label] 区分子类型，留空=内置默认，覆盖全部注入内容含 user 双名字认知行/开头/导语/5分类/结尾）
 * v0.8.0: 召唤评论实时注入短期记忆（无需关闭插件）；reply-to 白名单校验防幻觉前缀；unmount 多 char 注入持久化修复（syncstate 默认值+await 链）；氛围提示词标题显示 user 名；图形化蛛网关系网（user/char 身份设定+char 间有向关系+SVG 可视化+自动注入提示词）
 * v0.7.2: 轨迹记录补全被评论朋友圈内容（char 知道评论了哪条）；无新行为时不再注入空轨迹记录；拆分主动发圈(postEnabled)与参与评论(commentEnabled)双开关
 * v0.7.1: 顶栏"朋友圈"水平居中；侧边栏界面尺寸调整面板（顶栏高度+底部安全边距滑块实时预览，自动保存，全屏通用）；评论态滚动区底部让出输入栏高度防遮挡
 * v0.7: 召唤评论批量模型决策（人设+最近朋友圈+绑定记忆）；user双名字认知；buildActionSummary 5分类（新增②别人在我朋友圈互动+⑤别人@我）；心形点赞图标；封面图per-char/per-user；夜间模式；拆分enabled(发圈+评论)与memSync(记忆注入)
 * v0.6: 记忆/上下文加时间标签；氛围提示词（发圈/评论/NPC）；per-char NPC 系统（手动+AI生成）；buildActionSummary 4 分类修复人称矛盾
 * v0.5: char多评论+@提及；user@触发必定评论；"··"气泡定位修复+外部点击关闭；切换空间/主体抑制跳顶
 * v0.4: 修复滚动/弹窗关闭/发圈崩溃；侧边栏改双击顶栏触发；char发圈合并主动评论；触发评论隐晦化
 * v0.3: 拟真大改 + 修复发布失败/头像遮挡/文字图/局部loading/会话过滤/退出
 */
(function () {
  'use strict';

  // ========== 常量 ==========
  var PLUGIN_ID = 'roche-moments';
  var APP_ID = 'roche-moments-home';
  var ROOT_CLASS = 'roche-plugin-moments';
  var KEYS = {
    SPACES: 'moments:spaces', POSTS: 'moments:posts', NOTIFS: 'moments:notifs',
    SUBAPI: 'moments:subapi', SYNCSTATE: 'moments:syncstate',
    ACTIVE: 'moments:activeSpace', IMGCACHE: 'moments:imgcache', DARK: 'moments:dark', UIPREFS: 'moments:uiprefs'
  };
  var MIN_POST_INTERVAL = 30 * 60 * 1000;
  var JITTER = 0.2;
  var BG_CHECK_INTERVAL = 60 * 1000;
  var SYNC_PREFIX = '[RocheMomentsSync';
  var MAX_AUTO_COMMENT = 8;
  var DEFAULT_AUTO_COMMENT = 2;
  var NPC_COMMENT_PROBABILITY = 0.6;

  // ========== 风车 SVG ==========
  function petal(deg, color) {
    return '<g transform="rotate(' + deg + ')"><ellipse cx="0" cy="-22" rx="7" ry="22" fill="' + color + '"/></g>';
  }
  var WINDMILL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(50,50)">' +
    petal(0, 'rgb(255,92,92)') + petal(45, 'rgb(255,169,77)') + petal(90, 'rgb(255,212,59)') +
    petal(135, 'rgb(105,219,124)') + petal(180, 'rgb(77,171,247)') + petal(225, 'rgb(116,143,252)') +
    petal(270, 'rgb(177,151,252)') + petal(315, 'rgb(255,107,157)') +
    '<circle r="6" fill="white"/></g></svg>';
  var WINDMILL_DATA_URI = 'data:image/svg+xml,' + WINDMILL_SVG.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'").replace(/#/g, '%23');

  // ========== 内嵌图标（线性，微信风格，currentColor）==========
  var ICON = {
    camera: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M9 3l1.5 2h3L15 3h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4zm3 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M15.5 4L8 12l7.5 8V4z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>',
    like: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M4 4h16v12H8l-4 4V4z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 2a6 6 0 0 1 6 6v4l2 3H4l2-3V8a6 6 0 0 1 6-6zm-2 18h4a2 2 0 1 1-4 0z"/></svg>',
    menu: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 4h18v16H3V4zm2 12l4-4 3 3 4-5 3 4V6H5v10zm3-7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>',
    location: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
    del: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>'
  };

  // ========== 工具函数 ==========
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uuid() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function trim(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }
  function formatTime(ts) {
    var now = Date.now();
    var diff = now - ts;
    var d = new Date(ts);
    var today = new Date();
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + '分钟前';
    if (d.toDateString() === today.toDateString()) return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    var yest = new Date(today); yest.setDate(yest.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return '昨天 ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    if (d.getFullYear() === today.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  // 紧凑时间戳：MM-DD HH:MM（用于记忆轨迹与 AI 上下文时间标签）
  function formatStamp(ts) {
    var d = new Date(ts);
    return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function randomInterval(baseMin) {
    var base = baseMin * 60 * 1000;
    return Math.round(base + base * JITTER * (Math.random() * 2 - 1));
  }
  function randPick(arr, n) {
    var copy = arr.slice(); var out = [];
    while (n-- > 0 && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    return out;
  }

  // ========== 全局状态 ==========
  var cachedRoche = null;
  var root = null;
  var state = {
    spaces: [], posts: [], notifs: [], subapi: [], syncstate: {},
    activeSpaceId: null, currentSubject: 'user',
    sidebarOpen: false, postModalOpen: false, notifPanelOpen: false,
    subjectSheetOpen: false, memMountCharId: null, subApiPanelOpen: false,
    charListOpen: false, commentTarget: null, editPostId: null, editModalOpen: false, lpSheetOpen: false, lpTarget: null, darkMode: false, uiPrefsOpen: false,
    uiPrefs: { topbarH: 44, bottomPad: 80 },
    moodPromptsOpen: false, npcModalCharId: null, npcSuggestions: [], npcLoading: false,
    relationNetOpen: false,
    syncFormatOpen: false,
    tip: null,            // 局部 loading 提示 {text}
    bootLoading: true,    // 首次加载全屏
    allChars: [], allPersonas: [], activePersona: null
  };
  var pendingImages = [];
  var _lpTimer = null;
  var _lpStartX = 0;
  var _lpStartY = 0;
  var _lpTouchActive = false;
  // 长按达到阈值后暂存的操作，延迟到 touchend 后执行 render
  // 关键：在 touch 序列进行中替换 root.innerHTML 会移除 touch target，
  // 导致安卓 WebView 不再合成 click 事件，后续所有点击失效（但滑动不受影响）
  var _pendingLpAction = null;

  // ========== Store ==========
  var Store = {
    _get: function (k, d) { return cachedRoche.storage.get(k).then(function (v) { return v == null ? d : v; }); },
    _set: function (k, v) { return cachedRoche.storage.set(k, v); },
    loadAll: function () {
      return Promise.all([
        Store._get(KEYS.SPACES, []), Store._get(KEYS.POSTS, []), Store._get(KEYS.NOTIFS, []),
        Store._get(KEYS.SUBAPI, []), Store._get(KEYS.SYNCSTATE, {}), Store._get(KEYS.ACTIVE, null),
        Store._get(KEYS.DARK, false), Store._get(KEYS.UIPREFS, null)
      ]).then(function (r) {
        state.spaces = r[0] || []; state.posts = r[1] || []; state.notifs = r[2] || [];
        state.subapi = r[3] || []; state.syncstate = (r[4] && typeof r[4] === 'object' && !Array.isArray(r[4])) ? r[4] : {}; state.activeSpaceId = r[5];
        state.darkMode = !!r[6];
        if (r[7] && typeof r[7] === 'object') {
          if (r[7].topbarH != null) state.uiPrefs.topbarH = r[7].topbarH;
          if (r[7].bottomPad != null) state.uiPrefs.bottomPad = r[7].bottomPad;
        }
        if (!state.activeSpaceId && state.spaces.length) state.activeSpaceId = state.spaces[0].id;
        normalizeSpaces();
      });
    },
    saveDark: function () { return Store._set(KEYS.DARK, state.darkMode); },
    saveUiPrefs: function () { return Store._set(KEYS.UIPREFS, state.uiPrefs); },
    saveSpaces: function () { return Store._set(KEYS.SPACES, state.spaces); },
    savePosts: function () { return Store._set(KEYS.POSTS, state.posts); },
    saveNotifs: function () { return Store._set(KEYS.NOTIFS, state.notifs); },
    saveSubApi: function () { return Store._set(KEYS.SUBAPI, state.subapi); },
    saveSyncState: function () { return Store._set(KEYS.SYNCSTATE, state.syncstate); },
    saveActive: function () { return Store._set(KEYS.ACTIVE, state.activeSpaceId); },
    getActiveSpace: function () {
      for (var i = 0; i < state.spaces.length; i++) if (state.spaces[i].id === state.activeSpaceId) return state.spaces[i];
      return null;
    },
    addPost: function (p) { state.posts.push(p); state.posts.sort(function (a, b) { return b.createdAt - a.createdAt; }); return Store.savePosts(); },
    deletePost: function (id) { state.posts = state.posts.filter(function (p) { return p.id !== id; }); return Store.savePosts(); },
    updatePost: function (id, updates) {
      for (var i = 0; i < state.posts.length; i++) {
        if (state.posts[i].id === id) {
          for (var k in updates) { if (updates.hasOwnProperty(k)) state.posts[i][k] = updates[k]; }
          break;
        }
      }
      return Store.savePosts();
    },
    addComment: function (pid, c) {
      for (var i = 0; i < state.posts.length; i++) if (state.posts[i].id === pid) {
        if (!state.posts[i].comments) state.posts[i].comments = [];
        state.posts[i].comments.push(c); break;
      }
      return Store.savePosts();
    },
    deleteComment: function (postId, commentId) {
      for (var i = 0; i < state.posts.length; i++) {
        if (state.posts[i].id === postId) {
          if (state.posts[i].comments) {
            state.posts[i].comments = state.posts[i].comments.filter(function (c) { return c.id !== commentId; });
          }
          break;
        }
      }
      return Store.savePosts();
    },
    toggleLike: function (pid, who) {
      for (var i = 0; i < state.posts.length; i++) if (state.posts[i].id === pid) {
        var p = state.posts[i]; if (!p.likes) p.likes = [];
        var idx = -1;
        for (var j = 0; j < p.likes.length; j++) if (p.likes[j].id === who.id) { idx = j; break; }
        if (idx >= 0) p.likes.splice(idx, 1); else p.likes.push({ id: who.id, name: who.name, ts: Date.now() });
        break;
      }
      return Store.savePosts();
    },
    addNotif: function (n) { state.notifs.unshift(n); if (state.notifs.length > 200) state.notifs.length = 200; return Store.saveNotifs(); },
    markAllNotifRead: function () { state.notifs.forEach(function (n) { n.read = true; }); return Store.saveNotifs(); },
    clearNotifs: function () { state.notifs = []; return Store.saveNotifs(); },
    getSyncTs: function (sid, cid) { return state.syncstate[sid + '_' + cid] || 0; },
    setSyncTs: function (sid, cid, ts) { state.syncstate[sid + '_' + cid] = ts; return Store.saveSyncState(); }
  };

  // ========== AI 路由（健壮化）==========
  function getActiveSubApi() {
    for (var i = 0; i < state.subapi.length; i++) if (state.subapi[i].enabled) return state.subapi[i];
    return null;
  }
  function callAI(opts) {
    var preset = getActiveSubApi();
    if (preset) return callSubApi(preset, opts);
    if (!cachedRoche || !cachedRoche.ai || !cachedRoche.ai.chat) return Promise.reject(new Error('无可用 AI（未配置副 API 且 roche.ai.chat 不可用）'));
    var p;
    try { p = Promise.resolve(cachedRoche.ai.chat(opts)); }
    catch (e) { return Promise.reject(e); }
    return p.then(function (r) {
      if (r == null) return '';
      if (typeof r === 'string') return r;
      return r.text || r.content || r.message || r.output || '';
    });
  }
  function callSubApi(preset, opts) {
    var url = trim(preset.url).replace(/\/+$/, '');
    return fetch(url + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + preset.apiKey },
      body: JSON.stringify({ model: preset.model, messages: opts.messages, temperature: opts.temperature == null ? 0.85 : opts.temperature, stream: false })
    }).then(function (res) {
      if (!res.ok) throw new Error('副 API 状态 ' + res.status);
      return res.json();
    }).then(function (data) {
      try { return data.choices[0].message.content || ''; } catch (e) { return ''; }
    });
  }
  function fetchModels(url, apiKey) {
    var u = trim(url).replace(/\/+$/, '');
    return fetch(u + '/models', { headers: { 'Authorization': 'Bearer ' + apiKey } })
      .then(function (res) { if (!res.ok) throw new Error('状态 ' + res.status); return res.json(); })
      .then(function (data) {
        var list = [];
        if (Array.isArray(data.data)) data.data.forEach(function (m) { if (m.id) list.push(m.id); });
        return list;
      });
  }

  // ========== 人设/角色 ==========
  function refreshPersonas() {
    return cachedRoche.persona.getUserPersonas().then(function (list) {
      state.allPersonas = list || [];
      return cachedRoche.persona.getActiveUserPersona();
    }).then(function (ap) { state.activePersona = ap; return state.allPersonas; });
  }
  function refreshChars() { return cachedRoche.character.list().then(function (list) { state.allChars = list || []; return state.allChars; }); }
  function findChar(id) { for (var i = 0; i < state.allChars.length; i++) if (state.allChars[i].id === id) return state.allChars[i]; return null; }

  // ========== 空间/绑定 ==========
  function getSpaceChar(space, cid) {
    if (!space || !space.chars) return null;
    for (var i = 0; i < space.chars.length; i++) if (space.chars[i].charId === cid) return space.chars[i];
    return null;
  }
  function ensureSpaceForPersona(per) {
    for (var i = 0; i < state.spaces.length; i++) if (state.spaces[i].userPersonaId === per.id) return state.spaces[i];
    var sp = {
      id: 'sp_' + per.id + '_' + Date.now().toString(36),
      userPersonaId: per.id, userPersonaName: per.name || per.id,
      userPersonaHandle: per.handle || per.name || '', userPersonaAvatar: per.avatar || '',
      userPersonaBio: per.bio || '', cover: '', chars: [], createdAt: Date.now(),
      customPrompts: { charPost: '', charComment: '', npcComment: '', syncFormat: {} },
      userIdentity: '', relations: []
    };
    state.spaces.push(sp); Store.saveSpaces(); return sp;
  }
  function bindCharToSpace(space, cid) {
    if (getSpaceChar(space, cid)) return;
    var c = findChar(cid); if (!c) return;
    space.chars.push({
      charId: c.id, charName: c.name || c.id, charHandle: c.handle || c.name || '',
      charAvatar: c.avatar || '', charPersona: c.persona || c.bio || '', charBio: c.bio || '',
      enabled: true, postEnabled: true, commentEnabled: true, memoryMounts: [], nextPostAt: 0, postIntervalMin: 30,
      autoCommentCount: DEFAULT_AUTO_COMMENT, lastSyncAt: 0, npcs: [], cover: '', memSync: true, customIdentity: ''
    });
    Store.saveSpaces();
  }
  function unbindCharFromSpace(space, cid) {
    space.chars = space.chars.filter(function (c) { return c.charId !== cid; });
    // 清理指向被解绑 char 的关系
    if (space.relations && space.relations.length) {
      space.relations = space.relations.filter(function (r) { return r.fromCid !== cid && r.toCid !== cid; });
    }
    Store.saveSpaces();
  }
  // 氛围提示词读取（防御旧数据）
  function getSpacePrompts(space) {
    if (!space || !space.customPrompts) return { charPost: '', charComment: '', npcComment: '' };
    var cp = space.customPrompts || {};
    return { charPost: cp.charPost || '', charComment: cp.charComment || '', npcComment: cp.npcComment || '' };
  }
  // 读取自定义轨迹注入模板（留空 = 用内置默认）
  function getSyncFormat(space) {
    var empty = { header:'', userLine:'', intro:'', cat1:'', cat2:'', cat3:'', cat4:'', cat5:'', footer:'' };
    if (!space || !space.customPrompts || !space.customPrompts.syncFormat) return empty;
    var sf = space.customPrompts.syncFormat || {};
    return {
      header: sf.header || '', userLine: sf.userLine || '', intro: sf.intro || '',
      cat1: sf.cat1 || '', cat2: sf.cat2 || '', cat3: sf.cat3 || '',
      cat4: sf.cat4 || '', cat5: sf.cat5 || '', footer: sf.footer || ''
    };
  }
  // 模板变量替换：{varName} → vars[varName] || ''
  function applyTemplate(tpl, vars) {
    if (!tpl) return '';
    return tpl.replace(/\{(\w+)\}/g, function (m, k) {
      return (vars[k] != null) ? String(vars[k]) : '';
    });
  }
  // 解析 [标签] 行首标记的分类模板，返回 { like:'...', comment:'...', reply:'...', ... }
  function parseLabeledTemplate(tpl) {
    var out = {};
    (tpl || '').split('\n').forEach(function (line) {
      var m = line.match(/^\[(\w+)\]\s*(.*)$/);
      if (m) out[m[1]] = m[2];
    });
    return out;
  }
  // char 的 NPC 列表读取（防御旧数据）
  function getCharNpcs(sc) {
    if (!sc || !sc.npcs) return [];
    return sc.npcs || [];
  }
  // user 双名字认知行：handle（账户名）与 name（真实名字）是同一人
  function userDualNameLine(space) {
    if (!space) return '';
    var h = space.userPersonaHandle || '', n = space.userPersonaName || '';
    return '朋友圈空间主人 user 的账户名（handle）是「' + h + '」，真实名字是「' + n + '」。这两个指的是同一个人：你在朋友圈 @ user 时用 @' + h + '，在聊天里可以叫 ' + n + '，但必须知道二者是同一人，不要把朋友圈里 @' + h + ' 的内容当成别人的。';
  }
  // 按 charId 查 charName
  function charNameById(space, cid) {
    if (!space || !space.chars) return '';
    for (var i = 0; i < space.chars.length; i++) {
      if (space.chars[i].charId === cid) return space.chars[i].charName;
    }
    return '';
  }
  // user 节点保留字 id（关系网中 user↔char 关系用此 id 标识 user 端）
  var USER_NODE_ID = '__user__';
  // 节点显示名：user 节点返回 user 名字，char 节点返回 charName
  function nodeDisplayName(space, cid) {
    if (cid === USER_NODE_ID) return space.userPersonaName || space.userPersonaHandle || 'user';
    return charNameById(space, cid);
  }
  // 关系网提示词行：user 身份 + 各 char 身份 + 有向关系（可含 user↔char）
  function relationNetLine(space) {
    if (!space) return '';
    var parts = [];
    if (space.userIdentity) parts.push('user 身份：' + space.userIdentity);
    if (space.chars && space.chars.length) {
      var idParts = [];
      space.chars.forEach(function (sc) {
        if (sc.customIdentity) idParts.push(sc.charName + '：' + sc.customIdentity);
      });
      if (idParts.length) parts.push('char 身份：' + idParts.join('、'));
    }
    if (space.relations && space.relations.length) {
      var relParts = [];
      space.relations.forEach(function (r) {
        var fromName = nodeDisplayName(space, r.fromCid);
        var toName = nodeDisplayName(space, r.toCid);
        if (fromName && toName) relParts.push(fromName + '→' + toName + '（' + r.label + '）');
      });
      if (relParts.length) parts.push('关系：' + relParts.join('、'));
    }
    if (!parts.length) return '';
    return '【关系网（user 设定，请遵循）】' + parts.join('；') + '。';
  }
  // 旧数据兼容：补 customPrompts / npcs 字段
  function normalizeSpaces() {
    var dirty = false;
    (state.spaces || []).forEach(function (space) {
      if (!space.customPrompts || typeof space.customPrompts !== 'object') {
        space.customPrompts = { charPost: '', charComment: '', npcComment: '', syncFormat: {} };
        dirty = true;
      } else {
        var cp = space.customPrompts;
        if (cp.charPost == null) { cp.charPost = ''; dirty = true; }
        if (cp.charComment == null) { cp.charComment = ''; dirty = true; }
        if (cp.npcComment == null) { cp.npcComment = ''; dirty = true; }
        // syncFormat 子字段兜底（全部默认空串 = 用内置默认）
        if (!cp.syncFormat || typeof cp.syncFormat !== 'object') { cp.syncFormat = {}; dirty = true; }
        var sf = cp.syncFormat;
        ['header','userLine','intro','cat1','cat2','cat3','cat4','cat5','footer'].forEach(function (k) {
          if (sf[k] == null) { sf[k] = ''; dirty = true; }
        });
      }
      // 关系网字段迁移
      if (space.userIdentity == null) { space.userIdentity = ''; dirty = true; }
      if (!space.relations || !Array.isArray(space.relations)) { space.relations = []; dirty = true; }
      // 收集当前 space 存在的 charId，清理指向已删除 char 的孤立关系
      var existIds = {};
      existIds[USER_NODE_ID] = true; // user 节点始终存在，user↔char 关系不应被误删
      (space.chars || []).forEach(function (sc) { existIds[sc.charId] = true; });
      var rawRels = space.relations || [];
      var cleanRels = rawRels.filter(function (r) {
        return r && r.id && r.fromCid && r.toCid && existIds[r.fromCid] && existIds[r.toCid];
      });
      if (cleanRels.length !== rawRels.length) { space.relations = cleanRels; dirty = true; }
      (space.chars || []).forEach(function (sc) {
        if (!sc.npcs || !Array.isArray(sc.npcs)) { sc.npcs = []; dirty = true; }
        if (sc.memSync == null) { sc.memSync = true; dirty = true; }
        if (sc.cover == null) { sc.cover = ''; dirty = true; }
        if (sc.customIdentity == null) { sc.customIdentity = ''; dirty = true; }
        // 拆分 enabled 为 postEnabled + commentEnabled；旧数据按原 enabled 值迁移
        if (sc.postEnabled == null) { sc.postEnabled = sc.enabled != null ? sc.enabled : true; dirty = true; }
        if (sc.commentEnabled == null) { sc.commentEnabled = sc.enabled != null ? sc.enabled : true; dirty = true; }
      });
    });
    if (dirty) Store.saveSpaces();
  }

  // ========== 记忆加载（过滤防循环）==========
  function loadMountedMemory(sc) {
    if (!sc || !sc.memoryMounts || !sc.memoryMounts.length) return Promise.resolve('');
    var parts = [];
    var chain = Promise.resolve();
    sc.memoryMounts.forEach(function (m) {
      if (!m.enabled) return;
      chain = chain.then(function () {
        return cachedRoche.memory.getShortTerm({ conversationId: m.conversationId, limit: m.shortLimit || 50 }).then(function (msgs) {
          (msgs || []).forEach(function (msg) {
            if (msg && msg.text && String(msg.text).indexOf(SYNC_PREFIX) === 0) return;
            var who = msg.senderHandle || msg.senderName || (msg.isMe ? 'user' : '对方');
            if (msg.text) parts.push(who + '：' + msg.text);
          });
          if (m.factLimit || m.coreEnabled) return cachedRoche.memory.getLongTerm({ conversationId: m.conversationId, limit: m.factLimit || 50 });
          return null;
        }).then(function (lt) {
          if (!lt) return;
          if (m.coreEnabled && lt.core && lt.core.summary) parts.push('【核心记忆】' + lt.core.summary);
          if (m.factLimit && lt.facts) (lt.facts || []).forEach(function (f) {
            var t = f.summaryText || f.action || f.text || ''; if (t) parts.push('【事实】' + t);
          });
        }).catch(function () {});
      });
    });
    return chain.then(function () { return parts.join('\n'); });
  }

  // ========== 当前主体 ==========
  function getCurrentSubject() {
    var space = Store.getActiveSpace(); if (!space) return null;
    if (state.currentSubject === 'user' || !state.currentSubject) {
      return { type: 'user', id: space.userPersonaId, name: space.userPersonaHandle || space.userPersonaName, realName: space.userPersonaName, avatar: space.userPersonaAvatar, bio: space.userPersonaBio };
    }
    var sc = getSpaceChar(space, state.currentSubject); if (!sc) return null;
    return { type: 'char', id: sc.charId, name: sc.charHandle || sc.charName, realName: sc.charName, avatar: sc.charAvatar, bio: sc.charBio, spaceChar: sc };
  }

  // ========== CharPost ==========
  function parsePostContent(raw) {
    var text = raw || ''; var images = [];
    var imgBlock = text.match(/<images?>([\s\S]*?)<\/images?>/i);
    if (imgBlock) {
      var inner = imgBlock[1]; var re = /<img>([\s\S]*?)<\/img>/gi; var m;
      while ((m = re.exec(inner))) { var v = trim(m[1]); if (v) images.push({ type: 'text', value: v, textContent: v }); }
      if (!images.length) {
        inner.split(/\n/).map(function (s) { return trim(s); }).filter(Boolean).forEach(function (l) { images.push({ type: 'text', value: l, textContent: l }); });
      }
      text = text.replace(imgBlock[0], '');
    }
    var tBlock = text.match(/<text>([\s\S]*?)<\/text>/i);
    if (tBlock) text = tBlock[1];
    text = trim(text).replace(/<like>[\s\S]*?<\/like>/gi, '');
    return { text: text, images: images };
  }
  function generateCharPost(space, sc) {
    var c = findChar(sc.charId) || {};
    var persona = c.persona || c.bio || sc.charPersona || '';
    var myName = sc.charHandle || sc.charName;
    return loadMountedMemory(sc).then(function (mem) {
      // 抽取本空间最近 10 条动态 + 评论，作为 char 看到的朋友圈上下文
      var recent = (state.posts || []).filter(function (p) { return p.spaceId === space.id; }).slice(0, 10);
      var ctx = recent.map(function (p) {
        var author = p.authorHandle || p.authorName;
        var s = '【' + author + ' 的朋友圈 · ' + formatStamp(p.createdAt) + '】' + (p.text || '(仅图片)');
        if (p.comments && p.comments.length) {
          s += '\n  评论：' + p.comments.map(function (cm) {
            return (cm.authorHandle || cm.authorName) + '（' + formatStamp(cm.createdAt) + '）' + (cm.replyToName ? ' 回复 ' + cm.replyToName : '') + '：' + cm.text;
          }).join('；');
        }
        return s;
      }).join('\n\n');
      var sys = '你是「' + sc.charName + '」，此刻正在刷微信朋友圈。\n';
      if (persona) sys += '\n你的人设：\n' + persona + '\n';
      if (sc.customIdentity) sys += '你在关系网中的身份：' + sc.customIdentity + '\n';
      if (mem) sys += '\n你最近的记忆与对话上下文（来自 Roche 聊天）：\n' + mem + '\n';
      sys += '\n' + userDualNameLine(space) + '\n';
      var relLine = relationNetLine(space);
      if (relLine) sys += relLine + '\n';
      var prompts = getSpacePrompts(space);
      if (prompts.charPost) sys += '\n【发圈氛围提示（user 设定，请遵循）】' + prompts.charPost + '\n';
      if (ctx) sys += '\n你刚刚滑到的朋友圈动态和评论：\n' + ctx + '\n';
      // 可被 @ 的人名列表（user + 所有启用的 char）
      var mentionables = [];
      mentionables.push(space.userPersonaHandle || space.userPersonaName);
      (space.chars || []).forEach(function (ch) { if (ch.postEnabled || ch.commentEnabled) mentionables.push(ch.charHandle || ch.charName); });
      sys += '\n可以 @ 的人：' + mentionables.join('、') + '（在评论里用 @名字 的形式提及）\n';
      sys += '\n现在请你做两件事：\n';
      sys += '1. 发一条属于你自己的朋友圈\n';
      sys += '2. 根据你的兴趣和性格，从上面动态里挑 0-3 条去评论；也可以评论你自己刚发的那条\n';
      sys += '\n严格按以下格式输出，不要多余内容：\n';
      sys += '<post>你的朋友圈正文</post>\n';
      sys += '<post-images><img>图片1描述</img><img>图片2描述</img></post-images>   （可选，0-3 张文字图，没有就省略整段）\n';
      sys += '<comment target="对方名字">你的评论</comment>   （可重复多行，target 填要评论的那条动态的作者名；评论自己刚发的就填 "' + myName + '"；评论正文里可以用 @名字 提及某人）\n';
      sys += '\n要求：第一人称「我」，符合人设口吻，简短自然，不要 emoji/话题标签。@某人 用 @名字 形式写在评论正文里。';
      return callAI({ messages: [{ role: 'system', content: sys }, { role: 'user', content: '发朋友圈，并评论你感兴趣的动态。' }], temperature: 0.9 });
    }).then(function (raw) {
      // 解析 <post>
      var postText = '';
      var pm = raw.match(/<post>([\s\S]*?)<\/post>/i);
      if (pm) postText = trim(pm[1]);
      else postText = trim((raw || '').replace(/<comment[\s\S]*?<\/comment>/gi, '').replace(/<[^>]+>/g, '')) || '今天，又是普通的一天。';
      // 解析 <post-images>
      var images = [];
      var pim = raw.match(/<post-images?>([\s\S]*?)<\/post-images?>/i);
      if (pim) {
        var re = /<img>([\s\S]*?)<\/img>/gi; var m;
        while ((m = re.exec(pim[1]))) { var v = trim(m[1]); if (v) images.push({ type: 'text', value: v, textContent: v }); }
      }
      var post = {
        id: uuid(), spaceId: space.id, authorType: 'char', authorId: sc.charId,
        authorName: sc.charName, authorHandle: sc.charHandle || sc.charName, authorAvatar: sc.charAvatar,
        text: postText, images: images, location: '', createdAt: Date.now(), likes: [], comments: []
      };
      return Store.addPost(post).then(function () {
        Store.addNotif({ id: uuid(), spaceId: space.id, type: 'post', fromId: sc.charId, fromName: sc.charHandle || sc.charName, fromAvatar: sc.charAvatar, postId: post.id, postSnippet: postText.slice(0, 30), text: '发布了新朋友圈', createdAt: Date.now(), read: false });
        return post;
      }).then(function (savedPost) {
        // 解析 <comment target=""> 并逐条保存到对应动态
        var commentRe = /<comment\s+target="([^"]*)">([\s\S]*?)<\/comment>/gi;
        var cm; var cmChain = Promise.resolve();
        while ((cm = commentRe.exec(raw))) {
          (function (targetName, cmText) {
            cmChain = cmChain.then(function () {
              var tName = trim(targetName); var cText = trim(cmText);
              if (!cText) return;
              // 在空间内找作者名匹配的动态；target=自己名字则评论刚发的那条
              var target = null;
              if (tName === myName || tName === sc.charName) target = savedPost;
              else {
                var candidates = state.posts.filter(function (p) { return p.spaceId === space.id; });
                for (var i = 0; i < candidates.length; i++) {
                  var aName = candidates[i].authorHandle || candidates[i].authorName;
                  if (aName === tName) { target = candidates[i]; break; }
                }
              }
              if (!target) return;
              var comment = { id: uuid(), postId: target.id, authorType: 'char', authorId: sc.charId, authorName: sc.charName, authorHandle: sc.charHandle || sc.charName, text: cText, replyTo: null, replyToName: null, createdAt: Date.now() };
              return Store.addComment(target.id, comment).then(function () {
                if (target.id !== savedPost.id) {
                  Store.addNotif({ id: uuid(), spaceId: space.id, type: 'comment', fromId: sc.charId, fromName: sc.charHandle || sc.charName, fromAvatar: sc.charAvatar, postId: target.id, postSnippet: (target.text || '').slice(0, 30), text: '评论：' + cText, createdAt: Date.now(), read: false });
                }
              });
            });
          })(cm[1], cm[2]);
        }
        return cmChain.then(function () { return triggerNpcComments(space, savedPost, sc); }).then(function () { return savedPost; });
      });
    });
  }

  // ========== 评论 ==========
  // 解析 AI 评论输出：支持多条 <comment reply-to="...">text</comment> + <like>
  function parseCommentResponse(raw) {
    var text = trim(raw || '');
    var liked = /<like>\s*1\s*<\/like>/i.test(text);
    var comments = [];
    var re = /<comment(?:\s+reply-to="([^"]*)")?>([\s\S]*?)<\/comment>/gi;
    var m;
    while ((m = re.exec(text))) {
      var replyTo = trim(m[1] || '');
      var cText = trim(m[2] || '');
      if (cText) comments.push({ text: cText, replyToName: replyTo || null });
    }
    // 兼容旧格式：无 <comment> 标签时把整段当一条
    if (!comments.length) {
      var bare = trim(text.replace(/<like>[\s\S]*?<\/like>/gi, ''));
      if (bare) comments.push({ text: bare, replyToName: null });
    }
    return { comments: comments, liked: liked };
  }
  // 检测文本里 @了哪些 char（按 handle/name 匹配）
  function detectMentionedChars(space, text) {
    var ids = [];
    if (!text) return ids;
    (space.chars || []).forEach(function (sc) {
      if (!sc.commentEnabled) return;
      var names = [sc.charHandle, sc.charName].filter(Boolean);
      for (var i = 0; i < names.length; i++) {
        if (text.indexOf('@' + names[i]) >= 0) { ids.push(sc.charId); break; }
      }
    });
    return ids;
  }
  // 扫描某条动态下所有 user 评论里 @了哪些 char（用于触发必定评论）
  function detectMentionedCharsFromPost(space, post) {
    var ids = [];
    if (!post || !post.comments) return ids;
    (post.comments || []).forEach(function (c) {
      if (c.authorType === 'user' && c.text) {
        detectMentionedChars(space, c.text).forEach(function (cid) {
          if (ids.indexOf(cid) < 0) ids.push(cid);
        });
      }
    });
    return ids;
  }
  function generateSingleComment(space, post, sc, mode, replyTarget, prevComments) {
    var c = findChar(sc.charId) || {};
    var persona = c.persona || c.bio || sc.charPersona || '';
    // 可被 @ 的人名列表（user + 所有启用的 char）
    var mentionables = [];
    mentionables.push(space.userPersonaHandle || space.userPersonaName);
    (space.chars || []).forEach(function (ch) { if (ch.postEnabled || ch.commentEnabled) mentionables.push(ch.charHandle || ch.charName); });
    return loadMountedMemory(sc).then(function (mem) {
      var sys = '你是「' + sc.charName + '」，正在看「' + (post.authorHandle || post.authorName) + '」的微信朋友圈。\n';
      if (persona) sys += '\n你的人设：\n' + persona + '\n';
      if (sc.customIdentity) sys += '你在关系网中的身份：' + sc.customIdentity + '\n';
      var prompts = getSpacePrompts(space);
      if (prompts.charComment) sys += '\n【评论氛围提示（user 设定，请遵循）】' + prompts.charComment + '\n';
      if (mem) sys += '\n你最近的记忆上下文：\n' + mem + '\n';
      var relLine = relationNetLine(space);
      if (relLine) sys += relLine + '\n';
      sys += '\n这条朋友圈内容：\n' + (post.text || '(仅图片)') + '\n';
      sys += post.authorType === 'user' ? '发朋友圈的是 user（' + (space.userPersonaHandle || space.userPersonaName) + '）。\n' : '发朋友圈的是 ' + (post.authorHandle || post.authorName) + '（和你一样是 char）。\n';
      if (prevComments && prevComments.length) {
        sys += '\n已有评论（你可以看到，可回复其中某人，也可 @某人）：\n';
        prevComments.forEach(function (pc) { sys += '- ' + (pc.authorHandle || pc.authorName) + '：' + pc.text + (pc.replyToName ? ' （回复 ' + pc.replyToName + '）' : '') + '\n'; });
      }
      sys += '\n可以 @ 的人：' + mentionables.join('、') + '（在评论里用 @名字 的形式提及）\n';
      if (mode === 'reply' && replyTarget) {
        sys += '\n本次主要是回复「' + replyTarget.name + '」的评论。你也可以额外评论朋友圈本身。\n';
      }
      sys += '\n请以你的身份评论。可以写 1-3 条：评论朋友圈本身、回复已有评论里的某人、@某人都可以。\n';
      sys += '\n输出格式（严格遵守，不要多余内容）：\n';
      sys += '<comment reply-to="被回复人名字">评论正文</comment>   （reply-to 可选，回复某人评论时填那人名字；不回复就省略整个 reply-to 属性。可输出多条）\n';
      sys += '<like>1</like> 或 <like>0</like>   （放末尾，1 表示顺便给这条朋友圈点赞，0 表示不点）\n';
      sys += '\n要求：第一人称「我」，符合人设口吻，每条 1-2 句，简短自然，不要 emoji/话题标签。@某人 用 @名字 形式写在评论正文里。';
      sys += '\n注：reply-to 只能填上方「已有评论」里出现过的评论者名字；若只是评论朋友圈本身则必须省略 reply-to。user 未评论时绝对不能填 user 的名字。';
      return callAI({ messages: [{ role: 'system', content: sys }, { role: 'user', content: '写评论。' }], temperature: 0.9 });
    }).then(function (raw) {
      var p = parseCommentResponse(raw);
      var out = [];
      // 构建 reply-to 白名单：只能回复已有评论中出现过的评论者
      var replyWhitelist = {};
      (prevComments || []).forEach(function (pc) {
        if (pc.authorHandle) replyWhitelist[pc.authorHandle] = true;
        if (pc.authorName) replyWhitelist[pc.authorName] = true;
      });
      (p.comments || []).forEach(function (pc) {
        // 校验模型输出的 replyToName：不在白名单则清空（防止幻觉编造评论者）
        var modelRt = pc.replyToName || null;
        if (modelRt && !replyWhitelist[modelRt]) modelRt = null;
        out.push({
          id: uuid(), postId: post.id, authorType: 'char', authorId: sc.charId,
          authorName: sc.charName, authorHandle: sc.charHandle || sc.charName,
          text: pc.text,
          replyTo: (mode === 'reply' && replyTarget && replyTarget.commentId) || null,
          replyToName: (mode === 'reply' && replyTarget && replyTarget.name) || modelRt || null,
          createdAt: Date.now()
        });
      });
      if (!out.length) out.push({ id: uuid(), postId: post.id, authorType: 'char', authorId: sc.charId, authorName: sc.charName, authorHandle: sc.charHandle || sc.charName, text: '…', replyTo: (replyTarget && replyTarget.commentId) || null, replyToName: (replyTarget && replyTarget.name) || null, createdAt: Date.now() });
      return { comments: out, liked: p.liked, sc: sc };
    });
  }
  // NPC 评论生成（氛围组：NPC 是 char 的好友，只在 char 发圈时评论其动态，不挂 Roche 会话记忆）
  function generateNpcComment(space, post, sc, npc, prevComments) {
    var sys = '你是「' + npc.name + '」，「' + sc.charName + '」的好友，正在看「' + sc.charName + '」刚发的微信朋友圈。\n';
    if (npc.bio) sys += '\n你的人设：\n' + npc.bio + '\n';
    var prompts = getSpacePrompts(space);
    if (prompts.npcComment) sys += '\n【评论氛围提示（user 设定，请遵循）】' + prompts.npcComment + '\n';
    sys += '\n这条朋友圈内容：\n' + (post.text || '(仅图片)') + '\n';
    sys += '发朋友圈的是你的好友「' + (sc.charHandle || sc.charName) + '」。\n';
    sys += '\n' + userDualNameLine(space) + '\n';
    var npcRelLine = relationNetLine(space);
    if (npcRelLine) sys += npcRelLine + '\n';
    if (prevComments && prevComments.length) {
      sys += '\n已有评论（你可以看到）：\n';
      prevComments.forEach(function (pc) { sys += '- ' + (pc.authorHandle || pc.authorName) + '：' + pc.text + (pc.replyToName ? ' （回复 ' + pc.replyToName + '）' : '') + '\n'; });
    }
    sys += '\n请以你的身份评论这条朋友圈。写 1 条，简短自然。\n';
    sys += '\n输出格式（严格遵守，不要多余内容）：\n';
    sys += '<comment>评论正文</comment>\n';
    sys += '<like>1</like> 或 <like>0</like>   （放末尾，1 表示顺便点赞，0 表示不点）\n';
    sys += '\n要求：第一人称「我」，符合人设口吻，1-2 句，不要 emoji/话题标签。';
    return callAI({ messages: [{ role: 'system', content: sys }, { role: 'user', content: '写评论。' }], temperature: 0.9 }).then(function (raw) {
      var p = parseCommentResponse(raw);
      var out = [];
      (p.comments || []).forEach(function (pc) {
        out.push({
          id: uuid(), postId: post.id, authorType: 'npc', authorId: 'npc_' + npc.id,
          authorName: npc.name, authorHandle: npc.handle,
          text: pc.text, replyTo: null, replyToName: pc.replyToName || null, createdAt: Date.now()
        });
      });
      if (!out.length) out.push({ id: uuid(), postId: post.id, authorType: 'npc', authorId: 'npc_' + npc.id, authorName: npc.name, authorHandle: npc.handle, text: '…', replyTo: null, replyToName: null, createdAt: Date.now() });
      return { comments: out, liked: p.liked, npc: npc };
    });
  }
  // 触发 NPC 评论：只在 char 发圈后调用，每个 NPC 按 NPC_COMMENT_PROBABILITY 概率评论
  function triggerNpcComments(space, post, sc) {
    var npcs = getCharNpcs(sc);
    if (!npcs.length) return Promise.resolve();
    var prevComments = (post.comments || []).slice();
    var chain = Promise.resolve();
    npcs.forEach(function (npc) {
      if (Math.random() >= NPC_COMMENT_PROBABILITY) return;
      chain = chain.then(function () {
        return generateNpcComment(space, post, sc, npc, prevComments).then(function (r) {
          (r.comments || []).forEach(function (comment) { prevComments.push(comment); });
          if (r.liked) {
            var has = false;
            for (var i = 0; i < post.likes.length; i++) if (post.likes[i].id === 'npc_' + npc.id) { has = true; break; }
            if (!has) post.likes.push({ id: 'npc_' + npc.id, name: npc.handle || npc.name, ts: Date.now() });
          }
          var saveChain = Promise.resolve();
          (r.comments || []).forEach(function (comment) {
            saveChain = saveChain.then(function () {
              return Store.addComment(post.id, comment).then(function () {
                return Store.addNotif({ id: uuid(), spaceId: space.id, type: 'comment', fromId: 'npc_' + npc.id, fromName: npc.handle || npc.name, fromAvatar: npc.avatar || '', postId: post.id, postSnippet: (post.text || '').slice(0, 30), text: '评论：' + comment.text, createdAt: Date.now(), read: false });
              });
            });
          });
          return saveChain;
        }).catch(function (e) { console.warn('[Moments] NPC 评论失败', npc.name, e); });
      });
    });
    return chain.then(function () { return Store.savePosts(); });
  }
  // 容错：单个 char 失败不中断；forceCharIds 为必定参与评论的 char（user @触发）
  function generateAutoComments(space, post, count, forceCharIds) {
    // 批量模型决策：把多个 char 的人设/最近朋友圈/记忆打包给模型，由模型决定谁评论
    var pool = (space.chars || []).filter(function (c) { return c.commentEnabled; });
    if (!pool.length) return Promise.resolve([]);
    // 被 @ 的 char 必须评论
    var mandatory = [];
    if (forceCharIds && forceCharIds.length) {
      forceCharIds.forEach(function (cid) {
        for (var i = 0; i < pool.length; i++) if (pool[i].charId === cid) { mandatory.push(pool[i]); break; }
      });
    }
    var rest = pool.filter(function (c) {
      for (var i = 0; i < mandatory.length; i++) if (mandatory[i].charId === c.charId) return false;
      return true;
    });
    var candidates;
    if (pool.length <= 4) {
      candidates = mandatory.concat(rest);
    } else {
      var n = 3 + Math.floor(Math.random() * 2); // 3 或 4
      var need = Math.max(0, n - mandatory.length);
      candidates = mandatory.concat(randPick(rest, Math.min(need, rest.length)));
    }
    // 去重
    var seen = {}; candidates = candidates.filter(function (c) { if (seen[c.charId]) return false; seen[c.charId] = true; return true; });
    if (!candidates.length) return Promise.resolve([]);

    // 预计算每个候选 char 最近 1 条朋友圈
    var recentByChar = {};
    candidates.forEach(function (sc) {
      for (var i = 0; i < state.posts.length; i++) {
        var p = state.posts[i];
        if (p.authorType === 'char' && p.authorId === sc.charId) { recentByChar[sc.charId] = p; break; }
      }
    });
    // 并行加载记忆
    return Promise.all(candidates.map(function (sc) { return loadMountedMemory(sc); })).then(function (mems) {
      var prompts = getSpacePrompts(space);
      var sys = '你正在模拟多个 char 同时看一条微信朋友圈，并决定哪些 char 想评论。\n\n';
      sys += '本次可能参与评论的 char：\n';
      candidates.forEach(function (sc, idx) {
        var c = findChar(sc.charId) || {};
        var persona = (c.persona || c.bio || sc.charPersona || '').slice(0, 400);
        sys += '【' + sc.charName + '】@' + (sc.charHandle || sc.charName) + '\n';
        if (persona) sys += '人设：' + persona + '\n';
        if (sc.customIdentity) sys += '关系网身份：' + sc.customIdentity + '\n';
        var rp = recentByChar[sc.charId];
        if (rp) sys += '最近朋友圈：[' + formatStamp(rp.createdAt) + '] ' + ((rp.text || '(仅图片)').slice(0, 60)) + '\n';
        var mem = (mems[idx] || '').slice(0, 800);
        if (mem) sys += '记忆：' + mem + '\n';
        sys += '\n';
      });
      sys += '---\n' + userDualNameLine(space) + '\n\n';
      var autoRelLine = relationNetLine(space);
      if (autoRelLine) sys += autoRelLine + '\n\n';
      var mentionables = [];
      mentionables.push(space.userPersonaHandle || space.userPersonaName);
      (space.chars || []).forEach(function (ch) { if (ch.postEnabled || ch.commentEnabled) mentionables.push(ch.charHandle || ch.charName); });
      sys += '可以 @ 的人：' + mentionables.join('、') + '（在评论里用 @名字 形式提及）\n';
      if (prompts.charComment) sys += '【评论氛围提示（user 设定，请遵循）】' + prompts.charComment + '\n';
      if (mandatory.length) sys += '被明确 @ 的 char（必须评论至少一条）：' + mandatory.map(function (sc) { return '@' + (sc.charHandle || sc.charName); }).join('、') + '\n';
      sys += '\n请基于每个 char 的人设、最近朋友圈和记忆，决定哪些 char 想评论这条朋友圈。不想评论的可以不输出。至少保证 1 个 char 评论。char 之间可以互相回复。\n';
      sys += '\n这条朋友圈内容：[' + formatStamp(post.createdAt) + '] ' + (post.text || '(仅图片)') + '\n';
      sys += post.authorType === 'user' ? '发朋友圈的是 user（' + (space.userPersonaHandle || space.userPersonaName) + '）。\n' : '发朋友圈的是 ' + (post.authorHandle || post.authorName) + '。\n';
      var prevComments = (post.comments || []).slice();
      if (prevComments.length) {
        sys += '\n已有评论（char 们可以看到，可回复其中某人）：\n';
        prevComments.forEach(function (pc) { sys += '- ' + (pc.authorHandle || pc.authorName) + '（' + formatStamp(pc.createdAt) + '）：' + pc.text + (pc.replyToName ? ' （回复 ' + pc.replyToName + '）' : '') + '\n'; });
      }
      sys += '\n输出格式（严格遵守，不要多余内容）：\n';
      sys += '<comment author="charHandle" reply-to="被回复人名字(可省略)">评论正文</comment>\n';
      sys += '可输出多条，每条由不同 char 发出（author 必须是上面列出的 handle 之一）。\n';
      sys += '<like author="charHandle">1</like>   （放末尾，表示该 char 给这条朋友圈点赞；不点就不输出）\n';
      sys += '\n要求：每个 char 第一人称「我」，符合各自人设口吻，每条 1-2 句简短自然，不要 emoji/话题标签。@某人 用 @名字 形式写在评论正文里。';
      sys += '\n注：reply-to 只能填上方「已有评论」里出现过的评论者名字；若只是评论朋友圈本身则必须省略 reply-to。user 未评论时绝对不能填 user 的名字。';
      return callAI({ messages: [{ role: 'system', content: sys }, { role: 'user', content: '让 char 们评论这条朋友圈。' }], temperature: 0.9 });
    }).then(function (raw) {
      var text = trim(raw || '');
      // 解析批量输出（author + reply-to 属性，顺序不限）
      var parsedComments = [];
      var cmRe = /<comment\b([^>]*)>([\s\S]*?)<\/comment>/gi; var m;
      while ((m = cmRe.exec(text))) {
        var attrs = m[1] || '';
        var handle = trim((attrs.match(/author="([^"]*)"/) || [])[1] || '');
        var replyTo = trim((attrs.match(/reply-to="([^"]*)"/) || [])[1] || '');
        var cText = trim(m[2] || '');
        if (cText) parsedComments.push({ handle: handle, replyToName: replyTo || null, text: cText });
      }
      var parsedLikes = [];
      var lkRe = /<like\b([^>]*)>\s*1\s*<\/like>/gi;
      while ((m = lkRe.exec(text))) { var lh = trim(((m[1] || '').match(/author="([^"]*)"/) || [])[1] || ''); if (lh) parsedLikes.push(lh); }
      // 兼容旧格式：无 author 属性时全归第一个候选 char
      if (!parsedComments.length) {
        var bare = trim(text.replace(/<like[\s\S]*?<\/like>/gi, ''));
        if (bare) parsedComments.push({ handle: '', replyToName: null, text: bare });
      }
      // handle 匹配回 charId
      var handleMap = {};
      candidates.forEach(function (sc) { handleMap[sc.charHandle || sc.charName] = sc; handleMap[sc.charName] = sc; });
      var results = [];
      // 构建 reply-to 白名单：只能回复已有评论中出现过的评论者
      var replyWhitelist = {};
      (post.comments || []).forEach(function (pc) {
        if (pc.authorHandle) replyWhitelist[pc.authorHandle] = true;
        if (pc.authorName) replyWhitelist[pc.authorName] = true;
      });
      parsedComments.forEach(function (pc) {
        var sc = handleMap[pc.handle] || candidates[0];
        // 校验 replyToName：不在白名单则清空（防止模型幻觉编造不存在的评论者）
        var rt = pc.replyToName || null;
        if (rt && !replyWhitelist[rt]) rt = null;
        results.push({
          id: uuid(), postId: post.id, authorType: 'char', authorId: sc.charId,
          authorName: sc.charName, authorHandle: sc.charHandle || sc.charName,
          text: pc.text, replyTo: null, replyToName: rt, createdAt: Date.now()
        });
      });
      // 兜底：被 @ 的 char 必须评论
      mandatory.forEach(function (sc) {
        var has = false;
        for (var i = 0; i < results.length; i++) if (results[i].authorId === sc.charId) { has = true; break; }
        if (!has) results.push({ id: uuid(), postId: post.id, authorType: 'char', authorId: sc.charId, authorName: sc.charName, authorHandle: sc.charHandle || sc.charName, text: '…', replyTo: null, replyToName: null, createdAt: Date.now() });
      });
      // 兜底：至少 1 条
      if (!results.length && candidates.length) {
        var sc0 = candidates[0];
        results.push({ id: uuid(), postId: post.id, authorType: 'char', authorId: sc0.charId, authorName: sc0.charName, authorHandle: sc0.charHandle || sc0.charName, text: '…', replyTo: null, replyToName: null, createdAt: Date.now() });
      }
      // 处理 likes
      parsedLikes.forEach(function (handle) {
        var sc = handleMap[handle]; if (!sc) return;
        var has = false;
        for (var i = 0; i < post.likes.length; i++) if (post.likes[i].id === sc.charId) { has = true; break; }
        if (!has) post.likes.push({ id: sc.charId, name: sc.charHandle || sc.charName, ts: Date.now() });
      });
      // 保存
      var saveChain = Promise.resolve();
      results.forEach(function (comment) {
        saveChain = saveChain.then(function () {
          var sc = candidates.filter(function (c) { return c.charId === comment.authorId; })[0] || {};
          return Store.addComment(post.id, comment).then(function () {
            return Store.addNotif({ id: uuid(), spaceId: space.id, type: 'comment', fromId: comment.authorId, fromName: comment.authorHandle || comment.authorName, fromAvatar: sc.charAvatar || '', postId: post.id, postSnippet: (post.text || '').slice(0, 30), text: comment.replyToName ? '回复了 ' + comment.replyToName + '：' + comment.text : '评论：' + comment.text, createdAt: Date.now(), read: false });
          });
        });
      });
      return saveChain.then(function () { return Store.savePosts(); }).then(function () { return results; });
    }).catch(function (e) { console.warn('[Moments] 批量评论失败', e); return []; });
  }

  // ========== 同步：方式1 直接 IndexedDB 注入（第一人称"我"）==========
  function openRocheDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('Roche_db');
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function addMsgRecord(db, store, msg) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(store, 'readwrite').objectStore(store).add(msg);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function buildActionSummary(space, sc, sinceTs) {
    var userHandle = space.userPersonaHandle || space.userPersonaName;
    var myNames = [sc.charHandle, sc.charName].filter(Boolean);
    // 判断一段文本是否 @ 了本 char（按 handle/name 匹配）
    function mentionsMe(text) {
      if (!text) return false;
      for (var i = 0; i < myNames.length; i++) if (text.indexOf('@' + myNames[i]) >= 0) return true;
      return false;
    }
    // 5 分类：①我发的朋友圈(含自评/自赞) ②别人在我朋友圈下的互动 ③我对user朋友圈的互动 ④我对其他char朋友圈的互动 ⑤别人@我的评论
    var myPosts = [], othersOnMyPosts = [], userInteractions = [], otherCharInteractions = [], mentionMe = [];
    state.posts.forEach(function (p) {
      if (p.spaceId !== space.id) return;
      if (p.createdAt <= sinceTs) return;
      var isMyPost = p.authorType === 'char' && p.authorId === sc.charId;
      var onName = p.authorType === 'user' ? userHandle : (p.authorHandle || p.authorName);
      var postLine = '[' + formatStamp(p.createdAt) + '] ' + (p.text || '(仅图片)');
      var postText = (p.text || '(仅图片)').slice(0, 50);
      // ① 我发的朋友圈（含自评/自赞，按时间排序）
      if (isMyPost) {
        var entry = { postLine: postLine, postTs: p.createdAt, postText: postText, selfActions: [] };
        if (p.comments) p.comments.forEach(function (c) {
          if (c.authorType !== 'char' || c.authorId !== sc.charId) return;
          if (c.createdAt <= sinceTs) return;
          entry.selfActions.push({ ts: c.createdAt, kind: 'comment', replyToName: c.replyToName, text: c.text });
        });
        if (p.likes) for (var i = 0; i < p.likes.length; i++) {
          if (p.likes[i].id === sc.charId) {
            var lkTs = p.likes[i].ts || p.createdAt;
            if (lkTs > sinceTs) entry.selfActions.push({ ts: lkTs, kind: 'like' });
          }
        }
        entry.selfActions.sort(function (a, b) { return a.ts - b.ts; });
        myPosts.push(entry);
      }
      // 评论遍历（②③④⑤）
      if (p.comments) p.comments.forEach(function (c) {
        if (c.createdAt <= sinceTs) return;
        var isMine = c.authorType === 'char' && c.authorId === sc.charId;
        var fromName = c.authorHandle || c.authorName;
        // ⑤ 别人 @ 我的评论
        if (!isMine && mentionsMe(c.text)) {
          mentionMe.push({ ts: c.createdAt, fromName: fromName, onName: onName, postText: postText, text: c.text, replyToName: c.replyToName });
        }
        // ② 别人在我朋友圈下的评论
        if (isMyPost && !isMine) {
          othersOnMyPosts.push({ ts: c.createdAt, kind: 'comment', fromName: fromName, postText: postText, text: c.text, replyToName: c.replyToName });
        }
        // ③④ 我对别人朋友圈的评论
        if (!isMyPost && isMine) {
          var item = { ts: c.createdAt, kind: 'comment', replyToName: c.replyToName, text: c.text, onName: onName, postText: postText };
          if (p.authorType === 'user') userInteractions.push(item);
          else otherCharInteractions.push(item);
        }
      });
      // 点赞遍历（②③④；自赞已在①处理）
      if (p.likes) for (var j = 0; j < p.likes.length; j++) {
        var lk = p.likes[j];
        var lkTs2 = lk.ts || p.createdAt;
        if (lkTs2 <= sinceTs) continue;
        // ② 别人给我点赞
        if (isMyPost && lk.id !== sc.charId) {
          othersOnMyPosts.push({ ts: lkTs2, kind: 'like', fromName: lk.name, postText: postText });
        }
        // ③④ 我给别人的点赞
        if (!isMyPost && lk.id === sc.charId) {
          var lItem = { ts: lkTs2, kind: 'like', onName: onName, postText: postText };
          if (p.authorType === 'user') userInteractions.push(lItem);
          else otherCharInteractions.push(lItem);
        }
      }
    });
    var sf = getSyncFormat(space);
    var gVars = { now: formatStamp(Date.now()), userHandle: userHandle, userName: space.userPersonaName || '', charName: sc.charName, charHandle: sc.charHandle || '' };
    var L = [];
    // 开头行
    L.push(applyTemplate(sf.header, gVars) || (SYNC_PREFIX + ' · 我的朋友圈行为记录 · ' + gVars.now + ']'));
    // user 双名字认知行
    if (sf.userLine) L.push(applyTemplate(sf.userLine, gVars));
    else L.push(userDualNameLine(space));
    // 导语
    L.push(''); L.push(applyTemplate(sf.intro, gVars) || '我刚在朋友圈做了这些事 / 看到了这些与我有关的动态（按时间标签排列）：'); L.push('');
    // ① 我发的朋友圈（含自评/自赞）
    if (myPosts.length) {
      L.push('【我发的朋友圈】');
      var tpls1 = sf.cat1 ? parseLabeledTemplate(sf.cat1) : null;
      myPosts.forEach(function (entry) {
        if (tpls1 && tpls1.post) {
          L.push(applyTemplate(tpls1.post, { ts: formatStamp(entry.postTs), postText: entry.postText, postLine: entry.postLine }));
        } else {
          L.push('- ' + entry.postLine);
        }
        entry.selfActions.forEach(function (a) {
          var kind = a.kind === 'like' ? 'like' : (a.replyToName ? 'reply' : 'comment');
          if (tpls1 && tpls1[kind]) {
            L.push('  ' + applyTemplate(tpls1[kind], { actionTs: formatStamp(a.ts), replyToName: a.replyToName || '', text: a.text || '' }));
          } else {
            if (a.kind === 'like') L.push('  · [' + formatStamp(a.ts) + '] 我给自己的朋友圈点了赞');
            else if (a.replyToName) L.push('  · [' + formatStamp(a.ts) + '] 我回复了自己朋友圈下 ' + a.replyToName + ' 的评论：' + a.text);
            else L.push('  · [' + formatStamp(a.ts) + '] 我评论道：' + a.text);
          }
        });
      });
      L.push('');
    }
    // ② 别人在我朋友圈下的互动
    if (othersOnMyPosts.length) {
      L.push('【别人在我朋友圈下的互动】');
      othersOnMyPosts.sort(function (a, b) { return a.ts - b.ts; });
      var tpls2 = sf.cat2 ? parseLabeledTemplate(sf.cat2) : null;
      othersOnMyPosts.forEach(function (c) {
        var kind = c.kind === 'like' ? 'like' : (c.replyToName ? 'reply' : 'comment');
        if (tpls2 && tpls2[kind]) {
          L.push(applyTemplate(tpls2[kind], { ts: formatStamp(c.ts), fromName: c.fromName, postText: c.postText, replyToName: c.replyToName || '', text: c.text || '' }));
        } else {
          if (c.kind === 'like') L.push('- [' + formatStamp(c.ts) + '] ' + c.fromName + ' 给我「' + c.postText + '」的朋友圈点了赞');
          else if (c.replyToName) L.push('- [' + formatStamp(c.ts) + '] ' + c.fromName + ' 回复了我「' + c.postText + '」朋友圈下 ' + c.replyToName + ' 的评论：' + c.text);
          else L.push('- [' + formatStamp(c.ts) + '] ' + c.fromName + ' 评论了我的朋友圈「' + c.postText + '」：' + c.text);
        }
      });
      L.push('');
    }
    // ③ 我对 user 朋友圈的互动
    if (userInteractions.length) {
      L.push('【我对 user（' + userHandle + '）朋友圈的互动】');
      userInteractions.sort(function (a, b) { return a.ts - b.ts; });
      var tpls3 = sf.cat3 ? parseLabeledTemplate(sf.cat3) : null;
      userInteractions.forEach(function (c) {
        var kind = c.kind === 'like' ? 'like' : (c.replyToName ? 'reply' : 'comment');
        if (tpls3 && tpls3[kind]) {
          L.push(applyTemplate(tpls3[kind], { ts: formatStamp(c.ts), onName: c.onName, postText: c.postText, replyToName: c.replyToName || '', text: c.text || '', userHandle: userHandle }));
        } else {
          if (c.kind === 'like') L.push('- [' + formatStamp(c.ts) + '] 我给 user「' + c.postText + '」的朋友圈点了赞');
          else if (c.replyToName) L.push('- [' + formatStamp(c.ts) + '] 我回复了 ' + c.replyToName + ' 在 user「' + c.postText + '」朋友圈下的评论：' + c.text);
          else L.push('- [' + formatStamp(c.ts) + '] 我评论了 user 的朋友圈「' + c.postText + '」：' + c.text);
        }
      });
      L.push('');
    }
    // ④ 我对其他 char 朋友圈的互动
    if (otherCharInteractions.length) {
      L.push('【我对其他 char 朋友圈的互动】');
      otherCharInteractions.sort(function (a, b) { return a.ts - b.ts; });
      var tpls4 = sf.cat4 ? parseLabeledTemplate(sf.cat4) : null;
      otherCharInteractions.forEach(function (c) {
        var kind = c.kind === 'like' ? 'like' : (c.replyToName ? 'reply' : 'comment');
        if (tpls4 && tpls4[kind]) {
          L.push(applyTemplate(tpls4[kind], { ts: formatStamp(c.ts), onName: c.onName, postText: c.postText, replyToName: c.replyToName || '', text: c.text || '' }));
        } else {
          if (c.kind === 'like') L.push('- [' + formatStamp(c.ts) + '] 我给 ' + c.onName + '「' + c.postText + '」的朋友圈点了赞');
          else if (c.replyToName) L.push('- [' + formatStamp(c.ts) + '] 我回复了 ' + c.replyToName + ' 在 ' + c.onName + '「' + c.postText + '」朋友圈下的评论：' + c.text);
          else L.push('- [' + formatStamp(c.ts) + '] 我评论了 ' + c.onName + ' 的朋友圈「' + c.postText + '」：' + c.text);
        }
      });
      L.push('');
    }
    // ⑤ 别人 @ 我的评论
    if (mentionMe.length) {
      L.push('【别人 @ 我的评论】');
      mentionMe.sort(function (a, b) { return a.ts - b.ts; });
      var tpls5 = sf.cat5 ? parseLabeledTemplate(sf.cat5) : null;
      mentionMe.forEach(function (c) {
        var kind = c.replyToName ? 'mentionReply' : 'mention';
        if (tpls5 && tpls5[kind]) {
          L.push(applyTemplate(tpls5[kind], { ts: formatStamp(c.ts), fromName: c.fromName, onName: c.onName, postText: c.postText, replyToName: c.replyToName || '', text: c.text || '' }));
        } else {
          if (c.replyToName) L.push('- [' + formatStamp(c.ts) + '] ' + c.fromName + ' 在 ' + c.onName + '「' + c.postText + '」朋友圈下回复 ' + c.replyToName + ' 时 @ 了我：' + c.text);
          else L.push('- [' + formatStamp(c.ts) + '] ' + c.fromName + ' 在 ' + c.onName + '「' + c.postText + '」朋友圈下 @ 了我：' + c.text);
        }
      });
      L.push('');
    }
    // 5 分类全空：没有任何新行为，返回 null 让调用方跳过注入（不写空记录到聊天）
    if (!myPosts.length && !othersOnMyPosts.length && !userInteractions.length && !otherCharInteractions.length && !mentionMe.length) {
      return null;
    }
    L.push(applyTemplate(sf.footer, gVars) || '这是我的私人记忆记录，不必向 user 复述，但可以在对话中自然延续相关话题。');
    return L.join('\n');
  }
  function injectCharActionToChat(space, sc) {
    var sinceTs = Store.getSyncTs(space.id, sc.charId);
    var dmMount = null;
    (sc.memoryMounts || []).forEach(function (m) { if (m.enabled && !m.isGroup) dmMount = m; });
    if (!dmMount) return Promise.resolve({ ok: false, reason: '该 char 未挂载单聊会话' });
    var summary = buildActionSummary(space, sc, sinceTs);
    // 没有新行为时不注入空记录（buildActionSummary 返回 null 表示全空）
    if (!summary) return Promise.resolve({ ok: false, reason: '没有可同步的新行为' });
    var convId = dmMount.conversationId;
    return openRocheDb().then(function (db) {
      var now = Date.now();
      var msg = { id: now + Math.floor(Math.random() * 1000), isMe: false, text: summary, senderId: sc.charId, timestamp: now, senderName: sc.charName, conversationId: convId };
      if (convId.slice(-8) === '_offline') msg.isStreaming = false;
      return addMsgRecord(db, 'messages', msg).then(function () {
        db.close(); sc.lastSyncAt = now;
        return Store.setSyncTs(space.id, sc.charId, now);
      }).then(function () {
        return Store.saveSpaces();
      }).then(function () {
        return { ok: true };
      });
    }).catch(function (e) { return { ok: false, reason: (e && e.message) || 'DB 错误' }; });
  }
  // 实时批量注入：召唤评论/发圈后立即把新行为注入到对应 char 的单聊短期记忆
  // charIds 去重后逐个调用 injectCharActionToChat，跳过未开 memSync 的 char
  function injectCharsRealtime(space, charIds) {
    if (!space || !charIds || !charIds.length) return Promise.resolve();
    var seen = {}; var uniq = [];
    charIds.forEach(function (cid) { if (!seen[cid]) { seen[cid] = true; uniq.push(cid); } });
    var chain = Promise.resolve();
    uniq.forEach(function (cid) {
      var sc = getSpaceChar(space, cid);
      if (!sc || !sc.memSync) return;
      chain = chain.then(function () {
        return injectCharActionToChat(space, sc).then(function (r) {
          if (r && !r.ok && r.reason && r.reason.indexOf('DB') >= 0) {
            console.warn('[Moments] realtime inject fail', sc.charName, r.reason);
          }
        });
      });
    });
    return chain;
  }
  // 方式2：手动写事实记忆
  function syncCharToFactMemory(space, sc) {
    var sinceTs = Store.getSyncTs(space.id, sc.charId);
    var dmMount = null;
    (sc.memoryMounts || []).forEach(function (m) { if (m.enabled && !m.isGroup) dmMount = m; });
    if (!dmMount) return Promise.resolve({ ok: false, reason: '该 char 未挂载单聊会话' });
    var actions = [];
    state.posts.forEach(function (p) {
      if (p.spaceId !== space.id) return;
      if (p.authorType === 'char' && p.authorId === sc.charId && p.createdAt > sinceTs) actions.push('发了朋友圈：' + (p.text || '').slice(0, 40));
      if (p.comments) p.comments.forEach(function (c) { if (c.authorType === 'char' && c.authorId === sc.charId && c.createdAt > sinceTs) actions.push('评论了' + (p.authorHandle || p.authorName) + '的朋友圈'); });
      if (p.likes) p.likes.forEach(function (l) { if (l.id === sc.charId && p.createdAt > sinceTs) actions.push('点赞了' + (p.authorHandle || p.authorName) + '的朋友圈'); });
    });
    if (!actions.length) return Promise.resolve({ ok: false, reason: '没有可同步的新行为' });
    return callAI({
      messages: [{ role: 'system', content: '请把以下角色行为总结成一段简洁的事实记录，用于写入角色的长期记忆。用第三人称描述 ' + sc.charName + ' 的行为；一段话，100 字以内。' }, { role: 'user', content: '行为列表：\n' + actions.join('\n') }],
      temperature: 0.5
    }).then(function (summaryText) {
      return cachedRoche.memory.write({ conversationId: dmMount.conversationId, summaryText: summaryText, who: [sc.charName], action: '朋友圈行为记录', when: '最近', where: '朋友圈', source: 'plugin:roche-moments' }).then(function () {
        var now = Date.now(); sc.lastSyncAt = now; Store.setSyncTs(space.id, sc.charId, now); Store.saveSpaces(); return { ok: true, summary: summaryText };
      });
    }).catch(function (e) { return { ok: false, reason: (e && e.message) || 'AI 或写入失败' }; });
  }

  // ========== 后台定时器 ==========
  function startBgTimer() {
    if (window.__rocheMomentsBgStarted) return;
    window.__rocheMomentsBgStarted = true;
    setInterval(function () { checkBgTasks(); }, BG_CHECK_INTERVAL);
    setTimeout(function () { checkBgTasks(); }, 3000);
  }
  function checkBgTasks() {
    if (!cachedRoche) return;
    Store.loadAll().then(function () {
      var now = Date.now(); var tasks = [];
      state.spaces.forEach(function (space) {
        (space.chars || []).forEach(function (sc) {
          if (!sc.postEnabled) return;
          if (!sc.nextPostAt) { sc.nextPostAt = now + randomInterval(sc.postIntervalMin || 30); tasks.push(function () { return Store.saveSpaces(); }); }
          else if (now >= sc.nextPostAt) {
            sc.nextPostAt = now + randomInterval(sc.postIntervalMin || 30);
            tasks.push(function () {
              return Store.saveSpaces().then(function () {
                // char 发圈自带主动评论，不再触发其他 char 评论
                return generateCharPost(space, sc).then(function () { if (root) render(); }).catch(function (e) { console.warn('[Moments] 后台生成失败', e); });
              });
            });
          }
        });
      });
      var chain = Promise.resolve();
      tasks.forEach(function (t) { chain = chain.then(t); });
      return chain;
    }).catch(function () {});
  }

  // ========== 局部提示 / toast ==========
  function setTip(msg) { state.tip = msg || null; if (root) render(); }
  function toast(msg) { if (cachedRoche && cachedRoche.ui && cachedRoche.ui.toast) cachedRoche.ui.toast(msg); }
  function confirmBox(opt) { if (cachedRoche && cachedRoche.ui && cachedRoche.ui.confirm) return cachedRoche.ui.confirm(opt); return Promise.resolve(window.confirm(opt.message || '确认？')); }

  // ========== 渲染 ==========
  // 保存/恢复所有滚动容器的 scrollTop，避免重渲染跳顶
  var SCROLL_SEL = ['.moments-scroll', '.moments-sidebar', '.moments-modal-bd', '.moments-sheet'];
  function captureScrolls() {
    var map = {};
    if (!root) return map;
    SCROLL_SEL.forEach(function (sel) {
      var els = root.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) map[sel + '#' + i] = els[i].scrollTop;
    });
    return map;
  }
  function restoreScrolls(map) {
    if (!root || !map) return;
    SCROLL_SEL.forEach(function (sel) {
      var els = root.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) {
        var k = sel + '#' + i;
        if (map[k] != null) { try { els[i].scrollTop = map[k]; } catch (e) {} }
      }
    });
  }
  function render() {
    if (!root) return;
    if (state.bootLoading) {
      root.innerHTML = '<div class="' + ROOT_CLASS + '"><div class="moments-boot"><div class="moments-spin">' + WINDMILL_SVG + '</div><div class="moments-boot-text">加载中...</div></div></div>';
      return;
    }
    // 保存所有滚动容器位置，避免重渲染跳顶
    var savedScrolls = state._suppressScrollRestore ? {} : captureScrolls();
    var space = Store.getActiveSpace();
    var rootCls = ROOT_CLASS + (state.darkMode ? ' dark' : '') + (state.commentTarget ? ' commenting' : '');
    var html = '<div class="' + rootCls + '" style="--topbar-pad:' + Math.max(0, (state.uiPrefs.topbarH || 44) - 44) + 'px;--bottom-pad:' + (state.uiPrefs.bottomPad || 80) + 'px;">';
    // 滚动区：顶栏 sticky + 封面 + feed
    html += '<div class="moments-scroll">';
    html += renderTopbar(space);
    html += renderCover(space);
    html += renderFeed(space);
    html += '</div>';
    // 浮层（与滚动区同级，覆盖整个 root）
    if (state.sidebarOpen) html += renderSidebar(space);
    if (state.postModalOpen) html += renderPostModal(space);
    if (state.editModalOpen) html += renderEditPostModal(space);
    if (state.notifPanelOpen) html += renderNotifPanel(space);
    if (state.subjectSheetOpen) html += renderSubjectSheet(space);
    if (state.lpSheetOpen) html += renderLpSheet();
    if (state.memMountCharId) html += renderMemMountModal(space, state.memMountCharId);
    if (state.subApiPanelOpen) html += renderSubApiPanel();
    if (state.charListOpen) html += renderCharListModal(space);
    if (state.moodPromptsOpen) html += renderMoodPromptsModal(space);
    if (state.npcModalCharId) html += renderNpcModal(space, state.npcModalCharId);
    if (state.relationNetOpen) html += renderRelationNetModal(space);
    if (state.syncFormatOpen) html += renderSyncFormatModal(space);
    if (state.uiPrefsOpen) html += renderUiPrefsModal();
    if (state.commentTarget) html += renderCommentInput();
    html += '</div>';
    root.innerHTML = html;
    // 恢复滚动位置
    if (!state._suppressScrollRestore) restoreScrolls(savedScrolls);
    state._suppressScrollRestore = false;
    if (state.postModalOpen) setupPostModalTools();
    if (state.editModalOpen) { setupPostModalTools(); refreshPostImages(); }
    // 评论输入框出现时，把目标帖子滚到可见区域（避免被输入栏遮挡）
    if (state.commentTarget) {
      var tgt = $('.moment[data-id="' + state.commentTarget.postId + '"] .moment-acts', root);
      if (tgt) tgt.scrollIntoView({ block: 'nearest' });
    }
  }

  // 顶栏：黑底白字微信风格
  function renderTopbar(space) {
    var unread = 0; state.notifs.forEach(function (n) { if (!n.read) unread++; });
    return '<div class="moments-topbar">' +
      '<div class="moments-tb-left" data-action="back">' + ICON.back + '</div>' +
      '<div class="moments-tb-title" data-dbl="open-sidebar" title="双击打开侧边栏">朋友圈</div>' +
      '<div class="moments-tb-right">' +
        '<span class="moments-tb-icon" data-action="open-post-modal">' + ICON.camera + '</span>' +
        '<span class="moments-tb-icon moments-tb-bell' + (unread ? ' has-dot' : '') + '" data-action="open-notif">' + ICON.bell + (unread ? '<i class="moments-dot"></i>' : '') + '</span>' +
      '</div></div>';
  }

  // 封面：wrapper 布局，avatar 伸出不被裁
  function renderCover(space) {
    if (!space) return '<div class="moments-empty">还没有朋友圈空间，请打开左侧栏选择或创建。</div>';
    var subj = getCurrentSubject();
    // per-char/per-user 封面：char 用 spaceChar.cover，user 用 space.cover
    var cover = '';
    if (subj && subj.type === 'char' && subj.spaceChar) cover = subj.spaceChar.cover || '';
    else cover = space.cover || '';
    var coverBg = cover ? 'background-image:url(' + escapeHtml(cover) + ');' : '';
    return '<div class="moments-cover-wrap">' +
      '<div class="moments-cover" style="' + coverBg + '" data-action="set-cover">' +
        (cover ? '' : '<div class="moments-cover-ph">点击设置封面</div>') +
      '</div>' +
      '<div class="moments-cover-bar">' +
        '<div class="moments-cover-name" data-action="open-subject">' + escapeHtml(subj && subj.name || '') + '</div>' +
        '<div class="moments-cover-avatar" data-action="open-subject">' +
          '<div class="moments-avatar">' + (subj && subj.avatar ? '<img src="' + escapeHtml(subj.avatar) + '">' : '<div class="moments-avatar-fb">' + escapeHtml((subj && subj.name || '?').slice(0, 1)) + '</div>') + '</div>' +
        '</div>' +
      '</div></div>';
  }

  function renderFeed(space) {
    if (!space) return '';
    var posts = state.posts.filter(function (p) { return p.spaceId === space.id; });
    var subj = getCurrentSubject();
    if (subj && subj.type === 'char') posts = posts.filter(function (p) { return p.authorId === subj.id; });
    var html = '<div class="moments-feed">';
    if (state.tip) {
      html += '<div class="moments-tip"><div class="moments-spin sm">' + WINDMILL_SVG + '</div><span>' + escapeHtml(state.tip) + '</span></div>';
    }
    if (!posts.length && !state.tip) {
      html += '<div class="moments-feed-empty">' + ICON.camera + '<div>还没有朋友圈动态</div><div class="moments-fe-hint">点击右上角相机发布</div></div>';
    }
    posts.forEach(function (p) { html += renderMoment(p, space); });
    html += '</div>';
    return html;
  }

  function renderMoment(p, space) {
    var name = p.authorHandle || p.authorName;
    var av = p.authorAvatar;
    var h = '<div class="moment" data-id="' + p.id + '">';
    h += '<div class="moment-hd">';
    h += '<div class="moment-avatar">' + (av ? '<img src="' + escapeHtml(av) + '">' : '<div class="moments-avatar-fb">' + escapeHtml(name.slice(0, 1)) + '</div>') + '</div>';
    h += '<div class="moment-meta"><div class="moment-author" data-action="view-author" data-id="' + p.id + '">' + escapeHtml(name) + '</div>';
    if (p.location) h += '<div class="moment-loc">' + ICON.location + escapeHtml(p.location) + '</div>';
    h += '</div></div>';
    if (p.text) h += '<div class="moment-text">' + escapeHtml(p.text).replace(/\n/g, '<br>') + '</div>';
    if (p.images && p.images.length) {
      h += '<div class="moment-imgs' + (p.images.length === 1 ? ' single' : '') + '">';
      p.images.forEach(function (img, idx) {
        if (img.type === 'text') {
          h += '<div class="m-img-text" data-action="toggle-text" data-id="' + p.id + '" data-idx="' + idx + '">' +
            '<div class="mit-ph">' + ICON.image + '<span>图片</span></div>' +
            '<div class="mit-tx">' + escapeHtml(img.textContent || img.value).replace(/\n/g, '<br>') + '</div></div>';
        } else {
          h += '<div class="m-img" data-action="view-photo" data-id="' + p.id + '" data-idx="' + idx + '"><img src="' + escapeHtml(img.value) + '"></div>';
        }
      });
      h += '</div>';
    }
    h += '<div class="moment-ft"><span class="moment-time">' + formatTime(p.createdAt) + '</span>';
    // 操作气泡容器放在 ft 内部，"··"按钮左侧，定位相对 .moment-ft
    h += '<div class="moment-act-pop" data-id="' + p.id + '"></div>';
    h += '<span class="moment-acts" data-action="open-acts" data-id="' + p.id + '">' + ICON.more + '</span></div>';
    h += renderInteractions(p, space);
    h += '</div>';
    return h;
  }

  function renderInteractions(p, space) {
    var hasLike = p.likes && p.likes.length;
    var hasComment = p.comments && p.comments.length;
    if (!hasLike && !hasComment) return '';
    var h = '<div class="moment-int">';
    if (hasLike) {
      h += '<div class="moment-likes">' + ICON.like + '<span>' + p.likes.map(function (l) { return l.name; }).map(escapeHtml).join('，') + '</span></div>';
    }
    if (hasComment) {
      h += '<div class="moment-comments">';
      (p.comments || []).forEach(function (c) {
        var cn = c.authorHandle || c.authorName;
        h += '<div class="mc" data-action="reply-comment" data-id="' + p.id + '" data-cid="' + c.id + '">';
        h += '<span class="mc-n">' + escapeHtml(cn) + '</span>';
        if (c.replyToName) h += '<span class="mc-r"> 回复 </span><span class="mc-n">' + escapeHtml(c.replyToName) + '</span>';
        // 渲染评论正文（高亮 @提及）
        var txt = escapeHtml(c.text).replace(/@([^\s@，。,.\uff0c\u3002:：]+)/g, '<span class="mc-at">@$1</span>');
        h += '<span class="mc-c">：' + txt.replace(/\n/g, '<br>') + '</span></div>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  // 侧边栏
  function renderSidebar(space) {
    var html = '<div class="moments-mask open" data-action="close-sidebar"></div><div class="moments-sidebar open">';
    html += '<div class="moments-sb-hd"><div class="moments-sb-title">朋友圈</div><div class="moments-sb-close" data-action="close-sidebar">' + ICON.close + '</div></div>';
    html += '<div class="moments-sb-sec"><div class="moments-sb-label">user 人设空间</div>';
    state.allPersonas.forEach(function (per) {
      var sp = null;
      for (var i = 0; i < state.spaces.length; i++) if (state.spaces[i].userPersonaId === per.id) { sp = state.spaces[i]; break; }
      var active = sp && sp.id === state.activeSpaceId;
      html += '<div class="moments-sb-item' + (active ? ' active' : '') + '" data-action="switch-space" data-pid="' + escapeHtml(per.id) + '">';
      html += '<div class="moments-avatar sm">' + (per.avatar ? '<img src="' + escapeHtml(per.avatar) + '">' : '<div class="moments-avatar-fb">' + escapeHtml((per.name || '?').slice(0, 1)) + '</div>') + '</div>';
      html += '<div class="moments-sb-info"><div class="moments-sb-name">' + escapeHtml(per.handle || per.name) + '</div><div class="moments-sb-sub">' + (sp ? sp.chars.length + ' 个 char' : '未创建') + '</div></div></div>';
    });
    html += '</div>';
    if (space) {
      html += '<div class="moments-sb-sec"><div class="moments-sb-label">绑定的 char</div>';
      if (!space.chars.length) html += '<div class="moments-sb-empty">还没有绑定 char</div>';
      space.chars.forEach(function (sc) {
        html += '<div class="moments-sb-item col" data-action="view-char" data-cid="' + escapeHtml(sc.charId) + '">';
        html += '<div class="moments-sb-row"><div class="moments-avatar sm">' + (sc.charAvatar ? '<img src="' + escapeHtml(sc.charAvatar) + '">' : '<div class="moments-avatar-fb">' + escapeHtml((sc.charName || '?').slice(0, 1)) + '</div>') + '</div>';
        html += '<div class="moments-sb-info"><div class="moments-sb-name">' + escapeHtml(sc.charHandle || sc.charName) + '</div><div class="moments-sb-sub">发圈' + (sc.postEnabled ? '开' : '关') + ' · 评论' + (sc.commentEnabled ? '开' : '关') + ' · ' + (sc.postIntervalMin || 30) + '分钟</div></div></div>';
        html += '<div class="moments-sb-btns">';
        html += '<span class="mm-btn" data-action="char-post-now" data-cid="' + escapeHtml(sc.charId) + '">发一条</span>';
        html += '<span class="mm-btn" data-action="open-mem-mount" data-cid="' + escapeHtml(sc.charId) + '">记忆</span>';
        html += '<span class="mm-btn" data-action="open-npc-modal" data-cid="' + escapeHtml(sc.charId) + '">NPC</span>';
        html += '<span class="mm-btn" data-action="sync-trace" data-cid="' + escapeHtml(sc.charId) + '">同步</span>';
        html += '<span class="mm-btn danger" data-action="unbind-char" data-cid="' + escapeHtml(sc.charId) + '">解绑</span>';
        html += '</div></div>';
      });
      html += '<div class="moments-sb-item" data-action="open-char-list"><div class="moments-avatar sm add-av">' + ICON.plus + '</div><div class="moments-sb-info"><div class="moments-sb-name">绑定 char</div></div></div>';
      html += '</div>';
    }
    html += '<div class="moments-sb-sec"><div class="moments-sb-label">设置</div>';
    html += '<div class="moments-sb-item" data-action="toggle-dark"><div class="moments-sb-info"><div class="moments-sb-name">夜间模式</div><div class="moments-sb-sub">' + (state.darkMode ? '已开启' : '已关闭') + '</div></div></div>';
    html += '<div class="moments-sb-item" data-action="open-uiprefs"><div class="moments-sb-info"><div class="moments-sb-name">界面尺寸调整</div><div class="moments-sb-sub">顶栏高度 · 底部安全边距</div></div></div>';
    html += '<div class="moments-sb-item" data-action="open-mood-prompts"><div class="moments-sb-info"><div class="moments-sb-name">氛围提示词</div><div class="moments-sb-sub">自定义发圈/评论氛围</div></div></div>';
    html += '<div class="moments-sb-item" data-action="open-relation-net"><div class="moments-sb-info"><div class="moments-sb-name">关系网</div><div class="moments-sb-sub">身份设定 · 关系（含 user↔char）</div></div></div>';
    html += '<div class="moments-sb-item" data-action="open-sync-format"><div class="moments-sb-info"><div class="moments-sb-name">记忆注入格式</div><div class="moments-sb-sub">自定义轨迹行动注入模板</div></div></div>';
    html += '<div class="moments-sb-item" data-action="open-subapi"><div class="moments-sb-info"><div class="moments-sb-name">副 API 设置</div><div class="moments-sb-sub">' + (getActiveSubApi() ? getActiveSubApi().name : '默认 roche.ai.chat') + '</div></div></div>';
    html += '<div class="moments-sb-item" data-action="clear-img-cache"><div class="moments-sb-info"><div class="moments-sb-name">清除本地图片缓存</div></div></div>';
    html += '</div></div>';
    return html;
  }

  function renderCharListModal(space) {
    var html = '<div class="moments-modal-mask" data-action="close-char-list"><div class="moments-modal" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">选择要绑定的 char</div><div class="moments-modal-x" data-action="close-char-list">' + ICON.close + '</div></div><div class="moments-modal-bd">';
    var bound = {}; space.chars.forEach(function (sc) { bound[sc.charId] = true; });
    if (!state.allChars.length) html += '<div class="moments-empty">没有可用的 char</div>';
    state.allChars.forEach(function (c) {
      if (bound[c.id]) return;
      html += '<div class="moments-sb-item" data-action="bind-char" data-cid="' + escapeHtml(c.id) + '"><div class="moments-avatar sm">' + (c.avatar ? '<img src="' + escapeHtml(c.avatar) + '">' : '<div class="moments-avatar-fb">' + escapeHtml((c.name || '?').slice(0, 1)) + '</div>') + '</div><div class="moments-sb-info"><div class="moments-sb-name">' + escapeHtml(c.handle || c.name) + '</div><div class="moments-sb-sub">' + escapeHtml(c.bio || '') + '</div></div></div>';
    });
    return html + '</div></div></div>';
  }

  function renderMemMountModal(space, charId) {
    var sc = getSpaceChar(space, charId); if (!sc) return '';
    var html = '<div class="moments-modal-mask" data-action="close-mem-mount"><div class="moments-modal wide" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">' + escapeHtml(sc.charHandle || sc.charName) + ' 的记忆挂载</div><div class="moments-modal-x" data-action="close-mem-mount">' + ICON.close + '</div></div><div class="moments-modal-bd">';
    html += '<div class="moments-row"><div class="moments-row-label">主动发朋友圈<span class="moments-sec-hint">后台定时自动发圈</span></div><div class="moments-sw' + (sc.postEnabled ? ' on' : '') + '" data-action="toggle-post" data-cid="' + escapeHtml(charId) + '"><i></i></div></div>';
    html += '<div class="moments-row"><div class="moments-row-label">参与评论<span class="moments-sec-hint">自动评论与被 @ 召唤</span></div><div class="moments-sw' + (sc.commentEnabled ? ' on' : '') + '" data-action="toggle-comment" data-cid="' + escapeHtml(charId) + '"><i></i></div></div>';
    html += '<div class="moments-row"><div class="moments-row-label">关闭时短期记忆注入</div><div class="moments-sw' + (sc.memSync ? ' on' : '') + '" data-action="toggle-mem-sync" data-cid="' + escapeHtml(charId) + '"><i></i></div></div>';
    html += '<div class="moments-row"><div class="moments-row-label">主动发圈间隔（分钟，最小30）</div><input class="moments-input" type="number" min="30" value="' + (sc.postIntervalMin || 30) + '" data-field="interval" data-cid="' + escapeHtml(charId) + '"></div>';
    html += '<div class="moments-row"><div class="moments-row-label">被评论时自动评论数（0-8）</div><input class="moments-input" type="number" min="0" max="8" value="' + (sc.autoCommentCount == null ? DEFAULT_AUTO_COMMENT : sc.autoCommentCount) + '" data-field="autocomment" data-cid="' + escapeHtml(charId) + '"></div>';
    html += '<div class="moments-div"></div><div class="moments-sec-title">挂载的会话记忆<span class="moments-sec-hint">只显示包含该 char 的会话</span></div>';
    var convs = sc._convCache || [];
    if (sc._convLoading) {
      html += '<div class="moments-empty">正在加载会话列表...</div>';
    } else if (!convs.length) {
      html += '<div class="moments-empty">该 char 没有可挂载的会话（需先在 Roche 与该 char 建立单聊或群聊）</div>';
    } else {
      convs.forEach(function (conv) {
        var mount = null; (sc.memoryMounts || []).forEach(function (m) { if (m.conversationId === conv.id) mount = m; });
        var isOn = mount && mount.enabled;
        html += '<div class="moments-conv' + (isOn ? ' on' : '') + '"><div class="moments-conv-hd"><div class="moments-conv-name">' + escapeHtml(conv.name || conv.id) + (conv.isGroup ? ' (群)' : ' (单聊)') + '</div><div class="moments-sw' + (isOn ? ' on' : '') + '" data-action="toggle-mount" data-cid="' + escapeHtml(charId) + '" data-conv="' + escapeHtml(conv.id) + '"><i></i></div></div>';
        if (isOn) {
          html += '<div class="moments-conv-opts"><label>短期 <input type="number" min="0" max="500" value="' + (mount.shortLimit || 50) + '" data-field="short" data-cid="' + escapeHtml(charId) + '" data-conv="' + escapeHtml(conv.id) + '"></label><label>事实 <input type="number" min="0" max="500" value="' + (mount.factLimit || 0) + '" data-field="fact" data-cid="' + escapeHtml(charId) + '" data-conv="' + escapeHtml(conv.id) + '"></label><label>核心 <input type="checkbox" ' + (mount.coreEnabled ? 'checked' : '') + ' data-field="core" data-cid="' + escapeHtml(charId) + '" data-conv="' + escapeHtml(conv.id) + '"></label></div>';
        }
        html += '</div>';
      });
    }
    html += '<div class="moments-div"></div><div class="moments-sec-title">记忆同步</div>';
    html += '<div class="moments-hint">关闭朋友圈 App 时，自动以「我」的口吻把该 char 的朋友圈行为注入到其单聊消息流（直接操作 IndexedDB，仅单聊）。下次单聊时 char 不会失忆。</div>';
    html += '<div class="moments-btn-row"><button class="moments-btn" data-action="sync-fact-now" data-cid="' + escapeHtml(charId) + '">立即同步到事实记忆</button><button class="moments-btn ghost" data-action="close-mem-mount">完成</button></div>';
    return html + '</div></div></div>';
  }

  function renderSubApiPanel() {
    var html = '<div class="moments-modal-mask" data-action="close-subapi"><div class="moments-modal wide" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">副 API 设置</div><div class="moments-modal-x" data-action="close-subapi">' + ICON.close + '</div></div><div class="moments-modal-bd">';
    html += '<div class="moments-hint">兼容 OpenAI 格式。可保存多个预设，同时只能启用一个。不启用则默认走 roche.ai.chat。</div>';
    state.subapi.forEach(function (p) {
      html += '<div class="moments-sa' + (p.enabled ? ' active' : '') + '"><div class="moments-sa-info"><div class="moments-sa-name">' + escapeHtml(p.name) + '</div><div class="moments-sa-sub">' + escapeHtml(p.url) + ' · ' + escapeHtml(p.model) + '</div></div><div class="moments-sa-btns"><button class="mm-btn' + (p.enabled ? ' on' : '') + '" data-action="enable-subapi" data-id="' + escapeHtml(p.id) + '">' + (p.enabled ? '已启用' : '启用') + '</button><button class="mm-btn danger" data-action="del-subapi" data-id="' + escapeHtml(p.id) + '">删除</button></div></div>';
    });
    html += '<div class="moments-div"></div><div class="moments-sec-title">新建预设</div>';
    html += '<div class="moments-form"><label>名称<input class="moments-input" id="moments-sa-name" placeholder="如 OpenAI / DeepSeek"></label><label>Base URL<input class="moments-input" id="moments-sa-url" placeholder="https://api.openai.com/v1"></label><label>API Key<input class="moments-input" id="moments-sa-key" type="password" placeholder="sk-..."></label><div class="moments-form-row"><label>模型<select class="moments-input" id="moments-sa-model"><option value="">先点刷新获取</option></select></label><button class="moments-btn ghost" data-action="refresh-models">刷新模型</button></div><button class="moments-btn" data-action="save-subapi">保存预设</button></div>';
    return html + '</div></div></div>';
  }

  function renderMoodPromptsModal(space) {
    var cp = getSpacePrompts(space);
    var html = '<div class="moments-modal-mask" data-action="close-mood-prompts"><div class="moments-modal wide" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">朋友圈氛围提示词 — ' + escapeHtml(space.userPersonaHandle || space.userPersonaName || '') + '</div><div class="moments-modal-x" data-action="close-mood-prompts">' + ICON.close + '</div></div><div class="moments-modal-bd">';
    html += '<div class="moments-hint">留空则不注入。只影响 AI 生成的氛围倾向，不改变输出格式。三栏分别对应：char 发朋友圈、char 评论、NPC 评论。</div>';
    html += '<div class="moments-mood-label">char 发朋友圈</div>';
    html += '<div class="moments-mood-hint">如：朋友圈少一点争吵，多一些日常分享 / 喜欢在朋友圈抬杠吐槽</div>';
    html += '<textarea class="moments-mood-ta" data-field="mood-charPost" placeholder="留空=不注入">' + escapeHtml(cp.charPost) + '</textarea>';
    html += '<div class="moments-mood-label">char 评论</div>';
    html += '<div class="moments-mood-hint">如：char 评论时温和一些，少抬杠 / 评论尖锐一点更有性格</div>';
    html += '<textarea class="moments-mood-ta" data-field="mood-charComment" placeholder="留空=不注入">' + escapeHtml(cp.charComment) + '</textarea>';
    html += '<div class="moments-mood-label">NPC 评论</div>';
    html += '<div class="moments-mood-hint">如：NPC 评论热闹一些，可以互相接梗 / NPC 安静围观为主</div>';
    html += '<textarea class="moments-mood-ta" data-field="mood-npcComment" placeholder="留空=不注入">' + escapeHtml(cp.npcComment) + '</textarea>';
    html += '<div class="moments-btn-row"><button class="moments-btn ghost" data-action="close-mood-prompts">完成</button></div>';
    return html + '</div></div></div>';
  }

  // 关系网 SVG 蛛网预览：user 居中，char 圆周均匀分布，char 间有向关系带箭头
  function renderRelationNetSvg(space) {
    var chars = (space.chars || []).slice();
    var n = chars.length;
    var cx = 200, cy = 200, r = 140;
    // 计算每个 char 的坐标
    var pos = {};
    chars.forEach(function (sc, i) {
      var angle = (2 * Math.PI * i / Math.max(n, 1)) - Math.PI / 2;
      pos[sc.charId] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), name: sc.charName, handle: sc.charHandle || sc.charName };
    });
    // user 节点居中，加入 pos 映射以便 user↔char 有向关系能绘制
    pos[USER_NODE_ID] = { x: cx, y: cy, name: space.userPersonaName || 'user' };
    var svg = '<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:380px;height:auto;display:block;margin:0 auto;">';
    // defs：箭头 marker
    svg += '<defs><marker id="relArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="rgb(255,92,92)"/></marker></defs>';
    // user-char 绑定虚线
    chars.forEach(function (sc) {
      var p = pos[sc.charId];
      svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p.x.toFixed(1) + '" y2="' + p.y.toFixed(1) + '" stroke="rgb(200,200,200)" stroke-width="1" stroke-dasharray="3,3"/>';
    });
    // char-char 有向关系
    (space.relations || []).forEach(function (rel) {
      var from = pos[rel.fromCid], to = pos[rel.toCid];
      if (!from || !to) return;
      // 缩短线段避免箭头插入节点圆内
      var dx = to.x - from.x, dy = to.y - from.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / dist, uy = dy / dist;
      var x1 = from.x + ux * 26, y1 = from.y + uy * 26;
      var x2 = to.x - ux * 30, y2 = to.y - uy * 30;
      svg += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="rgb(255,92,92)" stroke-width="2" marker-end="url(#relArrow)"/>';
      // 标签居中
      var mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2 - 6;
      svg += '<text x="' + mx.toFixed(1) + '" y="' + my.toFixed(1) + '" text-anchor="middle" font-size="11" fill="rgb(255,92,92)">' + escapeHtml(rel.label || '') + '</text>';
    });
    // user 节点
    var userLabel = (space.userIdentity || 'user').slice(0, 4);
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="30" fill="rgb(77,171,247)" stroke="white" stroke-width="2"/>';
    svg += '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="13" fill="white" font-weight="bold">' + escapeHtml(userLabel) + '</text>';
    // char 节点
    chars.forEach(function (sc) {
      var p = pos[sc.charId];
      svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="24" fill="rgb(255,169,77)" stroke="white" stroke-width="2"/>';
      svg += '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + 4).toFixed(1) + '" text-anchor="middle" font-size="11" fill="white" font-weight="bold">' + escapeHtml(p.name.slice(0, 2)) + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  function renderRelationNetModal(space) {
    var chars = (space.chars || []).slice();
    var html = '<div class="moments-modal-mask" data-action="close-relation-net"><div class="moments-modal wide" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">关系网 — ' + escapeHtml(space.userPersonaHandle || space.userPersonaName || '') + '</div><div class="moments-modal-x" data-action="close-relation-net">' + ICON.close + '</div></div><div class="moments-modal-bd">';
    // 蛛网预览
    html += '<div class="moments-sec-title">蛛网预览</div>';
    if (!chars.length) {
      html += '<div class="moments-empty">尚未绑定任何 char，无法显示关系网</div>';
    } else {
      html += '<div class="moments-relation-svg">' + renderRelationNetSvg(space) + '</div>';
    }
    html += '<div class="moments-div"></div>';
    // user 身份
    html += '<div class="moments-sec-title">user 身份<span class="moments-sec-hint">设定你自己的身份信息</span></div>';
    html += '<input class="moments-input" data-field="rel-user-identity" placeholder="如：公司老板 / 大学生 / 自由职业者" value="' + escapeHtml(space.userIdentity || '') + '">';
    html += '<div class="moments-div"></div>';
    // 各 char 身份
    html += '<div class="moments-sec-title">char 身份<span class="moments-sec-hint">为每个绑定的 char 设定身份</span></div>';
    if (!chars.length) {
      html += '<div class="moments-empty">尚未绑定 char</div>';
    } else {
      chars.forEach(function (sc) {
        html += '<div class="moments-row"><div class="moments-row-label">' + escapeHtml(sc.charName) + '</div>';
        html += '<input class="moments-input" data-field="rel-char-identity" data-cid="' + escapeHtml(sc.charId) + '" placeholder="如：user 的徒弟 / 公司同事" value="' + escapeHtml(sc.customIdentity || '') + '"></div>';
      });
    }
    html += '<div class="moments-div"></div>';
    // 关系（可含 user↔char）
    html += '<div class="moments-sec-title">关系<span class="moments-sec-hint">有向关系（A→B），可连接 user 与 char，如师父、恋人、死对头</span></div>';
    var rels = space.relations || [];
    if (rels.length) {
      rels.forEach(function (rel) {
        var fromName = nodeDisplayName(space, rel.fromCid);
        var toName = nodeDisplayName(space, rel.toCid);
        html += '<div class="moments-npc-item"><div class="moments-npc-item-info"><div class="moments-npc-item-name">' + escapeHtml(fromName) + ' → ' + escapeHtml(toName) + ' <span style="color:#999;font-weight:normal;">（' + escapeHtml(rel.label) + '）</span></div></div><button class="mm-btn danger" data-action="relation-del" data-rel-id="' + escapeHtml(rel.id) + '">删除</button></div>';
      });
    } else {
      html += '<div class="moments-empty">尚未添加关系</div>';
    }
    // 添加关系表单（至少 1 个 char 即可，支持 user↔char）
    if (chars.length >= 1) {
      html += '<div class="moments-div"></div><div class="moments-sec-title">添加关系</div>';
      html += '<div class="moments-form"><label>从<select class="moments-input" id="rel-from">';
      html += '<option value="' + USER_NODE_ID + '">user（' + escapeHtml(space.userPersonaName || '') + '）</option>';
      chars.forEach(function (sc) { html += '<option value="' + escapeHtml(sc.charId) + '">' + escapeHtml(sc.charName) + '</option>'; });
      html += '</select></label><label>到<select class="moments-input" id="rel-to">';
      html += '<option value="' + USER_NODE_ID + '">user（' + escapeHtml(space.userPersonaName || '') + '）</option>';
      chars.forEach(function (sc) { html += '<option value="' + escapeHtml(sc.charId) + '">' + escapeHtml(sc.charName) + '</option>'; });
      html += '</select></label><label>关系标签<input class="moments-input" id="rel-label" placeholder="如：师父/恋人/死对头"></label><button class="moments-btn" data-action="relation-add">添加</button></div>';
    } else {
      html += '<div class="moments-hint">至少绑定 1 个 char 才能添加关系</div>';
    }
    html += '<div class="moments-btn-row"><button class="moments-btn ghost" data-action="close-relation-net">完成</button></div>';
    return html + '</div></div></div>';
  }

  // 自定义轨迹注入格式模态框：user 可自定义 buildActionSummary 输出全部内容
  function renderSyncFormatModal(space) {
    var sf = getSyncFormat(space);
    var userHandle = space.userPersonaHandle || space.userPersonaName || '';
    var html = '<div class="moments-modal-mask" data-action="close-sync-format"><div class="moments-modal wide" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">记忆注入格式 — ' + escapeHtml(userHandle) + '</div><div class="moments-modal-x" data-action="close-sync-format">' + ICON.close + '</div></div><div class="moments-modal-bd">';
    html += '<div class="moments-hint">自定义注入到 char 单聊短期记忆的轨迹行动格式。留空 = 用内置默认。分类模板用 [标签] 行首标记区分子类型。变量用 {varName} 格式。</div>';
    // 变量参考面板
    html += '<div class="moments-sync-vars"><div class="moments-sec-title">可用变量参考</div>';
    html += '<div class="moments-sync-var-group"><b>全局</b>：{now} 当前时间 · {userHandle} user账户名 · {userName} user真名 · {charName} char名 · {charHandle} char账户名</div>';
    html += '<div class="moments-sync-var-group"><b>分类①</b>：[post] {ts} {postText} · [like] {actionTs} · [comment] {actionTs} {text} · [reply] {actionTs} {replyToName} {text}</div>';
    html += '<div class="moments-sync-var-group"><b>分类②③④</b>：[like] {ts} {fromName}/{onName} {postText} · [comment] {ts} {fromName}/{onName} {postText} {text} · [reply] {ts} {fromName}/{onName} {postText} {replyToName} {text}</div>';
    html += '<div class="moments-sync-var-group"><b>分类⑤</b>：[mention] {ts} {fromName} {onName} {postText} {text} · [mentionReply] {ts} {fromName} {onName} {postText} {replyToName} {text}</div>';
    html += '</div>';
    html += '<div class="moments-div"></div>';
    // 全局模板
    html += '<div class="moments-sec-title">开头行<span class="moments-sec-hint">留空=默认 [RocheMomentsSync · 我的朋友圈行为记录 · 时间]</span></div>';
    html += '<textarea class="moments-sync-ta" data-field="sync-header" placeholder="' + escapeHtml(SYNC_PREFIX + ' · 我的朋友圈行为记录 · {now}]') + '">' + escapeHtml(sf.header) + '</textarea>';
    html += '<div class="moments-sec-title">user 双名字认知行<span class="moments-sec-hint">留空=内置默认完整认知行；可用 {userHandle} {userName}</span></div>';
    html += '<textarea class="moments-sync-ta" data-field="sync-userLine" placeholder="留空=内置默认（含 handle 与 name 的完整认知说明）">' + escapeHtml(sf.userLine) + '</textarea>';
    html += '<div class="moments-sec-title">导语<span class="moments-sec-hint">留空=默认导语</span></div>';
    html += '<textarea class="moments-sync-ta" data-field="sync-intro" placeholder="' + escapeHtml('我刚在朋友圈做了这些事 / 看到了这些与我有关的动态（按时间标签排列）：') + '">' + escapeHtml(sf.intro) + '</textarea>';
    html += '<div class="moments-div"></div>';
    // 5 个分类模板
    html += '<div class="moments-sec-title">分类① 我发的朋友圈<span class="moments-sec-hint">每行一种，[post] 朋友圈行 / [like] 自赞 / [comment] 自评 / [reply] 自回复</span></div>';
    html += '<textarea class="moments-sync-ta" data-field="sync-cat1" rows="4" placeholder="' + escapeHtml('[post] - [{ts}] {postText}\n[like]   · [{actionTs}] 我给自己的朋友圈点了赞\n[comment]   · [{actionTs}] 我评论道：{text}\n[reply]   · [{actionTs}] 我回复了自己朋友圈下 {replyToName} 的评论：{text}') + '">' + escapeHtml(sf.cat1) + '</textarea>';
    html += '<div class="moments-sec-title">分类② 别人在我朋友圈的互动<span class="moments-sec-hint">[like] / [comment] / [reply]，变量 {ts} {fromName} {postText} {replyToName} {text}</span></div>';
    html += '<textarea class="moments-sync-ta" data-field="sync-cat2" rows="3" placeholder="' + escapeHtml('[like] - [{ts}] {fromName} 给我「{postText}」的朋友圈点了赞\n[comment] - [{ts}] {fromName} 评论了我的朋友圈「{postText}」：{text}\n[reply] - [{ts}] {fromName} 回复了我「{postText}」朋友圈下 {replyToName} 的评论：{text}') + '">' + escapeHtml(sf.cat2) + '</textarea>';
    html += '<div class="moments-sec-title">分类③ 我对 user 朋友圈的互动<span class="moments-sec-hint">[like] / [comment] / [reply]，变量 {ts} {onName} {postText} {replyToName} {text} {userHandle}</span></div>';
    html += '<textarea class="moments-sync-ta" data-field="sync-cat3" rows="3" placeholder="' + escapeHtml('[like] - [{ts}] 我给 user「{postText}」的朋友圈点了赞\n[comment] - [{ts}] 我评论了 user 的朋友圈「{postText}」：{text}\n[reply] - [{ts}] 我回复了 {replyToName} 在 user「{postText}」朋友圈下的评论：{text}') + '">' + escapeHtml(sf.cat3) + '</textarea>';
    html += '<div class="moments-sec-title">分类④ 我对其他 char 朋友圈的互动<span class="moments-sec-hint">[like] / [comment] / [reply]，变量 {ts} {onName} {postText} {replyToName} {text}</span></div>';
    html += '<textarea class="moments-sync-ta" data-field="sync-cat4" rows="3" placeholder="' + escapeHtml('[like] - [{ts}] 我给 {onName}「{postText}」的朋友圈点了赞\n[comment] - [{ts}] 我评论了 {onName} 的朋友圈「{postText}」：{text}\n[reply] - [{ts}] 我回复了 {replyToName} 在 {onName}「{postText}」朋友圈下的评论：{text}') + '">' + escapeHtml(sf.cat4) + '</textarea>';
    html += '<div class="moments-sec-title">分类⑤ 别人 @ 我的评论<span class="moments-sec-hint">[mention] / [mentionReply]，变量 {ts} {fromName} {onName} {postText} {replyToName} {text}</span></div>';
    html += '<textarea class="moments-sync-ta" data-field="sync-cat5" rows="2" placeholder="' + escapeHtml('[mention] - [{ts}] {fromName} 在 {onName}「{postText}」朋友圈下 @ 了我：{text}\n[mentionReply] - [{ts}] {fromName} 在 {onName}「{postText}」朋友圈下回复 {replyToName} 时 @ 了我：{text}') + '">' + escapeHtml(sf.cat5) + '</textarea>';
    html += '<div class="moments-div"></div>';
    // 结尾
    html += '<div class="moments-sec-title">结尾<span class="moments-sec-hint">留空=默认结尾</span></div>';
    html += '<textarea class="moments-sync-ta" data-field="sync-footer" placeholder="' + escapeHtml('这是我的私人记忆记录，不必向 user 复述，但可以在对话中自然延续相关话题。') + '">' + escapeHtml(sf.footer) + '</textarea>';
    html += '<div class="moments-btn-row"><button class="mm-btn danger" data-action="sync-reset">恢复全部默认</button><button class="moments-btn ghost" data-action="close-sync-format">完成</button></div>';
    return html + '</div></div></div>';
  }

  function renderNpcModal(space, charId) {
    var sc = getSpaceChar(space, charId); if (!sc) return '';
    var npcs = getCharNpcs(sc);
    var html = '<div class="moments-modal-mask" data-action="close-npc-modal"><div class="moments-modal wide" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">' + escapeHtml(sc.charHandle || sc.charName) + ' 的 NPC 好友</div><div class="moments-modal-x" data-action="close-npc-modal">' + ICON.close + '</div></div><div class="moments-modal-bd">';
    html += '<div class="moments-hint">NPC 是氛围组：只在该 char 发朋友圈时评论其动态，不参与 user 触发的评论链。懒人可以完全不添加。</div>';
    html += '<div class="moments-sec-title">已绑定 NPC<span class="moments-sec-hint">共 ' + npcs.length + ' 个</span></div>';
    if (!npcs.length) html += '<div class="moments-empty">还没有绑定 NPC</div>';
    npcs.forEach(function (npc, idx) {
      html += '<div class="moments-npc-item"><div class="moments-npc-item-info"><div class="moments-npc-item-name">' + escapeHtml(npc.name) + ' <span style="color:#999;font-weight:normal;">@' + escapeHtml(npc.handle) + '</span></div><div class="moments-npc-item-sub">' + escapeHtml(npc.bio || '') + '</div></div><button class="mm-btn danger" data-action="npc-unbind" data-cid="' + escapeHtml(charId) + '" data-idx="' + idx + '">解绑</button></div>';
    });
    html += '<div class="moments-div"></div><div class="moments-sec-title">手动添加</div>';
    html += '<div class="moments-form"><label>名字<input class="moments-input" id="moments-npc-name" placeholder="如 小张"></label><label>handle<input class="moments-input" id="moments-npc-handle" placeholder="如 xiaozhang"></label><label>一句话人设<input class="moments-input" id="moments-npc-bio" placeholder="如 char 的大学室友，爱开玩笑"></label><button class="moments-btn" data-action="npc-add" data-cid="' + escapeHtml(charId) + '">添加</button></div>';
    html += '<div class="moments-div"></div><div class="moments-sec-title">AI 生成建议<span class="moments-sec-hint">读取该 char 人设生成 4 个候选</span></div>';
    if (state.npcLoading) {
      html += '<div class="moments-empty">生成中...</div>';
    } else {
      html += '<div class="moments-btn-row"><button class="moments-btn ghost" data-action="npc-generate" data-cid="' + escapeHtml(charId) + '">生成 4 个候选 NPC</button></div>';
      (state.npcSuggestions || []).forEach(function (s, idx) {
        html += '<div class="moments-npc-suggest"><div class="moments-npc-item-info"><div class="moments-npc-item-name">' + escapeHtml(s.name) + ' <span style="color:#999;font-weight:normal;">@' + escapeHtml(s.handle) + '</span></div><div class="moments-npc-item-sub">' + escapeHtml(s.bio || '') + '</div></div><button class="mm-btn" data-action="npc-bind" data-cid="' + escapeHtml(charId) + '" data-idx="' + idx + '">绑定</button></div>';
      });
    }
    html += '<div class="moments-btn-row"><button class="moments-btn ghost" data-action="close-npc-modal">完成</button></div>';
    return html + '</div></div></div>';
  }

  function renderPostModal(space) {
    var subj = getCurrentSubject(); if (!subj) return '';
    return '<div class="moments-modal-mask" data-action="close-post-modal"><div class="moments-modal" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">发表</div><div class="moments-modal-x" data-action="close-post-modal">' + ICON.close + '</div></div><div class="moments-modal-bd">' +
      '<div class="moments-post-as">以 <b>' + escapeHtml(subj.name) + '</b> 发布</div>' +
      '<textarea class="moments-post-text" id="moments-post-text" placeholder="这一刻的想法..."></textarea>' +
      '<div class="moments-post-imgs" id="moments-post-imgs"></div>' +
      '<div class="moments-post-tools"><span class="mp-tool" data-tool="text">' + ICON.image + '<span>文字图</span></span><span class="mp-tool" data-tool="url">' + ICON.image + '<span>图片URL</span></span><label class="mp-tool" data-tool="file">' + ICON.image + '<span>本地图片</span><input type="file" accept="image/*" id="moments-post-file" style="display:none"></label></div>' +
      '<div class="moments-btn-row"><button class="moments-btn" data-action="publish-post">发表</button></div></div></div></div>';
  }

  function renderEditPostModal(space) {
    var post = null;
    for (var i = 0; i < state.posts.length; i++) {
      if (state.posts[i].id === state.editPostId) { post = state.posts[i]; break; }
    }
    if (!post) return '';
    var name = post.authorHandle || post.authorName;
    return '<div class="moments-modal-mask" data-action="close-edit-modal"><div class="moments-modal" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">编辑</div><div class="moments-modal-x" data-action="close-edit-modal">' + ICON.close + '</div></div><div class="moments-modal-bd">' +
      '<div class="moments-post-as">以 <b>' + escapeHtml(name) + '</b> 编辑</div>' +
      '<textarea class="moments-post-text" id="moments-post-text">' + escapeHtml(post.text || '') + '</textarea>' +
      '<div class="moments-post-imgs" id="moments-post-imgs"></div>' +
      '<div class="moments-post-tools"><span class="mp-tool" data-tool="text">' + ICON.image + '<span>文字图</span></span><span class="mp-tool" data-tool="url">' + ICON.image + '<span>图片URL</span></span><label class="mp-tool" data-tool="file">' + ICON.image + '<span>本地图片</span><input type="file" accept="image/*" id="moments-post-file" style="display:none"></label></div>' +
      '<div class="moments-btn-row"><button class="moments-btn" data-action="save-edit-post">保存</button></div></div></div></div>';
  }

  function renderUiPrefsModal() {
    var tb = state.uiPrefs.topbarH || 44;
    var bp = state.uiPrefs.bottomPad || 80;
    var html = '<div class="moments-modal-mask" data-action="close-uiprefs"><div class="moments-modal" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">界面尺寸调整</div><div class="moments-modal-x" data-action="close-uiprefs">' + ICON.close + '</div></div><div class="moments-modal-bd">';
    html += '<div class="moments-hint">拖动滑块实时预览，设置自动保存，所有屏幕尺寸通用。</div>';
    html += '<div class="moments-div"></div>';
    html += '<div class="moments-row"><div class="moments-row-label">顶栏高度 <span class="moments-range-val" id="uipref-tb-val">' + tb + 'px</span></div>';
    html += '<input class="moments-range" type="range" min="36" max="72" step="1" value="' + tb + '" data-field="uipref-topbar"></div>';
    html += '<div class="moments-div"></div>';
    html += '<div class="moments-row"><div class="moments-row-label">底部安全边距 <span class="moments-range-val" id="uipref-bp-val">' + bp + 'px</span></div>';
    html += '<div class="moments-hint">为评论输入栏预留空间，防止遮挡底部朋友圈内容；不同屏幕均生效。</div>';
    html += '<input class="moments-range" type="range" min="0" max="240" step="2" value="' + bp + '" data-field="uipref-bottompad"></div>';
    html += '<div class="moments-div"></div>';
    html += '<div class="moments-btn-row"><button class="moments-btn ghost" data-action="reset-uiprefs">恢复默认</button><button class="moments-btn" data-action="close-uiprefs">完成</button></div>';
    return html + '</div></div></div>';
  }
  function renderCommentInput() {
    var t = state.commentTarget; if (!t) return '';
    var post = null; for (var i = 0; i < state.posts.length; i++) if (state.posts[i].id === t.postId) { post = state.posts[i]; break; }
    if (!post) return '';
    var ph = t.replyToName ? '回复 ' + t.replyToName : '评论';
    var subj = getCurrentSubject();
    return '<div class="moments-cm-bar"><input class="moments-cm-input" id="moments-cm-text" placeholder="' + escapeHtml(ph) + '"><button class="moments-cm-send" data-action="send-comment">' + ICON.comment + '</button></div>';
  }

  function renderSubjectSheet(space) {
    var html = '<div class="moments-modal-mask" data-action="close-subject"><div class="moments-sheet" data-stop="1"><div class="moments-sheet-title">切换查看主体</div>';
    html += '<div class="moments-sheet-item' + (state.currentSubject === 'user' ? ' active' : '') + '" data-action="set-subject" data-sub="user"><div class="moments-avatar sm">' + (space.userPersonaAvatar ? '<img src="' + escapeHtml(space.userPersonaAvatar) + '">' : '<div class="moments-avatar-fb">' + escapeHtml((space.userPersonaName || '?').slice(0, 1)) + '</div>') + '</div><div class="moments-sheet-info"><div class="moments-sheet-name">' + escapeHtml(space.userPersonaHandle || space.userPersonaName) + '</div><div class="moments-sheet-sub">user 视角（看全部）</div></div></div>';
    (space.chars || []).forEach(function (sc) {
      if (!sc.postEnabled && !sc.commentEnabled) return;
      html += '<div class="moments-sheet-item' + (state.currentSubject === sc.charId ? ' active' : '') + '" data-action="set-subject" data-sub="' + escapeHtml(sc.charId) + '"><div class="moments-avatar sm">' + (sc.charAvatar ? '<img src="' + escapeHtml(sc.charAvatar) + '">' : '<div class="moments-avatar-fb">' + escapeHtml((sc.charName || '?').slice(0, 1)) + '</div>') + '</div><div class="moments-sheet-info"><div class="moments-sheet-name">' + escapeHtml(sc.charHandle || sc.charName) + '</div><div class="moments-sheet-sub">char 视角（只看 ta 的）</div></div></div>';
    });
    return html + '</div></div>';
  }

  function renderLpSheet() {
    var lp = state.lpTarget;
    if (!lp) return '';
    var html = '<div class="moments-modal-mask" data-action="close-lp-sheet"><div class="moments-sheet" data-stop="1">';
    if (lp.type === 'post') {
      html += '<div class="moments-sheet-title">朋友圈操作</div>';
      html += '<div class="moments-sheet-item" data-action="lp-edit-post" data-id="' + escapeHtml(lp.postId) + '">' + ICON.edit + '<span>编辑</span></div>';
      html += '<div class="moments-sheet-item danger" data-action="lp-delete-post" data-id="' + escapeHtml(lp.postId) + '">' + ICON.del + '<span>删除</span></div>';
    } else if (lp.type === 'comment') {
      html += '<div class="moments-sheet-title">评论操作</div>';
      html += '<div class="moments-sheet-item danger" data-action="lp-delete-comment" data-id="' + escapeHtml(lp.postId) + '" data-cid="' + escapeHtml(lp.commentId) + '">' + ICON.del + '<span>删除评论</span></div>';
    }
    html += '</div></div>';
    return html;
  }

  function renderNotifPanel(space) {
    var html = '<div class="moments-modal-mask" data-action="close-notif"><div class="moments-modal" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">消息通知</div><div class="moments-modal-x" data-action="close-notif">' + ICON.close + '</div></div><div class="moments-modal-bd">';
    var list = state.notifs.filter(function (n) { return !space || n.spaceId === space.id; });
    if (!list.length) html += '<div class="moments-empty">暂无通知</div>';
    list.forEach(function (n) {
      html += '<div class="moments-notif' + (n.read ? '' : ' unread') + '" data-action="open-notif-item" data-id="' + escapeHtml(n.id) + '"><div class="moments-avatar sm">' + (n.fromAvatar ? '<img src="' + escapeHtml(n.fromAvatar) + '">' : '<div class="moments-avatar-fb">' + escapeHtml((n.fromName || '?').slice(0, 1)) + '</div>') + '</div><div class="moments-notif-info"><div class="moments-notif-text"><b>' + escapeHtml(n.fromName) + '</b> ' + escapeHtml(n.text) + '</div><div class="moments-notif-time">' + formatTime(n.createdAt) + '</div></div></div>';
    });
    if (list.length) html += '<div class="moments-btn-row"><button class="moments-btn ghost" data-action="clear-notifs">清空通知</button></div>';
    return html + '</div></div></div>';
  }

  // ========== 长按检测 ==========
  var LP_DELAY = 500;
  var LP_MOVE_THRESHOLD = 10;

  function findLpAnchor(el) {
    while (el && el !== root) {
      if (el.getAttribute) {
        // 排除：···按钮、图片、帖子头像、作者名、操作气泡
        if (el.getAttribute('data-action') === 'open-acts') return null;
        if (el.getAttribute('data-action') === 'view-photo') return null;
        if (el.getAttribute('data-action') === 'toggle-text') return null;
        if (el.classList && el.classList.contains('moment-avatar')) return null;
        if (el.getAttribute('data-action') === 'view-author') return null;
        if (el.classList && el.classList.contains('moment-act-pop')) return null;
        // 封面头像长按 → 已移除（导致第二次侧边栏点击失效）
        // 改为双击标题打开侧边栏
        // 评论锚点（优先，嵌套在帖子内）
        if (el.classList && el.classList.contains('mc')) {
          var cid = el.getAttribute('data-cid');
          var pid = el.getAttribute('data-id');
          if (cid && pid) return { type: 'comment', postId: pid, commentId: cid, anchor: el };
        }
        // 帖子锚点
        if (el.classList && el.classList.contains('moment')) {
          var mid = el.getAttribute('data-id');
          if (mid) return { type: 'post', postId: mid, anchor: el };
        }
      }
      el = el.parentNode;
    }
    return null;
  }

  function onLpStart(e) {
    if (e.type === 'touchstart') _lpTouchActive = true;
    if (e.type === 'mousedown' && _lpTouchActive) return;
    if (state.lpSheetOpen || state.sidebarOpen) return;
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
    var touch = e.touches ? e.touches[0] : e;
    _lpStartX = touch.clientX;
    _lpStartY = touch.clientY;
    var lpInfo = findLpAnchor(e.target);
    if (!lpInfo) return;
    _lpTimer = setTimeout(function () {
      _lpTimer = null;
      if (lpInfo.anchor) {
        lpInfo.anchor.classList.add('lp-active');
        setTimeout(function () { if (lpInfo.anchor) lpInfo.anchor.classList.remove('lp-active'); }, 200);
      }
      var lpTarget = { type: lpInfo.type, postId: lpInfo.postId, commentId: lpInfo.commentId || null };
      _pendingLpAction = function () { state.lpTarget = lpTarget; state.lpSheetOpen = true; render(); };
    }, LP_DELAY);
  }

  function onLpEnd(e) {
    if (e && (e.type === 'touchend' || e.type === 'touchcancel')) _lpTouchActive = false;
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
    if (_pendingLpAction) {
      var action = _pendingLpAction;
      _pendingLpAction = null;
      action();
    }
  }

  function onLpMove(e) {
    if (!_lpTimer) return;
    var touch = e.touches ? e.touches[0] : e;
    var dx = touch.clientX - _lpStartX;
    var dy = touch.clientY - _lpStartY;
    if (dx * dx + dy * dy > LP_MOVE_THRESHOLD * LP_MOVE_THRESHOLD) {
      clearTimeout(_lpTimer); _lpTimer = null;
    }
  }

  function onLpCancel(e) {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
    if (_pendingLpAction) {
      var action = _pendingLpAction;
      _pendingLpAction = null;
      action();
    }
  }

  // ========== 事件 ==========
  // 关键修复：所有事件绑在 document 捕获阶段，不依赖 root
  // 原因：第二次打开侧边栏后 root 上的监听器可能因 WebView bug 失效
  // 只有当事件 target 在 root 内时才处理
  function inRoot(el) {
    return !!(root && el && (el === root || (root.contains && root.contains(el))));
  }
  function wrapInRoot(handler) {
    return function (e) {
      if (!inRoot(e.target)) return;
      handler.call(root, e);
    };
  }
  var _docHandlers = {};
  function bindEvents() {
    if (!root || _docHandlers.bound) return;
    _docHandlers.click = wrapInRoot(onRootClick);
    _docHandlers.dblclick = wrapInRoot(onRootDblClick);
    _docHandlers.change = wrapInRoot(onRootChange);
    _docHandlers.input = wrapInRoot(onRootChange);
    _docHandlers.touchstart = wrapInRoot(onLpStart);
    _docHandlers.touchend = wrapInRoot(onLpEnd);
    _docHandlers.touchcancel = wrapInRoot(onLpEnd);
    _docHandlers.touchmove = wrapInRoot(onLpMove);
    _docHandlers.mousedown = wrapInRoot(onLpStart);
    _docHandlers.mouseup = wrapInRoot(onLpEnd);
    document.addEventListener('click', _docHandlers.click, { capture: true });
    document.addEventListener('dblclick', _docHandlers.dblclick, { capture: true });
    document.addEventListener('change', _docHandlers.change, { capture: true });
    document.addEventListener('input', _docHandlers.input, { capture: true });
    document.addEventListener('touchstart', _docHandlers.touchstart, { capture: true, passive: false });
    document.addEventListener('touchend', _docHandlers.touchend, { capture: true });
    document.addEventListener('touchcancel', _docHandlers.touchcancel, { capture: true });
    document.addEventListener('touchmove', _docHandlers.touchmove, { capture: true, passive: true });
    document.addEventListener('mousedown', _docHandlers.mousedown, { capture: true });
    document.addEventListener('mouseup', _docHandlers.mouseup, { capture: true });
    _docHandlers.bound = true;
  }
  function closestEl(el, attr, val) {
    while (el && el !== root) {
      var a = el.getAttribute ? el.getAttribute(attr) : null;
      if (a != null && (val == null || a === val)) return el;
      el = el.parentNode;
    }
    return null;
  }
  function did(el, attr) { var n = closestEl(el, attr); return n ? n.getAttribute(attr) : null; }
  // 双击：仅顶栏标题触发侧边栏
  function onRootDblClick(e) {
    var t = e.target;
    var dblEl = closestEl(t, 'data-dbl');
    if (!dblEl) return;
    var dbl = dblEl.getAttribute('data-dbl');
    if (dbl === 'open-sidebar') { state.sidebarOpen = true; render(); }
  }
  function onRootClick(e) {
    var t = e.target;
    // 文字图点击：直接 toggle class，不 render
    var textToggle = closestEl(t, 'data-action', 'toggle-text');
    if (textToggle) { textToggle.classList.toggle('revealed'); return; }
    // 点击气泡外部时关闭已打开的操作气泡（点"··"按钮或气泡内部不关）
    var isActsBtn = closestEl(t, 'data-action', 'open-acts');
    if (!isActsBtn) {
      var pops = root.querySelectorAll('.moment-act-pop.open');
      if (pops.length) {
        var inPop = false;
        for (var i = 0; i < pops.length; i++) { if (pops[i].contains(t)) { inPop = true; break; } }
        if (!inPop) {
          for (var j = 0; j < pops.length; j++) { pops[j].classList.remove('open'); pops[j].innerHTML = ''; }
        }
      }
    }
    // 遍历至 root：若中途遇到 data-stop="1" 则阻止冒泡到 mask 的关闭动作
    // 但若先遇到 data-action，则正常触发（modal 内部按钮自身带 data-action）
    var el = t;
    while (el && el !== root) {
      if (el.getAttribute && el.getAttribute('data-stop') === '1') return;
      var a = el.getAttribute && el.getAttribute('data-action');
      if (a != null) { handleAction(a, t, e); return; }
      el = el.parentNode;
    }
  }
  function onRootChange(e) {
    var t = e.target; var field = t.getAttribute && t.getAttribute('data-field'); if (!field) return;
    // 界面尺寸滑块实时预览（input 事件持续触发；change 事件释放时再持久化）
    if (field === 'uipref-topbar' || field === 'uipref-bottompad') {
      var val = parseInt(t.value, 10); if (isNaN(val)) return;
      var rootEl = root.querySelector('.' + ROOT_CLASS);
      if (field === 'uipref-topbar') {
        state.uiPrefs.topbarH = val;
        var padVal = Math.max(0, val - 44);
        if (rootEl) rootEl.style.setProperty('--topbar-pad', padVal + 'px');
        var tbValEl = $('#uipref-tb-val', root); if (tbValEl) tbValEl.textContent = val + 'px';
      } else {
        state.uiPrefs.bottomPad = val;
        if (rootEl) rootEl.style.setProperty('--bottom-pad', val + 'px');
        var bpValEl = $('#uipref-bp-val', root); if (bpValEl) bpValEl.textContent = val + 'px';
      }
      if (e.type === 'change') Store.saveUiPrefs();
      return;
    }
    // 氛围提示词（space 级，无 cid，textarea 失焦时保存）
    if (field === 'mood-charPost' || field === 'mood-charComment' || field === 'mood-npcComment') {
      var sp0 = Store.getActiveSpace(); if (sp0) { sp0.customPrompts[field.replace('mood-', '')] = t.value; Store.saveSpaces(); }
      return;
    }
    // 关系网：user 身份（space 级，无 cid）
    if (field === 'rel-user-identity') {
      var spR = Store.getActiveSpace(); if (spR) { spR.userIdentity = t.value; Store.saveSpaces(); }
      return;
    }
    // 关系网：char 身份（char 级，有 cid）
    if (field === 'rel-char-identity') {
      var cidR = t.getAttribute('data-cid'); var spR2 = Store.getActiveSpace(); if (!spR2 || !cidR) return;
      var scR = getSpaceChar(spR2, cidR); if (scR) { scR.customIdentity = t.value; Store.saveSpaces(); }
      return;
    }
    // 自定义记忆注入模板（space 级，textarea 输入时实时保存）
    if (field && field.indexOf('sync-') === 0) {
      var spS = Store.getActiveSpace(); if (!spS) return;
      var key = field.replace('sync-', '');
      if (!spS.customPrompts) spS.customPrompts = {};
      if (!spS.customPrompts.syncFormat) spS.customPrompts.syncFormat = {};
      spS.customPrompts.syncFormat[key] = t.value; Store.saveSpaces();
      return;
    }
    var cid = t.getAttribute('data-cid'); var conv = t.getAttribute('data-conv');
    var space = Store.getActiveSpace(); if (!space || !cid) return;
    var sc = getSpaceChar(space, cid); if (!sc) return;
    if (field === 'interval') { var v = parseInt(t.value, 10); if (!isNaN(v) && v >= 30) sc.postIntervalMin = v; Store.saveSpaces(); }
    else if (field === 'autocomment') { var v2 = parseInt(t.value, 10); if (!isNaN(v2) && v2 >= 0 && v2 <= 8) sc.autoCommentCount = v2; Store.saveSpaces(); }
    else if (field === 'core' && conv) { var m = findMount(sc, conv); if (m) { m.coreEnabled = t.checked; Store.saveSpaces(); } }
    else if (field === 'short' && conv) { var m2 = findMount(sc, conv); if (m2) { m2.shortLimit = parseInt(t.value, 10) || 0; Store.saveSpaces(); } }
    else if (field === 'fact' && conv) { var m3 = findMount(sc, conv); if (m3) { m3.factLimit = parseInt(t.value, 10) || 0; Store.saveSpaces(); } }
  }
  function findMount(sc, convId) { for (var i = 0; i < (sc.memoryMounts || []).length; i++) if (sc.memoryMounts[i].conversationId === convId) return sc.memoryMounts[i]; return null; }

  function handleAction(act, t, e) {
    var space = Store.getActiveSpace();
    switch (act) {
      case 'back': if (cachedRoche && cachedRoche.ui) cachedRoche.ui.closeApp(); break;
      case 'open-sidebar': state.sidebarOpen = true; render(); break;
      case 'close-sidebar': state.sidebarOpen = false; render(); break;
      case 'toggle-dark': { state.darkMode = !state.darkMode; Store.saveDark().then(render); break; }
      case 'open-uiprefs': state.uiPrefsOpen = true; state.sidebarOpen = false; render(); break;
      case 'close-uiprefs': state.uiPrefsOpen = false; render(); break;
      case 'reset-uiprefs': { state.uiPrefs = { topbarH: 44, bottomPad: 80 }; Store.saveUiPrefs().then(render); break; }
      case 'open-notif': state.notifPanelOpen = true; Store.markAllNotifRead(); render(); break;
      case 'close-notif': state.notifPanelOpen = false; render(); break;
      case 'clear-notifs': Store.clearNotifs().then(render); break;
      case 'open-subject': state.subjectSheetOpen = true; render(); break;
      case 'close-subject': state.subjectSheetOpen = false; render(); break;
      case 'set-subject': state.currentSubject = did(t, 'data-sub'); state.subjectSheetOpen = false; state._suppressScrollRestore = true; render(); break;
      case 'open-post-modal': pendingImages = []; state.postModalOpen = true; render(); break;
      case 'close-post-modal': state.postModalOpen = false; pendingImages = []; render(); break;
      case 'close-edit-modal': state.editModalOpen = false; state.editPostId = null; pendingImages = []; render(); break;
      case 'close-lp-sheet': state.lpSheetOpen = false; state.lpTarget = null; render(); break;
      case 'open-subapi': state.subApiPanelOpen = true; render(); break;
      case 'close-subapi': state.subApiPanelOpen = false; render(); break;
      case 'open-char-list': state.charListOpen = true; render(); break;
      case 'close-char-list': state.charListOpen = false; render(); break;
      case 'close-mem-mount': state.memMountCharId = null; render(); break;

      case 'open-mood-prompts': state.moodPromptsOpen = true; render(); break;
      case 'close-mood-prompts': state.moodPromptsOpen = false; render(); break;
      case 'open-relation-net': state.relationNetOpen = true; render(); break;
      case 'close-relation-net': state.relationNetOpen = false; render(); break;
      case 'open-sync-format': state.syncFormatOpen = true; render(); break;
      case 'close-sync-format': state.syncFormatOpen = false; render(); break;
      case 'sync-reset': {
        if (!space) break;
        if (!space.customPrompts) space.customPrompts = {};
        space.customPrompts.syncFormat = { header:'', userLine:'', intro:'', cat1:'', cat2:'', cat3:'', cat4:'', cat5:'', footer:'' };
        Store.saveSpaces(); render(); toast('已恢复全部默认');
        break;
      }
      case 'relation-add': {
        if (!space) break;
        var fromEl = $('#rel-from', root); var toEl = $('#rel-to', root); var labelEl = $('#rel-label', root);
        if (!fromEl || !toEl || !labelEl) break;
        var fromCid = trim(fromEl.value); var toCid = trim(toEl.value); var relLabel = trim(labelEl.value);
        if (!fromCid || !toCid) { toast('请选择节点'); break; }
        if (fromCid === toCid) { toast('不能指向自己'); break; }
        if (!relLabel) { toast('请填关系标签'); break; }
        if (!space.relations) space.relations = [];
        space.relations.push({ id: 'rel_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6), fromCid: fromCid, toCid: toCid, label: relLabel });
        Store.saveSpaces(); render();
        break;
      }
      case 'relation-del': {
        if (!space) break;
        var relId = did(t, 'data-rel-id'); if (!relId) break;
        if (!space.relations) break;
        space.relations = space.relations.filter(function (r) { return r.id !== relId; });
        Store.saveSpaces(); render();
        break;
      }
      case 'open-npc-modal': { var npcCid = did(t, 'data-cid'); state.npcModalCharId = npcCid; state.npcSuggestions = []; state.sidebarOpen = false; render(); break; }
      case 'close-npc-modal': state.npcModalCharId = null; render(); break;
      case 'npc-add': {
        var cidA = did(t, 'data-cid'); if (!space) break; var scA = getSpaceChar(space, cidA); if (!scA) break;
        var nm = $('#moments-npc-name', root) ? trim($('#moments-npc-name', root).value) : '';
        var hd = $('#moments-npc-handle', root) ? trim($('#moments-npc-handle', root).value) : '';
        var bo = $('#moments-npc-bio', root) ? trim($('#moments-npc-bio', root).value) : '';
        if (!nm || !hd) { toast('请填名字和 handle'); break; }
        scA.npcs.push({ id: uuid(), name: nm, handle: hd, bio: bo, avatar: '' });
        Store.saveSpaces().then(render); toast('已添加');
        break;
      }
      case 'npc-generate': {
        var cidG = did(t, 'data-cid'); if (!space) break; var scG = getSpaceChar(space, cidG); if (!scG) break;
        var cG = findChar(scG.charId) || {};
        var personaG = cG.persona || cG.bio || scG.charPersona || '';
        var sysG = '你是 NPC 生成器。根据以下 char 的人设，生成 4 个可能出现在该 char 朋友圈下的 NPC 好友。\n要求：每个 NPC 风格各异，名字自然，handle 简短，bio 一句话人设。\n严格按格式输出，不要多余内容：\n<npc><name>名字</name><handle>handle</handle><bio>一句话人设</bio></npc>\n（重复 4 次）';
        state.npcLoading = true; render();
        callAI({ messages: [{ role: 'system', content: sysG }, { role: 'user', content: 'char 名字：' + scG.charName + '\nchar 人设：' + (personaG || '(无)') }], temperature: 0.9 }).then(function (raw) {
          var list = []; var reN = /<npc>([\s\S]*?)<\/npc>/gi; var mN;
          while ((mN = reN.exec(raw || ''))) {
            var blk = mN[1];
            var nmN = (blk.match(/<name>([\s\S]*?)<\/name>/i) || [])[1] || '';
            var hdN = (blk.match(/<handle>([\s\S]*?)<\/handle>/i) || [])[1] || '';
            var boN = (blk.match(/<bio>([\s\S]*?)<\/bio>/i) || [])[1] || '';
            if (trim(nmN)) list.push({ id: uuid(), name: trim(nmN), handle: trim(hdN) || trim(nmN), bio: trim(boN), avatar: '' });
          }
          state.npcSuggestions = list; state.npcLoading = false; render();
          if (!list.length) toast('未能解析出 NPC，请重试');
        }).catch(function (err) { state.npcLoading = false; render(); toast('生成失败：' + (err && err.message || '')); });
        break;
      }
      case 'npc-bind': {
        var cidB = did(t, 'data-cid'); var idxB = parseInt(did(t, 'data-idx'), 10); if (!space || isNaN(idxB)) break;
        var scB = getSpaceChar(space, cidB); if (!scB) break;
        var sug = (state.npcSuggestions || [])[idxB]; if (!sug) break;
        scB.npcs.push({ id: uuid(), name: sug.name, handle: sug.handle, bio: sug.bio, avatar: '' });
        Store.saveSpaces().then(render); toast('已绑定');
        break;
      }
      case 'npc-unbind': {
        var cidU = did(t, 'data-cid'); var idxU = parseInt(did(t, 'data-idx'), 10); if (!space || isNaN(idxU)) break;
        var scU = getSpaceChar(space, cidU); if (!scU) break;
        scU.npcs.splice(idxU, 1); Store.saveSpaces().then(render);
        break;
      }

      case 'switch-space': {
        var pid = did(t, 'data-pid'); var per = null;
        for (var i = 0; i < state.allPersonas.length; i++) if (state.allPersonas[i].id === pid) { per = state.allPersonas[i]; break; }
        if (per) { var sp = ensureSpaceForPersona(per); state.activeSpaceId = sp.id; state.currentSubject = 'user'; state.sidebarOpen = false; Store.saveActive().then(function () { state._suppressScrollRestore = true; render(); }); }
        break;
      }
      case 'view-char': { var cid = did(t, 'data-cid'); if (space && getSpaceChar(space, cid)) { state.currentSubject = cid; state.sidebarOpen = false; state._suppressScrollRestore = true; render(); } break; }
      case 'bind-char': { var cid2 = did(t, 'data-cid'); if (space) { bindCharToSpace(space, cid2); state.charListOpen = false; render(); } break; }
      case 'unbind-char': { var cid3 = did(t, 'data-cid'); confirmBox({ message: '确定解绑该 char？历史朋友圈保留。' }).then(function (ok) { if (ok && space) { unbindCharFromSpace(space, cid3); render(); } }); break; }
      case 'open-mem-mount': { var cid4 = did(t, 'data-cid'); state.memMountCharId = cid4; state.sidebarOpen = false; render(); loadConversationsForChar(cid4); break; }
      case 'toggle-post': { var cidP = did(t, 'data-cid'); if (space) { var scP = getSpaceChar(space, cidP); if (scP) { scP.postEnabled = !scP.postEnabled; Store.saveSpaces().then(render); } } break; }
      case 'toggle-comment': { var cidC = did(t, 'data-cid'); if (space) { var scC = getSpaceChar(space, cidC); if (scC) { scC.commentEnabled = !scC.commentEnabled; Store.saveSpaces().then(render); } } break; }
      case 'toggle-mem-sync': { var cidMs = did(t, 'data-cid'); if (space) { var scMs = getSpaceChar(space, cidMs); if (scMs) { scMs.memSync = !scMs.memSync; Store.saveSpaces().then(render); } } break; }
      case 'toggle-mount': {
        var cid6 = did(t, 'data-cid'); var convId = did(t, 'data-conv');
        if (space) { var sc6 = getSpaceChar(space, cid6); if (sc6) { var m6 = findMount(sc6, convId); if (m6) m6.enabled = !m6.enabled; else { var co = null; (sc6._convCache || []).forEach(function (c) { if (c.id === convId) co = c; }); sc6.memoryMounts.push({ conversationId: convId, convName: co ? co.name : '', isGroup: co ? !!co.isGroup : false, enabled: true, shortLimit: 50, factLimit: 0, coreEnabled: false }); } Store.saveSpaces().then(render); } }
        break;
      }
      case 'char-post-now': {
        var cid7 = did(t, 'data-cid'); if (!space) break; var sc7 = getSpaceChar(space, cid7); if (!sc7) break;
        setTip((sc7.charHandle || sc7.charName) + ' 正在发朋友圈并评论...');
        generateCharPost(space, sc7).then(function () { setTip(null); toast('已发布'); if (root) render(); }).catch(function (err) { setTip(null); toast('发布失败：' + (err && err.message || '')); });
        break;
      }
      case 'sync-trace':
      case 'sync-fact-now': {
        var cid8 = did(t, 'data-cid'); if (!space) break; var sc8 = getSpaceChar(space, cid8); if (!sc8) break;
        setTip('AI 总结并写入事实记忆中...');
        syncCharToFactMemory(space, sc8).then(function (r) { setTip(null); toast(r.ok ? '已同步到事实记忆' : '同步失败：' + r.reason); });
        break;
      }
      case 'set-cover': { if (!space) break; var subjCov = getCurrentSubject(); var curCov = (subjCov && subjCov.type === 'char' && subjCov.spaceChar) ? (subjCov.spaceChar.cover || '') : (space.cover || ''); var url = window.prompt('输入封面图 URL（留空清除）：', curCov); if (url !== null) { var trimUrl = trim(url); if (subjCov && subjCov.type === 'char' && subjCov.spaceChar) subjCov.spaceChar.cover = trimUrl; else space.cover = trimUrl; Store.saveSpaces().then(render); } break; }
      case 'like': { var pid1 = did(t, 'data-id'); var subj1 = getCurrentSubject(); if (subj1) Store.toggleLike(pid1, { id: subj1.id, name: subj1.name }).then(render); break; }
      case 'comment-post': { var pid2 = did(t, 'data-id'); state.commentTarget = { postId: pid2, replyTo: null, replyToName: null }; render(); var inp = $('#moments-cm-text', root); if (inp) inp.focus(); break; }
      case 'reply-comment': { var pid3 = did(t, 'data-id'); var cmId = did(t, 'data-cid'); var post3 = null; for (var j = 0; j < state.posts.length; j++) if (state.posts[j].id === pid3) { post3 = state.posts[j]; break; } var cm = null; if (post3 && post3.comments) for (var k = 0; k < post3.comments.length; k++) if (post3.comments[k].id === cmId) { cm = post3.comments[k]; break; } if (cm) { state.commentTarget = { postId: pid3, replyTo: cm.id, replyToName: cm.authorHandle || cm.authorName }; render(); var inp2 = $('#moments-cm-text', root); if (inp2) inp2.focus(); } break; }
      case 'send-comment': {
        var inp3 = $('#moments-cm-text', root); if (!inp3) break; var text = trim(inp3.value); if (!text || !state.commentTarget) break;
        var subj2 = getCurrentSubject(); if (!subj2) break; var ct = state.commentTarget;
        var comment = { id: uuid(), postId: ct.postId, authorType: subj2.type, authorId: subj2.id, authorName: subj2.realName || subj2.name, authorHandle: subj2.name, text: text, replyTo: ct.replyTo, replyToName: ct.replyToName, createdAt: Date.now() };
        Store.addComment(ct.postId, comment).then(function () {
          state.commentTarget = null; render();
          // 仅 user 主体评论才触发其他 char 回应（char 主体评论不触发）
          if (space && subj2.type === 'user') {
            var post9 = null; for (var r = 0; r < state.posts.length; r++) if (state.posts[r].id === ct.postId) { post9 = state.posts[r]; break; }
            if (post9) {
              // user @了谁，谁就必定被召唤
              var mentionedIds = detectMentionedCharsFromPost(space, post9);
              setTip('char 正在看这条动态...');
              generateAutoComments(space, post9, DEFAULT_AUTO_COMMENT, mentionedIds).then(function (results) { setTip(null); if (root) render(); return injectCharsRealtime(space, (results || []).map(function (r) { return r.authorId; })); }).catch(function () { setTip(null); });
            }
          }
        });
        break;
      }
      case 'open-acts': {
        var pid5 = did(t, 'data-id');
        // 先关闭其他已打开的气泡
        var allPops = root.querySelectorAll('.moment-act-pop.open');
        for (var i = 0; i < allPops.length; i++) {
          if (allPops[i].getAttribute('data-id') !== pid5) {
            allPops[i].classList.remove('open');
            allPops[i].innerHTML = '';
          }
        }
        // 切换目标气泡（赞 / 评论 / 召唤）
        var pop = $('.moment-act-pop[data-id="' + pid5 + '"]', root);
        if (pop) {
          if (pop.classList.contains('open')) {
            pop.classList.remove('open');
            pop.innerHTML = '';
          } else {
            pop.classList.add('open');
            pop.innerHTML = '<div class="moment-act-pop-i" data-action="like" data-id="' + pid5 + '">' + ICON.like + '赞</div><div class="moment-act-pop-i" data-action="comment-post" data-id="' + pid5 + '">' + ICON.comment + '评论</div><div class="moment-act-pop-i subtle" data-action="summon-comments" data-id="' + pid5 + '">' + ICON.more + '召唤</div>';
          }
        }
        break;
      }
      case 'summon-comments': {
        var pidS = did(t, 'data-id'); if (!space) break;
        var postS = null; for (var s = 0; s < state.posts.length; s++) if (state.posts[s].id === pidS) { postS = state.posts[s]; break; }
        if (!postS) break;
        // user 在该动态下 @过的 char 必定被召唤
        var mentionedIdsS = detectMentionedCharsFromPost(space, postS);
        setTip('召唤 char 评论中...');
        generateAutoComments(space, postS, DEFAULT_AUTO_COMMENT, mentionedIdsS).then(function (results) { setTip(null); toast('评论已生成'); if (root) render(); return injectCharsRealtime(space, (results || []).map(function (r) { return r.authorId; })); }).catch(function () { setTip(null); });
        break;
      }
      case 'view-photo': { /* URL/本地图直接显示，无需操作 */ break; }
      case 'edit-post': {
        var pidE = did(t, 'data-id'); var postE = null;
        for (var e = 0; e < state.posts.length; e++) { if (state.posts[e].id === pidE) { postE = state.posts[e]; break; } }
        if (!postE) break;
        state.editPostId = pidE; state.editModalOpen = true;
        pendingImages = (postE.images || []).slice();
        render(); break;
      }
      case 'delete-post': {
        var pidDel = did(t, 'data-id');
        confirmBox({ message: '删除这条朋友圈？' }).then(function (ok) {
          if (ok) Store.deletePost(pidDel).then(function () { toast('已删除'); render(); });
        }); break;
      }
      case 'delete-comment': {
        var pidCm = did(t, 'data-id'); var cidCm = did(t, 'data-cid');
        if (!pidCm || !cidCm) break;
        confirmBox({ message: '删除这条评论？' }).then(function (ok) {
          if (ok) Store.deleteComment(pidCm, cidCm).then(function () { toast('已删除'); render(); });
        }); break;
      }
      case 'lp-edit-post': {
        var pidLpE = did(t, 'data-id'); var postLpE = null;
        for (var le = 0; le < state.posts.length; le++) { if (state.posts[le].id === pidLpE) { postLpE = state.posts[le]; break; } }
        if (!postLpE) break;
        state.lpSheetOpen = false; state.lpTarget = null;
        state.editPostId = pidLpE; state.editModalOpen = true;
        pendingImages = (postLpE.images || []).slice();
        render(); break;
      }
      case 'lp-delete-post': {
        var pidLpD = did(t, 'data-id');
        state.lpSheetOpen = false; state.lpTarget = null;
        confirmBox({ message: '删除这条朋友圈？' }).then(function (ok) {
          if (ok) Store.deletePost(pidLpD).then(function () { toast('已删除'); render(); });
        }); break;
      }
      case 'lp-delete-comment': {
        var pidLpC = did(t, 'data-id'); var cidLpC = did(t, 'data-cid');
        state.lpSheetOpen = false; state.lpTarget = null;
        if (!pidLpC || !cidLpC) break;
        confirmBox({ message: '删除这条评论？' }).then(function (ok) {
          if (ok) Store.deleteComment(pidLpC, cidLpC).then(function () { toast('已删除'); render(); });
        }); break;
      }
      case 'clear-img-cache': { confirmBox({ message: '清除朋友圈本地图片缓存？已发布的本地图片会失效。' }).then(function (ok) { if (ok) return cachedRoche.storage.set(KEYS.IMGCACHE, []); }).then(function () { toast('已清除'); }); break; }
      case 'enable-subapi': { var sid = did(t, 'data-id'); state.subapi.forEach(function (p) { p.enabled = (p.id === sid); }); Store.saveSubApi().then(render); break; }
      case 'del-subapi': { var sid2 = did(t, 'data-id'); state.subapi = state.subapi.filter(function (p) { return p.id !== sid2; }); Store.saveSubApi().then(render); break; }
      case 'refresh-models': { var url = $('#moments-sa-url', root) ? $('#moments-sa-url', root).value : ''; var key = $('#moments-sa-key', root) ? $('#moments-sa-key', root).value : ''; if (!trim(url) || !trim(key)) { toast('请填 URL 和 Key'); break; } setTip('刷新模型列表中...'); fetchModels(url, key).then(function (list) { setTip(null); var sel = $('#moments-sa-model', root); if (sel) sel.innerHTML = list.length ? list.map(function (m) { return '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + '</option>'; }).join('') : '<option value="">无可用模型</option>'; toast('获取到 ' + list.length + ' 个模型'); }).catch(function (err) { setTip(null); toast('刷新失败：' + (err && err.message || '')); }); break; }
      case 'save-subapi': { var name = $('#moments-sa-name', root) ? $('#moments-sa-name', root).value : ''; var url2 = $('#moments-sa-url', root) ? $('#moments-sa-url', root).value : ''; var key2 = $('#moments-sa-key', root) ? $('#moments-sa-key', root).value : ''; var model = $('#moments-sa-model', root) ? $('#moments-sa-model', root).value : ''; if (!trim(name) || !trim(url2) || !trim(key2) || !trim(model)) { toast('请完整填写'); break; } state.subapi.push({ id: uuid(), name: trim(name), url: trim(url2), apiKey: trim(key2), model: trim(model), enabled: false }); Store.saveSubApi().then(function () { toast('已保存'); render(); }); break; }
      case 'publish-post': {
        if (!space) break; var subj4 = getCurrentSubject(); if (!subj4) break;
        var txtEl = $('#moments-post-text', root); var text = txtEl ? trim(txtEl.value) : ''; var imgs = pendingImages.slice();
        if (!text && !imgs.length) { toast('请输入内容'); break; }
        var post7 = { id: uuid(), spaceId: space.id, authorType: subj4.type, authorId: subj4.id, authorName: subj4.realName || subj4.name, authorHandle: subj4.name, authorAvatar: subj4.avatar, text: text, images: imgs, location: '', createdAt: Date.now(), likes: [], comments: [] };
        Store.addPost(post7).then(function () { state.postModalOpen = false; pendingImages = []; render(); if (subj4.type === 'user') { setTip('char 正在评论...'); generateAutoComments(space, post7, DEFAULT_AUTO_COMMENT).then(function (results) { setTip(null); return injectCharsRealtime(space, (results || []).map(function (r) { return r.authorId; })); }).catch(function () { setTip(null); }); } });
        break;
      }
      case 'save-edit-post': {
        var pidSave = state.editPostId; if (!pidSave) break;
        var txtSave = $('#moments-post-text', root); var textSave = txtSave ? trim(txtSave.value) : '';
        var imgsSave = pendingImages.slice();
        if (!textSave && !imgsSave.length) { toast('请输入内容'); break; }
        Store.updatePost(pidSave, { text: textSave, images: imgsSave }).then(function () {
          state.editModalOpen = false; state.editPostId = null; pendingImages = [];
          toast('已保存'); render();
        }); break;
      }
      case 'open-notif-item': { var nid = did(t, 'data-id'); var nItem = null; for (var z = 0; z < state.notifs.length; z++) if (state.notifs[z].id === nid) { nItem = state.notifs[z]; break; } if (nItem) { nItem.read = true; Store.saveNotifs().then(function () { state.notifPanelOpen = false; render(); setTimeout(function () { var node = $('.moment[data-id="' + nItem.postId + '"]', root); if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50); }); } break; }
    }
  }

  // 会话加载：只列包含该 char 的会话
  function loadConversationsForChar(charId) {
    var space = Store.getActiveSpace(); if (!space) return;
    var sc = getSpaceChar(space, charId); if (!sc) return;
    sc._convLoading = true; render();
    if (!cachedRoche.conversation || !cachedRoche.conversation.list) { sc._convLoading = false; sc._convCache = []; render(); return; }
    // 优先用 memberId 过滤，列出包含该 char 的会话
    var p;
    try { p = Promise.resolve(cachedRoche.conversation.list({ memberId: charId })); }
    catch (e) { p = Promise.resolve(cachedRoche.conversation.list()); }
    p.then(function (list) {
      list = list || [];
      // 兜底过滤：确保会话确实包含该 char（单聊 contactId 或群聊 members）
      var filtered = list.filter(function (c) {
        var id = c.id || c.conversationId;
        if (c.contactId && c.contactId === charId) return true;
        if (c.members && c.members.indexOf) return c.members.indexOf(charId) >= 0;
        if (c.memberProfiles) { for (var i = 0; i < c.memberProfiles.length; i++) if (c.memberProfiles[i].id === charId) return true; }
        // 单聊且 handle/name 匹配也算
        return true; // memberId 已过滤，默认信任
      });
      sc._convCache = filtered.map(function (c) { return { id: c.id || c.conversationId, name: c.name || c.title || c.handle || (c.id || c.conversationId), isGroup: c.isGroup, handle: c.handle, avatar: c.avatar }; });
      sc._convLoading = false;
      render();
    }).catch(function () { sc._convLoading = false; sc._convCache = []; render(); });
  }

  // 发布图片工具
  function setupPostModalTools() {
    if (!root) return;
    $all('.mp-tool', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tool = btn.getAttribute('data-tool');
        if (tool === 'text') { var txt = window.prompt('输入文字图内容（点击后显示）：'); if (txt != null && trim(txt)) { pendingImages.push({ type: 'text', value: trim(txt), textContent: trim(txt) }); refreshPostImages(); } }
        else if (tool === 'url') { var url = window.prompt('输入图片 URL：'); if (url != null && trim(url)) { pendingImages.push({ type: 'url', value: trim(url) }); refreshPostImages(); } }
      });
    });
    var fileInput = $('#moments-post-file', root);
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0]; if (!f) return;
        if (f.size > 2 * 1024 * 1024) toast('图片超过 2MB，建议用 URL');
        var reader = new FileReader();
        reader.onload = function () {
          var dataUri = reader.result; pendingImages.push({ type: 'local', value: dataUri });
          cachedRoche.storage.get(KEYS.IMGCACHE).then(function (cache) { cache = cache || []; cache.push({ key: dataUri.slice(0, 32), dataUri: dataUri }); if (cache.length > 50) cache = cache.slice(-50); cachedRoche.storage.set(KEYS.IMGCACHE, cache); });
          refreshPostImages();
        };
        reader.readAsDataURL(f); fileInput.value = '';
      });
    }
  }
  function refreshPostImages() {
    var box = $('#moments-post-imgs', root); if (!box) return;
    box.innerHTML = pendingImages.map(function (img, idx) {
      var preview = img.type === 'text' ? '<div class="mp-img-text">' + ICON.image + '<span>' + escapeHtml((img.textContent || '').slice(0, 8)) + '</span></div>' : '<img src="' + escapeHtml(img.value) + '">';
      return '<div class="mp-img">' + preview + '<div class="mp-img-del" data-mp-del="' + idx + '">' + ICON.close + '</div></div>';
    }).join('');
    $all('[data-mp-del]', box).forEach(function (d) { d.addEventListener('click', function () { pendingImages.splice(parseInt(d.getAttribute('data-mp-del'), 10), 1); refreshPostImages(); }); });
  }

  // ========== CSS（微信拟真）==========
  var CSS = ''
+ '.' + ROOT_CLASS + '{position:absolute;inset:0;background:#EDEDED;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#353535;font-size:14px;line-height:1.5;}'
+ '.' + ROOT_CLASS + ' *{box-sizing:border-box;}'
// 滚动容器：顶栏 sticky + 封面 + feed 全在里面滚动；底部留安全边距防输入栏遮挡
+ '.' + ROOT_CLASS + ' .moments-scroll{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding-bottom:var(--bottom-pad,80px);}'
// 顶栏 黑底白字 sticky；高度可调
+ '.' + ROOT_CLASS + ' .moments-topbar{position:sticky;top:0;left:0;right:0;z-index:20;display:flex;align-items:center;background:#1F1F1F;color:#fff;padding:0 8px;padding-top:calc(env(safe-area-inset-top,0px) + var(--topbar-pad,0px) + 72px);height:calc(44px + var(--topbar-pad,0px) + env(safe-area-inset-top,0px) + 72px);flex-shrink:0;box-sizing:border-box;}'
+ '.' + ROOT_CLASS + ' .moments-tb-left{flex:1 1 0;height:100%;display:flex;align-items:center;justify-content:flex-start;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-tb-title{flex:0 0 auto;text-align:center;font-size:17px;font-weight:500;cursor:pointer;user-select:none;padding:8px 12px;margin:-8px -12px;}'
+ '.' + ROOT_CLASS + ' .moments-tb-right{flex:1 1 0;height:100%;display:flex;align-items:center;justify-content:flex-end;gap:2px;}'
// 评论态：滚动区底部额外让出输入栏高度，确保不遮挡
+ '.' + ROOT_CLASS + '.commenting .moments-scroll{padding-bottom:calc(var(--cm-h,52px) + var(--bottom-pad,80px) + 12px);}'

+ '.' + ROOT_CLASS + ' .moments-range{width:100%;-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;background:#ddd;outline:none;margin:6px 0;}'
+ '.' + ROOT_CLASS + ' .moments-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;border-radius:50%;background:#576B95;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-range::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#576B95;cursor:pointer;border:none;}'
+ '.' + ROOT_CLASS + ' .moments-range-val{font-size:12px;color:#576B95;font-weight:600;min-width:42px;text-align:right;}'
+ '.' + ROOT_CLASS + ' .moments-tb-icon{width:40px;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;}'
+ '.' + ROOT_CLASS + ' .moments-dot{position:absolute;top:7px;right:8px;width:8px;height:8px;background:#FA5151;border-radius:50%;border:1.5px solid #1F1F1F;}'
// 封面
+ '.' + ROOT_CLASS + ' .moments-cover-wrap{position:relative;width:100%;height:270px;background:#333;}'
+ '.' + ROOT_CLASS + ' .moments-cover{position:absolute;inset:0;background-size:cover;background-position:center;background-color:#576B95;cursor:pointer;overflow:hidden;}'
+ '.' + ROOT_CLASS + ' .moments-cover-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.55);font-size:13px;}'
+ '.' + ROOT_CLASS + ' .moments-cover-bar{position:absolute;left:0;right:0;bottom:-34px;display:flex;align-items:flex-end;justify-content:flex-end;gap:14px;padding:0 16px;z-index:2;}'
+ '.' + ROOT_CLASS + ' .moments-cover-name{color:#fff;font-size:17px;font-weight:600;text-shadow:0 1px 4px rgba(0,0,0,0.6);margin-bottom:8px;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-cover-avatar{cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-avatar{width:70px;height:70px;border-radius:8px;overflow:hidden;border:3px solid #fff;background:#ddd;box-shadow:0 1px 6px rgba(0,0,0,0.2);}'
+ '.' + ROOT_CLASS + ' .moments-avatar.sm{width:38px;height:38px;border-radius:6px;border:none;}'
+ '.' + ROOT_CLASS + ' .moments-avatar img{width:100%;height:100%;object-fit:cover;display:block;}'
+ '.' + ROOT_CLASS + ' .moments-avatar-fb{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#576B95;color:#fff;font-size:22px;font-weight:600;}'
+ '.' + ROOT_CLASS + ' .moments-avatar.sm .moments-avatar-fb{font-size:16px;}'
// feed
+ '.' + ROOT_CLASS + ' .moments-feed{padding:46px 0 30px 0;background:#EDEDED;}'
+ '.' + ROOT_CLASS + ' .moment{background:#fff;padding:14px 16px;border-bottom:1px solid #f0f0f0;position:relative;}'
+ '.' + ROOT_CLASS + ' .moment-hd{display:flex;align-items:flex-start;}'
+ '.' + ROOT_CLASS + ' .moment-avatar{width:42px;height:42px;border-radius:6px;overflow:hidden;background:#ddd;flex-shrink:0;margin-right:10px;}'
+ '.' + ROOT_CLASS + ' .moment-avatar img{width:100%;height:100%;object-fit:cover;}'
+ '.' + ROOT_CLASS + ' .moment-avatar .moments-avatar-fb{font-size:18px;}'
+ '.' + ROOT_CLASS + ' .moment-meta{flex:1;padding-top:3px;}'
+ '.' + ROOT_CLASS + ' .moment-author{color:#576B95;font-size:15px;font-weight:600;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moment-loc{color:#576B95;font-size:12px;margin-top:2px;display:flex;align-items:center;gap:2px;}'
+ '.' + ROOT_CLASS + ' .moment-text{margin-top:6px;font-size:15px;line-height:1.6;color:#353535;word-break:break-word;}'
// 图片网格
+ '.' + ROOT_CLASS + ' .moment-imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px;}'
+ '.' + ROOT_CLASS + ' .moment-imgs.single{grid-template-columns:1fr;max-width:210px;}'
+ '.' + ROOT_CLASS + ' .m-img,.' + ROOT_CLASS + ' .m-img-text{width:100%;aspect-ratio:1;background:#f0f0f0;border-radius:4px;overflow:hidden;position:relative;}'
+ '.' + ROOT_CLASS + ' .moment-imgs.single .m-img{aspect-ratio:auto;max-height:240px;}'
+ '.' + ROOT_CLASS + ' .m-img img{width:100%;height:100%;object-fit:cover;display:block;}'
// 文字图：原位显示
+ '.' + ROOT_CLASS + ' .m-img-text{cursor:pointer;background:linear-gradient(135deg,#eaeaea,#d5d5d5);}'
+ '.' + ROOT_CLASS + ' .m-img-text .mit-ph{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#999;font-size:11px;}'
+ '.' + ROOT_CLASS + ' .m-img-text .mit-tx{display:none;position:absolute;inset:0;padding:10px;align-items:center;justify-content:center;text-align:center;font-size:13px;line-height:1.6;color:#333;background:rgba(255,255,255,0.92);overflow:auto;}'
+ '.' + ROOT_CLASS + ' .m-img-text.revealed .mit-ph{display:none;}'
+ '.' + ROOT_CLASS + ' .m-img-text.revealed .mit-tx{display:flex;}'
// footer 时间+操作
+ '.' + ROOT_CLASS + ' .moment-ft{display:flex;align-items:center;justify-content:space-between;margin-top:8px;position:relative;}'
+ '.' + ROOT_CLASS + ' .moment-time{font-size:12px;color:#99a0a8;}'
+ '.' + ROOT_CLASS + ' .moment-acts{display:flex;align-items:center;padding:4px 6px;color:#576B95;background:#f7f7f7;border-radius:4px;cursor:pointer;}'
// 操作气泡：相对 .moment-ft 定位，出现在"··"按钮左侧并垂直居中
+ '.' + ROOT_CLASS + ' .moment-act-pop{position:absolute;right:38px;top:50%;transform:translateY(-50%);display:none;z-index:30;}'
+ '.' + ROOT_CLASS + ' .moment-act-pop.open{display:flex;background:#4c4c4c;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.3);}'
+ '.' + ROOT_CLASS + ' .moment-act-pop.open::after{content:"";position:absolute;right:-6px;top:50%;transform:translateY(-50%);border:6px solid transparent;border-left-color:#4c4c4c;}'
+ '.' + ROOT_CLASS + ' .moment-act-pop-i{display:flex;align-items:center;gap:4px;color:#fff;font-size:13px;padding:8px 14px;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moment-act-pop-i.subtle{color:rgba(255,255,255,0.6);font-size:12px;}'
+ '.' + ROOT_CLASS + ' .moment-act-pop-i.danger{color:#FA5151;}'
+ '.' + ROOT_CLASS + ' .moment-act-pop-i:not(:last-child){border-right:1px solid rgba(255,255,255,0.2);}'
// 互动区
+ '.' + ROOT_CLASS + ' .moment-int{background:#f7f7f7;border-radius:4px;padding:6px 10px;margin-top:6px;position:relative;}'
+ '.' + ROOT_CLASS + ' .moment-likes{display:flex;align-items:flex-start;gap:5px;color:#576B95;font-size:13px;padding:3px 0;border-bottom:1px solid #eee;}'
+ '.' + ROOT_CLASS + ' .moment-likes svg{flex-shrink:0;margin-top:2px;}'
+ '.' + ROOT_CLASS + ' .moment-comments{padding-top:3px;}'
+ '.' + ROOT_CLASS + ' .moment-comments .mc{font-size:13px;line-height:1.7;color:#353535;cursor:pointer;position:relative;}'
+ '.' + ROOT_CLASS + ' .mc-n{color:#576B95;font-weight:600;}'
+ '.' + ROOT_CLASS + ' .mc-r{color:#999;}'
+ '.' + ROOT_CLASS + ' .mc-c{color:#353535;}'
+ '.' + ROOT_CLASS + ' .mc-at{color:#576B95;font-weight:500;}'
// 长按反馈
+ '.' + ROOT_CLASS + ' .moment.lp-active{background:#f0f0f0;transition:background 0.15s;}'
+ '.' + ROOT_CLASS + ' .mc.lp-active{background:rgba(87,107,149,0.08);border-radius:4px;transition:background 0.15s;}'
// 空状态
+ '.' + ROOT_CLASS + ' .moments-feed-empty{padding:90px 20px;text-align:center;color:#999;}'
+ '.' + ROOT_CLASS + ' .moments-feed-empty svg{color:#bbb;margin-bottom:12px;}'
+ '.' + ROOT_CLASS + ' .moments-fe-hint{font-size:12px;margin-top:6px;color:#bbb;}'
+ '.' + ROOT_CLASS + ' .moments-empty{padding:40px 20px;text-align:center;color:#999;font-size:13px;}'
// 局部 tip
+ '.' + ROOT_CLASS + ' .moments-tip{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#fff;color:#888;font-size:13px;border-bottom:1px solid #f0f0f0;}'
+ '.' + ROOT_CLASS + ' .moments-spin{width:30px;height:30px;flex-shrink:0;}'
+ '.' + ROOT_CLASS + ' .moments-spin.sm{width:18px;height:18px;}'
+ '.' + ROOT_CLASS + ' .moments-spin svg{animation:mom-spin 1.2s linear infinite;}'
// mask + 侧边栏
+ '.' + ROOT_CLASS + ' .moments-mask{position:absolute;inset:0;background:rgba(0,0,0,0.4);z-index:50;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar{position:absolute;top:0;left:0;bottom:0;width:280px;background:#fff;transform:translateX(-100%);transition:transform 0.25s;z-index:51;overflow-y:auto;-webkit-overflow-scrolling:touch;box-shadow:2px 0 12px rgba(0,0,0,0.15);}'
+ '.' + ROOT_CLASS + ' .moments-sidebar.open{transform:translateX(0);}'
+ '.' + ROOT_CLASS + ' .moments-sb-hd{display:flex;align-items:center;justify-content:space-between;padding:0 16px;height:50px;border-bottom:1px solid #f0f0f0;}'
+ '.' + ROOT_CLASS + ' .moments-sb-title{font-size:17px;font-weight:600;}'
+ '.' + ROOT_CLASS + ' .moments-sb-close{cursor:pointer;color:#999;padding:4px;}'
+ '.' + ROOT_CLASS + ' .moments-sb-sec{padding:10px 0;border-bottom:1px solid #f0f0f0;}'
+ '.' + ROOT_CLASS + ' .moments-sb-label{padding:0 16px 6px;font-size:12px;color:#999;}'
+ '.' + ROOT_CLASS + ' .moments-sb-item{display:flex;align-items:center;padding:10px 16px;cursor:pointer;gap:10px;}'
+ '.' + ROOT_CLASS + ' .moments-sb-item:hover{background:#f7f7f7;}'
+ '.' + ROOT_CLASS + ' .moments-sb-item.active{background:#eef2ff;}'
+ '.' + ROOT_CLASS + ' .moments-sb-item.col{flex-direction:column;align-items:stretch;}'
+ '.' + ROOT_CLASS + ' .moments-sb-row{display:flex;align-items:center;gap:10px;}'
+ '.' + ROOT_CLASS + ' .moments-sb-info{flex:1;min-width:0;}'
+ '.' + ROOT_CLASS + ' .moments-sb-name{font-size:14px;font-weight:500;}'
+ '.' + ROOT_CLASS + ' .moments-sb-sub{font-size:11px;color:#999;margin-top:2px;}'
+ '.' + ROOT_CLASS + ' .moments-sb-empty{padding:10px 16px;font-size:12px;color:#bbb;}'
+ '.' + ROOT_CLASS + ' .moments-sb-item .add-av{background:#f0f0f0;color:#576B95;display:flex;align-items:center;justify-content:center;}'
+ '.' + ROOT_CLASS + ' .moments-sb-btns{display:flex;gap:6px;margin-top:8px;padding-left:48px;flex-wrap:wrap;}'
+ '.' + ROOT_CLASS + ' .mm-btn{font-size:11px;padding:3px 9px;border:1px solid #576B95;color:#576B95;border-radius:11px;cursor:pointer;background:#fff;}'
+ '.' + ROOT_CLASS + ' .mm-btn:hover{background:#576B95;color:#fff;}'
+ '.' + ROOT_CLASS + ' .mm-btn.on{background:#07C160;color:#fff;border-color:#07C160;}'
+ '.' + ROOT_CLASS + ' .mm-btn.danger{border-color:#FA5151;color:#FA5151;}'
+ '.' + ROOT_CLASS + ' .mm-btn.danger:hover{background:#FA5151;color:#fff;}'
// modal
+ '.' + ROOT_CLASS + ' .moments-modal-mask{position:absolute;inset:0;background:rgba(0,0,0,0.5);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;}'
+ '.' + ROOT_CLASS + ' .moments-modal{background:#fff;border-radius:12px;width:100%;max-width:420px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;}'
+ '.' + ROOT_CLASS + ' .moments-modal.wide{max-width:480px;}'
+ '.' + ROOT_CLASS + ' .moments-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #f0f0f0;}'
+ '.' + ROOT_CLASS + ' .moments-modal-title{font-size:16px;font-weight:600;}'
+ '.' + ROOT_CLASS + ' .moments-modal-x{cursor:pointer;color:#999;padding:4px;}'
+ '.' + ROOT_CLASS + ' .moments-modal-bd{padding:16px;overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;}'
+ '.' + ROOT_CLASS + ' .moments-div{height:1px;background:#f0f0f0;margin:12px 0;}'
+ '.' + ROOT_CLASS + ' .moments-sec-title{font-size:14px;font-weight:600;margin-bottom:8px;}'
+ '.' + ROOT_CLASS + ' .moments-sec-hint{font-size:11px;color:#999;font-weight:400;margin-left:6px;}'
+ '.' + ROOT_CLASS + ' .moments-relation-svg{padding:10px;background:linear-gradient(135deg,#fafafa,#f0f0f0);border-radius:8px;margin-bottom:8px;}'
+ '.' + ROOT_CLASS + ' .moments-sync-vars{background:#fafafa;border-radius:8px;padding:10px;margin-bottom:8px;}'
+ '.' + ROOT_CLASS + ' .moments-sync-var-group{font-size:11px;color:#666;line-height:1.7;margin-bottom:4px;}'
+ '.' + ROOT_CLASS + ' .moments-sync-var-group b{color:#333;}'
+ '.' + ROOT_CLASS + ' .moments-sync-ta{width:100%;min-height:36px;border:1px solid #ddd;border-radius:6px;padding:8px 10px;font-size:12px;font-family:monospace;resize:vertical;box-sizing:border-box;margin-bottom:12px;}'
+ '.' + ROOT_CLASS + ' .moments-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;gap:12px;}'
+ '.' + ROOT_CLASS + ' .moments-row-label{font-size:14px;}'
+ '.' + ROOT_CLASS + ' .moments-input{border:1px solid #ddd;border-radius:6px;padding:6px 10px;font-size:14px;}'
+ '.' + ROOT_CLASS + ' .moments-input[type=number]{width:90px;}'
+ '.' + ROOT_CLASS + ' .moments-sw{width:44px;height:24px;background:#ccc;border-radius:12px;position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0;}'
+ '.' + ROOT_CLASS + ' .moments-sw.on{background:#07C160;}'
+ '.' + ROOT_CLASS + ' .moments-sw i{position:absolute;top:2px;left:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:left 0.2s;}'
+ '.' + ROOT_CLASS + ' .moments-sw.on i{left:22px;}'
+ '.' + ROOT_CLASS + ' .moments-conv{border:1px solid #f0f0f0;border-radius:8px;padding:10px;margin-bottom:8px;}'
+ '.' + ROOT_CLASS + ' .moments-conv.on{border-color:#576B95;background:#f8faff;}'
+ '.' + ROOT_CLASS + ' .moments-conv-hd{display:flex;align-items:center;justify-content:space-between;}'
+ '.' + ROOT_CLASS + ' .moments-conv-name{font-size:14px;font-weight:500;}'
+ '.' + ROOT_CLASS + ' .moments-conv-opts{display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;}'
+ '.' + ROOT_CLASS + ' .moments-conv-opts label{display:flex;align-items:center;gap:4px;font-size:12px;color:#666;}'
+ '.' + ROOT_CLASS + ' .moments-conv-opts input[type=number]{width:64px;}'
+ '.' + ROOT_CLASS + ' .moments-hint{font-size:12px;color:#999;line-height:1.6;margin:8px 0;}'
+ '.' + ROOT_CLASS + ' .moments-btn-row{display:flex;gap:8px;margin-top:12px;}'
+ '.' + ROOT_CLASS + ' .moments-btn{flex:1;padding:10px;background:#07C160;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-btn:hover{background:#06ad56;}'
+ '.' + ROOT_CLASS + ' .moments-btn.ghost{background:#f0f0f0;color:#353535;}'
// 副 API
+ '.' + ROOT_CLASS + ' .moments-sa{display:flex;align-items:center;justify-content:space-between;padding:10px;border:1px solid #f0f0f0;border-radius:8px;margin-bottom:8px;}'
+ '.' + ROOT_CLASS + ' .moments-sa.active{border-color:#07C160;background:#f6fff9;}'
+ '.' + ROOT_CLASS + ' .moments-sa-info{flex:1;min-width:0;}'
+ '.' + ROOT_CLASS + ' .moments-sa-name{font-size:14px;font-weight:500;}'
+ '.' + ROOT_CLASS + ' .moments-sa-sub{font-size:11px;color:#999;margin-top:2px;word-break:break-all;}'
+ '.' + ROOT_CLASS + ' .moments-sa-btns{display:flex;gap:4px;}'
+ '.' + ROOT_CLASS + ' .moments-form{display:flex;flex-direction:column;gap:10px;}'
+ '.' + ROOT_CLASS + ' .moments-form label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#666;}'
+ '.' + ROOT_CLASS + ' .moments-form .moments-input{width:100%;}'
+ '.' + ROOT_CLASS + ' .moments-form-row{display:flex;gap:8px;align-items:flex-end;}'
+ '.' + ROOT_CLASS + ' .moments-form-row label{flex:1;}'
// 发朋友圈
+ '.' + ROOT_CLASS + ' .moments-post-as{font-size:13px;color:#666;margin-bottom:10px;}'
+ '.' + ROOT_CLASS + ' .moments-post-as b{color:#576B95;}'
+ '.' + ROOT_CLASS + ' .moments-post-text{width:100%;min-height:120px;border:1px solid #eee;border-radius:8px;padding:10px;font-size:14px;resize:vertical;font-family:inherit;}'
+ '.' + ROOT_CLASS + ' .moments-post-imgs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}'
+ '.' + ROOT_CLASS + ' .mp-img{position:relative;width:78px;height:78px;border-radius:6px;overflow:hidden;background:#f0f0f0;}'
+ '.' + ROOT_CLASS + ' .mp-img img{width:100%;height:100%;object-fit:cover;}'
+ '.' + ROOT_CLASS + ' .mp-img-text{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;color:#888;gap:2px;}'
+ '.' + ROOT_CLASS + ' .mp-img-del{position:absolute;top:0;right:0;width:20px;height:20px;background:rgba(0,0,0,0.5);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;border-bottom-left-radius:6px;}'
+ '.' + ROOT_CLASS + ' .moments-post-tools{display:flex;gap:14px;margin-top:10px;}'
+ '.' + ROOT_CLASS + ' .mp-tool{display:flex;align-items:center;gap:4px;cursor:pointer;color:#576B95;font-size:13px;padding:6px;border-radius:6px;}'
+ '.' + ROOT_CLASS + ' .mp-tool:hover{background:#f0f0f0;}'
// 评论栏
+ '.' + ROOT_CLASS + ' .moments-cm-bar{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fff;border-top:1px solid #eee;z-index:40;}'
+ '.' + ROOT_CLASS + ' .moments-cm-input{flex:1;border:1px solid #ddd;border-radius:6px;padding:8px 10px;font-size:14px;}'
+ '.' + ROOT_CLASS + ' .moments-cm-send{width:40px;height:38px;display:flex;align-items:center;justify-content:center;background:#07C160;color:#fff;border:none;border-radius:6px;cursor:pointer;}'
// sheet
+ '.' + ROOT_CLASS + ' .moments-sheet{background:#fff;border-radius:12px 12px 0 0;width:100%;max-width:420px;max-height:70vh;overflow-y:auto;-webkit-overflow-scrolling:touch;align-self:flex-end;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-title{padding:16px;text-align:center;font-size:15px;font-weight:600;border-bottom:1px solid #f0f0f0;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-item{display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-item:hover{background:#f7f7f7;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-item.active{background:#eef2ff;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-info{flex:1;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-name{font-size:14px;font-weight:500;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-sub{font-size:11px;color:#999;margin-top:2px;}'
// 通知
+ '.' + ROOT_CLASS + ' .moments-notif{display:flex;gap:10px;padding:12px 0;border-bottom:1px solid #f5f5f5;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-notif.unread{background:#f8faff;margin:0 -16px;padding:12px 16px;}'
+ '.' + ROOT_CLASS + ' .moments-notif-info{flex:1;}'
+ '.' + ROOT_CLASS + ' .moments-notif-text{font-size:13px;line-height:1.5;}'
+ '.' + ROOT_CLASS + ' .moments-notif-text b{color:#576B95;}'
+ '.' + ROOT_CLASS + ' .moments-notif-time{font-size:11px;color:#999;margin-top:4px;}'
// boot loading
+ '.' + ROOT_CLASS + ' .moments-boot{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#EDEDED;gap:14px;}'
+ '.' + ROOT_CLASS + ' .moments-boot-text{font-size:13px;color:#999;}'
// 氛围提示词 + NPC
+ '.' + ROOT_CLASS + ' .moments-mood-ta{width:100%;min-height:80px;border:1px solid #eee;border-radius:8px;padding:10px;font-size:13px;resize:vertical;font-family:inherit;margin-top:4px;}'
+ '.' + ROOT_CLASS + ' .moments-mood-label{font-size:13px;color:#666;margin-top:12px;}'
+ '.' + ROOT_CLASS + ' .moments-mood-hint{font-size:11px;color:#aaa;margin-top:2px;}'
+ '.' + ROOT_CLASS + ' .moments-npc-item{display:flex;align-items:flex-start;gap:8px;padding:10px;border:1px solid #f0f0f0;border-radius:8px;margin-bottom:8px;}'
+ '.' + ROOT_CLASS + ' .moments-npc-item-info{flex:1;min-width:0;}'
+ '.' + ROOT_CLASS + ' .moments-npc-item-name{font-size:14px;font-weight:500;}'
+ '.' + ROOT_CLASS + ' .moments-npc-item-sub{font-size:11px;color:#999;margin-top:2px;word-break:break-all;}'
+ '.' + ROOT_CLASS + ' .moments-npc-suggest{display:flex;align-items:flex-start;gap:8px;padding:10px;border:1px dashed #c8d4e8;border-radius:8px;margin-bottom:8px;background:#f8faff;}'
+ '@keyframes mom-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'
// 夜间模式
+ '.' + ROOT_CLASS + '.dark{background:#121212;color:#E0E0E0;}'
+ '.' + ROOT_CLASS + '.dark .moments-boot{background:#121212;color:#888;}'
+ '.' + ROOT_CLASS + '.dark .moment{background:#1E1E1E;border-bottom-color:#2A2A2A;}'
+ '.' + ROOT_CLASS + '.dark .m-img,.' + ROOT_CLASS + '.dark .m-img-text,.' + ROOT_CLASS + '.dark .mp-img{background:#2A2A2A;}'
+ '.' + ROOT_CLASS + '.dark .moment-acts,.' + ROOT_CLASS + '.dark .moment-int{background:#2A2A2A;}'
+ '.' + ROOT_CLASS + '.dark .moment-likes{border-bottom-color:#2A2A2A;}'
+ '.' + ROOT_CLASS + '.dark .moments-tip{background:#1E1E1E;color:#888;border-bottom-color:#2A2A2A;}'
+ '.' + ROOT_CLASS + '.dark .moments-sidebar{background:#1E1E1E;box-shadow:2px 0 12px rgba(0,0,0,0.5);}'
+ '.' + ROOT_CLASS + '.dark .moments-sb-item:hover{background:#2A2A2A;}'
+ '.' + ROOT_CLASS + '.dark .mm-btn{background:#1E1E1E;}'
+ '.' + ROOT_CLASS + '.dark .moments-modal{background:#1E1E1E;color:#E0E0E0;}'
+ '.' + ROOT_CLASS + '.dark .moments-div{background:#2A2A2A;}'
+ '.' + ROOT_CLASS + '.dark .moments-btn.ghost{background:#2A2A2A;color:#E0E0E0;}'
+ '.' + ROOT_CLASS + '.dark .moments-cm-bar{background:#1E1E1E;border-top-color:#2A2A2A;}'
+ '.' + ROOT_CLASS + '.dark .moments-sheet{background:#1E1E1E;color:#E0E0E0;}'
+ '.' + ROOT_CLASS + '.dark .moments-sheet-item:hover{background:#2A2A2A;}'
+ '.' + ROOT_CLASS + '.dark .mp-tool:hover{background:#2A2A2A;}'
+ '.' + ROOT_CLASS + '.dark .moments-input,.' + ROOT_CLASS + '.dark .moments-mood-ta{background:#2A2A2A;border-color:#3a3a3a;color:#E0E0E0;}'
+ '.' + ROOT_CLASS + '.dark .moments-npc-item{border-color:#2A2A2A;}'
+ '.' + ROOT_CLASS + '.dark .moments-npc-suggest{background:#1E2433;border-color:#3a4a6a;}'
+ '.' + ROOT_CLASS + '.dark .moments-modal-mask{background:rgba(0,0,0,0.65);}'
+ '.' + ROOT_CLASS + '.dark .moments-sb-sub,.' + ROOT_CLASS + '.dark .moments-sb-label,.' + ROOT_CLASS + '.dark .moments-hint,.' + ROOT_CLASS + '.dark .moments-empty,.' + ROOT_CLASS + '.dark .moments-boot-text,.' + ROOT_CLASS + '.dark .moments-mood-hint{color:#888;}'
+ '.' + ROOT_CLASS + '.dark .moments-cover-ph{color:rgba(255,255,255,0.45);}'
+ '.' + ROOT_CLASS + '.dark .moment.lp-active{background:#2A2A2A;}'
+ '.' + ROOT_CLASS + '.dark .mc.lp-active{background:rgba(255,255,255,0.06);}'
+ '.' + ROOT_CLASS + '.dark .moment-act-pop-i.danger{color:#FF6B6B;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-item.danger{color:#FA5151;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-item.danger svg{color:#FA5151;}'
+ '.' + ROOT_CLASS + '.dark .moments-sheet-item.danger{color:#FF6B6B;}'
+ '.' + ROOT_CLASS + '.dark .moments-sheet-item.danger svg{color:#FF6B6B;}';

  // ========== 插件注册 ==========
  window.RochePlugin = window.RochePlugin || {};
  window.RochePlugin.register = window.RochePlugin.register || function () {};
  window.RochePlugin.register({
    id: PLUGIN_ID,
    name: '朋友圈',
    version: '0.9.9',
    apps: [{
      id: APP_ID,
      name: '朋友圈',
      iconImage: WINDMILL_DATA_URI,
      async mount(container, roche) {
        cachedRoche = roche;
        root = container;
        state.bootLoading = true;
        if (!document.querySelector('style[data-plugin="' + PLUGIN_ID + '"]')) {
          var st = document.createElement('style');
          st.setAttribute('data-plugin', PLUGIN_ID);
          st.textContent = CSS;
          document.head.appendChild(st);
        }
        render();
        try {
          await refreshPersonas();
          await refreshChars();
          await Store.loadAll();
          if (!state.activeSpaceId || !Store.getActiveSpace()) {
            if (state.allPersonas.length) {
              var sp = ensureSpaceForPersona(state.activePersona || state.allPersonas[0]);
              state.activeSpaceId = sp.id;
              await Store.saveActive();
            }
          }
        } catch (e) { console.warn('[Moments] init error', e); }
        state.bootLoading = false;
        bindEvents();
        render();
      },
      async unmount(container, roche) {
        // 自动同步方式1：注入 char 行为到单聊
        try {
          for (var i = 0; i < state.spaces.length; i++) {
            var sp = state.spaces[i];
            for (var j = 0; j < (sp.chars || []).length; j++) {
              var sc = sp.chars[j];
              if (sc.memSync) await injectCharActionToChat(sp, sc);
            }
          }
        } catch (e) { console.warn('[Moments] auto sync failed', e); }
        if (_docHandlers && _docHandlers.bound) {
          document.removeEventListener('click', _docHandlers.click, { capture: true });
          document.removeEventListener('dblclick', _docHandlers.dblclick, { capture: true });
          document.removeEventListener('change', _docHandlers.change, { capture: true });
          document.removeEventListener('input', _docHandlers.input, { capture: true });
          document.removeEventListener('touchstart', _docHandlers.touchstart, { capture: true });
          document.removeEventListener('touchend', _docHandlers.touchend, { capture: true });
          document.removeEventListener('touchcancel', _docHandlers.touchcancel, { capture: true });
          document.removeEventListener('touchmove', _docHandlers.touchmove, { capture: true });
          document.removeEventListener('mousedown', _docHandlers.mousedown, { capture: true });
          document.removeEventListener('mouseup', _docHandlers.mouseup, { capture: true });
          _docHandlers.bound = false;
        }
        pendingImages = [];
        if (container) container.replaceChildren();
        root = null;
      }
    }]
  });

  startBgTimer();
})();
