FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 先装依赖以利用层缓存
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# scrapling 底层用 Playwright/camoufox 时需要浏览器;stealth 模式才需要,
# 默认 fetch 模式无需。若使用 stealth,取消下一行注释预装浏览器:
# RUN python -m playwright install --with-deps chromium

COPY app ./app

EXPOSE 8000

# shell 形式,让 Render/Railway 注入的 $PORT 生效(本地无该变量则回退 8000)
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
