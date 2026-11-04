"""opencode 官方镜像（serve 模式）HTTP API 客户端。

opencode 作为知识抽取的运行引擎：growknow 把「知识抽取 skill + 输出契约 + 文档片段」
作为一条消息发进会话，取回模型输出的 JSON。provider / 模型 / Key 由系统设置生成，
启动时写入挂载的 opencode.json，并在设置变更时 PATCH /global/config 热更新。
热更新能不能被运行中的进程吃到并不确定：同一份 PATCH 有时生效、有时 /provider
和 /config 还停在启动时的快照上，dispose 和等待都刷不动（只能重启容器）。所以
settings 会把 LLM 服务端挂出的模型全登记进 provider，换用同一服务上的其他模型时
新名字本来就在注册表里；真的缺模型时 ensure_provider 直接报错并把重启命令写出来。
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from .. import config

log = logging.getLogger(__name__)

# 连接层重试的退避基数（秒）；只对「请求没发出去」的失败生效
_RETRY_BACKOFF = 2.0
# 会话/配置这类轻量调用可以原地重试；模型生成调用交给流水线的分段容错
_LIGHT_RETRIES = 2


class OpenCodeError(Exception):
    """opencode 调用失败（不可达 / 会话异常 / 模型报错）。"""


def _timeout(read: float | None = None) -> httpx.Timeout:
    return httpx.Timeout(read or config.OPENCODE_TIMEOUT_SECONDS, connect=10.0)


def _request(
    method: str,
    path: str,
    body: Any = None,
    read_timeout: float | None = None,
    retries: int = 0,
) -> Any:
    """调用 opencode。

    retries 只用于「请求没发出去 / 连接层失败」这类传输错误（httpx.HTTPError），
    引擎已经返回 4xx/5xx 时不重试——那类响应里包含了模型与会话的真实状态。
    """
    attempt = 0
    while True:
        try:
            with httpx.Client(base_url=config.OPENCODE_URL, timeout=_timeout(read_timeout)) as client:
                response = client.request(method, path, json=body)
            break
        except httpx.HTTPError as exc:
            if attempt >= retries:
                raise OpenCodeError(f"抽取引擎不可达：{exc}") from exc
            attempt += 1
            log.warning(
                "抽取引擎连接失败（%s %s），%.0f 秒后第 %d 次重试：%s",
                method, path, _RETRY_BACKOFF * attempt, attempt, exc,
            )
            time.sleep(_RETRY_BACKOFF * attempt)
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
    data = _request("GET", "/global/health", read_timeout=10.0, retries=_LIGHT_RETRIES)
    return data if isinstance(data, dict) else {"healthy": False}


def apply_global_config(cfg: dict) -> dict:
    data = _request(
        "PATCH", "/global/config", body=cfg, read_timeout=30.0, retries=_LIGHT_RETRIES
    )
    return data if isinstance(data, dict) else {}


def list_providers() -> dict:
    data = _request("GET", "/provider", read_timeout=30.0, retries=_LIGHT_RETRIES)
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


def reload_instance() -> None:
    """让引擎丢弃当前实例与全局缓存。

    兜底用：模型名正常应该已经由 settings 登记在 provider 里，走不到这里。
    实测 dispose 并不会让引擎重读配置文件里的模型列表，但它是 HTTP 侧唯一的
    重载入口，试一次不花钱；真刷不动时错误信息会把重启命令直接写给运维。
    """
    for path in ("/instance/dispose", "/global/dispose"):
        try:
            _request("POST", path, read_timeout=30.0, retries=_LIGHT_RETRIES)
        except OpenCodeError as exc:
            log.warning("抽取引擎重载（%s）失败：%s", path, exc)


def wait_ready(model: str, attempts: int = 6, interval: float = 0.5) -> bool:
    """等引擎的 provider 列表跟上当前配置。"""
    for _ in range(attempts):
        if provider_ready(model):
            return True
        time.sleep(interval)
    return provider_ready(model)


def ensure_provider(cfg: dict | None, model: str) -> None:
    if not cfg or not model:
        raise OpenCodeError("尚未配置 LLM（系统设置 → LLM 配置）")
    if provider_ready(model):
        return
    apply_global_config(cfg)
    # 刚启动的引擎加载配置需要一点时间
    if wait_ready(model):
        return
    reload_instance()
    if wait_ready(model):
        return
    declared = ((cfg.get("provider") or {}).get(config.OPENCODE_MODEL_PROVIDER) or {}).get("models") or {}
    if model not in declared:
        raise OpenCodeError(f"配置里没有模型 {model}，请检查系统设置 → LLM 配置的模型名")
    raise OpenCodeError(
        f"抽取引擎未加载模型 {model}（引擎只在启动时读配置），"
        f"配置已写入 {config.OPENCODE_CONFIG_PATH}，请执行 docker compose restart opencode 后重试"
    )


def create_session(title: str, model: str) -> str:
    data = _request(
        "POST",
        "/session",
        body={
            "title": title[:120],
            "model": {"id": model, "providerID": config.OPENCODE_MODEL_PROVIDER},
        },
        read_timeout=30.0,
        retries=_LIGHT_RETRIES,
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
        _request(
            "DELETE", f"/session/{session_id}", read_timeout=10.0, retries=_LIGHT_RETRIES
        )
    except OpenCodeError as exc:
        log.debug("删除 opencode 会话失败：%s", exc)
