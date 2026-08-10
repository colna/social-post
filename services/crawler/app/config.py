"""运行时配置:全部从环境变量读取,带安全默认值。"""

from __future__ import annotations

import os


class Settings:
    """集中管理环境变量,避免散落 os.environ 调用。"""

    def __init__(self) -> None:
        # 共享鉴权 token;生产必须覆盖默认值
        self.crawler_token: str = os.environ.get(
            "CRAWLER_TOKEN", "change-me-shared-secret"
        )
        # Instagram 登录态 Cookie(可被单次请求 body 覆盖)
        self.ig_cookie: str = os.environ.get("IG_COOKIE", "")
        # Facebook 登录态 Cookie(可被单次请求 body 覆盖)
        self.fb_cookie: str = os.environ.get("FB_COOKIE", "")
        # scrapling 抓取模式:fetch(普通) 或 stealth(反爬)
        self.scrapling_mode: str = os.environ.get("SCRAPLING_MODE", "fetch")


# 模块级单例,方便依赖注入时直接引用
settings = Settings()
