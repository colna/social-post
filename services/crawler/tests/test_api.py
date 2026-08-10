"""API 测试:/health、鉴权、/crawl/instagram(monkeypatch fetch_json)。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import fetcher
from app.config import settings
from app.main import app

FIXTURE = Path(__file__).parent / "fixtures" / "ig_web_profile_info.json"
client = TestClient(app)


@pytest.fixture()
def fixture_json() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture()
def auth_header() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.crawler_token}"}


@pytest.fixture()
def patched_fetch(monkeypatch: pytest.MonkeyPatch, fixture_json: dict):
    """把 crawler 用到的 fetch_json 替换成返回 fixture 的假实现。"""

    async def fake_fetch_json(url: str, headers: dict, mode: str = "fetch") -> dict:
        return fixture_json

    # instagram crawler 通过 `from app import fetcher` 调用 fetcher.fetch_json
    monkeypatch.setattr(fetcher, "fetch_json", fake_fetch_json)


def test_health() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_crawl_requires_auth() -> None:
    resp = client.post("/crawl/instagram", json={"handle": "x"})
    assert resp.status_code == 401


def test_crawl_wrong_token() -> None:
    resp = client.post(
        "/crawl/instagram",
        json={"handle": "x"},
        headers={"Authorization": "Bearer wrong"},
    )
    assert resp.status_code == 401


def test_crawl_unknown_platform(auth_header: dict[str, str]) -> None:
    resp = client.post("/crawl/tiktok", json={"handle": "x"}, headers=auth_header)
    assert resp.status_code == 404


def test_crawl_instagram_ok(
    patched_fetch, auth_header: dict[str, str]
) -> None:
    resp = client.post(
        "/crawl/instagram",
        json={"handle": "sample_creator", "maxPosts": 30},
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()

    # 响应必须是 camelCase
    assert data["account"]["displayName"] == "Sample Creator"
    assert data["account"]["followerCount"] == 1234567
    assert data["account"]["externalUrl"] == "https://example.com/sample"
    assert data["account"]["externalId"] == "25025320"
    assert "fetchedAt" in data
    assert len(data["posts"]) == 3

    first = data["posts"][0]
    assert first["coverUrl"] == "https://scontent.cdninstagram.com/img001.jpg"
    assert first["likeCount"] == 5000
    assert first["commentCount"] == 120
    assert "takenAt" in first
    assert first["type"] == "image"

    assert data["posts"][1]["type"] == "reel"
    assert data["posts"][2]["type"] == "carousel"


def test_crawl_respects_max_posts(
    patched_fetch, auth_header: dict[str, str]
) -> None:
    resp = client.post(
        "/crawl/instagram",
        json={"handle": "sample_creator", "maxPosts": 2},
        headers=auth_header,
    )
    assert resp.status_code == 200
    assert len(resp.json()["posts"]) == 2


# ── feed 分页(_fetch_feed_posts)──


def _feed_page(prefix: str, more: bool, next_id: str | None) -> dict:
    return {
        "items": [{"code": f"{prefix}{i}", "media_type": 1} for i in range(12)],
        "more_available": more,
        "next_max_id": next_id,
    }


def test_feed_pagination_follows_next_max_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio
    import re

    from app.crawlers.instagram import InstagramCrawler

    pages = [
        _feed_page("A", True, "m1"),
        _feed_page("B", True, "m2"),
        _feed_page("C", False, None),
    ]
    seen_max_ids: list[str | None] = []
    idx = {"i": 0}

    async def fake_fetch_json(url: str, headers: dict, mode: str = "fetch") -> dict:
        m = re.search(r"max_id=([^&]+)", url)
        seen_max_ids.append(m.group(1) if m else None)
        page = pages[idx["i"]]
        idx["i"] += 1
        return page

    monkeypatch.setattr(fetcher, "fetch_json", fake_fetch_json)

    posts = asyncio.run(InstagramCrawler()._fetch_feed_posts("123", {}, 30, None, None))
    assert len(posts) == 30  # limit=30,页内精确截断
    # 首页无 max_id,之后依次带 next_max_id 翻页
    assert seen_max_ids == [None, "m1", "m2"]


def test_feed_pagination_stops_at_max_posts(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from app.crawlers.instagram import InstagramCrawler

    calls = {"n": 0}

    async def fake_fetch_json(url: str, headers: dict, mode: str = "fetch") -> dict:
        calls["n"] += 1
        return _feed_page("A", True, "m1")

    monkeypatch.setattr(fetcher, "fetch_json", fake_fetch_json)

    posts = asyncio.run(InstagramCrawler()._fetch_feed_posts("123", {}, 5, None, None))
    # 单页内截到 5,不再翻页
    assert len(posts) == 5
    assert calls["n"] == 1


# ── Facebook(patch fetch_text 主页 + fetch_post_text GraphQL)──

FB_PROFILE = (Path(__file__).parent / "fixtures" / "fb_profile.html").read_text(
    encoding="utf-8"
)
FB_TIMELINE = (Path(__file__).parent / "fixtures" / "fb_timeline.txt").read_text(
    encoding="utf-8"
)


def test_crawl_facebook_ok(
    monkeypatch: pytest.MonkeyPatch, auth_header: dict[str, str]
) -> None:
    async def fake_fetch_text(url: str, headers: dict, mode: str = "fetch") -> str:
        return FB_PROFILE

    async def fake_post(url: str, headers: dict, data: str) -> str:
        return FB_TIMELINE

    monkeypatch.setattr(fetcher, "fetch_text", fake_fetch_text)
    monkeypatch.setattr(fetcher, "fetch_post_text", fake_post)

    resp = client.post(
        "/crawl/facebook",
        json={"handle": "uksmartgroup", "maxPosts": 5},
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["account"]["displayName"] == "The Smart Group"
    assert data["account"]["externalId"] == "100063693364145"
    # 内嵌帖 999 + timeline 111/222/333,按时间倒序去重
    codes = [p["shortcode"] for p in data["posts"]]
    assert codes == ["999", "111", "222", "333"]
    assert data["posts"][1]["type"] == "carousel"


def test_crawl_facebook_degrades_when_graphql_blocked(
    monkeypatch: pytest.MonkeyPatch, auth_header: dict[str, str]
) -> None:
    """FB 软封(GraphQL FetchError)时降级为仅内嵌帖,不报错。"""
    from app.errors import FetchError

    async def fake_fetch_text(url: str, headers: dict, mode: str = "fetch") -> str:
        return FB_PROFILE

    async def fake_post(url: str, headers: dict, data: str) -> str:
        raise FetchError("上游返回非 2xx 状态: 会话被软封")

    monkeypatch.setattr(fetcher, "fetch_text", fake_fetch_text)
    monkeypatch.setattr(fetcher, "fetch_post_text", fake_post)

    resp = client.post(
        "/crawl/facebook",
        json={"handle": "uksmartgroup"},
        headers=auth_header,
    )
    assert resp.status_code == 200
    posts = resp.json()["posts"]
    assert [p["shortcode"] for p in posts] == ["999"]


def test_feed_time_range_filter(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from app.crawlers.instagram import InstagramCrawler

    # 一页三条,taken_at 倒序 300/200/100;since=150 until=250 → 只保留 200
    page = {
        "items": [
            {"code": "new", "media_type": 1, "taken_at": 300},
            {"code": "mid", "media_type": 1, "taken_at": 200},
            {"code": "old", "media_type": 1, "taken_at": 100},
        ],
        "more_available": False,
        "next_max_id": None,
    }

    async def fake_fetch_json(url: str, headers: dict, mode: str = "fetch") -> dict:
        return page

    monkeypatch.setattr(fetcher, "fetch_json", fake_fetch_json)
    posts = asyncio.run(
        InstagramCrawler()._fetch_feed_posts("1", {}, None, 150, 250)
    )
    assert [p.shortcode for p in posts] == ["mid"]
