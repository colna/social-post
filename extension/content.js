// social-post · Facebook 采集 content script
// 采集/解析逻辑与 crawler 的 parsers/facebook.py、旧 Tampermonkey 脚本一致。
// 差异:配置走 chrome.storage.local;跨域 POST 交给 background service worker。
(function () {
  'use strict';

  const DEFAULTS = {
    sp_server: 'https://social-post-server.vercel.app/api',
    sp_token: 'change-me-ingest-token',
  };
  const cfg = {
    hopDelayMs: 3000, // 采集完一个到跳下一个的间隔
    maxScrolls: 150, // 滚动采集最大滚动轮数
    scrollWaitMs: 3000, // 每轮滚动后等待 FB 懒加载
    scrollStale: 6, // 连续 N 轮无新增则停止
    minScrolls: 6, // 至少滚这么多轮再允许因"无新增"停止(给 FB 反应时间)
    maxPosts: 0, // 单主页最多采多少帖,0=不限(由 maxScrolls/stale 兜底)
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

  // ── 外显日志(存 chrome.storage.local.sp_log,批量跳转不丢)──
  let _logEl = null;
  let _logBuf = [];
  let _saveTimer = null;
  function _renderLog() {
    if (_logEl) {
      _logEl.textContent = _logBuf.join('\n');
      _logEl.scrollTop = _logEl.scrollHeight;
    }
  }
  function logLine(msg) {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    _logBuf.push('[' + ts + '] ' + msg);
    if (_logBuf.length > 400) _logBuf = _logBuf.slice(-400);
    _renderLog();
    try {
      console.log('[social-post]', msg);
    } catch (e) {}
    // 防抖存储,供跨页面导航后续显
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => storageSet({ sp_log: _logBuf }), 400);
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

  // ── 滚动采集:劫持 FB 自己的 timeline 响应(inject.js MAIN world postMessage)──
  let _cap = new Map(); // shortcode → PostItem
  let _captureOn = false;
  let _scrollAbort = false;
  let _injectLoaded = false;
  let _gqlSeen = 0; // 见到的 /graphql 请求数
  let _capMsgs = 0; // 命中 timeline 的响应数

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d) return;
    if (d.source === 'sp-fb-hook') {
      if (d.kind === 'loaded') {
        _injectLoaded = true;
        logLine('✅ inject 已挂载(MAIN world),fetch/XHR 已 hook');
      } else if (d.kind === 'gql') {
        _gqlSeen++;
      }
      return;
    }
    if (d.source !== 'sp-fb-cap' || !_captureOn) return;
    _capMsgs++;
    try {
      const { posts } = parseTimeline(d.body);
      let fresh = 0;
      for (const p of posts) {
        if (p.shortcode && !_cap.has(p.shortcode)) {
          _cap.set(p.shortcode, p);
          fresh++;
        }
      }
      if (fresh) logLine('  捕获 +' + fresh + ',累计 ' + _cap.size);
    } catch (e) {}
  });

  function scrollStep() {
    // 滚到底触发懒加载;兼容 window / documentElement
    const h = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0,
    );
    window.scrollTo(0, h);
  }

  // 自动滚动 + 捕获 FB 自身 timeline 响应,拿全量帖并上报
  async function collectByScroll(setStatus) {
    const handle = currentHandle();
    if (!handle) {
      logLine('❌ 当前页面不是可识别的 FB 主页(' + location.pathname + ')');
      return { ok: false, error: '当前页面不是可识别的 FB 主页' };
    }
    logLine('▶ 滚动采集 @' + handle);
    const conf = await getConfig();
    // 滚动采集靠劫持 FB 自身请求,不需要 fb_dtsg/doc_id;账户信息尽力取,取不到不阻塞
    setStatus('读取页面信息…');
    let html = document.documentElement.outerHTML;
    let ctx = extractContext(html);
    if (!ctx.user_id) {
      // 首屏可能未就绪,轻等几轮(不强制三要素齐全)
      for (let i = 0; i < 6 && !ctx.user_id; i++) {
        await sleep(1200);
        html = document.documentElement.outerHTML;
        ctx = extractContext(html);
      }
    }
    const displayName =
      ctx.name || (document.title || '').replace(/\s*\|\s*Facebook.*$/i, '').trim() || null;
    logLine('账户信息:userID=' + (ctx.user_id || '?') + ' name=' + (displayName || '?'));

    _cap = new Map();
    _scrollAbort = false;
    _gqlSeen = 0;
    _capMsgs = 0;
    _captureOn = true;
    logLine('inject 挂载状态:' + (_injectLoaded ? '已挂载' : '⚠️ 尚未收到挂载信号'));
    // seed:页面内嵌的初始帖
    for (const p of embeddedPosts(html)) {
      if (p.shortcode) _cap.set(p.shortcode, p);
    }
    logLine('内嵌 seed ' + _cap.size + ' 帖,开始自动滚动(FB 自己加载,不触发软封)…');

    let last = _cap.size;
    let stale = 0;
    for (let i = 0; i < cfg.maxScrolls; i++) {
      if (_scrollAbort) {
        logLine('⏹ 用户停止滚动');
        break;
      }
      scrollStep();
      await sleep(cfg.scrollWaitMs);
      const size = _cap.size;
      setStatus(
        '滚动 ' + (i + 1) + '/' + cfg.maxScrolls + ' · 已 ' + size +
        ' 帖(graphql ' + _gqlSeen + '/timeline ' + _capMsgs + ')',
      );
      if ((i + 1) % 5 === 0)
        logLine('… 滚动 ' + (i + 1) + ' 轮:已 ' + size + ' 帖,见 graphql ' + _gqlSeen + ',timeline 响应 ' + _capMsgs);
      if (size > last) {
        last = size;
        stale = 0;
      } else {
        stale++;
      }
      // 至少滚 minScrolls 轮再允许因"无新增"停止,给 FB 反应时间
      if (i + 1 >= cfg.minScrolls && stale >= cfg.scrollStale) {
        logLine('连续 ' + stale + ' 轮无新增,判定到底,停止滚动');
        break;
      }
      if (cfg.maxPosts && size >= cfg.maxPosts) {
        logLine('达到设定上限 ' + cfg.maxPosts + ' 帖,停止');
        break;
      }
    }
    _captureOn = false;

    const all = [..._cap.values()];
    logLine('滚动结束,共 ' + all.length + ' 帖(见 graphql ' + _gqlSeen + ',timeline 响应 ' + _capMsgs + ')');
    if (!_injectLoaded)
      logLine('⚠️ 全程未收到 inject 挂载信号:MAIN world 注入可能未生效(Chrome<111 或被 CSP 拦)');
    else if (_gqlSeen === 0)
      logLine('⚠️ 全程没见到任何 /graphql 请求:FB 可能没触发懒加载(页面没滚动?)或走了别的通道');
    else if (_capMsgs === 0)
      logLine('⚠️ 见到 graphql 但没有 timeline 响应:该主页 feed 结构可能不同,需调整匹配');
    if (all.length <= 1) {
      return {
        ok: false,
        handle,
        error: '只拿到内嵌 ' + all.length + ' 帖(graphql ' + _gqlSeen + '/timeline ' + _capMsgs + ',inject=' + _injectLoaded + ')',
      };
    }

    const payload = {
      handle: handle,
      account: {
        displayName: displayName || undefined,
        externalId: ctx.user_id || undefined,
        externalUrl: 'https://www.facebook.com/' + handle,
      },
      posts: all,
    };
    setStatus('入库中…(' + all.length + ' 帖)');
    logLine('⬆ 上报 ' + all.length + ' 帖 → ' + conf.sp_server);
    const r = await postToServer(conf.sp_server, conf.sp_token, payload);
    if (!r.ok) {
      logLine('❌ 入库失败 ' + r.status + ':' + String(r.text).slice(0, 120));
      return { ok: false, handle, error: '入库失败 ' + r.status + ':' + String(r.text).slice(0, 120) };
    }
    let res = {};
    try {
      res = JSON.parse(r.text);
    } catch (e) {}
    logLine('✅ server:发送 ' + all.length + ',新增 ' + res.added + ',账户共 ' + res.total + ' 帖');
    return {
      ok: true,
      handle,
      added: res.added != null ? res.added : null,
      total: res.total != null ? res.total : null,
    };
  }

  // ── 浮动面板 UI(手动按钮 + 状态 + 外显日志)──
  let _status = null;
  function mkBtn(text, bg, color) {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText =
      'background:' + bg + ';color:' + color + ';border:0;border-radius:6px;' +
      'padding:6px 10px;cursor:pointer;font-weight:600;font-size:12px;';
    return b;
  }
  function mountButton() {
    if (document.getElementById('sp-fb-collect')) return;
    if (!document.body) return;
    const box = document.createElement('div');
    box.id = 'sp-fb-collect';
    box.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;' +
      'font:13px/1.4 -apple-system,system-ui,sans-serif;background:#fff;color:#222;' +
      'border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.25);padding:10px;';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
    const btn = mkBtn('滚动采集本页', '#1877f2', '#fff');
    const copyBtn = mkBtn('复制日志', '#f0f2f5', '#333');
    const clearBtn = mkBtn('清空', '#f0f2f5', '#333');
    row.appendChild(btn);
    row.appendChild(copyBtn);
    row.appendChild(clearBtn);

    const status = document.createElement('div');
    status.style.cssText =
      'margin-top:8px;font-weight:600;color:#1877f2;min-height:16px;white-space:pre-wrap;';

    const log = document.createElement('pre');
    log.style.cssText =
      'margin:8px 0 0;max-height:220px;overflow:auto;background:#0d1117;color:#c9d1d9;' +
      'border-radius:6px;padding:8px;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;' +
      'white-space:pre-wrap;word-break:break-all;';

    let _running = false;
    btn.addEventListener('click', async () => {
      // 运行中点击 = 停止滚动
      if (_running) {
        _scrollAbort = true;
        btn.textContent = '停止中…';
        return;
      }
      _running = true;
      btn.textContent = '停止采集';
      try {
        const r = await collectByScroll((t) => setStatus(t));
        setStatus(
          r.ok
            ? '✅ @' + r.handle + ' 新增 ' + r.added + ',账户共 ' + r.total
            : '❌ ' + (r.handle ? '@' + r.handle + ' ' : '') + r.error,
        );
      } catch (e) {
        setStatus('❌ 异常:' + e);
        logLine('❌ 异常:' + e);
      } finally {
        _running = false;
        btn.textContent = '滚动采集本页';
      }
    });
    copyBtn.addEventListener('click', async () => {
      const text = _logBuf.join('\n');
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = '已复制';
      } catch (e) {
        // 剪贴板不可用时兜底:选中一个临时 textarea
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          copyBtn.textContent = '已复制';
        } catch (e2) {
          copyBtn.textContent = '复制失败';
        }
        ta.remove();
      }
      setTimeout(() => (copyBtn.textContent = '复制日志'), 1500);
    });
    clearBtn.addEventListener('click', () => {
      _logBuf = [];
      _renderLog();
      storageSet({ sp_log: [] });
    });

    box.appendChild(row);
    box.appendChild(status);
    box.appendChild(log);
    document.body.appendChild(box);
    _status = status;
    _logEl = log;
    // 回填历史日志(批量跳转后接续)
    storageGet(['sp_log']).then(({ sp_log }) => {
      if (Array.isArray(sp_log) && sp_log.length && !_logBuf.length) {
        _logBuf = sp_log.slice(-400);
      }
      _renderLog();
    });
  }
  function setStatus(text) {
    if (_status) _status.textContent = text;
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
      logLine('➡ ' + prog + ' 跳转到 @' + cur.handle);
      location.assign(cur.url);
      return;
    }
    logLine('━━ ' + prog + ' @' + cur.handle + ' ━━');

    setStatus(prog + ':采集 @' + cur.handle + ' …');
    let r;
    try {
      r = await collectByScroll((t) => setStatus(prog + ' @' + cur.handle + ':' + t));
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
    logLine('🎉 批量完成:成功 ' + ok + ' / 失败 ' + fail);
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
