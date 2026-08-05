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
