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
