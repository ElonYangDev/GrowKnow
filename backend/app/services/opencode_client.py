"""opencode 官方镜像（serve 模式）HTTP API 客户端。

opencode 作为知识抽取的运行引擎：growknow 把「知识抽取 skill + 输出契约 + 文档片段」
作为一条消息发进会话，取回模型输出的 JSON。provider / 模型 / Key 由系统设置生成，
启动时写入挂载的 opencode.json，并在设置变更时 PATCH /global/config 热更新。
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .. import config

log = logging.getLogger(__name__)


class OpenCodeError(Exception):
    """opencode 调用失败（不可达 / 会话异常 / 模型报错）。"""


def _timeout(read: float | None = None) -> httpx.Timeout:
    return httpx.Timeout(read or config.OPENCODE_TIMEOUT_SECONDS, connect=10.0)


def _request(method: str, path: str, body: Any = None, read_timeout: float | None = None) -> Any:
    try:
        with httpx.Client(base_url=config.OPENCODE_URL, timeout=_timeout(read_timeout)) as client:
            response = client.request(method, path, json=body)
    except httpx.HTTPError as exc:
        raise OpenCodeError(f"抽取引擎不可达：{exc}") from exc
    if response.status_code >= 400:
        detail = response.text[:500]
        raise OpenCodeError(f"抽取引擎返回 HTTP {response.status_code}：{detail}")
    if not response.content:
        return None
    try:
        return response.json()
    except ValueError:
        return response.text


def health() -> dict:
    data = _request("GET", "/global/health", read_timeout=10.0)
    return data if isinstance(data, dict) else {"healthy": False}


def apply_global_config(cfg: dict) -> dict:
    data = _request("PATCH", "/global/config", body=cfg, read_timeout=30.0)
    return data if isinstance(data, dict) else {}


def list_providers() -> dict:
    data = _request("GET", "/provider", read_timeout=30.0)
    return data if isinstance(data, dict) else {}


def provider_ready(model: str) -> bool:
    """检查 growknow provider 与模型是否已注册。"""
    try:
        data = list_providers()
    except OpenCodeError:
        return False
    for provider in data.get("all") or []:
        if provider.get("id") == config.OPENCODE_MODEL_PROVIDER:
            return model in (provider.get("models") or {})
    return False


def ensure_provider(cfg: dict | None, model: str) -> None:
    if not cfg or not model:
        raise OpenCodeError("尚未配置 LLM（系统设置 → LLM 配置）")
    if not provider_ready(model):
        apply_global_config(cfg)
        if not provider_ready(model):
            # 刚启动的引擎加载配置需要一点时间
            import time

            for _ in range(10):
                time.sleep(0.5)
                if provider_ready(model):
                    return
            raise OpenCodeError("抽取引擎未能加载 LLM 配置，请检查系统设置与 opencode 日志")


def create_session(title: str, model: str) -> str:
    data = _request(
        "POST",
        "/session",
        body={
            "title": title[:120],
            "model": {"id": model, "providerID": config.OPENCODE_MODEL_PROVIDER},
        },
        read_timeout=30.0,
    )
    session_id = (data or {}).get("id") if isinstance(data, dict) else None
    if not session_id:
        raise OpenCodeError("抽取引擎未返回会话 ID")
    return session_id


def prompt(session_id: str, text: str, system: str | None, model: str) -> str:
    body = {
        "model": {"providerID": config.OPENCODE_MODEL_PROVIDER, "modelID": model},
        "parts": [{"type": "text", "text": text}],
    }
    if system:
        body["system"] = system
    data = _request("POST", f"/session/{session_id}/message", body=body)
    if not isinstance(data, dict):
        raise OpenCodeError("抽取引擎返回了无法识别的响应")
    info = data.get("info") or {}
    error = info.get("error")
    if error:
        message = (error.get("data") or {}).get("message") if isinstance(error, dict) else str(error)
        raise OpenCodeError(f"模型调用失败：{message or error}")
    texts = [
        part.get("text", "")
        for part in (data.get("parts") or [])
        if isinstance(part, dict) and part.get("type") == "text" and part.get("text")
    ]
    result = "".join(texts).strip()
    if not result:
        raise OpenCodeError("模型没有返回任何文本")
    return result


def delete_session(session_id: str) -> None:
    try:
        _request("DELETE", f"/session/{session_id}", read_timeout=10.0)
    except OpenCodeError as exc:
        log.debug("删除 opencode 会话失败：%s", exc)
