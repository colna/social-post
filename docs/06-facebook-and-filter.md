# social-post · 增量:Facebook 端到端 + 表格筛选

> 增量需求(2026-08-10 起,创造模式)。base 项目文档见 `01`~`05`。

## 一、需求(PRD-lite)

1. **Facebook 功能与 Instagram 一致**:输入 FB 主页(Page)handle → 抓取账户资料 + 帖子(封面 + 文案 + 点赞/评论/时间)→ 与 IG 同一套表格/抓取弹窗/帖子抽屉展示。首个目标页:`https://www.facebook.com/uksmartgroup`。
2. **表格筛选**:IG / FB 账户表格增加查询表单(利用 ProTable search 能力),支持按 **账号 handle**、**展示名**、**最近抓取时间段** 筛选。

## 二、技术方案

架构已完全「平台无关」,FB 接入点最小:

| 层 | 现状 | 本次改动 |
|----|------|----------|
| `services/crawler` | registry 模式,IG=`crawlers/instagram.py`+`parsers/instagram.py` | **新增** `crawlers/facebook.py` + `parsers/facebook.py`,在 `registry.py` 注册 |
| `apps/server` | `/crawl/{platform}` 全透传,无 IG 硬编码 | 零改动 |
| `prisma/seed.ts` | `facebook` 已存在但 `enabled:false` | 支持后翻 `true` |
| `apps/web` | 菜单/表格/抓取弹窗按 `platform` 泛化 | 筛选:`utils/filter.ts` + ProTable search;FB 启用后自动出现 |

### FB 抓取方案(2026-08-10 实测定稿)

**必须带已登录 fb cookie**(机制同 IG `IG_COOKIE`,新增 `FB_COOKIE`,不进仓库):三入口无 cookie 全 400/302。

实测结论(带真实 cookie 打 uksmartgroup):
- **mbasic 已死**:带 cookie 也返回「错误」页(FB 下线中)。
- **桌面 www 可用(纯 GET,不触发反自动化)**:能拿 名称/主页 id(`100063693364145`)/主页链接;粉丝数、帖子数不在初始页(懒加载);**页面内嵌 timeline 只有约 1 条帖**(字段可解析)。
- **GraphQL 翻页(拿多帖)**:从页面 `ProfileCometTimelineFeedQueryRelayPreloader` 抠到 `doc_id=27002668536074808` + variables(按 `userID` 翻页)。**关键坑**:用 urllib 发直接被 FB 反自动化拒(`error 1357054`)——真因是 **Python TLS 指纹**;换 **curl / curl_cffi(`impersonate=chrome` + HTTP/2)** 成功拿到 542KB、3 帖 + `end_cursor` + `has_next_page`。**但**:连发 1~2 次 GraphQL 后 FB 即软封该会话/账号(后续含全新 token 的请求也持续 `1357054`)。稳定多帖需 会话/代理轮换 或 无头浏览器 + 拟人节流,成本高 + 封号风险,**本期不做**。

**最终采用(稳妥优先 + 优雅降级)**:
1. crawler 用 curl_cffi(`impersonate=chrome`)GET `www.facebook.com/<handle>/` → parser 解析 资料 + 页面内嵌初始帖 + 抠 GraphQL 上下文(fb_dtsg/lsd/doc_id/userID/variables 等)。
2. 尽力发 1~N 次 GraphQL 翻页补更多帖;遇 `1357054` / 非 2xx **优雅降级**为「仅内嵌帖」,不报错。
3. parser 用真实抓到的 timeline 响应结构做 fixture,**离线单测**;cookie 仅运行时用。
- 备选(不采用):Graph API(任意公开页拿不到帖子)。

## 三、任务拆解(Phase → Task)

### Phase A · 表格筛选(不依赖 cookie)
- A.1 `utils/filter.ts` 纯函数 + Vitest 单测
- A.2 接入 `pages/index.tsx`:ProTable search + request 过滤;tsc/lint/test 全过

### Phase B · FB 抓取适配器(依赖 cookie 拿 fixture)
- B.1 用 cookie 抓一份 `uksmartgroup` mbasic HTML 存 fixture
- B.2 `parsers/facebook.py`:解析资料 + 帖子(对 fixture 写单测)
- B.3 `crawlers/facebook.py`:构造请求 + 翻页 + 时间段/条数过滤;注册到 `registry.py`
- B.4 `config.py` 加 `fb_cookie`;`.env.example` 补 `FB_COOKIE`
- B.5 crawler API 测试补 facebook 分支

