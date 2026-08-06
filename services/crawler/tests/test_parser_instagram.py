"""parser 全字段测试:用 fixture 覆盖三种帖子类型。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.errors import ParseError
from app.parsers.instagram import parse_web_profile_info

FIXTURE = Path(__file__).parent / "fixtures" / "ig_web_profile_info.json"


@pytest.fixture()
def fixture_json() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_account_fields(fixture_json: dict) -> None:
    result = parse_web_profile_info(fixture_json)
    acc = result.account
    assert acc.handle == "sample_creator"
    assert acc.display_name == "Sample Creator"
    # 优先取 hd 头像
    assert acc.avatar_url == "https://scontent.cdninstagram.com/pic_hd.jpg"
    assert acc.bio == "Traveler. Coffee lover. 🌍"
    assert acc.follower_count == 1234567
    assert acc.following_count == 321
    assert acc.media_count == 987
    assert acc.is_verified is True
    assert acc.is_private is False
    assert acc.external_url == "https://example.com/sample"
    assert acc.external_id == "25025320"


def test_posts_count(fixture_json: dict) -> None:
    result = parse_web_profile_info(fixture_json)
    assert len(result.posts) == 3


def test_image_post(fixture_json: dict) -> None:
    post = parse_web_profile_info(fixture_json).posts[0]
    assert post.type == "image"
    assert post.shortcode == "CimgABC001"
    assert post.url == "https://www.instagram.com/p/CimgABC001/"
    assert post.cover_url == "https://scontent.cdninstagram.com/img001.jpg"
    assert post.caption == "A single photo caption"
    # edge_liked_by 优先
    assert post.like_count == 5000
    assert post.comment_count == 120
    assert post.taken_at == datetime(2023, 11, 14, 22, 13, 20, tzinfo=timezone.utc)


def test_reel_post(fixture_json: dict) -> None:
    post = parse_web_profile_info(fixture_json).posts[1]
    assert post.type == "reel"
    assert post.shortcode == "CvidXYZ002"
    # clips -> /reel/ 路径
    assert post.url == "https://www.instagram.com/reel/CvidXYZ002/"
    assert post.cover_url == "https://scontent.cdninstagram.com/reel002.jpg"
    assert post.caption == "My reel caption #fun"
    # 无 edge_liked_by,退回 preview_like
    assert post.like_count == 8800
    assert post.comment_count == 240
    assert post.taken_at == datetime.fromtimestamp(1700100000, tz=timezone.utc)


def test_carousel_post(fixture_json: dict) -> None:
    post = parse_web_profile_info(fixture_json).posts[2]
    assert post.type == "carousel"
    assert post.shortcode == "CcarPQR003"
    assert post.url == "https://www.instagram.com/p/CcarPQR003/"
    assert post.cover_url == "https://scontent.cdninstagram.com/carousel003.jpg"
    # 空 caption edges -> None
    assert post.caption is None
    assert post.like_count == 3300
    assert post.comment_count == 55


def test_raw_preserved(fixture_json: dict) -> None:
    post = parse_web_profile_info(fixture_json).posts[0]
    assert post.raw is not None
    assert post.raw["id"] == "3001"


def test_missing_user_raises() -> None:
    with pytest.raises(ParseError):
        parse_web_profile_info({"data": {}})


def test_missing_data_raises() -> None:
    with pytest.raises(ParseError):
        parse_web_profile_info({})


# ── user feed 接口解析(parse_feed_items) ──


def test_parse_feed_items_types_and_fields() -> None:
    from app.parsers.instagram import parse_feed_items

    feed = {
        "items": [
            {
                "code": "AAA",
                "media_type": 1,  # 图片
                "like_count": 10,
                "comment_count": 2,
                "taken_at": 1700000000,
                "caption": {"text": "hello"},
                "image_versions2": {"candidates": [{"url": "https://cdn/a.jpg"}]},
            },
            {
                "code": "BBB",
                "media_type": 2,  # 视频 + clips → reel
                "product_type": "clips",
                "like_count": 6,
                "caption": None,
                "carousel_media": None,
            },
            {
                "code": "CCC",
                "media_type": 8,  # carousel,封面取首图
                "carousel_media": [
                    {"image_versions2": {"candidates": [{"url": "https://cdn/c1.jpg"}]}}
                ],
            },
        ]
    }
    posts = parse_feed_items(feed)
    assert [p.type for p in posts] == ["image", "reel", "carousel"]
    assert posts[0].shortcode == "AAA"
    assert posts[0].url == "https://www.instagram.com/p/AAA/"
    assert posts[0].caption == "hello"
    assert posts[0].like_count == 10
    assert posts[0].cover_url == "https://cdn/a.jpg"
    assert posts[1].url == "https://www.instagram.com/reel/BBB/"
    assert posts[1].caption is None
    assert posts[2].cover_url == "https://cdn/c1.jpg"


def test_parse_feed_items_empty() -> None:
    from app.parsers.instagram import parse_feed_items

    assert parse_feed_items({}) == []
    assert parse_feed_items({"items": None}) == []
