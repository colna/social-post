"""Facebook 解析器(纯函数,无副作用)。

两部分:
  1. parse_profile_page: 从 www.facebook.com/<handle>/ 的 HTML 抠
     账户资料 + GraphQL 翻页上下文(fb_dtsg / lsd / doc_id / userID / variables…)。
  2. parse_timeline: 把 ProfileCometTimelineFeedQuery 的(流式多段)响应解析成 PostItem。

FB 的 Comet JSON 结构极深且多变,字段一律用「递归按 key 搜索」而非写死路径,
容错优先:任何字段缺失都降级为 None,不抛 KeyError。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.models import AccountProfile, PostItem


@dataclass
class FbPageContext:
    """从主页 HTML 抠出的 GraphQL 翻页上下文;字段缺失即不可翻页(降级)。"""

    fb_dtsg: str | None = None
    lsd: str | None = None
    rev: str | None = None
    spin_t: str | None = None
    spin_b: str | None = None
    hs: str | None = None
    hsi: str | None = None
    doc_id: str | None = None
    user_id: str | None = None
    variables: dict[str, Any] = field(default_factory=dict)

    @property
    def can_paginate(self) -> bool:
        return bool(self.doc_id and self.fb_dtsg and self.lsd and self.user_id)


# ── 递归工具 ──────────────────────────────────────────────


def _find_all(obj: Any, key: str, out: list | None = None) -> list:
    """递归收集所有名为 key 的值。"""
    if out is None:
        out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                out.append(v)
            _find_all(v, key, out)
    elif isinstance(obj, list):
        for v in obj:
            _find_all(v, key, out)
    return out


def _to_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _int_counts(values: list) -> list[int]:
    """把 [{'count': n} | int | '3'] 归一为 int 列表。"""
    out: list[int] = []
    for v in values:
        if isinstance(v, bool):
            continue
        if isinstance(v, int):
            out.append(v)
        elif isinstance(v, dict):
            n = _to_int(v.get("count"))
            if n is not None:
                out.append(n)
        elif isinstance(v, str):
            n = _to_int(v.replace(",", ""))
            if n is not None:
                out.append(n)
    return out


# ── 主页 HTML → 资料 + 翻页上下文 ─────────────────────────


def _search(html_text: str, pattern: str) -> str | None:
    m = re.search(pattern, html_text)
    return m.group(1) if m else None


def _extract_preloader(html_text: str) -> tuple[str | None, dict[str, Any]]:
    """从 ProfileCometTimelineFeedQueryRelayPreloader 块抠 queryID(=doc_id)+ variables。"""
    marker = '"preloaderID":"adp_ProfileCometTimelineFeedQueryRelayPreloader'
    i = html_text.find(marker)
    if i < 0:
        return None, {}
    seg = html_text[i - 300 : i + 4000]
    qid = _search(seg, r'"queryID":"(\d+)"')
    variables: dict[str, Any] = {}
    vstart = seg.find('"variables":')
    if vstart >= 0:
        vstart += len('"variables":')
        depth = 0
        end = None
        for j in range(vstart, len(seg)):
            c = seg[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    end = j + 1
                    break
        if end is not None:
            try:
                variables = json.loads(seg[vstart:end])
            except (ValueError, TypeError):
                variables = {}
    return qid, variables


def parse_profile_page(
    html_text: str, handle: str
) -> tuple[AccountProfile, FbPageContext]:
    """解析 FB 主页 HTML:返回(账户资料, 翻页上下文)。

    资料 best-effort:名称/主页 id/主页链接较稳,粉丝数/帖子数不在初始页 → None。
    """
    doc_id, variables = _extract_preloader(html_text)
    user_id = str(variables.get("userID")) if variables.get("userID") else None

    ctx = FbPageContext(
        fb_dtsg=_search(html_text, r'"DTSGInitialData",\[\],\{"token":"([^"]+)"'),
        lsd=_search(html_text, r'"LSD",\[\],\{"token":"([^"]+)"'),
        rev=_search(html_text, r'"__spin_r":(\d+)')
        or _search(html_text, r'"client_revision":(\d+)'),
        spin_t=_search(html_text, r'"__spin_t":(\d+)'),
        spin_b=_search(html_text, r'"__spin_b":"([^"]+)"'),
        hs=_search(html_text, r'"haste_session":"([^"]+)"'),
        hsi=_search(html_text, r'"hsi":"(\d+)"'),
        doc_id=doc_id,
        user_id=user_id,
        variables=variables,
    )

    # 名称:优先 User 节点(id 匹配),否则任意 Page/User name
    name = None
    if user_id:
        name = _search(
            html_text,
            r'"__typename":"(?:User|Page)","id":"'
            + re.escape(user_id)
            + r'"[^}]*?"name":"([^"]+)"',
        )
    if not name:
        name = _search(html_text, r'"__isProfile":"(?:User|Page)","name":"([^"]+)"')

    account = AccountProfile(
        handle=handle,
        display_name=_unescape(name) if name else None,
        avatar_url=None,
        bio=None,
        follower_count=None,
        following_count=None,
        media_count=None,
        is_verified=False,
        is_private=False,
        external_url=f"https://www.facebook.com/{handle}",
        external_id=user_id,
    )
    return account, ctx


def _unescape(s: str) -> str:
    """还原 JSON 字符串里的 \\uXXXX / \\/ 等转义(名称常含中文/斜杠)。"""
    try:
        return json.loads(f'"{s}"')
    except (ValueError, TypeError):
        return s


# ── timeline 响应 → PostItem ──────────────────────────────


def _walk_stories(obj: Any, nodes: list[dict], seen: set[str]) -> None:
    """递归收集 Story 节点(dict 且带 post_id),按 post_id 去重。"""
    if isinstance(obj, dict):
        if obj.get("__typename") == "Story" and obj.get("post_id"):
            pid = str(obj["post_id"])
            if pid not in seen:
                seen.add(pid)
                nodes.append(obj)
        for v in obj.values():
            _walk_stories(v, nodes, seen)
    elif isinstance(obj, list):
        for v in obj:
            _walk_stories(v, nodes, seen)


def _collect_story_nodes(raw_text: str) -> list[dict]:
    """从(可能流式多段的)响应里收集所有 Story 节点。每行尝试 json 解析。"""
    nodes: list[dict] = []
    seen: set[str] = set()
    for line in raw_text.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            _walk_stories(json.loads(line), nodes, seen)
        except (ValueError, TypeError):
            continue
    return nodes


def parse_embedded_posts(html_text: str) -> list[PostItem]:
    """从主页 HTML 的 <script type="application/json"> 块里抽内嵌的初始帖。

    纯 GET 不触发反自动化,但内嵌帖通常很少(常 1 条)。作为 GraphQL 翻页失败时的兜底。
    """
    nodes: list[dict] = []
    seen: set[str] = set()
    blocks = re.findall(
        r'<script type="application/json"[^>]*>(.*?)</script>', html_text, re.S
    )
    for block in blocks:
        try:
            _walk_stories(json.loads(block), nodes, seen)
        except (ValueError, TypeError):
            continue
    return [_parse_node(n) for n in nodes]


def _extract_cursor(raw_text: str) -> tuple[str | None, bool]:
    """从响应里取分页游标:返回(end_cursor, has_next_page)。"""
    end_cursor: str | None = None
    has_next = False
    for line in raw_text.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except (ValueError, TypeError):
            continue
        for pi in _find_all(data, "page_info"):
            if isinstance(pi, dict):
                if pi.get("end_cursor"):
                    end_cursor = pi["end_cursor"]
                if pi.get("has_next_page"):
                    has_next = True
    return end_cursor, has_next


def _post_caption(node: dict) -> str | None:
    """文案:取所有 message.text 里最长的一条(不同 section 会重复,内容一致)。"""
    texts: list[str] = []
    for msg in _find_all(node, "message"):
        if isinstance(msg, dict) and isinstance(msg.get("text"), str) and msg["text"]:
            texts.append(msg["text"])
    if not texts:
        return None
    return max(texts, key=len)


def _post_type(node: dict) -> str:
    """按附件结构判定类型:album→carousel;可播放→video;否则 image。"""
    typenames = {t for t in _find_all(node, "__typename") if isinstance(t, str)}
    if any("Album" in t for t in typenames):
        return "carousel"
    if any(bool(v) for v in _find_all(node, "is_playable")) or _find_all(
        node, "playable_url"
    ):
        return "video"
    if any(t == "Video" for t in typenames):
        return "video"
    return "image"


def _post_cover(node: dict) -> str:
    """封面:附件里第一张 fbcdn 图片 uri。"""
    attachments = node.get("attachments")
    scope = attachments if attachments is not None else node
    for uri in _find_all(scope, "uri"):
        if isinstance(uri, str) and "fbcdn" in uri:
            return uri
    return ""


def _post_comment_count(node: dict) -> int | None:
    """评论数 best-effort:优先 total_comment_count,退回 comments 下的 total_count/count。"""
    counts = _int_counts(_find_all(node, "total_comment_count"))
    if counts:
        return max(counts)
    for comments in _find_all(node, "comments"):
        if isinstance(comments, dict):
            n = _to_int(comments.get("total_count")) or _to_int(comments.get("count"))
            if n is not None:
                return n
    return None


def _parse_node(node: dict) -> PostItem:
    post_id = str(node.get("post_id") or "")
    ct = _to_int(node.get("creation_time"))
    taken_at = (
        datetime.fromtimestamp(ct, tz=timezone.utc) if ct is not None else None
    )
    reactions = _int_counts(_find_all(node, "reaction_count"))
    return PostItem(
        shortcode=post_id,
        url=node.get("permalink_url") or f"https://www.facebook.com/{post_id}",
        type=_post_type(node),
        cover_url=_post_cover(node),
        caption=_post_caption(node),
        like_count=max(reactions) if reactions else None,
        comment_count=_post_comment_count(node),
        taken_at=taken_at,
        raw={"post_id": post_id, "permalink_url": node.get("permalink_url")},
    )


def parse_timeline(raw_text: str) -> tuple[list[PostItem], str | None, bool]:
    """解析 timeline 响应:返回(帖子列表, end_cursor, has_next_page)。"""
    nodes = _collect_story_nodes(raw_text)
    posts = [_parse_node(n) for n in nodes]
    end_cursor, has_next = _extract_cursor(raw_text)
    return posts, end_cursor, has_next