### Phase C · 打通 + 上线
- C.1 `seed.ts` facebook `enabled:true`,跑 seed
- C.2 端到端:web 点 Facebook → 新增 uksmartgroup → 抓取 → 表格/帖子展示
- C.3 浏览器视觉走查(筛选 + FB 帖子)

## 三·补 · Phase D:浏览器脚本采集(绕开 FB 软封)

服务器侧自动化 GraphQL 会被 FB 软封(见上)。改用**在用户已登录的 facebook.com 标签页里跑 JS**:同源 `fetch` 打 `/api/graphql/`,带真实 httpOnly cookie + 真实 `fb_dtsg` + 真实浏览器指纹 + 真人会话 → FB 当正常刷页面,风控宽容。数据从「浏览器 → 推给 server」。

- **server**:`POST /api/ingest/facebook`(`src/ingest/`),`x-ingest-token` 鉴权(env `INGEST_TOKEN`,默认 `change-me-ingest-token`),upsert 账户 + 去重入库(复用 Post 模型),`takenAt` 收 unix 秒。IngestModule 挂进 app.module。
- **脚本**:`scripts/fb-collector.user.js`(Tampermonkey 用户脚本,`@match https://www.facebook.com/*`)。页内抠 token/doc_id/variables(同 crawler parser 逻辑)→ 同源 GraphQL cursor 翻页(拟人节流 1.2s/页,遇 1357054 停)→ 组装 POST 给 server。FB 主页右下角出现「采集到 social-post」按钮。

**装法**:装 Tampermonkey → 新建脚本粘贴 `scripts/fb-collector.user.js` → 油猴菜单「设置 server API 基址」(如 `http://localhost:3001/api`)+「设置 ingest token」(与 server `INGEST_TOKEN` 一致)→ 打开目标 FB 主页点按钮。

## 四、进度

> 状态:⬜ 未开始 / 🟡 进行中 / ✅ 完成。

| Task | 状态 | 完成时间 | 测试 | commit | 备注 |
|------|------|----------|------|--------|------|
| A.1 filter 纯函数+测试 | ✅ | 2026-08-10 | 7 passed | e69fefa | handle/展示名/时间段 |
| A.2 接入 ProTable search | ✅ | 2026-08-10 | tsc/lint/11 passed | e69fefa | IG/FB 共用 |
| B.1 抓 fixture | ✅ | 2026-08-10 | — | — | 带 cookie 抓到真实 www 页 + 542KB timeline 响应,据此建合成 fixture |
| B.2 FB parser+测试 | ✅ | 2026-08-10 | 9 passed | — | `parsers/facebook.py`:资料+上下文+timeline 三类帖 |
| B.3 FB crawler+注册 | ✅ | 2026-08-10 | — | — | `crawlers/facebook.py` GET+尽力翻页+优雅降级;registry 注册 |
| B.4 config/env cookie | ✅ | 2026-08-10 | — | — | `config.fb_cookie` + `.env.example` FB_COOKIE + fetcher.fetch_post_text |
| B.5 API 测试 facebook | ✅ | 2026-08-10 | 32 passed | — | crawl OK + 软封降级两条 |
| C.1 seed 启用 facebook | ✅ | 2026-08-10 | — | — | `enabled:true` |
| C.2 端到端打通 | 🟡 | | | | server 侧代码通;live 拉取受 FB 风控 → 改走 Phase D 浏览器脚本 |
| C.3 视觉走查 | ⬜ | | | | 待用户本地跑 seed + web 验证 |
| D.1 server ingest 端点 | ✅ | 2026-08-10 | 13 passed | — | POST /api/ingest/facebook + token 鉴权 + 去重入库 |
| D.2 Tampermonkey 采集脚本 | ✅ | 2026-08-10 | — | — | scripts/fb-collector.user.js,同源 GraphQL 翻页 + 拟人节流 |
| D.3 脚本端到端实测 | ⬜ | | | | 待用户装脚本在 FB 主页点采集验证 |

## 五 · Phase E:补转发数 + 抓取时间精确到时分(2026-08-14)

背景:复盘发现 5 项需求里「转发/分享数」虽全链路字段齐(schema/types/UI「转发」列),但 FB 两条路径都没解析 → `shareCount` 恒 None;抓取时间选择是「按天」粒度。用户定:补转发数(走浏览器脚本路径)、抓取时间精确到时分。

FB Comet 分享数在 feedback 的 `share_count.count`(退回 `reshare_count`),按 `reaction_count` 同款「递归找 key + best-effort」提取。

