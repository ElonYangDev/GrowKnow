"""growknow 后端入口：API 服务（前端由 nginx 容器托管）。"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import api, config, db, i18n
from .services import age_store, seed, settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("growknow")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db(wait_seconds=60)
    seed.seed_skills()
    for attempt in range(1, 31):
        try:
            age_store.ensure_indexes()
            break
        except Exception as exc:  # noqa: BLE001
            log.warning("等待 Apache AGE 就绪（%d/30）：%s", attempt, exc)
            time.sleep(2)
    sync = settings.sync_opencode_config(apply=True)
    log.info("LLM 配置同步：%s", sync)
    yield
    db.close_pool()
    age_store.close()


app = FastAPI(title="growknow", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if "*" in config.CORS_ORIGINS else config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
# 语言必须在 CORS 之后添加，成为最外层中间件，异常处理器才能读到请求语言
app.add_middleware(i18n.LanguageMiddleware)


@app.exception_handler(api.ApiError)
async def handle_api_error(request: Request, exc: api.ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content={
            "code": exc.status,
            "message": i18n.translate(exc.message, i18n.lang_of(request)),
            "data": None,
        },
    )


@app.exception_handler(StarletteHTTPException)
async def handle_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "请求失败"
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": exc.status_code,
            "message": i18n.translate(message, i18n.lang_of(request)),
            "data": None,
        },
    )


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(item) for item in first.get("loc", []) if item != "body")
    message = f"参数不合法：{field} {first.get('msg', '')}".strip()
    return JSONResponse(
        status_code=422,
        content={"code": 422, "message": i18n.translate(message, i18n.lang_of(request)), "data": None},
    )


@app.exception_handler(Exception)
async def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
    log.exception("未处理异常：%s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "code": 500,
            "message": i18n.translate(f"服务器内部错误：{str(exc)[:300]}", i18n.lang_of(request)),
            "data": None,
        },
    )


app.include_router(api.router)


@app.get("/")
def index() -> dict:
    return {
        "name": "growknow",
        "version": "1.0.0",
        "docs": "/docs",
        "api": "/api/v1",
        "message": i18n.translate("前端界面由 nginx 容器在 8090 端口提供"),
    }
