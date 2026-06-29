/**
 * Roche 朋友圈插件 v0.3.0
 * 完全拟真微信朋友圈的沉浸式模拟
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
    ACTIVE: 'moments:activeSpace', IMGCACHE: 'moments:imgcache'
  };
  var MIN_POST_INTERVAL = 30 * 60 * 1000;
  var JITTER = 0.2;
  var BG_CHECK_INTERVAL = 60 * 1000;
  var SYNC_PREFIX = '[RocheMomentsSync';
  var MAX_AUTO_COMMENT = 8;
  var DEFAULT_AUTO_COMMENT = 2;

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
    like: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M2 9h3v11H2V9zm5 0h4l-1 3c-.4 1.3.5 2.5 1.8 2.5.4 0 .8-.1 1.1-.3l3.6-5.4V4H8.5L5.5 7v2h1.5z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M4 4h16v12H8l-4 4V4z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 2a6 6 0 0 1 6 6v4l2 3H4l2-3V8a6 6 0 0 1 6-6zm-2 18h4a2 2 0 1 1-4 0z"/></svg>',
    menu: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 4h18v16H3V4zm2 12l4-4 3 3 4-5 3 4V6H5v10zm3-7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>',
    location: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>'
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
    charListOpen: false, commentTarget: null,
    tip: null,            // 局部 loading 提示 {text}
    bootLoading: true,    // 首次加载全屏
    allChars: [], allPersonas: [], activePersona: null
  };
  var pendingImages = [];

  // ========== Store ==========
  var Store = {
    _get: function (k, d) { return cachedRoche.storage.get(k).then(function (v) { return v == null ? d : v; }); },
    _set: function (k, v) { return cachedRoche.storage.set(k, v); },
    loadAll: function () {
      return Promise.all([
        Store._get(KEYS.SPACES, []), Store._get(KEYS.POSTS, []), Store._get(KEYS.NOTIFS, []),
        Store._get(KEYS.SUBAPI, []), Store._get(KEYS.SYNCSTATE, {}), Store._get(KEYS.ACTIVE, null)
      ]).then(function (r) {
        state.spaces = r[0] || []; state.posts = r[1] || []; state.notifs = r[2] || [];
        state.subapi = r[3] || []; state.syncstate = r[4] || []; state.activeSpaceId = r[5];
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
      for (var i = 0; i < state.spaces.length; i++) if (state.spaces[i].id === state.activeSpaceId) return state.spaces[i];
      return null;
    },
    addPost: function (p) { state.posts.push(p); state.posts.sort(function (a, b) { return b.createdAt - a.createdAt; }); return Store.savePosts(); },
    deletePost: function (id) { state.posts = state.posts.filter(function (p) { return p.id !== id; }); return Store.savePosts(); },
    addComment: function (pid, c) {
      for (var i = 0; i < state.posts.length; i++) if (state.posts[i].id === pid) {
        if (!state.posts[i].comments) state.posts[i].comments = [];
        state.posts[i].comments.push(c); break;
      }
      return Store.savePosts();
    },
    toggleLike: function (pid, who) {
      for (var i = 0; i < state.posts.length; i++) if (state.posts[i].id === pid) {
        var p = state.posts[i]; if (!p.likes) p.likes = [];
        var idx = -1;
        for (var j = 0; j < p.likes.length; j++) if (p.likes[j].id === who.id) { idx = j; break; }
        if (idx >= 0) p.likes.splice(idx, 1); else p.likes.push(who);
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
      userPersonaBio: per.bio || '', cover: '', chars: [], createdAt: Date.now()
    };
    state.spaces.push(sp); Store.saveSpaces(); return sp;
  }
  function bindCharToSpace(space, cid) {
    if (getSpaceChar(space, cid)) return;
    var c = findChar(cid); if (!c) return;
    space.chars.push({
      charId: c.id, charName: c.name || c.id, charHandle: c.handle || c.name || '',
      charAvatar: c.avatar || '', charPersona: c.persona || c.bio || '', charBio: c.bio || '',
      enabled: true, memoryMounts: [], nextPostAt: 0, postIntervalMin: 30,
      autoCommentCount: DEFAULT_AUTO_COMMENT, lastSyncAt: 0
    });
    Store.saveSpaces();
  }
  function unbindCharFromSpace(space, cid) {
    space.chars = space.chars.filter(function (c) { return c.charId !== cid; });
    Store.saveSpaces();
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
    return loadMountedMemory(sc).then(function (mem) {
      var sys = '你是「' + sc.charName + '」，现在要发一条你自己的微信朋友圈。\n';
      if (persona) sys += '\n你的人设：\n' + persona + '\n';
      if (mem) sys += '\n你最近的记忆与对话上下文：\n' + mem + '\n';
      sys += '\n当前你身处的朋友圈空间，user 人设是「' + (space.userPersonaHandle || space.userPersonaName) + '」。\n';
      sys += '\n要求：\n1. 用第一人称「我」发朋友圈，符合你的人设口吻\n2. 内容真实自然，1-3 句话\n3. 想配图用 <images><img>图片描述</img></images>，0~3 张文字图\n4. 正文放 <text>这里</text>\n5. 不要 emoji/hashtag/@\n6. 只输出 <text> 和可选 <images>';
      return callAI({ messages: [{ role: 'system', content: sys }, { role: 'user', content: '发一条你的朋友圈吧。' }], temperature: 0.9 });
    }).then(function (raw) {
      var parsed = parsePostContent(raw);
      if (!parsed.text && !parsed.images.length) parsed.text = trim((raw || '').replace(/<[^>]+>/g, '')) || '今天，又是普通的一天。';
      var post = {
        id: uuid(), spaceId: space.id, authorType: 'char', authorId: sc.charId,
        authorName: sc.charName, authorHandle: sc.charHandle || sc.charName, authorAvatar: sc.charAvatar,
        text: parsed.text, images: parsed.images, location: '', createdAt: Date.now(), likes: [], comments: []
      };
      return Store.addPost(post).then(function () {
        Store.addNotif({ id: uuid(), spaceId: space.id, type: 'post', fromId: sc.charId, fromName: sc.charHandle || sc.charName, fromAvatar: sc.charAvatar, postId: post.id, postSnippet: parsed.text.slice(0, 30), text: '发布了新朋友圈', createdAt: Date.now(), read: false });
        return post;
      });
    });
  }

  // ========== 评论 ==========
  function parseCommentResponse(raw) {
    var text = trim(raw || '');
    var liked = /<like>\s*1\s*<\/like>/i.test(text);
    text = text.replace(/<like>[\s\S]*?<\/like>/gi, '');
    var cm = text.match(/<comment>([\s\S]*?)<\/comment>/i);
    if (cm) text = cm[1];
    return { text: trim(text), liked: liked };
  }
  function generateSingleComment(space, post, sc, mode, replyTarget, prevComments) {
    var c = findChar(sc.charId) || {};
    var persona = c.persona || c.bio || sc.charPersona || '';
    return loadMountedMemory(sc).then(function (mem) {
      var sys = '你是「' + sc.charName + '」，正在看「' + (post.authorHandle || post.authorName) + '」的微信朋友圈，要写一条评论。\n';
      if (persona) sys += '\n你的人设：\n' + persona + '\n';
      if (mem) sys += '\n你最近的记忆上下文：\n' + mem + '\n';
      sys += '\n这条朋友圈内容：\n' + (post.text || '(仅图片)') + '\n';
      sys += post.authorType === 'user' ? '发朋友圈的是 user（' + (space.userPersonaHandle || space.userPersonaName) + '）。\n' : '发朋友圈的是 ' + (post.authorHandle || post.authorName) + '（和你一样是 char）。\n';
      if (prevComments && prevComments.length) {
        sys += '\n已有评论（你可以看到，也可回复其中某人）：\n';
        prevComments.forEach(function (c) { sys += '- ' + (c.authorHandle || c.authorName) + '：' + c.text + (c.replyToName ? ' （回复 ' + c.replyToName + '）' : '') + '\n'; });
      }
      sys += '\n评论模式：' + (mode === 'post' ? '直接评论这条朋友圈' : '回复 ' + (replyTarget && replyTarget.name) + ' 的评论');
      sys += '\n\n要求：\n1. 第一人称「我」的口吻，符合人设，1-2 句\n2. 不要 emoji/@\n3. 觉得值得点赞末尾加 <like>1</like>，否则 <like>0</like>\n4. 只输出评论正文和 like 标签';
      return callAI({ messages: [{ role: 'system', content: sys }, { role: 'user', content: '写评论。' }], temperature: 0.9 });
    }).then(function (raw) {
      var p = parseCommentResponse(raw);
      return {
        comment: { id: uuid(), postId: post.id, authorType: 'char', authorId: sc.charId, authorName: sc.charName, authorHandle: sc.charHandle || sc.charName, text: p.text || '…', replyTo: (replyTarget && replyTarget.commentId) || null, replyToName: (replyTarget && replyTarget.name) || null, createdAt: Date.now() },
        liked: p.liked, sc: sc
      };
    });
  }
  // 容错：单个 char 失败不中断
  function generateAutoComments(space, post, count) {
    var pool = (space.chars || []).filter(function (c) { return c.enabled && c.charId !== post.authorId; });
    if (!pool.length) return Promise.resolve([]);
    var picks = randPick(pool, Math.min(count || DEFAULT_AUTO_COMMENT, MAX_AUTO_COMMENT, pool.length));
    var prevComments = (post.comments || []).slice();
    var results = [];
    var chain = Promise.resolve();
    picks.forEach(function (sc) {
      chain = chain.then(function () {
        return generateSingleComment(space, post, sc, 'post', null, prevComments).then(function (r) {
          results.push(r); prevComments.push(r.comment);
          if (r.liked) {
            var has = false;
            for (var i = 0; i < post.likes.length; i++) if (post.likes[i].id === sc.charId) { has = true; break; }
            if (!has) post.likes.push({ id: sc.charId, name: sc.charHandle || sc.charName });
          }
          return Store.addComment(post.id, r.comment).then(function () { return Store.savePosts(); }).then(function () {
            return Store.addNotif({ id: uuid(), spaceId: space.id, type: 'comment', fromId: sc.charId, fromName: sc.charHandle || sc.charName, fromAvatar: sc.charAvatar, postId: post.id, postSnippet: (post.text || '').slice(0, 30), text: r.comment.replyToName ? '回复了 ' + r.comment.replyToName + '：' + r.comment.text : '评论：' + r.comment.text, createdAt: Date.now(), read: false });
          });
        }).catch(function (e) { console.warn('[Moments] 单个 char 评论失败', e); });
      });
    });
    return chain.then(function () { return results; });
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
    var myPosts = [], myComments = [], myLikes = [];
    state.posts.forEach(function (p) {
      if (p.spaceId !== space.id) return;
      if (p.authorType === 'char' && p.authorId === sc.charId && p.createdAt > sinceTs) myPosts.push(p);
      if (p.likes) for (var i = 0; i < p.likes.length; i++) if (p.likes[i].id === sc.charId && p.createdAt > sinceTs) {
        myLikes.push({ ownerName: p.authorType === 'user' ? (space.userPersonaHandle || space.userPersonaName) : (p.authorHandle || p.authorName) });
      }
      if (p.comments) p.comments.forEach(function (c) {
        if (c.authorType === 'char' && c.authorId === sc.charId && c.createdAt > sinceTs) {
          myComments.push({ onName: p.authorType === 'user' ? (space.userPersonaHandle || space.userPersonaName) : (p.authorHandle || p.authorName), isMyPost: p.authorType === 'char' && p.authorId === sc.charId, replyToName: c.replyToName, text: c.text });
        }
      });
    });
    var dt = new Date();
    var stamp = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0') + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
    var L = [];
    L.push(SYNC_PREFIX + ' · 我的朋友圈行为记录 · ' + stamp + ']');
    L.push(''); L.push('我刚在朋友圈做了这些事：'); L.push('');
    if (myPosts.length) { L.push('【我发的朋友圈】'); myPosts.forEach(function (p, i) { L.push((i + 1) + '. "' + (p.text || '(仅图片)') + '"'); }); L.push(''); }
    if (myComments.length) {
      L.push('【我的评论】');
      myComments.forEach(function (c) {
        if (c.isMyPost && c.replyToName) L.push('- 我回复了 ' + c.replyToName + ' 在我朋友圈下的评论：' + c.text);
        else if (c.replyToName) L.push('- 我回复了 ' + c.replyToName + ' 在 ' + c.onName + ' 朋友圈下的评论：' + c.text);
        else L.push('- 我评论了 ' + c.onName + ' 的朋友圈：' + c.text);
      });
      L.push('');
    }
    if (myLikes.length) {
      L.push('【我的点赞】');
      var names = myLikes.map(function (l) { return l.ownerName; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      L.push('我给 ' + names.join('、') + ' 的朋友圈点了赞。'); L.push('');
    }
    if (!myPosts.length && !myComments.length && !myLikes.length) { L.push('（这段时间我没有在朋友圈做任何事。）'); L.push(''); }
    L.push('这是我的私人记忆记录，不必向 user 复述，但可以在对话中自然延续相关话题。');
    return L.join('\n');
  }
  function injectCharActionToChat(space, sc) {
    var sinceTs = Store.getSyncTs(space.id, sc.charId);
    var dmMount = null;
    (sc.memoryMounts || []).forEach(function (m) { if (m.enabled && !m.isGroup) dmMount = m; });
    if (!dmMount) return Promise.resolve({ ok: false, reason: '该 char 未挂载单聊会话' });
    var summary = buildActionSummary(space, sc, sinceTs);
    var convId = dmMount.conversationId;
    return openRocheDb().then(function (db) {
      var now = Date.now();
      var msg = { id: now + Math.floor(Math.random() * 1000), isMe: false, text: summary, senderId: sc.charId, timestamp: now, senderName: sc.charName, conversationId: convId };
      if (convId.slice(-8) === '_offline') msg.isStreaming = false;
      return addMsgRecord(db, 'messages', msg).then(function () { db.close(); sc.lastSyncAt = now; Store.setSyncTs(space.id, sc.charId, now); Store.saveSpaces(); return { ok: true }; });
    }).catch(function (e) { return { ok: false, reason: (e && e.message) || 'DB 错误' }; });
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
          if (!sc.enabled) return;
          if (!sc.nextPostAt) { sc.nextPostAt = now + randomInterval(sc.postIntervalMin || 30); tasks.push(function () { return Store.saveSpaces(); }); }
          else if (now >= sc.nextPostAt) {
            sc.nextPostAt = now + randomInterval(sc.postIntervalMin || 30);
            tasks.push(function () {
              return Store.saveSpaces().then(function () {
                return generateCharPost(space, sc).then(function (post) {
                  return generateAutoComments(space, post, sc.autoCommentCount || DEFAULT_AUTO_COMMENT).then(function () { if (root) render(); });
                }).catch(function (e) { console.warn('[Moments] 后台生成失败', e); });
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
  function render() {
    if (!root) return;
    if (state.bootLoading) {
      root.innerHTML = '<div class="' + ROOT_CLASS + '"><div class="moments-boot"><div class="moments-spin">' + WINDMILL_SVG + '</div><div class="moments-boot-text">加载中...</div></div></div>';
      return;
    }
    var space = Store.getActiveSpace();
    var html = '<div class="' + ROOT_CLASS + '">';
    html += renderTopbar(space);
    html += renderCover(space);
    html += renderFeed(space);
    // 浮层
    if (state.sidebarOpen) html += renderSidebar(space);
    if (state.postModalOpen) html += renderPostModal(space);
    if (state.notifPanelOpen) html += renderNotifPanel(space);
    if (state.subjectSheetOpen) html += renderSubjectSheet(space);
    if (state.memMountCharId) html += renderMemMountModal(space, state.memMountCharId);
    if (state.subApiPanelOpen) html += renderSubApiPanel();
    if (state.charListOpen) html += renderCharListModal(space);
    if (state.commentTarget) html += renderCommentInput();
    html += '</div>';
    root.innerHTML = html;
    if (state.postModalOpen) setupPostModalTools();
  }

  // 顶栏：黑底白字微信风格
  function renderTopbar(space) {
    var unread = 0; state.notifs.forEach(function (n) { if (!n.read) unread++; });
    return '<div class="moments-topbar">' +
      '<div class="moments-tb-left" data-action="back">' + ICON.back + '</div>' +
      '<div class="moments-tb-title">朋友圈</div>' +
      '<div class="moments-tb-right">' +
        '<span class="moments-tb-icon" data-action="open-post-modal">' + ICON.camera + '</span>' +
        '<span class="moments-tb-icon moments-tb-bell' + (unread ? ' has-dot' : '') + '" data-action="open-notif">' + ICON.bell + (unread ? '<i class="moments-dot"></i>' : '') + '</span>' +
      '</div></div>';
  }

  // 封面：wrapper 布局，avatar 伸出不被裁
  function renderCover(space) {
    if (!space) return '<div class="moments-empty">还没有朋友圈空间，请打开左侧栏选择或创建。</div>';
    var subj = getCurrentSubject();
    var cover = space.cover || '';
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
    h += '<span class="moment-acts" data-action="open-acts" data-id="' + p.id + '">' + ICON.more + '</span></div>';
    h += renderInteractions(p, space);
    h += '</div>';
    return h;
  }

  function renderInteractions(p, space) {
    var hasLike = p.likes && p.likes.length;
    var hasComment = p.comments && p.comments.length;
    if (!hasLike && !hasComment) return '<div class="moment-act-pop" data-id="' + p.id + '"></div>';
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
        h += '<span class="mc-c">：' + escapeHtml(c.text) + '</span></div>';
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
        html += '<div class="moments-sb-info"><div class="moments-sb-name">' + escapeHtml(sc.charHandle || sc.charName) + '</div><div class="moments-sb-sub">' + (sc.enabled ? '已开启' : '已关闭') + ' · ' + (sc.postIntervalMin || 30) + '分钟</div></div></div>';
        html += '<div class="moments-sb-btns">';
        html += '<span class="mm-btn" data-action="char-post-now" data-cid="' + escapeHtml(sc.charId) + '">发一条</span>';
        html += '<span class="mm-btn" data-action="open-mem-mount" data-cid="' + escapeHtml(sc.charId) + '">记忆</span>';
        html += '<span class="mm-btn" data-action="sync-trace" data-cid="' + escapeHtml(sc.charId) + '">同步</span>';
        html += '<span class="mm-btn danger" data-action="unbind-char" data-cid="' + escapeHtml(sc.charId) + '">解绑</span>';
        html += '</div></div>';
      });
      html += '<div class="moments-sb-item" data-action="open-char-list"><div class="moments-avatar sm add-av">' + ICON.plus + '</div><div class="moments-sb-info"><div class="moments-sb-name">绑定 char</div></div></div>';
      html += '</div>';
    }
    html += '<div class="moments-sb-sec"><div class="moments-sb-label">设置</div>';
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
    html += '<div class="moments-row"><div class="moments-row-label">开启朋友圈功能</div><div class="moments-sw' + (sc.enabled ? ' on' : '') + '" data-action="toggle-enabled" data-cid="' + escapeHtml(charId) + '"><i></i></div></div>';
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

  function renderPostModal(space) {
    var subj = getCurrentSubject(); if (!subj) return '';
    return '<div class="moments-modal-mask" data-action="close-post-modal"><div class="moments-modal" data-stop="1"><div class="moments-modal-hd"><div class="moments-modal-title">发表</div><div class="moments-modal-x" data-action="close-post-modal">' + ICON.close + '</div></div><div class="moments-modal-bd">' +
      '<div class="moments-post-as">以 <b>' + escapeHtml(subj.name) + '</b> 发布</div>' +
      '<textarea class="moments-post-text" id="moments-post-text" placeholder="这一刻的想法..."></textarea>' +
      '<div class="moments-post-imgs" id="moments-post-imgs"></div>' +
      '<div class="moments-post-tools"><span class="mp-tool" data-tool="text">' + ICON.image + '<span>文字图</span></span><span class="mp-tool" data-tool="url">' + ICON.image + '<span>图片URL</span></span><label class="mp-tool" data-tool="file">' + ICON.image + '<span>本地图片</span><input type="file" accept="image/*" id="moments-post-file" style="display:none"></label></div>' +
      '<div class="moments-btn-row"><button class="moments-btn" data-action="publish-post">发表</button></div></div></div></div>';
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
      if (!sc.enabled) return;
      html += '<div class="moments-sheet-item' + (state.currentSubject === sc.charId ? ' active' : '') + '" data-action="set-subject" data-sub="' + escapeHtml(sc.charId) + '"><div class="moments-avatar sm">' + (sc.charAvatar ? '<img src="' + escapeHtml(sc.charAvatar) + '">' : '<div class="moments-avatar-fb">' + escapeHtml((sc.charName || '?').slice(0, 1)) + '</div>') + '</div><div class="moments-sheet-info"><div class="moments-sheet-name">' + escapeHtml(sc.charHandle || sc.charName) + '</div><div class="moments-sheet-sub">char 视角（只看 ta 的）</div></div></div>';
    });
    return html + '</div></div>';
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

  // ========== 事件 ==========
  function bindEvents() {
    if (!root) return;
    root.addEventListener('click', onRootClick);
    root.addEventListener('change', onRootChange);
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
  function onRootClick(e) {
    var t = e.target;
    // 文字图点击：直接 toggle class，不 render
    var textToggle = closestEl(t, 'data-action', 'toggle-text');
    if (textToggle) { textToggle.classList.toggle('revealed'); return; }
    var act = closestEl(t, 'data-action');
    if (!act) return;
    var action = act.getAttribute('data-action');
    handleAction(action, t, e);
  }
  function onRootChange(e) {
    var t = e.target; var field = t.getAttribute && t.getAttribute('data-field'); if (!field) return;
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
      case 'open-notif': state.notifPanelOpen = true; Store.markAllNotifRead(); render(); break;
      case 'close-notif': state.notifPanelOpen = false; render(); break;
      case 'clear-notifs': Store.clearNotifs().then(render); break;
      case 'open-subject': state.subjectSheetOpen = true; render(); break;
      case 'close-subject': state.subjectSheetOpen = false; render(); break;
      case 'set-subject': state.currentSubject = did(t, 'data-sub'); state.subjectSheetOpen = false; render(); break;
      case 'open-post-modal': pendingImages = []; state.postModalOpen = true; render(); break;
      case 'close-post-modal': state.postModalOpen = false; pendingImages = []; render(); break;
      case 'open-subapi': state.subApiPanelOpen = true; render(); break;
      case 'close-subapi': state.subApiPanelOpen = false; render(); break;
      case 'open-char-list': state.charListOpen = true; render(); break;
      case 'close-char-list': state.charListOpen = false; render(); break;
      case 'close-mem-mount': state.memMountCharId = null; render(); break;

      case 'switch-space': {
        var pid = did(t, 'data-pid'); var per = null;
        for (var i = 0; i < state.allPersonas.length; i++) if (state.allPersonas[i].id === pid) { per = state.allPersonas[i]; break; }
        if (per) { var sp = ensureSpaceForPersona(per); state.activeSpaceId = sp.id; state.currentSubject = 'user'; state.sidebarOpen = false; Store.saveActive().then(render); }
        break;
      }
      case 'view-char': { var cid = did(t, 'data-cid'); if (space && getSpaceChar(space, cid)) { state.currentSubject = cid; state.sidebarOpen = false; render(); } break; }
      case 'bind-char': { var cid2 = did(t, 'data-cid'); if (space) { bindCharToSpace(space, cid2); state.charListOpen = false; render(); } break; }
      case 'unbind-char': { var cid3 = did(t, 'data-cid'); confirmBox({ message: '确定解绑该 char？历史朋友圈保留。' }).then(function (ok) { if (ok && space) { unbindCharFromSpace(space, cid3); render(); } }); break; }
      case 'open-mem-mount': { var cid4 = did(t, 'data-cid'); state.memMountCharId = cid4; state.sidebarOpen = false; render(); loadConversationsForChar(cid4); break; }
      case 'toggle-enabled': { var cid5 = did(t, 'data-cid'); if (space) { var sc5 = getSpaceChar(space, cid5); if (sc5) { sc5.enabled = !sc5.enabled; Store.saveSpaces().then(render); } } break; }
      case 'toggle-mount': {
        var cid6 = did(t, 'data-cid'); var convId = did(t, 'data-conv');
        if (space) { var sc6 = getSpaceChar(space, cid6); if (sc6) { var m6 = findMount(sc6, convId); if (m6) m6.enabled = !m6.enabled; else { var co = null; (sc6._convCache || []).forEach(function (c) { if (c.id === convId) co = c; }); sc6.memoryMounts.push({ conversationId: convId, convName: co ? co.name : '', isGroup: co ? !!co.isGroup : false, enabled: true, shortLimit: 50, factLimit: 0, coreEnabled: false }); } Store.saveSpaces().then(render); } }
        break;
      }
      case 'char-post-now': {
        var cid7 = did(t, 'data-cid'); if (!space) break; var sc7 = getSpaceChar(space, cid7); if (!sc7) break;
        setTip((sc7.charHandle || sc7.charName) + ' 正在发朋友圈...');
        generateCharPost(space, sc7).then(function (post) { return generateAutoComments(space, post, sc7.autoCommentCount || DEFAULT_AUTO_COMMENT); }).then(function () { setTip(null); toast('已发布'); }).catch(function (err) { setTip(null); toast('发布失败：' + (err && err.message || '')); });
        break;
      }
      case 'sync-trace':
      case 'sync-fact-now': {
        var cid8 = did(t, 'data-cid'); if (!space) break; var sc8 = getSpaceChar(space, cid8); if (!sc8) break;
        setTip('AI 总结并写入事实记忆中...');
        syncCharToFactMemory(space, sc8).then(function (r) { setTip(null); toast(r.ok ? '已同步到事实记忆' : '同步失败：' + r.reason); });
        break;
      }
      case 'set-cover': { if (!space) break; var url = window.prompt('输入封面图 URL（留空清除）：', space.cover || ''); if (url !== null) { space.cover = trim(url); Store.saveSpaces().then(render); } break; }
      case 'like': { var pid1 = did(t, 'data-id'); var subj1 = getCurrentSubject(); if (subj1) Store.toggleLike(pid1, { id: subj1.id, name: subj1.name }).then(render); break; }
      case 'comment-post': { var pid2 = did(t, 'data-id'); state.commentTarget = { postId: pid2, replyTo: null, replyToName: null }; render(); var inp = $('#moments-cm-text', root); if (inp) inp.focus(); break; }
      case 'reply-comment': { var pid3 = did(t, 'data-id'); var cmId = did(t, 'data-cid'); var post3 = null; for (var j = 0; j < state.posts.length; j++) if (state.posts[j].id === pid3) { post3 = state.posts[j]; break; } var cm = null; if (post3 && post3.comments) for (var k = 0; k < post3.comments.length; k++) if (post3.comments[k].id === cmId) { cm = post3.comments[k]; break; } if (cm) { state.commentTarget = { postId: pid3, replyTo: cm.id, replyToName: cm.authorHandle || cm.authorName }; render(); var inp2 = $('#moments-cm-text', root); if (inp2) inp2.focus(); } break; }
      case 'send-comment': {
        var inp3 = $('#moments-cm-text', root); if (!inp3) break; var text = trim(inp3.value); if (!text || !state.commentTarget) break;
        var subj2 = getCurrentSubject(); if (!subj2) break; var ct = state.commentTarget;
        var comment = { id: uuid(), postId: ct.postId, authorType: subj2.type, authorId: subj2.id, authorName: subj2.realName || subj2.name, authorHandle: subj2.name, text: text, replyTo: ct.replyTo, replyToName: ct.replyToName, createdAt: Date.now() };
        Store.addComment(ct.postId, comment).then(function () { state.commentTarget = null; render(); });
        break;
      }
      case 'open-acts': {
        var pid5 = did(t, 'data-id');
        // 弹出点赞/评论气泡
        var pop = $('.moment-act-pop[data-id="' + pid5 + '"]', root);
        if (pop) { pop.classList.toggle('open'); pop.innerHTML = '<div class="moment-act-pop-i" data-action="like" data-id="' + pid5 + '">' + ICON.like + '赞</div><div class="moment-act-pop-i" data-action="comment-post" data-id="' + pid5 + '">' + ICON.comment + '评论</div>'; }
        break;
      }
      case 'view-photo': { /* URL/本地图直接显示，无需操作 */ break; }
      case 'moment-more': {
        var pid6 = did(t, 'data-id'); var post6 = null; for (var y = 0; y < state.posts.length; y++) if (state.posts[y].id === pid6) { post6 = state.posts[y]; break; } if (!post6) break;
        var subj3 = getCurrentSubject(); var canDelete = (subj3 && post6.authorId === subj3.id) || post6.authorType === 'char';
        var choice = window.prompt((canDelete ? '删除\n' : '') + '让 char 评论');
        if (choice === '删除' && canDelete) { confirmBox({ message: '删除这条朋友圈？' }).then(function (ok) { if (ok) Store.deletePost(pid6).then(render); }); }
        else if (choice === '让 char 评论') { if (!space) break; var count = parseInt(window.prompt('让几个 char 评论？(1-8)', String(DEFAULT_AUTO_COMMENT)), 10) || DEFAULT_AUTO_COMMENT; setTip('生成评论中...'); generateAutoComments(space, post6, Math.min(Math.max(count, 1), MAX_AUTO_COMMENT)).then(function () { setTip(null); toast('评论已生成'); }).catch(function () { setTip(null); }); }
        break;
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
        Store.addPost(post7).then(function () { state.postModalOpen = false; pendingImages = []; render(); if (subj4.type === 'user') { setTip('char 正在评论...'); generateAutoComments(space, post7, DEFAULT_AUTO_COMMENT).then(function () { setTip(null); }).catch(function () { setTip(null); }); } });
        break;
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
// 顶栏 黑底白字
+ '.' + ROOT_CLASS + ' .moments-topbar{position:absolute;top:0;left:0;right:0;z-index:20;height:44px;display:flex;align-items:center;background:#1F1F1F;color:#fff;padding:0 8px;}'
+ '.' + ROOT_CLASS + ' .moments-tb-left{width:40px;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moments-tb-title{flex:1;text-align:center;font-size:17px;font-weight:500;}'
+ '.' + ROOT_CLASS + ' .moments-tb-right{display:flex;align-items:center;gap:2px;}'
+ '.' + ROOT_CLASS + ' .moments-tb-icon{width:40px;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;}'
+ '.' + ROOT_CLASS + ' .moments-dot{position:absolute;top:7px;right:8px;width:8px;height:8px;background:#FA5151;border-radius:50%;border:1.5px solid #1F1F1F;}'
// 封面
+ '.' + ROOT_CLASS + ' .moments-cover-wrap{position:relative;width:100%;height:270px;background:#333;margin-top:44px;}'
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
+ '.' + ROOT_CLASS + ' .moments-feed{padding:50px 0 30px 0;background:#EDEDED;min-height:calc(100% - 314px);}'
+ '.' + ROOT_CLASS + ' .moment{background:#fff;padding:14px 16px;border-bottom:1px solid #f0f0f0;}'
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
+ '.' + ROOT_CLASS + ' .moment-ft{display:flex;align-items:center;justify-content:space-between;margin-top:8px;}'
+ '.' + ROOT_CLASS + ' .moment-time{font-size:12px;color:#99a0a8;}'
+ '.' + ROOT_CLASS + ' .moment-acts{display:flex;align-items:center;padding:4px 6px;color:#576B95;background:#f7f7f7;border-radius:4px;cursor:pointer;}'
// 操作气泡
+ '.' + ROOT_CLASS + ' .moment-act-pop{position:relative;}'
+ '.' + ROOT_CLASS + ' .moment-act-pop.open{position:absolute;right:30px;top:-6px;background:#4c4c4c;border-radius:6px;display:flex;z-index:5;}'
+ '.' + ROOT_CLASS + ' .moment-act-pop.open::after{content:"";position:absolute;right:-6px;top:10px;border:6px solid transparent;border-left-color:#4c4c4c;}'
+ '.' + ROOT_CLASS + ' .moment-act-pop-i{display:flex;align-items:center;gap:4px;color:#fff;font-size:13px;padding:8px 14px;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .moment-act-pop-i:not(:last-child){border-right:1px solid rgba(255,255,255,0.2);}'
// 互动区
+ '.' + ROOT_CLASS + ' .moment-int{background:#f7f7f7;border-radius:4px;padding:6px 10px;margin-top:6px;position:relative;}'
+ '.' + ROOT_CLASS + ' .moment-likes{display:flex;align-items:flex-start;gap:5px;color:#576B95;font-size:13px;padding:3px 0;border-bottom:1px solid #eee;}'
+ '.' + ROOT_CLASS + ' .moment-likes svg{flex-shrink:0;margin-top:2px;}'
+ '.' + ROOT_CLASS + ' .moment-comments{padding-top:3px;}'
+ '.' + ROOT_CLASS + ' .moment-comments .mc{font-size:13px;line-height:1.7;color:#353535;cursor:pointer;}'
+ '.' + ROOT_CLASS + ' .mc-n{color:#576B95;font-weight:600;}'
+ '.' + ROOT_CLASS + ' .mc-r{color:#999;}'
+ '.' + ROOT_CLASS + ' .mc-c{color:#353535;}'
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
+ '.' + ROOT_CLASS + ' .moments-sidebar{position:absolute;top:0;left:0;bottom:0;width:280px;background:#fff;transform:translateX(-100%);transition:transform 0.25s;z-index:51;overflow-y:auto;box-shadow:2px 0 12px rgba(0,0,0,0.15);}'
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
+ '.' + ROOT_CLASS + ' .moments-modal-bd{padding:16px;overflow-y:auto;flex:1;}'
+ '.' + ROOT_CLASS + ' .moments-div{height:1px;background:#f0f0f0;margin:12px 0;}'
+ '.' + ROOT_CLASS + ' .moments-sec-title{font-size:14px;font-weight:600;margin-bottom:8px;}'
+ '.' + ROOT_CLASS + ' .moments-sec-hint{font-size:11px;color:#999;font-weight:400;margin-left:6px;}'
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
+ '.' + ROOT_CLASS + ' .moments-sheet{background:#fff;border-radius:12px 12px 0 0;width:100%;max-width:420px;max-height:70vh;overflow-y:auto;align-self:flex-end;}'
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
+ '@keyframes mom-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}';

  // ========== 插件注册 ==========
  window.RochePlugin = window.RochePlugin || {};
  window.RochePlugin.register = window.RochePlugin.register || function () {};
  window.RochePlugin.register({
    id: PLUGIN_ID,
    name: '朋友圈',
    version: '0.3.0',
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
              if (sc.enabled) await injectCharActionToChat(sp, sc);
            }
          }
        } catch (e) { console.warn('[Moments] auto sync failed', e); }
        if (root) {
          root.removeEventListener('click', onRootClick);
          root.removeEventListener('change', onRootChange);
        }
        pendingImages = [];
        if (container) container.replaceChildren();
        root = null;
      }
    }]
  });

  startBgTimer();
})();