| Task | 状态 | 完成时间 | 测试 | 备注 |
|------|------|----------|------|------|
| E.1 parser 补 share_count + fixture 单测 | ✅ | 2026-08-14 | 9 passed | `_post_share_count`;fixture 111 加分享数、222 验 None |
| E.2 采集脚本 pickShareCount | ✅ | 2026-08-14 | — | `fb-collector.user.js`;server ingest 已支持接收 |
| E.3 抓取弹窗改 DateTime 精确到时分 | ✅ | 2026-08-14 | tsc/lint/11 passed | `ProFormDateTimeRangePicker`,since/until 用确切时间点 |
| E.4 全量测试 | ✅ | 2026-08-14 | crawler 32 + web 11 | tsc/lint 全过 |
| E.5 实机走查 uksmartgroup | ⬜ | | | 待用户装扩展在 FB 主页点采集,验证「转发」列有值 |

## 六 · Phase F:自建 Chrome 扩展(替代 Tampermonkey,2026-08-14)

用户不想依赖 Tampermonkey,改自建 MV3 扩展。采集/解析逻辑与 `scripts/fb-collector.user.js`、`parsers/facebook.py` **一字不改地复用**,只换「壳」。

**目录 `extension/`(MV3,纯静态,无需构建)**:
- `manifest.json`:content script 注入 `https://www.facebook.com/*`;`permissions:["storage"]`;`host_permissions:["http://localhost/*","http://127.0.0.1/*"]`(部署到远端 server 时在此加对应 host)。
- `content.js`:搬全部采集逻辑。差异——① 配置从 `GM_getValue` → `chrome.storage.local`;② 跨域 POST 从 `GM_xmlhttpRequest` → `chrome.runtime.sendMessage` 交给 background。
- `background.js`:service worker,收 `{type:'ingest'}` 消息做跨域 fetch(有 host_permissions → 绕过 CORS,**server 零改动、无需开 CORS**)。
- `popup.html`/`popup.js`:配置页(server API 基址 + ingest token),存 `chrome.storage.local`。

**关键机制**:content script 与页面**同源**,同源 `fetch('/api/graphql/',{credentials:'include'})` 由浏览器自动带 httpOnly cookie(httpOnly 只挡 JS 读 `document.cookie`,不挡网络附带)→ GraphQL 采集可在 content script 跑;唯一跨域的是打本地 server,走 background。

**安装(开发者模式加载已解压扩展)**:
1. Chrome 地址栏进 `chrome://extensions`,右上角开「开发者模式」。
2. 点「加载已解压的扩展程序」→ 选 `social-post/extension/` 目录。
3. 点扩展图标 → popup 填 server API 基址(默认 `http://localhost:3001/api`)+ ingest token(与 server `INGEST_TOKEN` 一致)→ 保存。
4. 登录 facebook.com → 打开目标主页(如 `/uksmartgroup`)→ 右下角「采集到 social-post」按钮 → 点。

> 前提:social-post server 已在运行且 `INGEST_TOKEN` 与 popup 里一致。
> 旧 `scripts/fb-collector.user.js` 保留作 Tampermonkey 备选,逻辑等价。

| Task | 状态 | 完成时间 | 测试 | 备注 |
|------|------|----------|------|------|
| F.1 MV3 manifest + 目录 | ✅ | 2026-08-14 | node --check | content/background/popup |
| F.2 content.js 复用采集逻辑 | ✅ | 2026-08-14 | node --check | chrome.storage + 消息转发 |
| F.3 background 跨域转发 + popup 配置页 | ✅ | 2026-08-14 | node --check | server 零改动 |
| F.4 实机走查 | ⬜ | | | 与 E.5 合并:装扩展点采集验证 |

## 七 · Phase G:扩展支持批量主页 + 自动跳转采集(2026-08-14)

需求:popup 填**多个主页链接**(每行一个)→ 依次进入每个主页采集帖子 → 每个采完经 ingest 接口上报 → 自动跳下一个 → 全部完成后表格可见。

**状态机(存 `chrome.storage.local.batch`,跨页面导航存活)**:
`batch = { running, items:[{handle,url}], index, results:[{handle,ok,added,total,error}] }`

**流程**:
1. popup 解析文本域每行 → `{handle,url}`(支持完整链接或裸 handle;去重;不支持 `profile.php` 数字 id 主页)→ 存 `batch{running:true,index:0}` → `chrome.tabs.update` 把当前标签导航到第 1 个主页。
2. content script **每次页面加载**跑 `batchTick()`:读 batch;若 running 且当前 `currentHandle()==items[index].handle` → `waitContext`(重试抠 fb_dtsg/doc_id/userID,应对 SPA 首屏未就绪)→ `collectAndReport` 采集+上报 → 结果 push 进 `batch.results`、`index++` 存回 → 若还有下一个,节流 3s 后 `location.assign(next.url)`;否则 `finishBatch`。
3. 页面不匹配预期(首跳/被重定向)→ 先 `location.assign` 到预期 handle,交给下次加载。
4. 右下角面板显示实时进度;popup 每 1.5s 刷新 `batch.results` 摘要;「停止批量」置 `running=false`。

