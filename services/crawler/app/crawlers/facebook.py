"""Facebook 平台爬虫:GET 主页拿资料+内嵌帖 → 尽力 GraphQL 翻页补更多帖。

抓取路径(2026-08-10 实测,见 docs/06):
  - GET www.facebook.com/<handle>/(curl_cffi impersonate chrome)拿 资料 + 内嵌初始帖
    + 翻页上下文(fb_dtsg/doc_id/userID/variables…),此步稳、不触发反自动化。
  - POST /api/graphql/(ProfileCometTimelineFeedQuery)按 cursor 翻页补更多帖;
    FB 连发即软封(error 1357054),故**优雅降级**:任一页失败就停,返回已拿到的帖。
"""

from __future__ import annotations

import json
import urllib.parse
from datetime import datetime, timezone

from app import fetcher
from app.config import settings
from app.errors import FetchError
from app.models import CrawlOptions, PostItem, ProfileResult
from app.parsers.facebook import (
    FbPageContext,
    parse_embedded_posts,
    parse_profile_page,
    parse_timeline,
)

DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)
PROFILE_URL = "https://www.facebook.com/{handle}/"
GRAPHQL_URL = "https://www.facebook.com/api/graphql/"
PAGE_SIZE = 8  # 单次 GraphQL 请求的 count
MAX_PAGES = 15  # 翻页上限,防跑飞(FB 一般翻不了几页就被封)
MAX_TOTAL_POSTS = 300  # 不限条数时的兜底上限


def _page_headers(cookie: str) -> dict[str, str]:
    """GET 主页用的浏览器请求头(缺 sec-* / Accept 会被 FB 返回 400)。"""
    return {
        "User-Agent": DESKTOP_UA,
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,*/*;q=0.8"
        ),
        "Accept-Language": "en-US,en;q=0.9",
        "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
        "Cookie": cookie,
    }


def _graphql_headers(cookie: str, lsd: str) -> dict[str, str]:
    return {
        "User-Agent": DESKTOP_UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-FB-Friendly-Name": "ProfileCometTimelineFeedQuery",
        "X-FB-LSD": lsd,
        "Origin": "https://www.facebook.com",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Cookie": cookie,
    }


def _jazoest(token: str) -> str:
    return "2" + str(sum(ord(c) for c in token))


def _build_body(ctx: FbPageContext, count: int, cursor: str | None) -> str:
    variables = dict(ctx.variables)
    variables["count"] = count
    if cursor:
        variables["cursor"] = cursor
    body = {
        "av": ctx.user_id or "",
        "__user": "0",
        "__a": "1",
        "__req": "1",
        "__hs": ctx.hs or "",
        "dpr": "1",
        "__ccg": "EXCELLENT",
        "__rev": ctx.rev or "0",
        "__s": "a:b:c",
        "__hsi": ctx.hsi or "",
        "__comet_req": "15",
        "fb_dtsg": ctx.fb_dtsg or "",
        "jazoest": _jazoest(ctx.fb_dtsg or ""),
        "lsd": ctx.lsd or "",
        "__spin_r": ctx.rev or "0",
        "__spin_b": ctx.spin_b or "trunk",
        "__spin_t": ctx.spin_t or "0",
        "fb_api_caller_class": "RelayModern",
        "fb_api_req_friendly_name": "ProfileCometTimelineFeedQuery",
        "variables": json.dumps(variables, separators=(",", ":")),
        "server_timings": "1",
        "doc_id": ctx.doc_id or "",
    }
    return urllib.parse.urlencode(body)


def _dedupe(posts: list[PostItem]) -> list[PostItem]:
    """按 shortcode 去重,保留首个(保序)。"""
    seen: set[str] = set()
    out: list[PostItem] = []
    for p in posts:
        if p.shortcode and p.shortcode not in seen:
            seen.add(p.shortcode)
            out.append(p)
    return out


def _filter_posts(
    posts: list[PostItem],
    max_posts: int | None,
    since: int | None,
    until: int | None,
) -> list[PostItem]:
    """对帖子(按发布时间倒序)应用「时间段 + 条数」过滤。"""
    out: list[PostItem] = []
    for post in posts:
        ts = post.taken_at.timestamp() if post.taken_at else None
        if until is not None and ts is not None and ts > until:
            continue
        if since is not None and ts is not None and ts < since:
            continue
        out.append(post)
        if max_posts is not None and len(out) >= max_posts:
            break
    return out


class FacebookCrawler:
    key = "facebook"

    async def fetch_profile(
        self,
        handle: str,
        opts: CrawlOptions,
        cookie: str | None,
    ) -> ProfileResult:
        cookie_value = cookie if cookie else settings.fb_cookie

        html_text = await fetcher.fetch_text(
            PROFILE_URL.format(handle=urllib.parse.quote(handle)),
            headers=_page_headers(cookie_value),
        )
        account, ctx = parse_profile_page(html_text, handle)

        # 内嵌初始帖(GET 即得,兜底)
        posts: list[PostItem] = parse_embedded_posts(html_text)

        # 尽力 GraphQL 翻页补更多帖(不限条数或明确要 >0 条时)
        if ctx.can_paginate and (opts.max_posts is None or opts.max_posts > 0):
            posts.extend(await self._paginate(ctx, cookie_value, opts))

        posts = _dedupe(posts)
        posts.sort(
            key=lambda p: p.taken_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        posts = _filter_posts(posts, opts.max_posts, opts.since, opts.until)

        return ProfileResult(
            account=account,
            posts=posts,
            fetched_at=datetime.now(tz=timezone.utc),
        )

    async def _paginate(
        self, ctx: FbPageContext, cookie: str, opts: CrawlOptions
    ) -> list[PostItem]:
        """按 cursor 翻页;任一页 FetchError(含 FB 软封)即优雅停止。"""
        limit = opts.max_posts if opts.max_posts is not None else MAX_TOTAL_POSTS
        headers = _graphql_headers(cookie, ctx.lsd or "")
        collected: list[PostItem] = []
        cursor: str | None = None
        for _ in range(MAX_PAGES):
            body = _build_body(ctx, PAGE_SIZE, cursor)
            try:
                raw = await fetcher.fetch_post_text(GRAPHQL_URL, headers, body)
            except FetchError:
                break  # FB 软封 / 网络问题 → 降级,返回已拿到的
            page_posts, end_cursor, has_next = parse_timeline(raw)
            if not page_posts:
                break
            collected.extend(page_posts)

            if len(collected) >= limit:
                break
            # 整页最旧帖已早于 since → 后续更旧,停止翻页
            if opts.since is not None:
                oldest = min(
                    (p.taken_at.timestamp() for p in page_posts if p.taken_at),
                    default=None,
                )
                if oldest is not None and oldest < opts.since:
                    break
            if not has_next or not end_cursor:
                break
            cursor = end_cursor
        return collected
