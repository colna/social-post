const DEFAULTS = {
  sp_server: 'http://localhost:3001/api',
  sp_token: 'change-me-ingest-token',
};

const $server = document.getElementById('server');
const $token = document.getElementById('token');
const $saved = document.getElementById('saved');

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