**关键点**:
- `collect` 重构为 `collectAndReport(setStatus)` 返回结果对象(不 alert),手动按钮与批量共用。
- 重入保护:`_batchRan` 每页只跑一次;popup 兜底 `batch-start` 消息仅在 `!_batchRan` 时补触发,避免与页面加载的 batchTick 并发双跑。
- manifest 加 `tabs` 权限(popup 导航当前标签)。
- 手动单页按钮改名「采集本页」,保留。

| Task | 状态 | 完成时间 | 测试 | 备注 |
|------|------|----------|------|------|
| G.1 collect 重构为返回结果 + waitContext 就绪重试 | ✅ | 2026-08-14 | node --check | 手动/批量共用 |
| G.2 批量状态机 + 自动跳转驱动 | ✅ | 2026-08-14 | node --check | storage 存活 + 重入保护 |
| G.3 popup 批量 UI + 解析 + 进度刷新 | ✅ | 2026-08-14 | node --check | 多行链接/handle |
| G.4 实机走查(多主页) | ⬜ | | | 待用户填多个链接跑一遍 |

## 八 · Phase H:滚动采集(劫持 FB 自身 timeline 响应,拿全量帖)(2026-08-14)

背景:实测 uksmartgroup 只入库 1 帖——www 页只内嵌 1 条,脚本**自发** GraphQL 翻页发 1~2 次即被 FB 软封(`1357054`)。用户提「注入脚本操作 DOM 获取」。比抠混淆 DOM 更稳的做法:**不自己发请求,劫持 FB 自己发的 timeline 响应**。

**方案**:
- `inject.js`(**MAIN world**,`document_start`):content script 在隔离世界拿不到页面 `window.fetch`,故在 MAIN 世界 patch。命中 `/api/graphql/` 且请求体含 `Timeline` 的响应,`response.clone().text()` 读出后 `postMessage({source:'sp-fb-cap',body})` 交给 content script(只克隆读、原样返回,不干扰 FB)。
- `content.js`:
  - 监听 `message` → `parseTimeline(body)` → Story 节点按 shortcode 累积进 `_cap` Map(复用现成 parser,拿干净 JSON:精确点赞/评论/转发/时间)。
  - `collectByScroll`:seed 内嵌帖 → **自动滚到底**(`window.scrollTo`)触发 FB 用**它自己会话**懒加载后续帖(正常行为,不软封)→ 每 `scrollWaitMs`(2.5s)检查 `_cap` 增长,连续 `scrollStale`(4)轮无新增判定到底停止,或达 `maxScrolls`(120)/`maxPosts` 上限 → 上报。
  - 主按钮改「滚动采集本页」,运行中可点「停止采集」(`_scrollAbort`);批量驱动也切到 `collectByScroll`。
- 因滚动采集不需 `fb_dtsg/doc_id`(那是自发 graphql 用的),**删掉旧自发 graphql 路径**(`collectAndReport`/`gqlPage`/`cookie`/`jazoest`/`waitContext`);账户 displayName 尽力取(extractContext 或 document.title),取不到不阻塞。
- `manifest`:加 MAIN world 注入 content script;版本 → 1.2.0。`pack.sh` 白名单加 `inject.js`。

**关键点**:全程是 FB 自己发请求 → 不触发 `1357054`;字段解析逻辑复用 `parseTimeline`,拿到的是结构化 JSON 而非 DOM 抠取。代价:滚动单主页耗时随帖子数增长(120 轮 ×2.5s 上限 ~5min)。

| Task | 状态 | 完成时间 | 测试 | 备注 |
|------|------|----------|------|------|
| H.1 inject.js MAIN world 劫持 fetch | ✅ | 2026-08-14 | node --check | postMessage 交 content |
| H.2 collectByScroll 自动滚动 + 捕获累积 | ✅ | 2026-08-14 | node --check | stale/maxScrolls 兜底 + 停止 |
| H.3 删旧自发 graphql 路径 + 放宽就绪 | ✅ | 2026-08-14 | node --check | 手动/批量切滚动 |
| H.4 实机走查(全量帖) | ⬜ | | | 待用户滚动采集 uksmartgroup 验证帖数 |
