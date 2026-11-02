"""系统设置：保存于 PostgreSQL，API Key 仅存服务端，读取时脱敏。"""

from __future__ import annotations

import copy
import json
import logging
import os
from pathlib import Path

from .. import config, db
from . import opencode_client

log = logging.getLogger(__name__)

DEFAULTS = {
    "llm": {"base_url": "", "model": "", "api_key": ""},
    "embedding": {"base_url": "", "model": "", "api_key": ""},
    "mineru": {
        "mode": config.MINERU_MODE,
        "url": config.MINERU_URL,
        "api_key": config.MINERU_API_KEY,
        "tier": config.MINERU_TIER,
    },
}


def _merge(base: dict, override: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge(result[key], value)
        else:
            result[key] = value
    return result


def _bootstrap() -> dict:
    """环境变量只在数据库尚无配置时作为初始值。"""
    cfg = copy.deepcopy(DEFAULTS)
    for section, env in (("llm", config.ENV_LLM), ("embedding", config.ENV_EMBEDDING)):
        for key, value in env.items():
            if value:
                cfg[section][key] = value
    return cfg


def get_settings() -> dict:
    row = db.fetch_one("SELECT value FROM app_setting WHERE id = 1")
    stored = row["value"] if row and isinstance(row["value"], dict) else {}
    cfg = _merge(_bootstrap(), stored)
    mined = stored.get("mineru") if isinstance(stored.get("mineru"), dict) else {}
    if not mined.get("mode"):
        # 兼容升级前的配置：已经填了私有服务地址的，继续走 selfhost，避免突然切到云端。
        cfg["mineru"]["mode"] = "selfhost" if mined.get("url") else config.MINERU_MODE
    if cfg["mineru"].get("mode") not in ("agent", "precision", "selfhost"):
        cfg["mineru"]["mode"] = config.MINERU_MODE
    return cfg


def _clean_text(value, limit=500) -> str:
    return str(value or "").strip()[:limit]


def save_settings(payload: dict) -> dict:
    current = get_settings()
    incoming = copy.deepcopy(payload or {})
    for section in ("llm", "embedding"):
        if section not in incoming:
            continue
        conf = incoming[section] or {}
        for field in ("base_url", "model"):
            if field in conf:
                current[section][field] = _clean_text(conf[field], 1000)
        # api_key 为 None 表示保持原值；空字符串表示清除
        if "api_key" in conf and conf["api_key"] is not None:
            current[section]["api_key"] = _clean_text(conf["api_key"], 2000)
    if "mineru" in incoming:
        conf = incoming["mineru"] or {}
        mode = str(conf.get("mode") or "").strip().lower()
        if mode in ("agent", "precision", "selfhost"):
            current["mineru"]["mode"] = mode
        for field in ("url", "api_key"):
            if field in conf and conf[field] is not None:
                current["mineru"][field] = _clean_text(conf[field], 2000)
        if conf.get("tier") in ("flash", "standard", "advanced"):
            current["mineru"]["tier"] = conf["tier"]

    json_value = json.dumps(current, ensure_ascii=False)
    db.execute(
        """
        INSERT INTO app_setting (id, value, updated_at) VALUES (1, %s::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET value = excluded.value, updated_at = now()
        """,
        (json_value,),
    )
    return current


def public_settings() -> dict:
    cfg = get_settings()
    public = copy.deepcopy(cfg)
    for section in ("llm", "embedding"):
        public[section]["key_set"] = bool(public[section].get("api_key"))
        public[section]["api_key"] = ""
    public["embedding"]["fallback_to_llm"] = not bool(public["embedding"].get("base_url"))
    public["mineru"]["key_set"] = bool(public["mineru"].get("api_key"))
    public["mineru"]["api_key"] = ""
    public["opencode"] = {"url": config.OPENCODE_URL}
    return public


def effective_embedding() -> dict:
    """Embedding 未单独配置时复用 LLM 服务。"""
    cfg = get_settings()
    emb = cfg["embedding"]
    base_url = emb.get("base_url") or cfg["llm"].get("base_url", "")
    api_key = emb.get("api_key") or cfg["llm"].get("api_key", "")
    return {
        "base_url": base_url.strip(),
        "model": emb.get("model", "").strip(),
        "api_key": api_key,
    }


def opencode_config(settings: dict | None = None) -> dict | None:
    cfg = settings or get_settings()
    llm = cfg["llm"]
    base_url = (llm.get("base_url") or "").strip()
    model = (llm.get("model") or "").strip()
    if not base_url or not model:
        return None
    entry = {
        "name": model,
        "id": model,
        "tool_call": False,
        "attachment": False,
        "temperature": True,
        "limit": {"context": 200000, "output": 32000},
    }
    return {
        "$schema": "https://opencode.ai/config.json",
        "model": f"{config.OPENCODE_MODEL_PROVIDER}/{model}",
        "provider": {
            config.OPENCODE_MODEL_PROVIDER: {
                "npm": "@ai-sdk/openai-compatible",
                "name": "GrowKnow LLM",
                "options": {
                    "baseURL": base_url,
                    "apiKey": (llm.get("api_key") or "sk-growknow").strip() or "sk-growknow",
                    "timeout": int(config.OPENCODE_TIMEOUT_SECONDS * 1000),
                },
                "models": {model: entry},
            }
        },
        "share": "disabled",
        "autoupdate": False,
    }


def write_opencode_config(cfg: dict | None = None) -> Path | None:
    cfg = cfg if cfg is not None else opencode_config()
    if not cfg:
        return None
    path = config.OPENCODE_CONFIG_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    # api 与 worker 可能同时写同一份配置，临时文件名带上进程号避免互相覆盖
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(path)
    return path


def sync_opencode_config(apply: bool = True) -> dict:
    """把当前 LLM 配置写成 opencode provider，并热更新运行中的引擎。"""
    cfg = opencode_config()
    result = {"written": False, "applied": False, "reason": ""}
    if not cfg:
        result["reason"] = "尚未配置 LLM"
        return result
    try:
        write_opencode_config(cfg)
        result["written"] = True
    except OSError as exc:
        result["reason"] = f"写入配置失败：{exc}"
        log.warning(result["reason"])
        return result
    if apply:
        try:
            opencode_client.apply_global_config(cfg)
            result["applied"] = True
        except Exception as exc:  # noqa: BLE001
            result["reason"] = f"引擎暂不可达，配置将在其重启后生效：{exc}"
            log.warning(result["reason"])
    return result
