// MAIN world 注入:劫持 FB 自己发出的 GraphQL timeline 响应(fetch + XHR 都 hook)。
// content script 在隔离世界拿不到页面的 window.fetch/XHR,必须在 MAIN 世界 patch。
// 只克隆读取、原样返回,不干扰 FB;命中含 Story/timeline 的响应文本 postMessage 交给 content。
(function () {
  if (window.__spFbHooked) return;
  window.__spFbHooked = true;

  function post(obj) {
    try {
      window.postMessage(obj, '*');
    } catch (e) {}
  }
  // 只转发像是 timeline 的响应,减少 postMessage 体积
  function looksLikeTimeline(text) {
    return (
      typeof text === 'string' &&
      (text.indexOf('timeline_list_feed_units') >= 0 ||
        text.indexOf('"__typename":"Story"') >= 0 ||
        (text.indexOf('"post_id"') >= 0 && text.indexOf('creation_time') >= 0))
    );
  }
  function handle(url, text) {
    if (!url || url.indexOf('/graphql') < 0) return;
    post({ source: 'sp-fb-hook', kind: 'gql', url: String(url).slice(0, 80) });
    if (looksLikeTimeline(text)) post({ source: 'sp-fb-cap', body: text });
  }

  // ── hook fetch ──
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/graphql') >= 0) {
          p.then(function (resp) {
            try {
              resp
                .clone()
                .text()
                .then(function (t) {
                  handle(url, t);
                })
                .catch(function () {});
            } catch (e) {}
          }).catch(function () {});
        }
      } catch (e) {}
      return p;
    };
  }

  // ── hook XMLHttpRequest ──
  const XO = window.XMLHttpRequest;
  if (XO && XO.prototype) {
    const origOpen = XO.prototype.open;
    const origSend = XO.prototype.send;
    XO.prototype.open = function (method, url) {
      try {
        this.__spUrl = url;
      } catch (e) {}
      return origOpen.apply(this, arguments);
    };
    XO.prototype.send = function () {
      try {
        const xhr = this;
        if (xhr.__spUrl && String(xhr.__spUrl).indexOf('/graphql') >= 0) {
          xhr.addEventListener('load', function () {
            try {
              handle(xhr.__spUrl, xhr.responseText);
            } catch (e) {}
          });
        }
      } catch (e) {}
      return origSend.apply(this, arguments);
    };
  }

  post({ source: 'sp-fb-hook', kind: 'loaded' });
})();
