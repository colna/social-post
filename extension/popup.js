const DEFAULTS = {
  sp_server: 'https://social-post-server.vercel.app/api',
  sp_token: 'change-me-ingest-token',
};

const $server = document.getElementById('server');
const $token = document.getElementById('token');
const $saved = document.getElementById('saved');
const $targets = document.getElementById('targets');
const $batchMsg = document.getElementById('batchMsg');

// ── 配置 ──
chrome.storage.local.get(DEFAULTS, (cfg) => {
  $server.value = cfg.sp_server;
  $token.value = cfg.sp_token;
});

document.getElementById('save').addEventListener('click', () => {
  chrome.storage.local.set(
    {
      sp_server: $server.value.trim() || DEFAULTS.sp_server,
      sp_token: $token.value.trim() || DEFAULTS.sp_token,
    },
    () => {
      $saved.textContent = '✅ 已保存';
      setTimeout(() => ($saved.textContent = ''), 1500);
    },
  );
});

// ── 批量 ──
// 把一行输入(完整链接或 handle)解析为 {handle, url};不支持 profile.php 数字 id 主页
function parseTarget(line) {
  const s = line.trim();
  if (!s) return null;
  let path = s;
  if (/^https?:\/\//i.test(s)) {
    try {
      path = new URL(s).pathname;
    } catch (e) {
      return null;
    }
  }
  const seg = path.split('/').filter(Boolean);
  if (!seg.length) return null;
  const h = seg[0].replace(/^@/, '');
  if (h === 'profile.php') return null;
  if (!/^[A-Za-z0-9._-]+$/.test(h)) return null;
  return { handle: h, url: 'https://www.facebook.com/' + h + '/' };
}

function parseTargets(text) {
  const out = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    const t = parseTarget(line);
    if (t && !seen.has(t.handle)) {
      seen.add(t.handle);
      out.push(t);
    }
  }
  return out;
}

// 渲染上次/当前批量进度
function renderBatch() {
  chrome.storage.local.get(['batch'], ({ batch }) => {
    if (!batch || !batch.results) {
      $batchMsg.textContent = '';
      return;
    }
    const done = batch.results.length;
    const total = batch.items ? batch.items.length : done;
    const ok = batch.results.filter((x) => x.ok).length;
    const head = batch.running
      ? '⏳ 进行中 ' + done + '/' + total + '(成功 ' + ok + ')'
      : '已完成 ' + done + '/' + total + '(成功 ' + ok + ')';
    const lines = batch.results
      .slice(-6)
      .map((x) => (x.ok ? '✅ @' + x.handle + ' +' + x.added : '❌ @' + x.handle + ' ' + x.error))
      .join('\n');
    $batchMsg.textContent = head + (lines ? '\n' + lines : '');
  });
}
renderBatch();
setInterval(renderBatch, 1500);

document.getElementById('start').addEventListener('click', () => {
  const items = parseTargets($targets.value);
  if (!items.length) {
    $batchMsg.textContent = '⚠️ 没解析到有效主页(每行一个链接/handle)';
    return;
  }
  const batch = { running: true, items: items, index: 0, results: [] };
  chrome.storage.local.set({ batch }, () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) {
        $batchMsg.textContent = '⚠️ 找不到当前标签页,请先打开一个 facebook.com 标签页';
        return;
      }
      // 导航到第一个主页;content script 加载后自动接力
      chrome.tabs.update(tab.id, { url: items[0].url }, () => {
        // 兜底:若已在该页未触发 reload,主动发消息启动
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { type: 'batch-start' }, () => {
            void chrome.runtime.lastError; // 忽略无接收方
          });
        }, 1200);
      });
      $batchMsg.textContent = '🚀 已启动:' + items.length + ' 个主页,跳转到 @' + items[0].handle + ' …';
    });
  });
});

document.getElementById('stop').addEventListener('click', () => {
  chrome.storage.local.get(['batch'], ({ batch }) => {
    if (!batch) return;
    batch.running = false;
    chrome.storage.local.set({ batch }, () => {
      $batchMsg.textContent = '⏹ 已停止(当前页采集完不再跳下一个)';
    });
  });
});
