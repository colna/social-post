// MAIN world 注入:劫持 FB 自己发出的 GraphQL timeline 响应。
// content script 在隔离世界,拿不到页面的 window.fetch;必须在 MAIN 世界 patch。
// 只克隆读取、原样返回,不干扰 FB;命中 timeline 的响应文本通过 postMessage 交给 content script。
(function () {
  if (window.__spFbHooked) return;
  window.__spFbHooked = true;

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/graphql/') >= 0) {
        // 尽量只抓 timeline 相关(请求体含 Timeline);读不到请求体则放行全部 graphql
        let want = true;
        try {
          const body = init && init.body;
          if (typeof body === 'string') want = /Timeline/.test(body);
        } catch (e) {}
        if (want) {
          p.then(function (resp) {
            try {
              resp
                .clone()
                .text()
                .then(function (text) {
                  window.postMessage({ source: 'sp-fb-cap', body: text }, '*');
                })
                .catch(function () {});
            } catch (e) {}
          }).catch(function () {});
        }
      }
    } catch (e) {}
    return p;
  };
})();
