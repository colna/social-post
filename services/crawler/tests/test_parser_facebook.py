"""Facebook parser 测试:用 fixture 覆盖资料解析、内嵌帖、timeline 三种帖子类型。"""

from __future__ import annotations

from pathlib import Path

from app.parsers.facebook import (
    parse_embedded_posts,
    parse_profile_page,
    parse_timeline,
)

FX = Path(__file__).parent / "fixtures"
PROFILE_HTML = (FX / "fb_profile.html").read_text(encoding="utf-8")
TIMELINE = (FX / "fb_timeline.txt").read_text(encoding="utf-8")


# ── 资料 + 翻页上下文 ──


def test_profile_account_fields() -> None:
    acc, _ctx = parse_profile_page(PROFILE_HTML, "uksmartgroup")
    assert acc.handle == "uksmartgroup"
    assert acc.display_name == "The Smart Group"
    assert acc.external_id == "100063693364145"
    assert acc.external_url == "https://www.facebook.com/uksmartgroup"
    # 粉丝/帖子数不在初始页
    assert acc.follower_count is None
    assert acc.media_count is None


def test_profile_context_tokens() -> None:
    _acc, ctx = parse_profile_page(PROFILE_HTML, "uksmartgroup")
    assert ctx.fb_dtsg == "DTSG_TOKEN_ABC"
    assert ctx.lsd == "LSD_TOKEN_XYZ"
    assert ctx.doc_id == "27002668536074808"
    assert ctx.user_id == "100063693364145"
    assert ctx.rev == "1044830814"
    assert ctx.variables.get("userID") == "100063693364145"
    assert ctx.can_paginate is True


def test_profile_missing_preloader_degrades() -> None:
    acc, ctx = parse_profile_page("<html><body>nothing</body></html>", "x")
    assert acc.handle == "x"
    assert acc.external_id is None
    assert ctx.can_paginate is False


# ── 内嵌初始帖 ──


def test_embedded_posts() -> None:
    posts = parse_embedded_posts(PROFILE_HTML)
    assert len(posts) == 1
    p = posts[0]
    assert p.shortcode == "999"
    assert p.caption == "Embedded initial post"
    assert p.type == "image"
    assert p.like_count == 7


# ── timeline ──


def test_timeline_count_and_cursor() -> None:
    posts, cursor, has_next = parse_timeline(TIMELINE)
    assert [p.shortcode for p in posts] == ["111", "222", "333"]
    assert cursor == "CURSOR_NEXT_123"
    assert has_next is True


def test_timeline_carousel_post() -> None:
    post = parse_timeline(TIMELINE)[0][0]
    assert post.type == "carousel"
    assert post.shortcode == "111"
    assert post.url == "https://www.facebook.com/uksmartgroup/posts/pfbidAAA"
    assert post.caption == "Meet the Team: Orla caption"
    assert post.like_count == 12
    assert post.comment_count == 3
    assert "fbcdn" in post.cover_url and "111" in post.cover_url
    assert post.taken_at is not None


def test_timeline_video_post() -> None:
    post = parse_timeline(TIMELINE)[0][1]
    assert post.type == "video"
    assert post.like_count == 5
    assert post.comment_count is None  # 关评/无评论
    assert "fbcdn" in post.cover_url


def test_timeline_image_post() -> None:
    post = parse_timeline(TIMELINE)[0][2]
    assert post.type == "image"
    assert post.like_count == 0
    assert post.comment_count == 1


def test_timeline_empty() -> None:
    posts, cursor, has_next = parse_timeline("")
    assert posts == []
    assert cursor is None
    assert has_next is False
