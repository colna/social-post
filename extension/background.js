// background service worker:替 content script 做跨域 POST(content script 直接打
// localhost server 会被 CORS 拦;service worker 有 host_permissions 可放行)。
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'ingest') {
    const url = String(msg.server || '').replace(/\/$/, '') + '/ingest/facebook';
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ingest-token': msg.token || '',
      },
      body: JSON.stringify(msg.payload),
    })
      .then(async (r) => {
        const text = await r.text();
        sendResponse({ ok: r.ok, status: r.status, text: text });
      })
      .catch((e) => sendResponse({ ok: false, status: 0, text: String(e) }));
    return true; // 异步 sendResponse
  }
  return false;
});
