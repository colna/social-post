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

### FB 抓取方案(2026-08-10 定)

- **数据源:mbasic HTML + cookie**(已与用户确认)。三入口(mbasic / m.facebook / www)无 cookie 全部 400/302 跳登录 → **必须带已登录 fb cookie**(机制同 IG `IG_COOKIE`,新增 `FB_COOKIE`,不进仓库)。
- 复用 `fetcher.fetch_text`(curl_cffi impersonate)抓 `mbasic.facebook.com/<handle>`;parser 从 mbasic HTML 抠资料 + 帖子列表,翻页走 mbasic 的「查看更多」`?cursor=` 链接。
- 备选(不采用):Graph API(任意公开页拿不到帖子)、内部 GraphQL(fb_dtsg/doc_id 最脆)。
- **开发方式**:parser 用真实 mbasic HTML fixture + mock fetcher 离线单测(同 IG),cookie 仅运行时需要。

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

## 四、进度

> 状态:⬜ 未开始 / 🟡 进行中 / ✅ 完成。

| Task | 状态 | 完成时间 | 测试 | commit | 备注 |
|------|------|----------|------|--------|------|
| A.1 filter 纯函数+测试 | ✅ | 2026-08-10 | 7 passed | — | handle/展示名/时间段 |
| A.2 接入 ProTable search | ✅ | 2026-08-10 | tsc/lint/11 passed | — | IG/FB 共用 |
| B.1 抓 fixture | ⬜ | | | | 待 cookie |
| B.2 FB parser+测试 | ⬜ | | | | |
| B.3 FB crawler+注册 | ⬜ | | | | |
| B.4 config/env cookie | ⬜ | | | | |
| B.5 API 测试 facebook | ⬜ | | | | |
| C.1 seed 启用 facebook | ⬜ | | | | |
| C.2 端到端打通 | ⬜ | | | | |
| C.3 视觉走查 | ⬜ | | | | |
