// ==UserScript==
// @name         social-post · Facebook 采集
// @namespace    social-post
// @version      1.0.0
// @description  在已登录的 facebook.com 主页一键采集帖子,直接 POST 给 social-post server 入库。走真实浏览器会话,规避 FB 对服务器侧自动化 GraphQL 的软封。
// @author       colna
// @match        https://www.facebook.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      localhost
// @connect      *
// ==/UserScript==

/* eslint-disable */
(function () {
  'use strict';

  // ── 配置(可用油猴菜单命令随时改,存 GM 存储)──
  const cfg = {
    get server() {
      return GM_getValue('sp_server', 'http://localhost:3001/api');
    },
    get token() {
      return GM_getValue('sp_token', 'change-me-ingest-token');
    },
    pageSize: 8, // 单次 GraphQL count
    maxPages: 25, // 翻页上限(FB 可能翻不了几页就限流)
    pageDelayMs: 1200, // 每页间隔,拟人节流,降低触发风控
  };
  GM_registerMenuCommand('设置 server API 基址', () => {
    const v = prompt('social-post server API 基址', cfg.server);
    if (v) GM_setValue('sp_server', v.trim());
  });
  GM_registerMenuCommand('设置 ingest token', () => {
    const v = prompt('ingest token(与 server INGEST_TOKEN 一致)', cfg.token);
    if (v) GM_setValue('sp_token', v.trim());
  });

  // ── 递归工具(与 crawler 的 parsers/facebook.py 同逻辑)──
  function findAll(obj, key, out) {
    out = out || [];
    if (Array.isArray(obj)) {
      for (const v of obj) findAll(v, key, out);
    } else if (obj && typeof obj === 'object') {
      for (const k in obj) {
        if (k === key) out.push(obj[k]);
        findAll(obj[k], key, out);
      }
    }
    return out;
  }
  function walkStories(obj, nodes, seen) {
    if (Array.isArray(obj)) {
      for (const v of obj) walkStories(v, nodes, seen);
    } else if (obj && typeof obj === 'object') {
      if (obj.__typename === 'Story' && obj.post_id) {
        const p = String(obj.post_id);
        if (!seen.has(p)) {
          seen.add(p);
          nodes.push(obj);
        }
      }
      for (const k in obj) walkStories(obj[k], nodes, seen);
    }
  }
  function intCounts(vals) {
    const out = [];
    for (const v of vals) {
      if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
      else if (v && typeof v === 'object' && typeof v.count === 'number')
        out.push(v.count);
      else if (typeof v === 'string') {
        const n = parseInt(v.replace(/,/g, ''), 10);
        if (!isNaN(n)) out.push(n);
      }
    }
    return out;
  }
  function pickCaption(node) {
    const texts = findAll(node, 'message')
      .filter((m) => m && typeof m === 'object' && typeof m.text === 'string' && m.text)
      .map((m) => m.text);
    if (!texts.length) return null;
    return texts.reduce((a, b) => (b.length > a.length ? b : a));
  }
  function pickType(node) {
    const tn = new Set(findAll(node, '__typename').filter((t) => typeof t === 'string'));
    if ([...tn].some((t) => t.includes('Album'))) return 'carousel';
    if (findAll(node, 'is_playable').some(Boolean) || findAll(node, 'playable_url').length)
      return 'video';
    if (tn.has('Video')) return 'video';
    return 'image';
  }
  function pickCover(node) {
    const scope = node.attachments != null ? node.attachments : node;
    for (const u of findAll(scope, 'uri')) {
      if (typeof u === 'string' && u.indexOf('fbcdn') >= 0) return u;
    }
    return '';
  }
  function pickCommentCount(node) {
    const c = intCounts(findAll(node, 'total_comment_count'));
    if (c.length) return Math.max.apply(null, c);
    for (const cm of findAll(node, 'comments')) {
      if (cm && typeof cm === 'object') {
        const n = cm.total_count != null ? cm.total_count : cm.count;
        if (typeof n === 'number') return n;
      }
    }
    return null;
  }
  function pickShareCount(node) {
    let c = intCounts(findAll(node, 'share_count'));
    if (c.length) return Math.max.apply(null, c);
    c = intCounts(findAll(node, 'reshare_count'));
    if (c.length) return Math.max.apply(null, c);
    return null;
  }
  function parseNode(node) {
    const pid = String(node.post_id || '');
    const reactions = intCounts(findAll(node, 'reaction_count'));
    return {
      shortcode: pid,
      url: node.permalink_url || 'https://www.facebook.com/' + pid,
      type: pickType(node),
      coverUrl: pickCover(node),
      caption: pickCaption(node),
      likeCount: reactions.length ? Math.max.apply(null, reactions) : null,
      commentCount: pickCommentCount(node),
      shareCount: pickShareCount(node),
      takenAt: typeof node.creation_time === 'number' ? node.creation_time : null,
    };
  }
  function parseTimeline(raw) {
    const nodes = [];
    const seen = new Set();
    let cursor = null;
    let hasNext = false;
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let d;
      try {
        d = JSON.parse(t);
      } catch (e) {
        continue;
      }
      walkStories(d, nodes, seen);
      for (const pi of findAll(d, 'page_info')) {
        if (pi && typeof pi === 'object') {
          if (pi.end_cursor) cursor = pi.end_cursor;
          if (pi.has_next_page) hasNext = true;
        }
      }
    }
    return { posts: nodes.map(parseNode), cursor: cursor, hasNext: hasNext };
  }

  // ── 从当前页面 HTML 抠 token / doc_id / variables ──
  function extractContext(html) {
    function g(re) {
      const m = html.match(re);
      return m ? m[1] : null;
    }
    const ctx = {
      fb_dtsg: g(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/),
      lsd: g(/"LSD",\[\],\{"token":"([^"]+)"/),
      rev: g(/"__spin_r":(\d+)/) || g(/"client_revision":(\d+)/),
      spin_t: g(/"__spin_t":(\d+)/),
      spin_b: g(/"__spin_b":"([^"]+)"/),
      hs: g(/"haste_session":"([^"]+)"/),
      hsi: g(/"hsi":"(\d+)"/),
      doc_id: null,
      user_id: null,
      variables: {},
      name: null,
    };
    const i = html.indexOf(
      '"preloaderID":"adp_ProfileCometTimelineFeedQueryRelayPreloader',
    );
    if (i >= 0) {
      const seg = html.slice(i - 300, i + 4000);
      const qid = seg.match(/"queryID":"(\d+)"/);
      ctx.doc_id = qid ? qid[1] : '27002668536074808';
      const vs = seg.indexOf('"variables":');
      if (vs >= 0) {
        const start = vs + '"variables":'.length;
        let depth = 0,
          end = -1;
        for (let j = start; j < seg.length; j++) {
          const c = seg[j];
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) {
              end = j + 1;
              break;
            }
          }
        }
        if (end > 0) {
          try {
            ctx.variables = JSON.parse(seg.slice(start, end));
          } catch (e) {}
        }
      }
    }
    ctx.user_id = ctx.variables.userID ? String(ctx.variables.userID) : null;
    if (ctx.user_id) {
      const nm = html.match(
        new RegExp(
          '"__typename":"(?:User|Page)","id":"' +
            ctx.user_id +
            '"[^}]*?"name":"([^"]+)"',
        ),
      );
      if (nm) {
        try {
          ctx.name = JSON.parse('"' + nm[1] + '"');
        } catch (e) {
          ctx.name = nm[1];
        }
      }
    }
    return ctx;
  }

  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function jazoest(t) {
    let s = 0;
    for (let i = 0; i < t.length; i++) s += t.charCodeAt(i);
    return '2' + s;
  }

  // ── 同源 GraphQL 请求(带真实会话 cookie + 浏览器指纹)──
  async function gqlPage(ctx, count, cursorVal) {
    const variables = Object.assign({}, ctx.variables, { count: count });
    if (cursorVal) variables.cursor = cursorVal;
    const av = cookie('c_user');
    const body = new URLSearchParams({
      av: av,
      __user: av,
      __a: '1',
      __req: '1',
      __hs: ctx.hs || '',
      dpr: '1',
      __ccg: 'EXCELLENT',
      __rev: ctx.rev || '0',
      __s: 'a:b:c',
      __hsi: ctx.hsi || '',
      __comet_req: '15',
      fb_dtsg: ctx.fb_dtsg || '',
      jazoest: jazoest(ctx.fb_dtsg || ''),
      lsd: ctx.lsd || '',
      __spin_r: ctx.rev || '0',
      __spin_b: ctx.spin_b || 'trunk',
      __spin_t: ctx.spin_t || '0',
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'ProfileCometTimelineFeedQuery',
      variables: JSON.stringify(variables),
      server_timings: '1',
      doc_id: ctx.doc_id || '',
    });
    const resp = await fetch('/api/graphql/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-fb-friendly-name': 'ProfileCometTimelineFeedQuery',
        'x-fb-lsd': ctx.lsd || '',
      },
      body: body.toString(),
    });
    return await resp.text();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── 采集主流程 ──
  async function collect(setStatus) {
    const handle = currentHandle();
    if (!handle) {
      alert('当前页面不是可识别的 FB 主页(打开某个主页 /<handle>/ 再点采集)');
      return;
    }
    const html = document.documentElement.outerHTML;
    const ctx = extractContext(html);
    if (!ctx.fb_dtsg || !ctx.doc_id || !ctx.user_id) {
      alert('未能从页面抠到 fb_dtsg/doc_id/userID,刷新页面后重试');
      return;
    }

    const all = [];
    const seen = new Set();
    // 先收页面内嵌的初始帖(兜底)
    for (const p of embeddedPosts(html)) {
      if (!seen.has(p.shortcode)) {
        seen.add(p.shortcode);
        all.push(p);
      }
    }

    let cursor = null;
    let stopped = '';
    for (let page = 0; page < cfg.maxPages; page++) {
      setStatus('抓取第 ' + (page + 1) + ' 页…(已 ' + all.length + ' 帖)');
      let raw;
      try {
        raw = await gqlPage(ctx, cfg.pageSize, cursor);
      } catch (e) {
        stopped = '网络错误,停止:' + e;
        break;
      }
      if (raw.indexOf('"error":1357054') >= 0 || raw.indexOf('"errors"') === 0) {
        stopped = 'FB 限流(1357054),停止翻页,已采集 ' + all.length + ' 帖';
        break;
      }
      const { posts, cursor: next, hasNext } = parseTimeline(raw);
      let fresh = 0;
      for (const p of posts) {
        if (!seen.has(p.shortcode)) {
          seen.add(p.shortcode);
          all.push(p);
          fresh++;
        }
      }
      if (!posts.length || (!fresh && !hasNext)) break;
      if (!hasNext || !next) break;
      cursor = next;
      await sleep(cfg.pageDelayMs);
    }

    if (!all.length) {
      alert('没采集到帖子(可能被限流或该主页无公开帖)');
      return;
    }

    const payload = {
      handle: handle,
      account: {
        displayName: ctx.name || undefined,
        externalId: ctx.user_id,
        externalUrl: 'https://www.facebook.com/' + handle,
      },
      posts: all,
    };
    setStatus('入库中…(' + all.length + ' 帖)');
    postToServer(payload, setStatus, stopped);
  }

  function embeddedPosts(html) {
    const nodes = [];
    const seen = new Set();
    const re = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) {
      let d;
      try {
        d = JSON.parse(m[1]);
      } catch (e) {
        continue;
      }
      walkStories(d, nodes, seen);
    }
    return nodes.map(parseNode);
  }

  function postToServer(payload, setStatus, stoppedNote) {
    GM_xmlhttpRequest({
      method: 'POST',
      url: cfg.server.replace(/\/$/, '') + '/ingest/facebook',
      headers: {
        'content-type': 'application/json',
        'x-ingest-token': cfg.token,
      },
      data: JSON.stringify(payload),
      onload: (r) => {
        if (r.status >= 200 && r.status < 300) {
          let res = {};
          try {
            res = JSON.parse(r.responseText);
          } catch (e) {}
          setStatus(
            '✅ 入库成功:新增 ' +
              (res.added ?? '?') +
              ',共 ' +
              (res.total ?? '?') +
              (stoppedNote ? ' · ' + stoppedNote : ''),
            true,
          );
        } else {
          setStatus('❌ 入库失败 ' + r.status + ':' + r.responseText.slice(0, 120), true);
        }
      },
      onerror: (e) =>
        setStatus('❌ 请求失败(检查 server 地址 / @connect):' + JSON.stringify(e), true),
    });
  }

  function currentHandle() {
    const seg = location.pathname.split('/').filter(Boolean);
    if (!seg.length) return null;
    const first = seg[0];
    const skip = new Set([
      'profile.php', 'watch', 'marketplace', 'groups', 'events', 'gaming',
      'pages', 'photo', 'story.php', 'reel', 'reels', 'messages', 'notifications',
      'settings', 'friends', 'bookmarks', 'search', 'help', 'policies', 'me',
    ]);
    if (skip.has(first)) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(first)) return null;
    return first;
  }

  // ── 浮动按钮 UI ──
  function mountButton() {
    if (document.getElementById('sp-fb-collect')) return;
    const box = document.createElement('div');
    box.id = 'sp-fb-collect';
    box.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;font:13px/1.4 -apple-system,system-ui,sans-serif;';
    const btn = document.createElement('button');
    btn.textContent = '采集到 social-post';
    btn.style.cssText =
      'background:#1877f2;color:#fff;border:0;border-radius:8px;padding:10px 14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2);font-weight:600;';
    const status = document.createElement('div');
    status.style.cssText =
      'margin-top:8px;max-width:280px;background:#fff;color:#222;border-radius:8px;padding:8px 10px;box-shadow:0 2px 8px rgba(0,0,0,.15);display:none;';
    function setStatus(text, done) {
      status.style.display = 'block';
      status.textContent = text;
      if (done) btn.disabled = false;
    }
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await collect(setStatus);
      } catch (e) {
        setStatus('❌ 异常:' + e, true);
      } finally {
        setTimeout(() => (btn.disabled = false), 1500);
      }
    });
    box.appendChild(btn);
    box.appendChild(status);
    document.body.appendChild(box);
  }

  mountButton();
  // FB 是 SPA,路由变化后按钮可能被卸载,定时补挂
  setInterval(mountButton, 3000);
})();
