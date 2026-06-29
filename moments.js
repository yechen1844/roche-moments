/**
 * Roche 朋友圈插件 v0.2.0
 * 完全拟真微信朋友圈的沉浸式模拟
 * - user人设绑定多char，每个user人设一个独立朋友圈空间
 * - char主动发朋友圈（定时30min+±20%抖动，后台运行）
 * - AI评论生成（三种模式、顺序生成、char互回、like标签）
 * - 记忆挂载（单聊/群聊、短期/事实/核心独立配置）
 * - 双模式记忆同步（方式1直接IndexedDB注入char消息、方式2roche.memory.write事实记忆）
 * - 副 API 系统（OpenAI兼容、多预设、互斥启用）
 * - 文字图机制（spoiler样式，点击显示）
 * - 全沉浸式微信朋友圈 UI
 */
(function () {
  'use strict';

  // ========== 常量 ==========
  var PLUGIN_ID = 'roche-moments';
  var APP_ID = 'roche-moments-home';
  var ROOT_CLASS = 'roche-plugin-moments';
  var KEYS = {
    SPACES: 'moments:spaces',
    POSTS: 'moments:posts',
    NOTIFS: 'moments:notifs',
    SUBAPI: 'moments:subapi',
    SYNCSTATE: 'moments:syncstate',
    ACTIVE: 'moments:activeSpace',
    IMGCACHE: 'moments:imgcache'
  };
  var MIN_POST_INTERVAL = 30 * 60 * 1000; // 30 分钟
  var JITTER = 0.2; // ±20%
  var BG_CHECK_INTERVAL = 60 * 1000; // 后台每 60 秒检查一次（更及时）
  var SYNC_PREFIX = '[RocheMomentsSync';
  var MAX_AUTO_COMMENT = 8;
  var DEFAULT_AUTO_COMMENT = 2;

  // ========== 风车 SVG ==========
  var WINDMILL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(50,50)">' +
    petal(0, 'rgb(255,92,92)') + petal(45, 'rgb(255,169,77)') + petal(90, 'rgb(255,212,59)') +
    petal(135, 'rgb(105,219,124)') + petal(180, 'rgb(77,171,247)') + petal(225, 'rgb(116,143,252)') +
    petal(270, 'rgb(177,151,252)') + petal(315, 'rgb(255,107,157)') +
    '<circle r="6" fill="white"/></g></svg>';
  function petal(deg, color) {
    return '<g transform="rotate(' + deg + ')"><ellipse cx="0" cy="-22" rx="7" ry="22" fill="' + color + '"/></g>';
  }
  var WINDMILL_DATA_URI = 'data:image/svg+xml,' + WINDMILL_SVG.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'").replace(/#/g, '%23');

  // 内嵌图标（线性，微信风格）
  var ICON = {
    camera: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M9 3l1.5 2h3L15 3h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4zm3 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M15 5l-7 7 7 7V5z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    like: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M2 9h3v11H2V9zm5 0h4.5l-1 3.5c-.3 1 .5 2 1.5 2h.5l3-5.5V4H7v5z"/></svg>',
    likeFilled: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M2 9h3v11H2V9zm5 0h4.5l-1 3.5c-.3 1 .5 2 1.5 2h.5l3-5.5V4H7v5z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 4h16v12H8l-4 4V4z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 2a6 6 0 0 1 6 6v4l2 3H4l2-3V8a6 6 0 0 1 6-6zm-2 18h4a2 2 0 1 1-4 0z"/></svg>',
    menu: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9z"/></svg>',
    sync: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4V1L8 5l4 4V6a6 6 0 0 1 6 6h2A8 8 0 0 0 12 4zm0 14a6 6 0 0 1-6-6H4a8 8 0 0 0 8 8v3l4-4-4-4v3z"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 3l18 9-18 9 4-9-4-9z"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 4h18v16H3V4zm2 12l4-4 3 3 4-5 3 4V6H5v10zm3-7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>',
    location: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>'
  };

  // ========== 工具函数 ==========
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, props, children) {
    var n = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === 'class') n.className = props[k];
      else if (k === 'style' && typeof props[k] === 'object') Object.assign(n.style, props[k]);
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else if (k === 'html') n.innerHTML = props[k];
      else n.setAttribute(k, props[k]);
    }
    if (children) {
      if (typeof children === 'string') n.innerHTML = children;
      else if (Array.isArray(children)) children.forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      else n.appendChild(children);
    }
    return n;
  }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uuid() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
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
  function randomInterval(baseMin) {
    // baseMin 分钟，±JITTER 抖动
    var base = baseMin * 60 * 1000;
    var jitter = base * JITTER * (Math.random() * 2 - 1);
    return Math.round(base + jitter);
  }
  function randPick(arr, n) {
    var copy = arr.slice();
    var out = [];
    while (n-- > 0 && copy.length) {
      out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    }
    return out;
  }
  function trim(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }
  function fileName(p) { return (p || '').split(/[\\/]/).pop(); }

  // ========== 全局状态 ==========
  var cachedRoche = null; // mount 时赋值，unmount 后保留（后台定时器用）
  var root = null; // 当前容器
  var state = {
    spaces: [],
    posts: [],
    notifs: [],
    subapi: [],
    syncstate: {},
    activeSpaceId: null,
    currentSubject: 'user', // 'user' 或 charId
    sidebarOpen: false,
    postModalOpen: false,
    notifPanelOpen: false,
    subjectSheetOpen: false,
    memMountCharId: null,
    subApiPanelOpen: false,
    charListOpen: false,
    commentTarget: null, // { postId, replyTo: commentId|null, replyToName: null }
    textViewer: null,
    busy: false,
    busyMsg: '',
    allChars: [],
    allPersonas: [],
    activePersona: null
  };
  var cleanupFns = [];
  var styleTag = null;

  // ========== Store 数据层 ==========
  var Store = {
    _get: function (key, def) {
      return cachedRoche.storage.get(key).then(function (v) { return v == null ? def : v; });
    },
    _set: function (key, v) { return cachedRoche.storage.set(key, v); },

    loadAll: function () {
      return Promise.all([
        Store._get(KEYS.SPACES, []),
        Store._get(KEYS.POSTS, []),
        Store._get(KEYS.NOTIFS, []),
        Store._get(KEYS.SUBAPI, []),
        Store._get(KEYS.SYNCSTATE, {}),
        Store._get(KEYS.ACTIVE, null)
      ]).then(function (r) {
        state.spaces = r[0] || [];
        state.posts = r[1] || [];
        state.notifs = r[2] || [];
        state.subapi = r[3] || [];
        state.syncstate = r[4] || {};
        state.activeSpaceId = r[5];
        if (!state.activeSpaceId && state.spaces.length) state.activeSpaceId = state.spaces[0].id;
      });
    },
    saveSpaces: function () { return Store._set(KEYS.SPACES, state.spaces); },
    savePosts: function () { return Store._set(KEYS.POSTS, state.posts); },
    saveNotifs: function () { return Store._set(KEYS.NOTIFS, state.notifs); },
    saveSubApi: function () { return Store._set(KEYS.SUBAPI, state.subapi); },
    saveSyncState: function () { return Store._set(KEYS.SYNCSTATE, state.syncstate); },
    saveActive: function () { return Store._set(KEYS.ACTIVE, state.activeSpaceId); },

    getActiveSpace: function () {
      var i = -1;
      for (var k = 0; k < state.spaces.length; k++) if (state.spaces[k].id === state.activeSpaceId) { i = k; break; }
      return i >= 0 ? state.spaces[i] : null;
    },
    addPost: function (post) {
      state.posts.push(post);
      state.posts.sort(function (a, b) { return b.createdAt - a.createdAt; });
      return Store.savePosts();
    },
    updatePost: function (id, patch) {
      for (var i = 0; i < state.posts.length; i++) {
        if (state.posts[i].id === id) { Object.assign(state.posts[i], patch); break; }
      }
      return Store.savePosts();
    },
    deletePost: function (id) {
      state.posts = state.posts.filter(function (p) { return p.id !== id; });
      return Store.savePosts();
    },
    addComment: function (postId, comment) {
      for (var i = 0; i < state.posts.length; i++) {
        if (state.posts[i].id === postId) {
          if (!state.posts[i].comments) state.posts[i].comments = [];
          state.posts[i].comments.push(comment);
          break;
        }
      }
      return Store.savePosts();
    },
    toggleLike: function (postId, who) {
      for (var i = 0; i < state.posts.length; i++) {
        if (state.posts[i].id === postId) {
          var p = state.posts[i];
          if (!p.likes) p.likes = [];
          var idx = -1;
          for (var j = 0; j < p.likes.length; j++) if (p.likes[j].id === who.id) { idx = j; break; }
          if (idx >= 0) p.likes.splice(idx, 1);
          else p.likes.push(who);
          break;
        }
      }
      return Store.savePosts();
    },
    addNotif: function (n) {
      state.notifs.unshift(n);
      if (state.notifs.length > 200) state.notifs.length = 200;
      return Store.saveNotifs();
    },
    markAllNotifRead: function () {
      state.notifs.forEach(function (n) { n.read = true; });
      return Store.saveNotifs();
    },
    clearNotifs: function () {
      state.notifs = [];
      return Store.saveNotifs();
    },
    getSyncTs: function (spaceId, charId) {
      return state.syncstate[spaceId + '_' + charId] || 0;
    },
    setSyncTs: function (spaceId, charId, ts) {
      state.syncstate[spaceId + '_' + charId] = ts;
      return Store.saveSyncState();
    }
  };

  // ========== AI 路由 ==========
  function getActiveSubApi() {
    for (var i = 0; i < state.subapi.length; i++) if (state.subapi[i].enabled) return state.subapi[i];
    return null;
  }
  function callAI(opts) {
    var preset = getActiveSubApi();
    if (preset) return callSubApi(preset, opts);
    if (!cachedRoche || !cachedRoche.ai) return Promise.reject(new Error('无可用 AI'));
    return cachedRoche.ai.chat(opts).then(function (r) { return r.text || r.content || ''; });
  }
  function callSubApi(preset, opts) {
    var url = trim(preset.url).replace(/\/+$/, '');
    var body = {
      model: preset.model,
      messages: opts.messages,
      temperature: opts.temperature == null ? 0.85 : opts.temperature,
      stream: false
    };
    return fetch(url + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + preset.apiKey
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('副 API 状态 ' + res.status);
      return res.json();
    }).then(function (data) {
      var txt = '';
      try { txt = data.choices[0].message.content; } catch (e) { txt = ''; }
      return txt;
    });
  }
  function fetchModels(url, apiKey) {
    var u = trim(url).replace(/\/+$/, '');
    return fetch(u + '/models', {
      headers: { 'Authorization': 'Bearer ' + apiKey }
    }).then(function (res) {
      if (!res.ok) throw new Error('状态 ' + res.status);
      return res.json();
    }).then(function (data) {
      var list = [];
      if (Array.isArray(data.data)) data.data.forEach(function (m) { if (m.id) list.push(m.id); });
      return list;
    });
  }

  // ========== 人设/角色加载 ==========
  function refreshPersonas() {
    return cachedRoche.persona.getUserPersonas().then(function (list) {
      state.allPersonas = list || [];
      return cachedRoche.persona.getActiveUserPersona();
    }).then(function (ap) {
      state.activePersona = ap;
      return state.allPersonas;
    });
  }
  function refreshChars() {
    return cachedRoche.character.list().then(function (list) {
      state.allChars = list || [];
      return state.allChars;
    });
  }
  function findChar(charId) {
    for (var i = 0; i < state.allChars.length; i++) if (state.allChars[i].id === charId) return state.allChars[i];
    return null;
  }
  function charDisplayName(c) { return (c && (c.handle || c.name)) || '未知'; }
  function charAvatar(c) { return (c && c.avatar) || ''; }
  function charPersonaText(c) { return (c && (c.persona || c.bio)) || ''; }

  // ========== 空间/绑定管理 ==========
  function getSpaceChar(space, charId) {
    if (!space || !space.chars) return null;
    for (var i = 0; i < space.chars.length; i++) if (space.chars[i].charId === charId) return space.chars[i];
    return null;
  }
  function ensureSpaceForPersona(persona) {
    // 每个user人设对应一个space
    for (var i = 0; i < state.spaces.length; i++) {
      if (state.spaces[i].userPersonaId === persona.id) return state.spaces[i];
    }
    var sp = {
      id: 'sp_' + persona.id + '_' + Date.now().toString(36),
      userPersonaId: persona.id,
      userPersonaName: persona.name || persona.id,
      userPersonaHandle: persona.handle || persona.name || '',
      userPersonaAvatar: persona.avatar || '',
      userPersonaBio: persona.bio || '',
      cover: '',
      chars: [],
      createdAt: Date.now()
    };
    state.spaces.push(sp);
    Store.saveSpaces();
    return sp;
  }
  function bindCharToSpace(space, charId) {
    if (getSpaceChar(space, charId)) return;
    var c = findChar(charId);
    if (!c) return;
    space.chars.push({
      charId: c.id,
      charName: c.name || c.id,
      charHandle: c.handle || c.name || '',
      charAvatar: c.avatar || '',
      charPersona: c.persona || c.bio || '',
      charBio: c.bio || '',
      enabled: true,
      memoryMounts: [],
      nextPostAt: 0,
      postIntervalMin: 30,
      autoCommentCount: DEFAULT_AUTO_COMMENT,
      lastSyncAt: 0
    });
    Store.saveSpaces();
  }
  function unbindCharFromSpace(space, charId) {
    space.chars = space.chars.filter(function (c) { return c.charId !== charId; });
    Store.saveSpaces();
  }

  // ========== 记忆加载器 ==========
  function loadMountedMemory(spaceChar) {
    if (!spaceChar || !spaceChar.memoryMounts || !spaceChar.memoryMounts.length) return Promise.resolve('');
    var parts = [];
    var chain = Promise.resolve();
    spaceChar.memoryMounts.forEach(function (m) {
      if (!m.enabled) return;
      chain = chain.then(function () {
        return cachedRoche.memory.getShortTerm({ conversationId: m.conversationId, limit: m.shortLimit || 50 }).then(function (msgs) {
          (msgs || []).forEach(function (msg) {
            // 过滤 [RocheMomentsSync 防循环
            if (msg && msg.text && String(msg.text).indexOf(SYNC_PREFIX) === 0) return;
            var who = msg.senderHandle || msg.senderName || (msg.isMe ? 'user' : '对方');
            if (msg.text) parts.push(who + '：' + msg.text);
          });
          if (m.factLimit || m.coreEnabled) {
            return cachedRoche.memory.getLongTerm({ conversationId: m.conversationId, limit: m.factLimit || 50 });
          }
          return null;
        }).then(function (lt) {
          if (!lt) return;
          if (m.coreEnabled && lt.core && lt.core.summary) parts.push('【核心记忆】' + lt.core.summary);
          if (m.factLimit && lt.facts) {
            (lt.facts || []).forEach(function (f) {
              var t = f.summaryText || f.action || f.text || '';
              if (t) parts.push('【事实】' + t);
            });
          }
        }).catch(function () {});
      });
    });
    return chain.then(function () { return parts.join('\n'); });
  }

  // ========== 当前主体信息 ==========
  function getCurrentSubject() {
    var space = Store.getActiveSpace();
    if (!space) return null;
    if (state.currentSubject === 'user' || !state.currentSubject) {
      return {
        type: 'user',
        id: space.userPersonaId,
        name: space.userPersonaHandle || space.userPersonaName,
        realName: space.userPersonaName,
        avatar: space.userPersonaAvatar,
        bio: space.userPersonaBio
      };
    }
    var sc = getSpaceChar(space, state.currentSubject);
    if (!sc) return null;
    return {
      type: 'char',
      id: sc.charId,
      name: sc.charHandle || sc.charName,
      realName: sc.charName,
      avatar: sc.charAvatar,
      bio: sc.charBio,
      spaceChar: sc
    };
  }

  // ========== CharPost 生成 ==========
  function parsePostContent(raw) {
    var text = raw || '';
    var images = [];
    // 解析 <images><img>xxx</img></images> 或 <image>xxx</image>
    var imgBlock = text.match(/<images?>([\s\S]*?)<\/images?>/i);
    if (imgBlock) {
      var inner = imgBlock[1];
      var re = /<img>([\s\S]*?)<\/img>/gi;
      var m;
      while ((m = re.exec(inner))) {
        var v = trim(m[1]);
        if (v) images.push({ type: 'text', value: v, textContent: v });
      }
      // 也支持 <image> 单标签写法
      if (!images.length) {
        var lines = inner.split(/\n/).map(function (s) { return trim(s); }).filter(Boolean);
        lines.forEach(function (l) { images.push({ type: 'text', value: l, textContent: l }); });
      }
      text = text.replace(imgBlock[0], '');
    }
    // 解析 <text>...</text>
    var tBlock = text.match(/<text>([\s\S]*?)<\/text>/i);
    if (tBlock) {
      text = tBlock[1];
    }
    text = trim(text);
    // 去掉可能残留的 <like> 标签
    text = text.replace(/<like>[\s\S]*?<\/like>/gi, '').replace(/<like>\s*<\/like>/gi, '');
    return { text: text, images: images };
  }

  function generateCharPost(space, sc) {
    var charObj = findChar(sc.charId) || {};
    var persona = charObj.persona || charObj.bio || sc.charPersona || '';
    return loadMountedMemory(sc).then(function (memText) {
      var sys = '你是「' + sc.charName + '」，现在要发一条你自己的微信朋友圈。\n';
      if (persona) sys += '\n你的人设：\n' + persona + '\n';
      if (memText) sys += '\n你最近的记忆与对话上下文：\n' + memText + '\n';
      sys += '\n当前你身处的朋友圈空间，user 人设是「' + (space.userPersonaHandle || space.userPersonaName) + '」。\n';
      sys += '\n要求：\n';
      sys += '1. 用第一人称「我」发朋友圈，符合你的人设口吻\n';
      sys += '2. 内容真实自然，像你今天真的发生的事或当下的心情，1-3 句话\n';
      sys += '3. 如果想配图，用 <images><img>图片描述文字</img></images> 包裹，可以是 0~3 张，每张是一段文字描述（文字图，不是真图）\n';
      sys += '4. 正文放在 <text>这里</text> 里\n';
      sys += '5. 不要 emoji，不要 hashtag，不要 @\n';
      sys += '6. 只输出 <text> 和可选的 <images>，不要任何解释\n';
      return callAI({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: '发一条你的朋友圈吧。' }
        ],
        temperature: 0.9
      });
    }).then(function (raw) {
      var parsed = parsePostContent(raw);
      if (!parsed.text && !parsed.images.length) {
        parsed.text = trim(raw.replace(/<[^>]+>/g, '')) || '今天，又是普通的一天。';
      }
      var post = {
        id: uuid(),
        spaceId: space.id,
        authorType: 'char',
        authorId: sc.charId,
        authorName: sc.charName,
        authorHandle: sc.charHandle || sc.charName,
        authorAvatar: sc.charAvatar,
        text: parsed.text,
        images: parsed.images,
        location: '',
        createdAt: Date.now(),
        likes: [],
        comments: []
      };
      return Store.addPost(post).then(function () {
        // 通知
        Store.addNotif({
          id: uuid(), spaceId: space.id, type: 'post',
          fromId: sc.charId, fromName: sc.charHandle || sc.charName, fromAvatar: sc.charAvatar,
          postId: post.id, postSnippet: parsed.text.slice(0, 30), text: '发布了新朋友圈', createdAt: Date.now(), read: false
        });
        return post;
      });
    });
  }

  // ========== 评论生成 ==========
  function parseCommentResponse(raw) {
    var text = trim(raw || '');
    var liked = /<like>\s*1\s*<\/like>/i.test(text);
    text = text.replace(/<like>[\s\S]*?<\/like>/gi, '');
    // 去掉 <comment> 包裹
    var cm = text.match(/<comment>([\s\S]*?)<\/comment>/i);
    if (cm) text = cm[1];
    text = trim(text);
    return { text: text, liked: liked };
  }

  function generateSingleComment(space, post, sc, mode, replyTarget, prevComments) {
    var charObj = findChar(sc.charId) || {};
    var persona = charObj.persona || charObj.bio || sc.charPersona || '';
    return loadMountedMemory(sc).then(function (memText) {
      var sys = '你是「' + sc.charName + '」，正在看「' + (post.authorHandle || post.authorName) + '」的微信朋友圈，要写一条评论。\n';
      if (persona) sys += '\n你的人设：\n' + persona + '\n';
      if (memText) sys += '\n你最近的记忆上下文：\n' + memText + '\n';
      sys += '\n这条朋友圈内容：\n' + (post.text || '(仅图片)') + '\n';
      if (post.authorType === 'user') {
        sys += '发朋友圈的是 user（' + (space.userPersonaHandle || space.userPersonaName) + '）。\n';
      } else {
        sys += '发朋友圈的是 ' + (post.authorHandle || post.authorName) + '（和你一样是 char）。\n';
      }
      if (prevComments && prevComments.length) {
        sys += '\n已有评论（你可以看到，也可以选择回复其中某人）：\n';
        prevComments.forEach(function (c) {
          var line = '- ' + (c.authorHandle || c.authorName) + '：' + c.text;
          if (c.replyToName) line += ' （回复 ' + c.replyToName + '）';
          sys += line + '\n';
        });
      }
      sys += '\n评论模式：';
      if (mode === 'post') sys += '直接评论这条朋友圈';
      else if (mode === 'comment') sys += '回复 ' + (replyTarget && replyTarget.name) + ' 的评论';
      else if (mode === 'person') sys += '回复 ' + (replyTarget && replyTarget.name) + '（针对其在该朋友圈下的所有发言）';
      sys += '\n\n要求：\n';
      sys += '1. 用第一人称「我」的口吻，符合你的人设，简短自然，1-2 句\n';
      sys += '2. 不要 emoji，不要 @\n';
      sys += '3. 如果你觉得这条朋友圈值得点赞，在末尾加 <like>1</like>，不点赞则加 <like>0</like>\n';
      sys += '4. 只输出评论正文和 like 标签，不要任何解释\n';
      return callAI({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: '写评论。' }
        ],
        temperature: 0.9
      });
    }).then(function (raw) {
      var parsed = parseCommentResponse(raw);
      var comment = {
        id: uuid(),
        postId: post.id,
        authorType: 'char',
        authorId: sc.charId,
        authorName: sc.charName,
        authorHandle: sc.charHandle || sc.charName,
        text: parsed.text || '…',
        replyTo: (replyTarget && replyTarget.commentId) || null,
        replyToName: (replyTarget && replyTarget.name) || null,
        createdAt: Date.now()
      };
      return { comment: comment, liked: parsed.liked, sc: sc };
    });
  }

  function generateAutoComments(space, post, count) {
    // 随机选 N 个 enabled char 顺序评论，后面看前面
    var pool = (space.chars || []).filter(function (c) { return c.enabled && c.charId !== post.authorId; });
    if (!pool.length) return Promise.resolve([]);
    var picks = randPick(pool, Math.min(count || DEFAULT_AUTO_COMMENT, MAX_AUTO_COMMENT, pool.length));
    var prevComments = (post.comments || []).slice();
    var results = [];
    var chain = Promise.resolve();
    picks.forEach(function (sc) {
      chain = chain.then(function () {
        return generateSingleComment(space, post, sc, 'post', null, prevComments).then(function (r) {
          results.push(r);
          prevComments.push(r.comment);
          // 点赞
          if (r.liked) {
            var hasLike = false;
            for (var i = 0; i < post.likes.length; i++) if (post.likes[i].id === sc.charId) { hasLike = true; break; }
            if (!hasLike) post.likes.push({ id: sc.charId, name: sc.charHandle || sc.charName });
          }
          return Store.addComment(post.id, r.comment).then(function () {
            return Store.savePosts(); // 保存 likes 更新
          }).then(function () {
            // 通知
            return Store.addNotif({
              id: uuid(), spaceId: space.id, type: 'comment',
              fromId: sc.charId, fromName: sc.charHandle || sc.charName, fromAvatar: sc.charAvatar,
              postId: post.id, postSnippet: (post.text || '').slice(0, 30),
              text: r.comment.replyToName ? '回复了 ' + r.comment.replyToName + '：' + r.comment.text : '评论：' + r.comment.text,
              createdAt: Date.now(), read: false
            });
          });
        });
      });
    });
    return chain.then(function () { return results; });
  }

  // ========== 同步：方式1 直接 IndexedDB 注入 ==========
  function openRocheDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('Roche_db');
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function addMsgRecord(db, storeName, msg) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      var req = tx.objectStore(storeName).add(msg);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function buildActionSummary(space, sc, sinceTs) {
    // 收集该 char 自 sinceTs 以来的行为
    var myPosts = [];
    var myComments = [];
    var myLikes = [];
    state.posts.forEach(function (p) {
      if (p.spaceId !== space.id) return;
      if (p.authorType === 'char' && p.authorId === sc.charId && p.createdAt > sinceTs) {
        myPosts.push(p);
      }
      if (p.likes) {
        for (var i = 0; i < p.likes.length; i++) {
          if (p.likes[i].id === sc.charId && p.createdAt > sinceTs) {
            var ownerName = p.authorType === 'user' ? (space.userPersonaHandle || space.userPersonaName) : (p.authorHandle || p.authorName);
            myLikes.push({ ownerName: ownerName, snippet: (p.text || '').slice(0, 12) });
          }
        }
      }
      if (p.comments) {
        p.comments.forEach(function (c) {
          if (c.authorType === 'char' && c.authorId === sc.charId && c.createdAt > sinceTs) {
            var onName = p.authorType === 'user' ? (space.userPersonaHandle || space.userPersonaName) : (p.authorHandle || p.authorName);
            var isMyPost = (p.authorType === 'char' && p.authorId === sc.charId);
            myComments.push({
              onName: onName,
              isMyPost: isMyPost,
              replyToName: c.replyToName,
              text: c.text
            });
          }
        });
      }
    });

    var dt = new Date();
    var stamp = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0') + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
    var lines = [];
    lines.push(SYNC_PREFIX + ' · 我的朋友圈行为记录 · ' + stamp + ']');
    lines.push('');
    lines.push('我刚在朋友圈做了这些事：');
    lines.push('');

    if (myPosts.length) {
      lines.push('【我发的朋友圈】');
      myPosts.forEach(function (p, idx) {
        lines.push((idx + 1) + '. "' + (p.text || '(仅图片)') + '"');
      });
      lines.push('');
    }
    if (myComments.length) {
      lines.push('【我的评论】');
      myComments.forEach(function (c) {
        if (c.isMyPost && c.replyToName) {
          lines.push('- 我回复了 ' + c.replyToName + ' 在我朋友圈下的评论：' + c.text);
        } else if (c.replyToName) {
          lines.push('- 我回复了 ' + c.replyToName + ' 在 ' + c.onName + ' 朋友圈下的评论：' + c.text);
        } else {
          lines.push('- 我评论了 ' + c.onName + ' 的朋友圈：' + c.text);
        }
      });
      lines.push('');
    }
    if (myLikes.length) {
      lines.push('【我的点赞】');
      var names = myLikes.map(function (l) { return l.ownerName; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      lines.push('我给 ' + names.join('、') + ' 的朋友圈点了赞。');
      lines.push('');
    }
    if (!myPosts.length && !myComments.length && !myLikes.length) {
      lines.push('（这段时间我没有在朋友圈做任何事。）');
      lines.push('');
    }
    lines.push('这是我的私人记忆记录，不必向 user 复述，但可以在对话中自然延续相关话题。');
    return lines.join('\n');
  }

  function injectCharActionToChat(space, sc) {
    var sinceTs = Store.getSyncTs(space.id, sc.charId);
    var dmMount = null;
    (sc.memoryMounts || []).forEach(function (m) { if (m.enabled && !m.isGroup) dmMount = m; });
    if (!dmMount) return Promise.resolve({ ok: false, reason: '该 char 未挂载单聊会话' });

    var actionSummary = buildActionSummary(space, sc, sinceTs);
    var charObj = findChar(sc.charId) || {};
    var senderId = sc.charId;
    // 推断 conversationId（dmMount.conversationId 即单聊会话）
    var conversationId = dmMount.conversationId;

    return openRocheDb().then(function (db) {
      var now = Date.now();
      var msg = {
        id: now + Math.floor(Math.random() * 1000),
        isMe: false,
        text: actionSummary,
        senderId: senderId,
        timestamp: now,
        senderName: sc.charName,
        conversationId: conversationId
      };
      if (conversationId.indexOf('_offline', conversationId.length - 8) !== -1) {
        msg.isStreaming = false;
      }
      return addMsgRecord(db, 'messages', msg).then(function () {
        db.close();
        sc.lastSyncAt = now;
        Store.setSyncTs(space.id, sc.charId, now);
        Store.saveSpaces();
        return { ok: true };
      });
    }).catch(function (e) {
      return { ok: false, reason: (e && e.message) || 'DB 错误' };
    });
  }

  // ========== 同步：方式2 手动注入事实记忆 ==========
  function syncCharToFactMemory(space, sc) {
    var sinceTs = Store.getSyncTs(space.id, sc.charId);
    var dmMount = null;
    (sc.memoryMounts || []).forEach(function (m) { if (m.enabled && !m.isGroup) dmMount = m; });
    if (!dmMount) return Promise.resolve({ ok: false, reason: '该 char 未挂载单聊会话' });

    var actions = [];
    state.posts.forEach(function (p) {
      if (p.spaceId !== space.id) return;
      if (p.authorType === 'char' && p.authorId === sc.charId && p.createdAt > sinceTs) {
        actions.push('发了朋友圈：' + (p.text || '').slice(0, 40));
      }
      if (p.comments) p.comments.forEach(function (c) {
        if (c.authorType === 'char' && c.authorId === sc.charId && c.createdAt > sinceTs) {
          actions.push('评论了' + (p.authorHandle || p.authorName) + '的朋友圈');
        }
      });
      if (p.likes) p.likes.forEach(function (l) {
        if (l.id === sc.charId && p.createdAt > sinceTs) actions.push('点赞了' + (p.authorHandle || p.authorName) + '的朋友圈');
      });
    });

    if (!actions.length) return Promise.resolve({ ok: false, reason: '没有可同步的新行为' });

    return callAI({
      messages: [
        { role: 'system', content: '请把以下角色行为总结成一段简洁的事实记录，用于写入角色的长期记忆。要求：用第三人称描述 ' + sc.charName + ' 的行为；一段话，100 字以内；自然陈述，不要分点。' },
        { role: 'user', content: '行为列表：\n' + actions.join('\n') + '\n\n输出格式：' + sc.charName + '在{时间段}发了N条朋友圈（主题：xxx），评论了xxx的动态，点赞了xxx的动态。' }
      ],
      temperature: 0.5
    }).then(function (summaryText) {
      return cachedRoche.memory.write({
        conversationId: dmMount.conversationId,
        summaryText: summaryText,
        who: [sc.charName],
        action: '朋友圈行为记录',
        when: '最近',
        where: '朋友圈',
        source: 'plugin:roche-moments'
      }).then(function () {
        var now = Date.now();
        sc.lastSyncAt = now;
        Store.setSyncTs(space.id, sc.charId, now);
        Store.saveSpaces();
        return { ok: true, summary: summaryText };
      });
    }).catch(function (e) {
      return { ok: false, reason: (e && e.message) || 'AI 或写入失败' };
    });
  }

  // ========== 后台定时器 ==========
  function startBgTimer() {
    if (window.__rocheMomentsBgStarted) return;
    window.__rocheMomentsBgStarted = true;
    setInterval(function () { checkBgTasks(); }, BG_CHECK_INTERVAL);
    // 启动后立即检查一次
    setTimeout(function () { checkBgTasks(); }, 3000);
  }

  function checkBgTasks() {
    if (!cachedRoche) return; // 没 mount 过无法操作 storage
    // 加载最新数据（可能其他实例改过）
    Store.loadAll().then(function () {
      var now = Date.now();
      var tasks = [];
      state.spaces.forEach(function (space) {
        (space.chars || []).forEach(function (sc) {
          if (!sc.enabled) return;
          if (!sc.nextPostAt) {
            // 初始化下次发布时间
            sc.nextPostAt = now + randomInterval(sc.postIntervalMin || 30);
            tasks.push(function () { return Store.saveSpaces(); });
          } else if (now >= sc.nextPostAt) {
            // 到点了
            var prev = sc.nextPostAt;
            sc.nextPostAt = now + randomInterval(sc.postIntervalMin || 30);
            tasks.push(function () {
              return Store.saveSpaces().then(function () {
                return generateCharPost(space, sc).then(function (post) {
                  // char 发的朋友圈也触发自动评论（其他 char 评论）
                  return generateAutoComments(space, post, sc.autoCommentCount || DEFAULT_AUTO_COMMENT).then(function () {
                    // 如果当前 UI 挂载中，刷新
                    if (root) render();
                    return { ok: true };
                  });
                }).catch(function (e) {
                  console.warn('[Moments] 后台生成 char 朋友圈失败', e);
                  return { ok: false };
                });
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

  // ========== UI 渲染 ==========
  function setBusy(msg) {
    state.busy = !!msg;
    state.busyMsg = msg || '';
    if (root) {
      var ov = $('.moments-busy', root);
      if (ov) {
        if (state.busy) { ov.style.display = 'flex'; $('.moments-busy-text', ov).textContent = state.busyMsg; }
        else ov.style.display = 'none';
      }
    }
  }

  function toast(msg) {
    if (cachedRoche && cachedRoche.ui && cachedRoche.ui.toast) cachedRoche.ui.toast(msg);
  }

  function confirmBox(opt) {
    if (cachedRoche && cachedRoche.ui && cachedRoche.ui.confirm) return cachedRoche.ui.confirm(opt);
    return Promise.resolve(window.confirm(opt.message || '确认？'));
  }

  function render() {
    if (!root) return;
    var space = Store.getActiveSpace();
    var html = '';
    html += '<div class="moments-inner">';
    html += renderTopbar(space);
    html += renderCover(space);
    html += renderFeed(space);
    html += '</div>';
    // 浮层
    html += renderSidebar(space);
    if (state.postModalOpen) html += renderPostModal(space);
    if (state.notifPanelOpen) html += renderNotifPanel(space);
    if (state.subjectSheetOpen) html += renderSubjectSheet(space);
    if (state.memMountCharId) html += renderMemMountModal(space, state.memMountCharId);
    if (state.subApiPanelOpen) html += renderSubApiPanel();
    if (state.charListOpen) html += renderCharListModal(space);
    if (state.commentTarget) html += renderCommentInput();
    if (state.textViewer) html += renderTextViewer(state.textViewer);
    html += '<div class="moments-busy" style="display:' + (state.busy ? 'flex' : 'none') + '"><div class="moments-busy-box"><div class="moments-spin">' + WINDMILL_SVG + '</div><div class="moments-busy-text">' + escapeHtml(state.busyMsg) + '</div></div></div>';
    root.innerHTML = '<div class="' + ROOT_CLASS + '">' + html + '</div>';
    if (state.postModalOpen) setupPostModalTools();
  }

  function renderTopbar(space) {
    var subj = getCurrentSubject();
    var unread = 0;
    state.notifs.forEach(function (n) { if (!n.read) unread++; });
    return '' +
      '<div class="moments-topbar">' +
        '<div class="moments-topbar-left" data-action="open-sidebar">' + ICON.menu + '</div>' +
        '<div class="moments-topbar-title">朋友圈</div>' +
        '<div class="moments-topbar-right">' +
          '<span class="moments-topbar-cam" data-action="open-post-modal">' + ICON.camera + '</span>' +
          '<span class="moments-bell' + (unread ? ' has-dot' : '') + '" data-action="open-notif">' + ICON.bell + (unread ? '<i class="moments-dot"></i>' : '') + '</span>' +
        '</div>' +
      '</div>';
  }

  function renderCover(space) {
    if (!space) return '<div class="moments-empty">还没有朋友圈空间，请打开左侧栏选择或创建。</div>';
    var subj = getCurrentSubject();
    var cover = space.cover || '';
    var coverStyle = cover ? 'background-image:url(' + escapeHtml(cover) + ');background-size:cover;background-position:center;' : '';
    return '' +
      '<div class="moments-cover" style="' + coverStyle + '">' +
        (cover ? '' : '<div class="moments-cover-ph">点击设置封面</div>') +
        '<div class="moments-cover-mask" data-action="set-cover"></div>' +
        '<div class="moments-cover-avatar" data-action="open-subject">' +
          '<div class="moments-avatar">' + (subj && subj.avatar ? '<img src="' + escapeHtml(subj.avatar) + '">' : '<div class="moments-avatar-fallback">' + escapeHtml((subj && subj.name || '?').slice(0, 1)) + '</div>') + '</div>' +
        '</div>' +
        '<div class="moments-cover-name">' + escapeHtml(subj && subj.name || '') + '</div>' +
        '<div class="moments-cover-bio">' + escapeHtml(subj && subj.bio || '') + '</div>' +
        '<div class="moments-cover-hint">点击头像切换查看主体</div>' +
      '</div>';
  }

  function renderFeed(space) {
    if (!space) return '';
    var posts = state.posts.filter(function (p) { return p.spaceId === space.id; });
    // 主体视角过滤：user 看全部；char 视角只看自己的 + 互动过的？微信里看别人朋友圈只看对方的。
    var subj = getCurrentSubject();
    if (subj && subj.type === 'char') {
      // char 视角：只看该 char 自己发的朋友圈（拟真：进入某人朋友圈只看他的）
      posts = posts.filter(function (p) { return p.authorId === subj.id; });
    }
    if (!posts.length) {
      return '<div class="moments-feed-empty">' + ICON.camera + '<div>还没有朋友圈动态</div><div class="moments-feed-empty-hint">点击右上角相机发布，或等 char 主动发朋友圈</div></div>';
    }
    var html = '<div class="moments-feed">';
    posts.forEach(function (p) { html += renderMoment(p, space); });
    html += '</div>';
    return html;
  }

  function renderMoment(p, space) {
    var authorName = p.authorHandle || p.authorName;
    var avatar = p.authorAvatar;
    var html = '<div class="moment" data-id="' + p.id + '">';
    html += '<div class="moment-hd">';
    html += '<div class="moment-avatar">' + (avatar ? '<img src="' + escapeHtml(avatar) + '">' : '<div class="moments-avatar-fallback">' + escapeHtml(authorName.slice(0, 1)) + '</div>') + '</div>';
    html += '<div class="moment-meta"><div class="moment-author">' + escapeHtml(authorName) + '</div>';
    if (p.location) html += '<div class="moment-loc">' + ICON.location + escapeHtml(p.location) + '</div>';
    html += '</div>';
    html += '<div class="moment-more" data-action="moment-more" data-id="' + p.id + '">' + ICON.more + '</div>';
    html += '</div>';
    html += '<div class="moment-text">' + escapeHtml(p.text).replace(/\n/g, '<br>') + '</div>';
    if (p.images && p.images.length) {
      html += '<div class="moment-images' + (p.images.length === 1 ? ' single' : '') + '">';
      p.images.forEach(function (img, idx) {
        if (img.type === 'text') {
          html += '<div class="moment-img-text" data-action="view-text" data-id="' + p.id + '" data-idx="' + idx + '">' +
            '<div class="moment-img-text-inner">' + ICON.image + '<span>文字图</span></div>' +
            '<div class="moment-img-text-hint">点击查看</div></div>';
        } else {
          html += '<div class="moment-img"><img src="' + escapeHtml(img.value) + '" data-action="view-text" data-id="' + p.id + '" data-idx="' + idx + '"></div>';
        }
      });
      html += '</div>';
    }
    html += '<div class="moment-time">' + formatTime(p.createdAt) + '</div>';
    html += renderInteractions(p, space);
    html += '</div>';
    return html;
  }

  function renderInteractions(p, space) {
    var hasLike = p.likes && p.likes.length;
    var hasComment = p.comments && p.comments.length;
    if (!hasLike && !hasComment) {
      return '<div class="moment-actions"><div class="moment-action-btns"><span class="moment-act" data-action="like" data-id="' + p.id + '">' + ICON.like + '</span><span class="moment-act" data-action="comment-post" data-id="' + p.id + '">' + ICON.comment + '</span></div></div>';
    }
    var html = '<div class="moment-actions">';
    html += '<div class="moment-action-btns moment-action-btns-float"><span class="moment-act" data-action="like" data-id="' + p.id + '">' + ICON.like + '</span><span class="moment-act" data-action="comment-post" data-id="' + p.id + '">' + ICON.comment + '</span></div>';
    html += '<div class="moment-interactions">';
    if (hasLike) {
      html += '<div class="moment-likes">' + ICON.likeFilled + '<span>';
      var names = p.likes.map(function (l) { return l.name; });
      html += names.map(escapeHtml).join('，');
      html += '</span></div>';
    }
    if (hasComment) {
      html += '<div class="moment-comments">';
      p.comments.forEach(function (c) {
        var cn = c.authorHandle || c.authorName;
        html += '<div class="moment-comment" data-action="comment-target" data-id="' + p.id + '" data-cid="' + c.id + '">';
        html += '<span class="mc-name">' + escapeHtml(cn) + '</span>';
        if (c.replyToName) html += '<span class="mc-reply"> 回复 </span><span class="mc-name">' + escapeHtml(c.replyToName) + '</span>';
        html += '<span class="mc-colon">：</span>';
        html += '<span class="mc-text">' + escapeHtml(c.text) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div></div>';
    return html;
  }

  function renderSidebar(space) {
    var open = state.sidebarOpen ? ' open' : '';
    var html = '<div class="moments-mask' + (state.sidebarOpen ? ' open' : '') + '" data-action="close-sidebar"></div>';
    html += '<div class="moments-sidebar' + open + '">';
    html += '<div class="moments-sidebar-hd"><div class="moments-sidebar-title">朋友圈</div><div class="moments-sidebar-close" data-action="close-sidebar">' + ICON.close + '</div></div>';
    html += '<div class="moments-sidebar-section"><div class="moments-sidebar-label">user 人设空间</div>';
    state.allPersonas.forEach(function (per) {
      var sp = null;
      for (var i = 0; i < state.spaces.length; i++) if (state.spaces[i].userPersonaId === per.id) { sp = state.spaces[i]; break; }
      var active = sp && sp.id === state.activeSpaceId;
      html += '<div class="moments-sidebar-item' + (active ? ' active' : '') + '" data-action="switch-space" data-pid="' + escapeHtml(per.id) + '">';
      html += '<div class="moments-avatar sm">' + (per.avatar ? '<img src="' + escapeHtml(per.avatar) + '">' : '<div class="moments-avatar-fallback">' + escapeHtml((per.name || '?').slice(0, 1)) + '</div>') + '</div>';
      html += '<div class="moments-sidebar-item-info"><div class="moments-sidebar-item-name">' + escapeHtml(per.handle || per.name) + '</div>';
      html += '<div class="moments-sidebar-item-sub">' + (sp ? (sp.chars.length + ' 个 char') : '未创建') + '</div></div>';
      html += '</div>';
    });
    html += '</div>';

    if (space) {
      html += '<div class="moments-sidebar-section"><div class="moments-sidebar-label">绑定的 char</div>';
      if (!space.chars.length) {
        html += '<div class="moments-sidebar-empty">还没有绑定 char</div>';
      }
      space.chars.forEach(function (sc) {
        var c = findChar(sc.charId) || {};
        html += '<div class="moments-sidebar-item" data-action="view-char" data-cid="' + escapeHtml(sc.charId) + '">';
        html += '<div class="moments-avatar sm">' + (sc.charAvatar ? '<img src="' + escapeHtml(sc.charAvatar) + '">' : '<div class="moments-avatar-fallback">' + escapeHtml((sc.charName || '?').slice(0, 1)) + '</div>') + '</div>';
        html += '<div class="moments-sidebar-item-info"><div class="moments-sidebar-item-name">' + escapeHtml(sc.charHandle || sc.charName) + '</div>';
        html += '<div class="moments-sidebar-item-sub">' + (sc.enabled ? '已开启' : '已关闭') + ' · ' + (sc.postIntervalMin || 30) + '分钟</div></div>';
        html += '<div class="moments-sidebar-item-btns">';
        html += '<span class="moments-mini-btn" data-action="char-post-now" data-cid="' + escapeHtml(sc.charId) + '" title="让 char 现在发一条">发一条</span>';
        html += '<span class="moments-mini-btn" data-action="open-mem-mount" data-cid="' + escapeHtml(sc.charId) + '" title="记忆挂载设置">记忆</span>';
        html += '<span class="moments-mini-btn" data-action="sync-trace" data-cid="' + escapeHtml(sc.charId) + '" title="同步轨迹到事实记忆">同步</span>';
        html += '<span class="moments-mini-btn danger" data-action="unbind-char" data-cid="' + escapeHtml(sc.charId) + '" title="解绑">解绑</span>';
        html += '</div></div>';
      });
      html += '<div class="moments-sidebar-item add" data-action="open-char-list"><div class="moments-avatar sm add-avatar">' + ICON.plus + '</div><div class="moments-sidebar-item-info"><div class="moments-sidebar-item-name">绑定 char</div></div></div>';
      html += '</div>';
    }

    html += '<div class="moments-sidebar-section"><div class="moments-sidebar-label">设置</div>';
    html += '<div class="moments-sidebar-item" data-action="open-subapi"><div class="moments-sidebar-item-info"><div class="moments-sidebar-item-name">副 API 设置</div><div class="moments-sidebar-item-sub">' + (getActiveSubApi() ? getActiveSubApi().name : '默认 roche.ai.chat') + '</div></div></div>';
    html += '<div class="moments-sidebar-item" data-action="clear-img-cache"><div class="moments-sidebar-item-info"><div class="moments-sidebar-item-name">清除本地图片缓存</div><div class="moments-sidebar-item-sub">释放存储空间</div></div></div>';
    html += '<div class="moments-sidebar-item" data-action="close-app"><div class="moments-sidebar-item-info"><div class="moments-sidebar-item-name">退出朋友圈</div></div></div>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderCharListModal(space) {
    var html = '<div class="moments-modal-mask" data-action="close-char-list"><div class="moments-modal" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">选择要绑定的 char</div><div class="moments-modal-close" data-action="close-char-list">' + ICON.close + '</div></div><div class="moments-modal-bd">';
    var bound = {};
    space.chars.forEach(function (sc) { bound[sc.charId] = true; });
    if (!state.allChars.length) html += '<div class="moments-empty">没有可用的 char</div>';
    state.allChars.forEach(function (c) {
      if (bound[c.id]) return;
      html += '<div class="moments-sidebar-item" data-action="bind-char" data-cid="' + escapeHtml(c.id) + '">';
      html += '<div class="moments-avatar sm">' + (c.avatar ? '<img src="' + escapeHtml(c.avatar) + '">' : '<div class="moments-avatar-fallback">' + escapeHtml((c.name || '?').slice(0, 1)) + '</div>') + '</div>';
      html += '<div class="moments-sidebar-item-info"><div class="moments-sidebar-item-name">' + escapeHtml(c.handle || c.name) + '</div><div class="moments-sidebar-item-sub">' + escapeHtml(c.bio || c.name || '') + '</div></div>';
      html += '</div>';
    });
    html += '</div></div></div>';
    return html;
  }

  function renderMemMountModal(space, charId) {
    var sc = getSpaceChar(space, charId);
    if (!sc) return '';
    var html = '<div class="moments-modal-mask" data-action="close-mem-mount"><div class="moments-modal wide" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">' + escapeHtml(sc.charHandle || sc.charName) + ' 的记忆挂载</div><div class="moments-modal-close" data-action="close-mem-mount">' + ICON.close + '</div></div><div class="moments-modal-bd">';

    // 功能开关
    html += '<div class="moments-setting-row"><div class="moments-setting-label">开启朋友圈功能</div><div class="moments-switch' + (sc.enabled ? ' on' : '') + '" data-action="toggle-enabled" data-cid="' + escapeHtml(charId) + '"><i></i></div></div>';
    html += '<div class="moments-setting-row"><div class="moments-setting-label">主动发圈间隔（分钟，最小30）</div><input class="moments-input" type="number" min="30" value="' + (sc.postIntervalMin || 30) + '" data-field="interval" data-cid="' + escapeHtml(charId) + '"></div>';
    html += '<div class="moments-setting-row"><div class="moments-setting-label">被评论时自动评论数（0-8）</div><input class="moments-input" type="number" min="0" max="8" value="' + (sc.autoCommentCount == null ? DEFAULT_AUTO_COMMENT : sc.autoCommentCount) + '" data-field="autocomment" data-cid="' + escapeHtml(charId) + '"></div>';

    html += '<div class="moments-divider"></div>';
    html += '<div class="moments-section-title">挂载的会话记忆<span class="moments-section-hint">每个会话可独立配置短期/事实/核心</span></div>';

    // 会话列表（从 roche.conversation.list 读取，存到 state 临时）
    var convs = sc._convCache || [];
    if (!convs.length) {
      html += '<div class="moments-empty" id="moments-conv-loading">正在加载会话列表...</div>';
    } else {
      convs.forEach(function (conv) {
        var mount = null;
        (sc.memoryMounts || []).forEach(function (m) { if (m.conversationId === conv.id) mount = m; });
        var isOn = mount && mount.enabled;
        html += '<div class="moments-conv-row' + (isOn ? ' on' : '') + '">';
        html += '<div class="moments-conv-hd"><div class="moments-conv-name">' + escapeHtml(conv.name || conv.handle || conv.id) + (conv.isGroup ? ' (群)' : ' (单聊)') + '</div>';
        html += '<div class="moments-switch' + (isOn ? ' on' : '') + '" data-action="toggle-mount" data-cid="' + escapeHtml(charId) + '" data-conv="' + escapeHtml(conv.id) + '"><i></i></div></div>';
        if (isOn) {
          html += '<div class="moments-conv-opts">';
          html += '<label>短期记忆条数 <input type="number" min="0" max="500" value="' + (mount.shortLimit || 50) + '" data-field="short" data-cid="' + escapeHtml(charId) + '" data-conv="' + escapeHtml(conv.id) + '"></label>';
          html += '<label>事实记忆条数 <input type="number" min="0" max="500" value="' + (mount.factLimit || 0) + '" data-field="fact" data-cid="' + escapeHtml(charId) + '" data-conv="' + escapeHtml(conv.id) + '"></label>';
          html += '<label>挂载核心记忆 <input type="checkbox" ' + (mount.coreEnabled ? 'checked' : '') + ' data-field="core" data-cid="' + escapeHtml(charId) + '" data-conv="' + escapeHtml(conv.id) + '"></label>';
          html += '</div>';
        }
        html += '</div>';
      });
    }

    html += '<div class="moments-divider"></div>';
    html += '<div class="moments-section-title">记忆同步</div>';
    html += '<div class="moments-setting-row"><div class="moments-setting-label">退出时自动注入行为记录到单聊</div><div class="moments-switch on disabled"><i></i></div></div>';
    html += '<div class="moments-hint">关闭朋友圈 App 时，自动以「我」的口吻把该 char 的朋友圈行为注入到其单聊消息流（直接操作 IndexedDB，仅单聊）。下次单聊时 char 不会失忆。</div>';
    html += '<div class="moments-btn-row"><button class="moments-btn" data-action="sync-fact-now" data-cid="' + escapeHtml(charId) + '">立即同步到事实记忆</button><button class="moments-btn ghost" data-action="close-mem-mount">完成</button></div>';

    html += '</div></div></div>';
    return html;
  }

  function renderSubApiPanel() {
    var html = '<div class="moments-modal-mask" data-action="close-subapi"><div class="moments-modal wide" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">副 API 设置</div><div class="moments-modal-close" data-action="close-subapi">' + ICON.close + '</div></div><div class="moments-modal-bd">';
    html += '<div class="moments-hint">兼容 OpenAI 格式。可保存多个预设，同时只能启用一个。不启用则默认走 roche.ai.chat。</div>';
    html += '<div id="moments-subapi-list">';
    state.subapi.forEach(function (p) {
      html += '<div class="moments-subapi-row' + (p.enabled ? ' active' : '') + '">';
      html += '<div class="moments-subapi-info"><div class="moments-subapi-name">' + escapeHtml(p.name) + '</div><div class="moments-subapi-sub">' + escapeHtml(p.url) + ' · ' + escapeHtml(p.model) + '</div></div>';
      html += '<div class="moments-subapi-btns">';
      html += '<button class="moments-mini-btn' + (p.enabled ? '' : '') + '" data-action="enable-subapi" data-id="' + escapeHtml(p.id) + '">' + (p.enabled ? '已启用' : '启用') + '</button>';
      html += '<button class="moments-mini-btn danger" data-action="del-subapi" data-id="' + escapeHtml(p.id) + '">删除</button>';
      html += '</div></div>';
    });
    html += '</div>';
    html += '<div class="moments-divider"></div>';
    html += '<div class="moments-section-title">新建预设</div>';
    html += '<div class="moments-form"><label>名称<input class="moments-input" id="moments-sa-name" placeholder="如 OpenAI / DeepSeek"></label>';
    html += '<label>Base URL<input class="moments-input" id="moments-sa-url" placeholder="https://api.openai.com/v1"></label>';
    html += '<label>API Key<input class="moments-input" id="moments-sa-key" type="password" placeholder="sk-..."></label>';
    html += '<div class="moments-form-row"><label>模型<select class="moments-input" id="moments-sa-model"><option value="">先点刷新获取</option></select></label>';
    html += '<button class="moments-btn ghost" data-action="refresh-models">刷新模型</button></div>';
    html += '<button class="moments-btn" data-action="save-subapi">保存预设</button></div>';
    html += '</div></div></div>';
    return html;
  }

  function renderPostModal(space) {
    var subj = getCurrentSubject();
    if (!subj) return '';
    return '' +
      '<div class="moments-modal-mask" data-action="close-post-modal"><div class="moments-modal" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">发朋友圈</div><div class="moments-modal-close" data-action="close-post-modal">' + ICON.close + '</div></div><div class="moments-modal-bd">' +
      '<div class="moments-post-as">以 <b>' + escapeHtml(subj.name) + '</b> 身份发布' + (subj.type === 'char' ? '（char）' : '（user）') + '</div>' +
      '<textarea class="moments-post-text" id="moments-post-text" placeholder="这一刻的想法..."></textarea>' +
      '<div class="moments-post-imgs" id="moments-post-imgs"></div>' +
      '<div class="moments-post-tools">' +
        '<label class="moments-post-tool" data-tool="text">' + ICON.image + '<span>文字图</span></label>' +
        '<label class="moments-post-tool" data-tool="url">' + ICON.image + '<span>图片URL</span></label>' +
        '<label class="moments-post-tool" data-tool="file">' + ICON.image + '<span>本地图片</span><input type="file" accept="image/*" id="moments-post-file" style="display:none"></label>' +
      '</div>' +
      '<div class="moments-btn-row"><button class="moments-btn" data-action="publish-post">发表</button></div>' +
      '</div></div></div>';
  }

  function renderCommentInput() {
    var t = state.commentTarget;
    if (!t) return '';
    var post = null;
    for (var i = 0; i < state.posts.length; i++) if (state.posts[i].id === t.postId) { post = state.posts[i]; break; }
    if (!post) return '';
    var ph = '评论...';
    if (t.replyToName) ph = '回复 ' + t.replyToName + '...';
    var subj = getCurrentSubject();
    return '<div class="moments-comment-bar"><div class="moments-comment-avatar">' + (subj && subj.avatar ? '<img src="' + escapeHtml(subj.avatar) + '">' : '') + '</div><input class="moments-comment-input" id="moments-comment-text" placeholder="' + escapeHtml(ph) + '"><button class="moments-comment-send" data-action="send-comment">' + ICON.send + '</button></div>';
  }

  function renderSubjectSheet(space) {
    var html = '<div class="moments-modal-mask" data-action="close-subject"><div class="moments-sheet" data-stop="1"><div class="moments-sheet-title">切换查看主体</div>';
    var subj = getCurrentSubject();
    html += '<div class="moments-sheet-item' + (state.currentSubject === 'user' ? ' active' : '') + '" data-action="set-subject" data-sub="user"><div class="moments-avatar sm">' + (space.userPersonaAvatar ? '<img src="' + escapeHtml(space.userPersonaAvatar) + '">' : '<div class="moments-avatar-fallback">' + escapeHtml((space.userPersonaName || '?').slice(0, 1)) + '</div>') + '</div><div class="moments-sheet-item-info"><div class="moments-sheet-item-name">' + escapeHtml(space.userPersonaHandle || space.userPersonaName) + '</div><div class="moments-sheet-item-sub">user 视角（看全部）</div></div></div>';
    (space.chars || []).forEach(function (sc) {
      if (!sc.enabled) return;
      html += '<div class="moments-sheet-item' + (state.currentSubject === sc.charId ? ' active' : '') + '" data-action="set-subject" data-sub="' + escapeHtml(sc.charId) + '"><div class="moments-avatar sm">' + (sc.charAvatar ? '<img src="' + escapeHtml(sc.charAvatar) + '">' : '<div class="moments-avatar-fallback">' + escapeHtml((sc.charName || '?').slice(0, 1)) + '</div>') + '</div><div class="moments-sheet-item-info"><div class="moments-sheet-item-name">' + escapeHtml(sc.charHandle || sc.charName) + '</div><div class="moments-sheet-item-sub">char 视角（只看 ta 的）</div></div></div>';
    });
    html += '</div></div>';
    return html;
  }

  function renderNotifPanel(space) {
    var html = '<div class="moments-modal-mask" data-action="close-notif"><div class="moments-modal" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">消息通知</div><div class="moments-modal-close" data-action="close-notif">' + ICON.close + '</div></div><div class="moments-modal-bd">';
    var list = state.notifs.filter(function (n) { return !space || n.spaceId === space.id; });
    if (!list.length) html += '<div class="moments-empty">暂无通知</div>';
    list.forEach(function (n) {
      html += '<div class="moments-notif' + (n.read ? '' : ' unread') + '" data-action="open-notif-item" data-id="' + escapeHtml(n.id) + '"><div class="moments-avatar sm">' + (n.fromAvatar ? '<img src="' + escapeHtml(n.fromAvatar) + '">' : '<div class="moments-avatar-fallback">' + escapeHtml((n.fromName || '?').slice(0, 1)) + '</div>') + '</div><div class="moments-notif-info"><div class="moments-notif-text"><b>' + escapeHtml(n.fromName) + '</b> ' + escapeHtml(n.text) + '</div><div class="moments-notif-time">' + formatTime(n.createdAt) + '</div></div></div>';
    });
    if (list.length) html += '<div class="moments-btn-row"><button class="moments-btn ghost" data-action="clear-notifs">清空通知</button></div>';
    html += '</div></div></div>';
    return html;
  }

  function renderTextViewer(text) {
    return '<div class="moments-modal-mask moments-text-viewer" data-action="close-text-viewer"><div class="moments-text-viewer-box"><div class="moments-text-viewer-label">文字图内容</div><div class="moments-text-viewer-text">' + escapeHtml(text).replace(/\n/g, '<br>') + '</div><div class="moments-btn-row"><button class="moments-btn ghost" data-action="close-text-viewer">收起</button></div></div></div>';
  }

  // ========== 事件处理 ==========
  function bindEvents() {
    if (!root) return;
    root.addEventListener('click', onRootClick);
    root.addEventListener('change', onRootChange);
    root.addEventListener('input', onRootInput);
  }

  function onRootClick(e) {
    var t = e.target;
    var act = closestAttr(t, 'data-action');
    // 文字图/图片点击
    if (!act) {
      var vt = closestAttr(t, 'data-action', 'view-text');
      if (vt) act = 'view-text';
    }
    if (!act) return;
    // 阻止冒泡到 mask
    if (act.indexOf('close-') === 0) {
      // 关闭类
    }
    handleAction(act, t, e);
  }

  function closestAttr(el, attr, val) {
    while (el && el !== root) {
      var a = el.getAttribute ? el.getAttribute(attr) : null;
      if (a != null && (val == null || a === val)) return a;
      el = el.parentNode;
    }
    return null;
  }

  function closestEl(el, attr, val) {
    while (el && el !== root) {
      var a = el.getAttribute ? el.getAttribute(attr) : null;
      if (a != null && (val == null || a === val)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function did(el, attr) {
    var n = closestEl(el, attr);
    return n ? n.getAttribute(attr) : null;
  }

  function onRootChange(e) {
    var t = e.target;
    var field = t.getAttribute && t.getAttribute('data-field');
    if (!field) return;
    var cid = t.getAttribute('data-cid');
    var conv = t.getAttribute('data-conv');
    var space = Store.getActiveSpace();
    if (!space || !cid) return;
    var sc = getSpaceChar(space, cid);
    if (!sc) return;
    if (field === 'interval') {
      var v = parseInt(t.value, 10);
      if (!isNaN(v) && v >= 30) sc.postIntervalMin = v;
      Store.saveSpaces();
    } else if (field === 'autocomment') {
      var v2 = parseInt(t.value, 10);
      if (!isNaN(v2) && v2 >= 0 && v2 <= 8) sc.autoCommentCount = v2;
      Store.saveSpaces();
    } else if (field === 'core' && conv) {
      var m = findMount(sc, conv);
      if (m) { m.coreEnabled = t.checked; Store.saveSpaces(); }
    } else if (field === 'short' && conv) {
      var m2 = findMount(sc, conv);
      if (m2) { m2.shortLimit = parseInt(t.value, 10) || 0; Store.saveSpaces(); }
    } else if (field === 'fact' && conv) {
      var m3 = findMount(sc, conv);
      if (m3) { m3.factLimit = parseInt(t.value, 10) || 0; Store.saveSpaces(); }
    }
  }

  function onRootInput(e) {
    // 暂不处理
  }

  function findMount(sc, convId) {
    for (var i = 0; i < (sc.memoryMounts || []).length; i++) if (sc.memoryMounts[i].conversationId === convId) return sc.memoryMounts[i];
    return null;
  }

  function handleAction(act, t, e) {
    var space = Store.getActiveSpace();
    switch (act) {
      case 'open-sidebar': state.sidebarOpen = true; render(); break;
      case 'close-sidebar': state.sidebarOpen = false; render(); break;
      case 'open-notif': state.notifPanelOpen = true; Store.markAllNotifRead(); render(); break;
      case 'close-notif': state.notifPanelOpen = false; render(); break;
      case 'clear-notifs': Store.clearNotifs().then(render); break;
      case 'open-subject': state.subjectSheetOpen = true; render(); break;
      case 'close-subject': state.subjectSheetOpen = false; render(); break;
      case 'set-subject': state.currentSubject = did(t, 'data-sub'); state.subjectSheetOpen = false; render(); break;
      case 'open-post-modal': state.postModalOpen = true; render(); break;
      case 'close-post-modal': state.postModalOpen = false; pendingImages = []; render(); break;
      case 'open-subapi': state.subApiPanelOpen = true; render(); break;
      case 'close-subapi': state.subApiPanelOpen = false; render(); break;
      case 'open-char-list': state.charListOpen = true; render(); break;
      case 'close-char-list': state.charListOpen = false; render(); break;
      case 'close-mem-mount': state.memMountCharId = null; render(); break;
      case 'close-text-viewer': state.textViewer = null; render(); break;
      case 'close-app': if (cachedRoche && cachedRoche.ui) cachedRoche.ui.closeApp(); break;

      case 'switch-space': {
        var pid = did(t, 'data-pid');
        var per = null;
        for (var i = 0; i < state.allPersonas.length; i++) if (state.allPersonas[i].id === pid) { per = state.allPersonas[i]; break; }
        if (per) {
          var sp = ensureSpaceForPersona(per);
          state.activeSpaceId = sp.id;
          state.currentSubject = 'user';
          state.sidebarOpen = false;
          Store.saveActive().then(render);
        }
        break;
      }

      case 'view-char': {
        var cid = did(t, 'data-cid');
        if (space && getSpaceChar(space, cid)) {
          state.currentSubject = cid;
          state.sidebarOpen = false;
          render();
        }
        break;
      }

      case 'bind-char': {
        var cid2 = did(t, 'data-cid');
        if (space) {
          bindCharToSpace(space, cid2);
          state.charListOpen = false;
          render();
        }
        break;
      }

      case 'unbind-char': {
        var cid3 = did(t, 'data-cid');
        confirmBox({ message: '确定解绑该 char？历史朋友圈保留。' }).then(function (ok) {
          if (ok && space) { unbindCharFromSpace(space, cid3); render(); }
        });
        break;
      }

      case 'open-mem-mount': {
        var cid4 = did(t, 'data-cid');
        state.memMountCharId = cid4;
        state.sidebarOpen = false;
        render();
        // 异步加载会话列表
        loadConversationsForChar(cid4);
        break;
      }

      case 'toggle-enabled': {
        var cid5 = did(t, 'data-cid');
        if (space) {
          var sc5 = getSpaceChar(space, cid5);
          if (sc5) { sc5.enabled = !sc5.enabled; Store.saveSpaces().then(render); }
        }
        break;
      }

      case 'toggle-mount': {
        var cid6 = did(t, 'data-cid');
        var convId = did(t, 'data-conv');
        if (space) {
          var sc6 = getSpaceChar(space, cid6);
          if (sc6) {
            var m6 = findMount(sc6, convId);
            if (m6) { m6.enabled = !m6.enabled; }
            else {
              var convObj = null;
              (sc6._convCache || []).forEach(function (c) { if (c.id === convId) convObj = c; });
              sc6.memoryMounts.push({ conversationId: convId, convName: convObj ? convObj.name : '', isGroup: convObj ? !!convObj.isGroup : false, enabled: true, shortLimit: 50, factLimit: 0, coreEnabled: false });
            }
            Store.saveSpaces().then(render);
          }
        }
        break;
      }

      case 'char-post-now': {
        var cid7 = did(t, 'data-cid');
        if (!space) break;
        var sc7 = getSpaceChar(space, cid7);
        if (!sc7) break;
        setBusy('让 ' + (sc7.charHandle || sc7.charName) + ' 发朋友圈中...');
        generateCharPost(space, sc7).then(function (post) {
          return generateAutoComments(space, post, sc7.autoCommentCount || DEFAULT_AUTO_COMMENT);
        }).then(function () {
          setBusy('');
          toast('已发布');
          render();
        }).catch(function (err) {
          setBusy('');
          toast('发布失败：' + (err && err.message || ''));
        });
        break;
      }

      case 'sync-trace': {
        var cid8 = did(t, 'data-cid');
        if (!space) break;
        var sc8 = getSpaceChar(space, cid8);
        if (!sc8) break;
        setBusy('AI 总结并写入事实记忆中...');
        syncCharToFactMemory(space, sc8).then(function (r) {
          setBusy('');
          toast(r.ok ? '已同步到事实记忆' : ('同步失败：' + r.reason));
          render();
        });
        break;
      }

      case 'sync-fact-now': {
        var cid9 = did(t, 'data-cid');
        if (!space) break;
        var sc9 = getSpaceChar(space, cid9);
        if (!sc9) break;
        setBusy('AI 总结并写入事实记忆中...');
        syncCharToFactMemory(space, sc9).then(function (r) {
          setBusy('');
          toast(r.ok ? '已同步到事实记忆' : ('同步失败：' + r.reason));
          render();
        });
        break;
      }

      case 'set-cover': {
        if (!space) break;
        var url = window.prompt('输入封面图 URL（留空则清除）：', space.cover || '');
        if (url !== null) {
          space.cover = trim(url);
          Store.saveSpaces().then(render);
        }
        break;
      }

      case 'like': {
        var pid1 = did(t, 'data-id');
        var subj1 = getCurrentSubject();
        if (subj1) {
          Store.toggleLike(pid1, { id: subj1.id, name: subj1.name }).then(render);
        }
        break;
      }

      case 'comment-post': {
        var pid2 = did(t, 'data-id');
        state.commentTarget = { postId: pid2, replyTo: null, replyToName: null };
        render();
        var inp = $('#moments-comment-text', root);
        if (inp) inp.focus();
        break;
      }

      case 'comment-target': {
        var pid3 = did(t, 'data-id');
        var cmId = did(t, 'data-cid');
        var post3 = null;
        for (var j = 0; j < state.posts.length; j++) if (state.posts[j].id === pid3) { post3 = state.posts[j]; break; }
        var cm = null;
        if (post3 && post3.comments) for (var k = 0; k < post3.comments.length; k++) if (post3.comments[k].id === cmId) { cm = post3.comments[k]; break; }
        if (cm) {
          state.commentTarget = { postId: pid3, replyTo: cm.id, replyToName: cm.authorHandle || cm.authorName };
          render();
          var inp2 = $('#moments-comment-text', root);
          if (inp2) inp2.focus();
        }
        break;
      }

      case 'send-comment': {
        var inp3 = $('#moments-comment-text', root);
        if (!inp3) break;
        var text = trim(inp3.value);
        if (!text || !state.commentTarget) break;
        var subj2 = getCurrentSubject();
        if (!subj2) break;
        var ct = state.commentTarget;
        var comment = {
          id: uuid(), postId: ct.postId,
          authorType: subj2.type, authorId: subj2.id,
          authorName: subj2.realName || subj2.name, authorHandle: subj2.name,
          text: text, replyTo: ct.replyTo, replyToName: ct.replyToName, createdAt: Date.now()
        };
        Store.addComment(ct.postId, comment).then(function () {
          state.commentTarget = null;
          render();
        });
        break;
      }

      case 'view-text': {
        var pid4 = did(t, 'data-id');
        var idx = did(t, 'data-idx');
        var post4 = null;
        for (var x = 0; x < state.posts.length; x++) if (state.posts[x].id === pid4) { post4 = state.posts[x]; break; }
        if (post4 && post4.images && post4.images[parseInt(idx, 10)]) {
          var img = post4.images[parseInt(idx, 10)];
          if (img.type === 'text') { state.textViewer = img.textContent || img.value; render(); }
        }
        break;
      }

      case 'moment-more': {
        var pid5 = did(t, 'data-id');
        var post5 = null;
        for (var y = 0; y < state.posts.length; y++) if (state.posts[y].id === pid5) { post5 = state.posts[y]; break; }
        if (!post5) break;
        var subj3 = getCurrentSubject();
        var isOwner = subj3 && (post5.authorId === subj3.id);
        var canDelete = isOwner || (post5.authorType === 'char');
        var opts = [];
        if (canDelete) opts.push('删除');
        opts.push('让 char 评论');
        var choice = window.prompt(opts.join('\n'));
        if (choice === '删除' && canDelete) {
          confirmBox({ message: '删除这条朋友圈？' }).then(function (ok) {
            if (ok) Store.deletePost(pid5).then(render);
          });
        } else if (choice === '让 char 评论') {
          if (!space) break;
          var count = parseInt(window.prompt('让几个 char 评论？(1-8)', String(DEFAULT_AUTO_COMMENT)), 10) || DEFAULT_AUTO_COMMENT;
          setBusy('生成评论中...');
          generateAutoComments(space, post5, Math.min(Math.max(count, 1), MAX_AUTO_COMMENT)).then(function () {
            setBusy('');
            toast('评论已生成');
            render();
          }).catch(function (err) {
            setBusy('');
            toast('评论失败：' + (err && err.message || ''));
          });
        }
        break;
      }

      case 'clear-img-cache': {
        confirmBox({ message: '清除朋友圈本地图片缓存？已发布的图片会失效。' }).then(function (ok) {
          if (ok) return cachedRoche.storage.set(KEYS.IMGCACHE, []);
        }).then(function () { toast('已清除'); });
        break;
      }

      case 'enable-subapi': {
        var sid = did(t, 'data-id');
        state.subapi.forEach(function (p) { p.enabled = (p.id === sid); });
        Store.saveSubApi().then(render);
        break;
      }

      case 'del-subapi': {
        var sid2 = did(t, 'data-id');
        state.subapi = state.subapi.filter(function (p) { return p.id !== sid2; });
        Store.saveSubApi().then(render);
        break;
      }

      case 'refresh-models': {
        var url = $('#moments-sa-url', root) ? $('#moments-sa-url', root).value : '';
        var key = $('#moments-sa-key', root) ? $('#moments-sa-key', root).value : '';
        if (!trim(url) || !trim(key)) { toast('请填 URL 和 Key'); break; }
        setBusy('刷新模型列表中...');
        fetchModels(url, key).then(function (list) {
          setBusy('');
          var sel = $('#moments-sa-model', root);
          if (sel) {
            sel.innerHTML = list.length ? list.map(function (m) { return '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + '</option>'; }).join('') : '<option value="">无可用模型</option>';
          }
          toast('获取到 ' + list.length + ' 个模型');
        }).catch(function (err) {
          setBusy('');
          toast('刷新失败：' + (err && err.message || ''));
        });
        break;
      }

      case 'save-subapi': {
        var name = $('#moments-sa-name', root) ? $('#moments-sa-name', root).value : '';
        var url2 = $('#moments-sa-url', root) ? $('#moments-sa-url', root).value : '';
        var key2 = $('#moments-sa-key', root) ? $('#moments-sa-key', root).value : '';
        var model = $('#moments-sa-model', root) ? $('#moments-sa-model', root).value : '';
        if (!trim(name) || !trim(url2) || !trim(key2) || !trim(model)) { toast('请完整填写'); break; }
        state.subapi.push({ id: uuid(), name: trim(name), url: trim(url2), apiKey: trim(key2), model: trim(model), enabled: false });
        Store.saveSubApi().then(function () { toast('已保存'); render(); });
        break;
      }

      case 'publish-post': {
        if (!space) break;
        var subj4 = getCurrentSubject();
        if (!subj4) break;
        var txtEl = $('#moments-post-text', root);
        var text = txtEl ? trim(txtEl.value) : '';
        var imgs = collectPostImages();
        if (!text && !imgs.length) { toast('请输入内容'); break; }
        var post6 = {
          id: uuid(), spaceId: space.id,
          authorType: subj4.type, authorId: subj4.id, authorName: subj4.realName || subj4.name, authorHandle: subj4.name, authorAvatar: subj4.avatar,
          text: text, images: imgs, location: '', createdAt: Date.now(), likes: [], comments: []
        };
        Store.addPost(post6).then(function () {
          state.postModalOpen = false;
          pendingImages = [];
          render();
          // 如果是 user 发的，触发 char 自动评论
          if (subj4.type === 'user') {
            setBusy('char 正在评论中...');
            generateAutoComments(space, post6, DEFAULT_AUTO_COMMENT).then(function () {
              setBusy('');
              render();
            }).catch(function () { setBusy(''); });
          }
        });
        break;
      }

      case 'open-notif-item': {
        var nid = did(t, 'data-id');
        var nItem = null;
        for (var z = 0; z < state.notifs.length; z++) if (state.notifs[z].id === nid) { nItem = state.notifs[z]; break; }
        if (nItem) {
          nItem.read = true;
          Store.saveNotifs().then(function () {
            state.notifPanelOpen = false;
            render();
            // 滚动到该朋友圈
            setTimeout(function () {
              var node = $('.moment[data-id="' + nItem.postId + '"]', root);
              if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 50);
          });
        }
        break;
      }
    }
  }

  // 临时存发布图片
  var pendingImages = [];
  function collectPostImages() {
    return pendingImages.slice();
  }

  function loadConversationsForChar(charId) {
    if (!cachedRoche.conversation || !cachedRoche.conversation.list) {
      var sp0 = Store.getActiveSpace();
      if (sp0) {
        var sc0 = getSpaceChar(sp0, charId);
        if (sc0) { sc0._convCache = []; render(); }
      }
      return;
    }
    cachedRoche.conversation.list().then(function (list) {
      var sp = Store.getActiveSpace();
      if (!sp) return;
      var sc = getSpaceChar(sp, charId);
      if (!sc) return;
      sc._convCache = (list || []).map(function (c) {
        return { id: c.id || c.conversationId, name: c.name || c.title || c.handle || (c.id || c.conversationId), isGroup: c.isGroup, handle: c.handle, avatar: c.avatar };
      });
      render();
    }).catch(function () {
      var sp2 = Store.getActiveSpace();
      if (sp2) {
        var sc2 = getSpaceChar(sp2, charId);
        if (sc2) { sc2._convCache = []; render(); }
      }
    });
  }

  // 发布图片工具（文字图/URL/本地）
  // 通过全局事件挂载到 post modal 的工具按钮
  function setupPostModalTools() {
    if (!root) return;
    var rootEl = $('.' + ROOT_CLASS, root) || root;
    $all('.moments-post-tool', rootEl).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tool = btn.getAttribute('data-tool');
        if (tool === 'text') {
          var txt = window.prompt('输入文字图内容（点击后显示）：');
          if (txt != null && trim(txt)) {
            pendingImages.push({ type: 'text', value: trim(txt), textContent: trim(txt) });
            refreshPostImages();
          }
        } else if (tool === 'url') {
          var url = window.prompt('输入图片 URL：');
          if (url != null && trim(url)) {
            pendingImages.push({ type: 'url', value: trim(url) });
            refreshPostImages();
          }
        }
      });
    });
    var fileInput = $('#moments-post-file', rootEl);
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;
        if (f.size > 2 * 1024 * 1024) { toast('图片超过 2MB，建议用 URL'); }
        var reader = new FileReader();
        reader.onload = function () {
          var dataUri = reader.result;
          pendingImages.push({ type: 'local', value: dataUri });
          // 存缓存
          cachedRoche.storage.get(KEYS.IMGCACHE).then(function (cache) {
            cache = cache || [];
            cache.push({ key: dataUri.slice(0, 32), dataUri: dataUri });
            if (cache.length > 50) cache = cache.slice(-50);
            cachedRoche.storage.set(KEYS.IMGCACHE, cache);
          });
          refreshPostImages();
        };
        reader.readAsDataURL(f);
        fileInput.value = '';
      });
    }
  }

  function refreshPostImages() {
    var box = $('#moments-post-imgs', root);
    if (!box) return;
    box.innerHTML = pendingImages.map(function (img, idx) {
      var preview = img.type === 'text' ? '<div class="mp-img-text">' + ICON.image + '<span>' + escapeHtml((img.textContent || '').slice(0, 12)) + '</span></div>' : '<img src="' + escapeHtml(img.value) + '">';
      return '<div class="mp-img">' + preview + '<div class="mp-img-del" data-mp-del="' + idx + '">' + ICON.close + '</div></div>';
    }).join('');
    $all('[data-mp-del]', box).forEach(function (d) {
      d.addEventListener('click', function () {
        var i = parseInt(d.getAttribute('data-mp-del'), 10);
        pendingImages.splice(i, 1);
        refreshPostImages();
      });
    });
  }

  // ========== CSS ==========
  var CSS = ''
+ '.' + ROOT_CLASS + '{position:absolute;inset:0;background:#EDEDED;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#353535;font-size:14px;line-height:1.5;}'
+ '.' + ROOT_CLASS + ' *{box-sizing:border-box;}'
+ '.' + ROOT_CLASS + ' .moments-inner{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;}'
+ '.' + ROOT_CLASS + ' .moments-topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;height:48px;padding:0 12px;background:rgba(237,237,237,0.95);backdrop-filter:blur(8px);}'
+ '.' + ROOT_CLASS + ' .moments-topbar-left,.' + ROOT_CLASS + ' .moments-topbar-right{display:flex;align-items:center;cursor:pointer;color:#353535;padding:6px;}'
+ '.' + ROOT_CLASS + ' .moments-topbar-title{flex:1;text-align:center;font-size:17px;font-weight:600;}'
+ '.' + ROOT_CLASS + ' .moments-bell{position:relative;display:flex;align-items:center;}'
+ '.' + ROOT_CLASS + ' .moments-bell.has-dot{color:#576B95;}'
+ '.' + ROOT_CLASS + ' .moments-dot{position:absolute;top:-2px;right:-2px;width:8px;height:8px;background:#FA5151;border-radius:50%;border:1.5px solid #EDEDED;}'
+ '.' + ROOT_CLASS + ' .moments-cover{position:relative;height:280px;background:linear-gradient(135deg,#576B95,#353535);overflow:hidden;}'
+ '.' + ROOT_CLASS + ' .moments-cover-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.5);font-size:13px;}'
+ '.' + ROOT_CLASS + ' .moments-cover-mask{position:absolute;inset:0;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-cover-avatar{position:absolute;right:16px;bottom:-32px;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-avatar{width:70px;height:70px;border-radius:8px;overflow:hidden;border:3px solid #fff;background:#ddd;box-shadow:0 2px 8px rgba(0,0,0,0.15);}'
+ '.' + ROOT_CLASS + ' .moments-avatar.sm{width:40px;height:40px;border-radius:6px;border-width:0;}'
+ '.' + ROOT_CLASS + ' .moments-avatar img{width:100%;height:100%;object-fit:cover;display:block;}'
+ '.' + ROOT_CLASS + ' .moments-avatar-fallback{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#576B95;color:#fff;font-size:20px;font-weight:600;}'
+ '.' + ROOT_CLASS + ' .moments-avatar.sm .moments-avatar-fallback{font-size:16px;}'
+ '.' + ROOT_CLASS + ' .moments-cover-name{position:absolute;right:96px;bottom:-24px;color:#fff;font-size:17px;font-weight:600;text-shadow:0 1px 4px rgba(0,0,0,0.5);}'
+ '.' + ROOT_CLASS + ' .moments-cover-bio{position:absolute;right:96px;bottom:-44px;color:rgba(255,255,255,0.8);font-size:12px;max-width:180px;text-shadow:0 1px 4px rgba(0,0,0,0.5);}'
+ '.' + ROOT_CLASS + ' .moments-cover-hint{position:absolute;left:16px;bottom:12px;color:rgba(255,255,255,0.6);font-size:11px;}'
+ '.' + ROOT_CLASS + ' .moments-feed{padding:48px 0 60px 0;}'
+ '.' + ROOT_CLASS + ' .moment{background:#fff;margin-bottom:8px;padding:12px 16px;}'
+ '.' + ROOT_CLASS + ' .moment-hd{display:flex;align-items:flex-start;}'
+ '.' + ROOT_CLASS + ' .moment-avatar{width:42px;height:42px;border-radius:6px;overflow:hidden;background:#ddd;flex-shrink:0;margin-right:10px;}'
+ '.' + ROOT_CLASS + ' .moment-avatar img{width:100%;height:100%;object-fit:cover;}'
+ '.' + ROOT_CLASS + ' .moment-avatar .moments-avatar-fallback{font-size:18px;}'
+ '.' + ROOT_CLASS + ' .moment-meta{flex:1;padding-top:4px;}'
+ '.' + ROOT_CLASS + ' .moment-author{color:#576B95;font-size:15px;font-weight:600;}'
+ '.' + ROOT_CLASS + ' .moment-loc{color:#576B95;font-size:12px;margin-top:2px;display:flex;align-items:center;gap:2px;}'
+ '.' + ROOT_CLASS + ' .moment-more{color:#999;cursor:pointer;padding:4px;}'
+ '.' + ROOT_CLASS + ' .moment-text{margin-top:8px;font-size:15px;line-height:1.6;color:#353535;word-break:break-word;}'
+ '.' + ROOT_CLASS + ' .moment-images{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:8px;}'
+ '.' + ROOT_CLASS + ' .moment-images.single{grid-template-columns:1fr;max-width:200px;}'
+ '.' + ROOT_CLASS + ' .moment-img,.' + ROOT_CLASS + ' .moment-img-text{width:100%;aspect-ratio:1;background:#f0f0f0;border-radius:4px;overflow:hidden;cursor:pointer;position:relative;}'
+ '.' + ROOT_CLASS + ' .moment-images.single .moment-img{aspect-ratio:auto;max-height:240px;}'
+ '.' + ROOT_CLASS + ' .moment-img img{width:100%;height:100%;object-fit:cover;display:block;}'
+ '.' + ROOT_CLASS + ' .moment-img-text{display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#f5f5f5,#e0e0e0);color:#888;}'
+ '.' + ROOT_CLASS + ' .moment-img-text-inner{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;}'
+ '.' + ROOT_CLASS + ' .moment-img-text-hint{position:absolute;bottom:4px;font-size:10px;color:#aaa;}'
+ '.' + ROOT_CLASS + ' .moment-time{margin-top:8px;font-size:12px;color:#999;}'
+ '.' + ROOT_CLASS + ' .moment-actions{margin-top:8px;position:relative;min-height:24px;}'
+ '.' + ROOT_CLASS + ' .moment-action-btns{display:flex;align-items:center;gap:16px;background:#f7f7f7;border-radius:4px;padding:4px 8px;width:fit-content;}'
+ '.' + ROOT_CLASS + ' .moment-action-btns-float{position:absolute;right:0;top:0;}'
+ '.' + ROOT_CLASS + ' .moment-act{cursor:pointer;color:#576B95;display:flex;align-items:center;padding:2px;}'
+ '.' + ROOT_CLASS + ' .moment-interactions{background:#f7f7f7;border-radius:4px;padding:6px 10px;margin-top:4px;}'
+ '.' + ROOT_CLASS + ' .moment-likes{display:flex;align-items:center;gap:4px;color:#576B95;font-size:13px;padding:2px 0;border-bottom:1px solid #eee;}'
+ '.' + ROOT_CLASS + ' .moment-likes svg{flex-shrink:0;}'
+ '.' + ROOT_CLASS + ' .moment-comments{padding-top:4px;}'
+ '.' + ROOT_CLASS + ' .moment-comment{font-size:13px;line-height:1.7;color:#353535;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moment-comment:hover{background:#f0f0f0;}'
+ '.' + ROOT_CLASS + ' .mc-name{color:#576B95;font-weight:600;}'
+ '.' + ROOT_CLASS + ' .mc-reply{color:#999;}'
+ '.' + ROOT_CLASS + ' .mc-colon{color:#353535;}'
+ '.' + ROOT_CLASS + ' .moments-feed-empty{padding:80px 20px;text-align:center;color:#999;}'
+ '.' + ROOT_CLASS + ' .moments-feed-empty svg{color:#bbb;margin-bottom:12px;}'
+ '.' + ROOT_CLASS + ' .moments-feed-empty-hint{font-size:12px;margin-top:6px;color:#bbb;}'
+ '.' + ROOT_CLASS + ' .moments-empty{padding:40px 20px;text-align:center;color:#999;font-size:13px;}'
// 浮层
+ '.' + ROOT_CLASS + ' .moments-mask{position:absolute;inset:0;background:rgba(0,0,0,0.4);opacity:0;pointer-events:none;transition:opacity 0.2s;z-index:50;}'
+ '.' + ROOT_CLASS + ' .moments-mask.open{opacity:1;pointer-events:auto;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar{position:absolute;top:0;left:0;bottom:0;width:280px;background:#fff;transform:translateX(-100%);transition:transform 0.25s;z-index:51;overflow-y:auto;box-shadow:2px 0 12px rgba(0,0,0,0.1);}'
+ '.' + ROOT_CLASS + ' .moments-sidebar.open{transform:translateX(0);}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-hd{display:flex;align-items:center;justify-content:space-between;padding:16px;height:56px;border-bottom:1px solid #f0f0f0;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-title{font-size:17px;font-weight:600;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-close{cursor:pointer;padding:4px;color:#999;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-section{padding:12px 0;border-bottom:1px solid #f0f0f0;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-label{padding:0 16px 8px;font-size:12px;color:#999;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-item{display:flex;align-items:center;padding:10px 16px;cursor:pointer;gap:10px;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-item:hover{background:#f7f7f7;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-item.active{background:#eef2ff;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-item-info{flex:1;min-width:0;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-item-name{font-size:14px;font-weight:500;color:#353535;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-item-sub{font-size:11px;color:#999;margin-top:2px;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-item-btns{display:flex;gap:4px;flex-wrap:wrap;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-empty{padding:12px 16px;font-size:12px;color:#bbb;}'
+ '.' + ROOT_CLASS + ' .moments-sidebar-item.add .add-avatar{background:#f0f0f0;color:#576B95;display:flex;align-items:center;justify-content:center;}'
+ '.' + ROOT_CLASS + ' .moments-mini-btn{font-size:11px;padding:3px 8px;border:1px solid #576B95;color:#576B95;border-radius:10px;cursor:pointer;background:#fff;}'
+ '.' + ROOT_CLASS + ' .moments-mini-btn:hover{background:#576B95;color:#fff;}'
+ '.' + ROOT_CLASS + ' .moments-mini-btn.danger{border-color:#FA5151;color:#FA5151;}'
+ '.' + ROOT_CLASS + ' .moments-mini-btn.danger:hover{background:#FA5151;color:#fff;}'
// modal
+ '.' + ROOT_CLASS + ' .moments-modal-mask{position:absolute;inset:0;background:rgba(0,0,0,0.5);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;}'
+ '.' + ROOT_CLASS + ' .moments-modal{background:#fff;border-radius:12px;width:100%;max-width:420px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;}'
+ '.' + ROOT_CLASS + ' .moments-modal.wide{max-width:480px;}'
+ '.' + ROOT_CLASS + ' .moments-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #f0f0f0;}'
+ '.' + ROOT_CLASS + ' .moments-modal-title{font-size:16px;font-weight:600;}'
+ '.' + ROOT_CLASS + ' .moments-modal-close{cursor:pointer;color:#999;padding:4px;}'
+ '.' + ROOT_CLASS + ' .moments-modal-bd{padding:16px;overflow-y:auto;flex:1;}'
+ '.' + ROOT_CLASS + ' .moments-divider{height:1px;background:#f0f0f0;margin:12px 0;}'
+ '.' + ROOT_CLASS + ' .moments-section-title{font-size:14px;font-weight:600;margin-bottom:8px;}'
+ '.' + ROOT_CLASS + ' .moments-section-hint{font-size:11px;color:#999;font-weight:400;margin-left:6px;}'
+ '.' + ROOT_CLASS + ' .moments-setting-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;gap:12px;}'
+ '.' + ROOT_CLASS + ' .moments-setting-label{font-size:14px;}'
+ '.' + ROOT_CLASS + ' .moments-input{border:1px solid #ddd;border-radius:6px;padding:6px 10px;font-size:14px;min-width:0;flex:0 0 auto;width:auto;}'
+ '.' + ROOT_CLASS + ' .moments-input[type=number]{width:90px;}'
+ '.' + ROOT_CLASS + ' .moments-switch{width:44px;height:24px;background:#ccc;border-radius:12px;position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0;}'
+ '.' + ROOT_CLASS + ' .moments-switch.on{background:#07C160;}'
+ '.' + ROOT_CLASS + ' .moments-switch.disabled{opacity:0.5;}'
+ '.' + ROOT_CLASS + ' .moments-switch i{position:absolute;top:2px;left:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:left 0.2s;}'
+ '.' + ROOT_CLASS + ' .moments-switch.on i{left:22px;}'
+ '.' + ROOT_CLASS + ' .moments-conv-row{border:1px solid #f0f0f0;border-radius:8px;padding:10px;margin-bottom:8px;}'
+ '.' + ROOT_CLASS + ' .moments-conv-row.on{border-color:#576B95;background:#f8faff;}'
+ '.' + ROOT_CLASS + ' .moments-conv-hd{display:flex;align-items:center;justify-content:space-between;}'
+ '.' + ROOT_CLASS + ' .moments-conv-name{font-size:14px;font-weight:500;}'
+ '.' + ROOT_CLASS + ' .moments-conv-opts{display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;}'
+ '.' + ROOT_CLASS + ' .moments-conv-opts label{display:flex;align-items:center;gap:4px;font-size:12px;color:#666;}'
+ '.' + ROOT_CLASS + ' .moments-conv-opts input[type=number]{width:70px;}'
+ '.' + ROOT_CLASS + ' .moments-hint{font-size:12px;color:#999;line-height:1.6;margin:8px 0;}'
+ '.' + ROOT_CLASS + ' .moments-btn-row{display:flex;gap:8px;margin-top:12px;}'
+ '.' + ROOT_CLASS + ' .moments-btn{flex:1;padding:10px;background:#07C160;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-btn:hover{background:#06ad56;}'
+ '.' + ROOT_CLASS + ' .moments-btn.ghost{background:#f0f0f0;color:#353535;}'
+ '.' + ROOT_CLASS + ' .moments-btn.ghost:hover{background:#e5e5e5;}'
// 副API
+ '.' + ROOT_CLASS + ' .moments-subapi-row{display:flex;align-items:center;justify-content:space-between;padding:10px;border:1px solid #f0f0f0;border-radius:8px;margin-bottom:8px;}'
+ '.' + ROOT_CLASS + ' .moments-subapi-row.active{border-color:#07C160;background:#f6fff9;}'
+ '.' + ROOT_CLASS + ' .moments-subapi-info{flex:1;min-width:0;}'
+ '.' + ROOT_CLASS + ' .moments-subapi-name{font-size:14px;font-weight:500;}'
+ '.' + ROOT_CLASS + ' .moments-subapi-sub{font-size:11px;color:#999;margin-top:2px;word-break:break-all;}'
+ '.' + ROOT_CLASS + ' .moments-subapi-btns{display:flex;gap:4px;}'
+ '.' + ROOT_CLASS + ' .moments-form{display:flex;flex-direction:column;gap:10px;}'
+ '.' + ROOT_CLASS + ' .moments-form label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#666;}'
+ '.' + ROOT_CLASS + ' .moments-form .moments-input{width:100%;flex:1;}'
+ '.' + ROOT_CLASS + ' .moments-form-row{display:flex;gap:8px;align-items:flex-end;}'
+ '.' + ROOT_CLASS + ' .moments-form-row label{flex:1;}'
// 发朋友圈
+ '.' + ROOT_CLASS + ' .moments-post-as{font-size:13px;color:#666;margin-bottom:10px;}'
+ '.' + ROOT_CLASS + ' .moments-post-as b{color:#576B95;}'
+ '.' + ROOT_CLASS + ' .moments-post-text{width:100%;min-height:120px;border:1px solid #eee;border-radius:8px;padding:10px;font-size:14px;resize:vertical;font-family:inherit;}'
+ '.' + ROOT_CLASS + ' .moments-post-imgs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}'
+ '.' + ROOT_CLASS + ' .mp-img{position:relative;width:80px;height:80px;border-radius:6px;overflow:hidden;background:#f0f0f0;}'
+ '.' + ROOT_CLASS + ' .mp-img img{width:100%;height:100%;object-fit:cover;}'
+ '.' + ROOT_CLASS + ' .mp-img-text{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;color:#888;gap:2px;}'
+ '.' + ROOT_CLASS + ' .mp-img-del{position:absolute;top:0;right:0;width:20px;height:20px;background:rgba(0,0,0,0.5);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;border-bottom-left-radius:6px;}'
+ '.' + ROOT_CLASS + ' .moments-post-tools{display:flex;gap:16px;margin-top:10px;}'
+ '.' + ROOT_CLASS + ' .moments-post-tool{display:flex;align-items:center;gap:4px;cursor:pointer;color:#576B95;font-size:13px;padding:6px;border-radius:6px;}'
+ '.' + ROOT_CLASS + ' .moments-post-tool:hover{background:#f0f0f0;}'
// 评论栏
+ '.' + ROOT_CLASS + ' .moments-comment-bar{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fff;border-top:1px solid #eee;z-index:40;}'
+ '.' + ROOT_CLASS + ' .moments-comment-avatar{width:32px;height:32px;border-radius:6px;overflow:hidden;background:#ddd;flex-shrink:0;}'
+ '.' + ROOT_CLASS + ' .moments-comment-avatar img{width:100%;height:100%;object-fit:cover;}'
+ '.' + ROOT_CLASS + ' .moments-comment-input{flex:1;border:1px solid #ddd;border-radius:6px;padding:8px 10px;font-size:14px;}'
+ '.' + ROOT_CLASS + ' .moments-comment-send{width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:#07C160;color:#fff;border:none;border-radius:6px;cursor:pointer;}'
// subject sheet
+ '.' + ROOT_CLASS + ' .moments-sheet{background:#fff;border-radius:12px 12px 0 0;width:100%;max-width:420px;max-height:70vh;overflow-y:auto;align-self:flex-end;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-title{padding:16px;text-align:center;font-size:15px;font-weight:600;border-bottom:1px solid #f0f0f0;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-item{display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-item:hover{background:#f7f7f7;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-item.active{background:#eef2ff;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-item-info{flex:1;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-item-name{font-size:14px;font-weight:500;}'
+ '.' + ROOT_CLASS + ' .moments-sheet-item-sub{font-size:11px;color:#999;margin-top:2px;}'
// 通知
+ '.' + ROOT_CLASS + ' .moments-notif{display:flex;gap:10px;padding:12px 0;border-bottom:1px solid #f5f5f5;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-notif.unread{background:#f8faff;margin:0 -16px;padding:12px 16px;}'
+ '.' + ROOT_CLASS + ' .moments-notif-info{flex:1;}'
+ '.' + ROOT_CLASS + ' .moments-notif-text{font-size:13px;line-height:1.5;}'
+ '.' + ROOT_CLASS + ' .moments-notif-text b{color:#576B95;}'
+ '.' + ROOT_CLASS + ' .moments-notif-time{font-size:11px;color:#999;margin-top:4px;}'
// 文字图查看
+ '.' + ROOT_CLASS + ' .moments-text-viewer{align-items:center;}'
+ '.' + ROOT_CLASS + ' .moments-text-viewer-box{background:#fff;border-radius:12px;padding:20px;max-width:360px;width:100%;}'
+ '.' + ROOT_CLASS + ' .moments-text-viewer-label{font-size:12px;color:#999;margin-bottom:10px;}'
+ '.' + ROOT_CLASS + ' .moments-text-viewer-text{font-size:15px;line-height:1.7;color:#353535;white-space:pre-wrap;word-break:break-word;}'
// busy
+ '.' + ROOT_CLASS + ' .moments-busy{position:absolute;inset:0;background:rgba(0,0,0,0.4);z-index:100;display:flex;align-items:center;justify-content:center;}'
+ '.' + ROOT_CLASS + ' .moments-busy-box{background:#fff;border-radius:12px;padding:24px 32px;display:flex;flex-direction:column;align-items:center;gap:12px;}'
+ '.' + ROOT_CLASS + ' .moments-spin{width:36px;height:36px;}'
+ '.' + ROOT_CLASS + ' .moments-spin svg{animation:moments-spin 1.2s linear infinite;}'
+ '.' + ROOT_CLASS + ' .moments-busy-text{font-size:13px;color:#666;}'
+ '@keyframes moments-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'
+ '.' + ROOT_CLASS + ' .moments-topbar-right .moments-bell{position:relative;}'
+ '.' + ROOT_CLASS + ' .moments-topbar-cam{display:flex;align-items:center;cursor:pointer;color:#353535;padding:6px;margin-right:4px;}';

  // ========== 插件注册 ==========
  window.RochePlugin = window.RochePlugin || {};
  window.RochePlugin.register = window.RochePlugin.register || function () {};
  window.RochePlugin.register({
    id: PLUGIN_ID,
    name: '朋友圈',
    version: '0.2.0',
    apps: [{
      id: APP_ID,
      name: '朋友圈',
      iconImage: WINDMILL_DATA_URI,
      async mount(container, roche) {
        cachedRoche = roche;
        root = container;
        pendingImages = [];
        // 注入样式
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.setAttribute('data-plugin', PLUGIN_ID);
          styleTag.textContent = CSS;
          document.head.appendChild(styleTag);
        }
        // 初始化数据
        setBusy('加载中...');
        try {
          await refreshPersonas();
          await refreshChars();
          await Store.loadAll();
          // 确保有 active space
          if (!state.activeSpaceId || !Store.getActiveSpace()) {
            if (state.allPersonas.length) {
              var sp = ensureSpaceForPersona(state.activePersona || state.allPersonas[0]);
              state.activeSpaceId = sp.id;
              await Store.saveActive();
            }
          }
        } catch (e) {
          console.warn('[Moments] init error', e);
        }
        setBusy('');
        render();
        bindEvents();
        if (state.postModalOpen) setupPostModalTools();
      },
      async unmount(container, roche) {
        // 关闭时自动同步方式1（注入 char 行为到单聊）
        try {
          if (state.spaces.length) {
            for (var i = 0; i < state.spaces.length; i++) {
              var sp = state.spaces[i];
              for (var j = 0; j < (sp.chars || []).length; j++) {
                var sc = sp.chars[j];
                if (sc.enabled) {
                  await injectCharActionToChat(sp, sc);
                }
              }
            }
          }
        } catch (e) {
          console.warn('[Moments] auto sync on unmount failed', e);
        }
        // 清理 DOM/事件（后台定时器不停）
        if (root) {
          root.removeEventListener('click', onRootClick);
          root.removeEventListener('change', onRootChange);
          root.removeEventListener('input', onRootInput);
        }
        cleanupFns.forEach(function (fn) { try { fn(); } catch (e) {} });
        cleanupFns = [];
        pendingImages = [];
        if (container) container.replaceChildren();
        root = null;
      }
    }]
  });

  // 启动后台定时器（IIFE 层，只启动一次）
  startBgTimer();

})();
