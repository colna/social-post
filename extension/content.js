// social-post · Facebook 采集 content script
// 采集/解析逻辑与 crawler 的 parsers/facebook.py、旧 Tampermonkey 脚本一致。
// 差异:配置走 chrome.storage.local;跨域 POST 交给 background service worker。
(function () {
  'use strict';

  const DEFAULTS = {
    sp_server: 'http://localhost:3001/api',
    sp_token: 'change-me-ingest-token',
  };
  const cfg = {
    pageSize: 8, // 单次 GraphQL count
    maxPages: 25, // 翻页上限(FB 可能翻不了几页就限流)
    pageDelayMs: 1200, // 每页间隔,拟人节流,降低触发风控
    readyTries: 12, // 页面就绪重试次数(每次 1.5s)
    hopDelayMs: 3000, // 采集完一个到跳下一个的间隔
  };
  function getConfig() {
    return new Promise((resolve) =>
      chrome.storage.local.get(DEFAULTS, (c) => resolve(c)),
    );
  }
  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  // ── 递归工具(与 parsers/facebook.py 同逻辑)──
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
      .filter(
        (m) => m && typeof m === 'object' && typeof m.text === 'string' && m.text,
      )
      .map((m) => m.text);
    if (!texts.length) return null;
    return texts.reduce((a, b) => (b.length > a.length ? b : a));
  }
  function pickType(node) {
    const tn = new Set(
      findAll(node, '__typename').filter((t) => typeof t === 'string'),
    );
    if ([...tn].some((t) => t.includes('Album'))) return 'carousel';
    if (
      findAll(node, 'is_playable').some(Boolean) ||
      findAll(node, 'playable_url').length
    )
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

  // ── 同源 GraphQL 请求(content script 与页面同源,浏览器自动带 httpOnly cookie)──
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

  function currentHandle() {
    const seg = location.pathname.split('/').filter(Boolean);
    if (!seg.length) return null;
    const first = seg[0];
    const skip = new Set([
      'profile.php', 'watch', 'marketplace', 'groups', 'events', 'gaming',
      'pages', 'photo', 'story.php', 'reel', 'reels', 'messages',
      'notifications', 'settings', 'friends', 'bookmarks', 'search', 'help',
      'policies', 'me',
    ]);
    if (skip.has(first)) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(first)) return null;
    return first;
  }

  // ── POST 给 server:交给 background service worker(跨域)──
  function postToServer(server, token, payload) {
    return new Promise((resolve) =>
      chrome.runtime.sendMessage(
        { type: 'ingest', server: server, token: token, payload: payload },
        (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, status: 0, text: chrome.runtime.lastError.message });
          } else {
            resolve(res || { ok: false, status: 0, text: '无响应' });
          }
        },
      ),
    );
  }

  // ── 等待页面就绪:FB SPA 首屏可能还没塞入 timeline 上下文,重试抠 ──
  async function waitContext(maxTries) {
    for (let i = 0; i < (maxTries || 12); i++) {
      const html = document.documentElement.outerHTML;
      const ctx = extractContext(html);
      if (ctx.fb_dtsg && ctx.doc_id && ctx.user_id) return { ctx, html };
      await sleep(1500);
    }
    return null;
  }

  // ── 采集当前页并上报,返回结果对象(不 alert,供手动/批量共用)──
  async function collectAndReport(setStatus) {
    const handle = currentHandle();
    if (!handle) {
      return { ok: false, error: '当前页面不是可识别的 FB 主页' };
    }
    const conf = await getConfig();
    setStatus('等待页面就绪…');
    const ready = await waitContext(cfg.readyTries);
    if (!ready) {
      return { ok: false, handle, error: '未能抠到 fb_dtsg/doc_id/userID(页面未就绪或需登录)' };
    }
    const { ctx, html } = ready;

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
        stopped = 'FB 限流(1357054),停止翻页';
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
      return { ok: false, handle, error: '没采集到帖子(被限流或无公开帖)' + (stopped ? ' · ' + stopped : '') };
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
    const r = await postToServer(conf.sp_server, conf.sp_token, payload);
    if (!r.ok) {
      return { ok: false, handle, error: '入库失败 ' + r.status + ':' + String(r.text).slice(0, 120) };
    }
    let res = {};
    try {
      res = JSON.parse(r.text);
    } catch (e) {}
    return {
      ok: true,
      handle,
      added: res.added != null ? res.added : null,
      total: res.total != null ? res.total : null,
      note: stopped || '',
    };
  }

  // ── 浮动面板 UI(手动按钮 + 状态,批量进度也走这里)──
  let _btn = null;
  let _status = null;
  function mountButton() {
    if (document.getElementById('sp-fb-collect')) return;
    if (!document.body) return;
    const box = document.createElement('div');
    box.id = 'sp-fb-collect';
    box.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;font:13px/1.4 -apple-system,system-ui,sans-serif;';
    const btn = document.createElement('button');
    btn.textContent = '采集本页';
    btn.style.cssText =
      'background:#1877f2;color:#fff;border:0;border-radius:8px;padding:10px 14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2);font-weight:600;';
    const status = document.createElement('div');
    status.style.cssText =
      'margin-top:8px;max-width:300px;background:#fff;color:#222;border-radius:8px;padding:8px 10px;box-shadow:0 2px 8px rgba(0,0,0,.15);display:none;white-space:pre-wrap;';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = await collectAndReport((t) => setStatus(t));
        if (r.ok) {
          setStatus('✅ @' + r.handle + ' 新增 ' + r.added + ',共 ' + r.total + (r.note ? ' · ' + r.note : ''));
        } else {
          setStatus('❌ ' + (r.handle ? '@' + r.handle + ' ' : '') + r.error);
        }
      } catch (e) {
        setStatus('❌ 异常:' + e);
      } finally {
        setTimeout(() => (btn.disabled = false), 1500);
      }
    });
    box.appendChild(btn);
    box.appendChild(status);
    document.body.appendChild(box);
    _btn = btn;
    _status = status;
  }
  function setStatus(text) {
    if (_status) {
      _status.style.display = 'block';
      _status.textContent = text;
    }
  }

  // ── 批量驱动:队列存 chrome.storage.local,跨页面导航存活 ──
  // batch = { running, items:[{handle,url}], index, results:[{handle,ok,added,total,error}] }
  let _batchRan = false; // 每次页面加载只跑一次
  async function batchTick() {
    const { batch } = await storageGet(['batch']);
    if (!batch || !batch.running) return;
    if (_batchRan) return;
    _batchRan = true;

    const cur = batch.items[batch.index];
    if (!cur) {
      await finishBatch(batch);
      return;
    }
    const prog = '批量 ' + (batch.index + 1) + '/' + batch.items.length;

    // 不在预期页面(首跳/被重定向)→ 导航到预期 handle,交给下次加载
    if (currentHandle() !== cur.handle) {
      setStatus(prog + ':跳转到 @' + cur.handle + ' …');
      location.assign(cur.url);
      return;
    }

    setStatus(prog + ':采集 @' + cur.handle + ' …');
    let r;
    try {
      r = await collectAndReport((t) => setStatus(prog + ' @' + cur.handle + ':' + t));
    } catch (e) {
      r = { ok: false, handle: cur.handle, error: '异常:' + e };
    }
    batch.results.push({
      handle: cur.handle,
      ok: r.ok,
      added: r.added != null ? r.added : null,
      total: r.total != null ? r.total : null,
      error: r.error || '',
    });
    batch.index += 1;
    await storageSet({ batch });

    if (batch.index >= batch.items.length) {
      await finishBatch(batch);
      return;
    }
    const next = batch.items[batch.index];
    const tip = r.ok
      ? '✅ @' + cur.handle + ' 新增 ' + r.added
      : '⚠️ @' + cur.handle + ' ' + r.error;
    setStatus(prog + ' 完成 · ' + tip + '\n' + cfg.hopDelayMs / 1000 + 's 后跳 @' + next.handle + ' …');
    await sleep(cfg.hopDelayMs);
    location.assign(next.url);
  }

  async function finishBatch(batch) {
    batch.running = false;
    await storageSet({ batch });
    const ok = batch.results.filter((x) => x.ok).length;
    const fail = batch.results.length - ok;
    let summary = '🎉 批量采集完成:成功 ' + ok + ' / 失败 ' + fail + '\n';
    summary += batch.results
      .map((x) =>
        (x.ok ? '✅ @' + x.handle + ' +' + x.added : '❌ @' + x.handle + ' ' + x.error),
      )
      .join('\n');
    setStatus(summary);
  }

  // 允许 popup 通过消息即时启动批量(popup 已把 batch 存进 storage 并导航本 tab)
  chrome.runtime.onMessage.addListener((msg) => {
    // 仅当本页加载时的 batchTick 尚未触发(如同 URL 未 reload)才补一枪,避免并发双跑
    if (msg && msg.type === 'batch-start' && !_batchRan) {
      batchTick();
    }
  });

  mountButton();
  // FB 是 SPA,路由变化后按钮可能被卸载,定时补挂
  setInterval(mountButton, 3000);
  // 页面加载即检查是否处于批量流程中
  batchTick();
})();
