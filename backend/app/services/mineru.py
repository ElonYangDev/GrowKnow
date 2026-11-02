"""MinerU 多模式客户端：官方轻量 / 官方精准 / 私有部署，统一输出页块结构。

三种服务的 HTTP 协议并不相同：

- agent：mineru.net 免 Token 轻量解析，create → PUT 上传 → 轮询 → 下载 Markdown；
- precision：mineru.net 精准解析 v4，申请签名 URL → PUT → 轮询批次 → 下载 zip；
- selfhost：私有 MinerU V1，上传 → 解析任务 → 轮询 → 下载 zip。

本模块把它们统一归一化成 growknow 内部使用的 ``{"pages": [{"page_idx", "blocks"}]}``。
官方轻量接口只返回 Markdown，不包含页码，因此该模式的切片页码标记为未知。
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import mimetypes
import re
import time
import uuid
import zipfile
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx

from .. import config

log = logging.getLogger(__name__)

TERMINAL = {"completed", "partial", "failed", "canceled"}
MODES = ("agent", "precision", "selfhost")
MIME_MAP = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")
_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\([^)]+\)")


class MinerUError(Exception):
    pass


def _conf(conf: dict | None = None) -> dict:
    """配置入口：系统设置优先，缺省回落到部署环境变量。"""
    conf = conf or {}
    mode = str(conf.get("mode") or config.MINERU_MODE or "agent").strip().lower()
    if mode not in MODES:
        mode = "agent"
    return {
        "mode": mode,
        "url": (conf.get("url") or config.MINERU_URL or "").rstrip("/"),
        "agent_url": (conf.get("agent_url") or config.MINERU_AGENT_URL or "").rstrip("/"),
        "precise_url": (conf.get("precise_url") or config.MINERU_PRECISE_URL or "").rstrip("/"),
        "api_key": conf.get("api_key") if conf.get("api_key") is not None else config.MINERU_API_KEY,
        "tier": conf.get("tier") or config.MINERU_TIER,
        "language": conf.get("language") or config.MINERU_LANGUAGE,
    }


def _headers(conf: dict, auth: bool = True) -> dict:
    headers = {}
    if auth and conf["api_key"]:
        headers["Authorization"] = "Bearer " + conf["api_key"]
    return headers


def _same_origin(base_url: str, url: str) -> bool:
    base = urlsplit(base_url)
    target = urlsplit(url)
    return (base.scheme, base.hostname, base.port or 80) == (
        target.scheme,
        target.hostname,
        target.port or 80,
    )


def _request(client: httpx.Client, conf: dict, method: str, url: str, **kwargs):
    try:
        response = client.request(
            method, url, headers={**_headers(conf), **kwargs.pop("headers", {})}, **kwargs
        )
    except httpx.HTTPError as exc:
        raise MinerUError(f"MinerU 请求失败（{method} {url}）：{exc}") from exc
    if response.status_code >= 400:
        raise MinerUError(f"MinerU HTTP {response.status_code}：{response.text[:300]}")
    return response


def _json(response: httpx.Response) -> dict:
    try:
        return response.json()
    except ValueError as exc:
        raise MinerUError(f"MinerU 返回的不是合法 JSON：{response.text[:300]}") from exc


def health(conf: dict | None = None) -> dict:
    cfg = _conf(conf)
    if cfg["mode"] == "agent":
        return _health_agent(cfg)
    if cfg["mode"] == "precision":
        return _health_precision(cfg)
    return _health_selfhost(cfg)


def _health_selfhost(cfg: dict) -> dict:
    if not cfg["url"]:
        raise MinerUError("尚未配置私有 MinerU 服务地址")
    try:
        with httpx.Client(timeout=15) as client:
            response = client.get(cfg["url"] + "/v1/health", headers=_headers(cfg))
        if response.status_code >= 400:
            raise MinerUError(f"MinerU HTTP {response.status_code}")
        return response.json()
    except httpx.HTTPError as exc:
        raise MinerUError(f"MinerU 连接失败：{exc}") from exc


def _health_agent(cfg: dict) -> dict:
    """轻量接口没有健康检查端点，用一个不存在的任务探测服务可达性。"""
    probe = cfg["agent_url"] + "/parse/00000000-0000-0000-0000-000000000000"
    try:
        with httpx.Client(timeout=15) as client:
            response = client.get(probe)
    except httpx.HTTPError as exc:
        raise MinerUError(f"MinerU 官方轻量 API 连接失败：{exc}") from exc
    if response.status_code >= 500:
        raise MinerUError(f"MinerU 官方轻量 API 返回 HTTP {response.status_code}")
    return {
        "status": "ok",
        "engine": "mineru-official-agent",
        "mode": "agent",
        "version": "官方轻量 · 免 Token",
        "free": True,
        "limits": {
            "max_mb": config.MINERU_AGENT_MAX_BYTES // (1024 * 1024),
            "max_pages": config.MINERU_AGENT_MAX_PAGES,
            "output": "markdown",
        },
    }


def _health_precision(cfg: dict) -> dict:
    if not cfg["api_key"]:
        raise MinerUError("官方精准解析需要填写 API Token")
    probe = cfg["precise_url"] + "/extract/task/00000000-0000-0000-0000-000000000000"
    try:
        with httpx.Client(timeout=15) as client:
            response = client.get(probe, headers=_headers(cfg))
    except httpx.HTTPError as exc:
        raise MinerUError(f"MinerU 官方精准 API 连接失败：{exc}") from exc
    if response.status_code == 401:
        raise MinerUError("MinerU 官方精准 API Token 无效")
    if response.status_code >= 500:
        raise MinerUError(f"MinerU 官方精准 API 返回 HTTP {response.status_code}")
    return {
        "status": "ok",
        "engine": "mineru-official-precision",
        "mode": "precision",
        "version": "官方精准 · Token",
        "token_set": True,
    }


# ============================== 私有部署 V1 ==============================


def _upload(client: httpx.Client, path: Path, conf: dict) -> str:
    data = path.read_bytes()
    payload = {
        "filename": path.name,
        "bytes": len(data),
        "mime_type": MIME_MAP.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        "purpose": "parse",
        "sha256sum": hashlib.sha256(data).hexdigest(),
    }
    response = _request(client, conf, "POST", conf["url"] + "/v1/uploads", json=payload)
    obj = _json(response)
    if obj.get("status") == "completed":
        file_obj = obj.get("file") or {}
        if not file_obj.get("id"):
            raise MinerUError("MinerU 秒传响应缺少 file.id")
        return file_obj["id"]
    if obj.get("status") != "pending" or not obj.get("upload_url"):
        raise MinerUError(f"MinerU 上传响应异常：{str(obj)[:300]}")

    upload_url = urljoin(conf["url"], obj["upload_url"])
    headers = dict(obj.get("upload_headers") or {})
    if conf["api_key"] and _same_origin(conf["url"], upload_url):
        headers["Authorization"] = "Bearer " + conf["api_key"]
    response = _request(client, conf, obj.get("upload_method", "PUT"), upload_url, content=data, headers=headers)
    if response.status_code >= 400:
        raise MinerUError(f"MinerU 上传文件失败：HTTP {response.status_code}")

    upload_id = obj.get("id")
    if not upload_id:
        raise MinerUError("MinerU 上传响应缺少 id")
    response = _request(client, conf, "POST", conf["url"] + f"/v1/uploads/{upload_id}/complete")
    completed = _json(response)
    file_obj = completed.get("file") or {}
    if not file_obj.get("id"):
        raise MinerUError("MinerU 完成上传响应缺少 file.id")
    return file_obj["id"]


def _parse_selfhost(path: Path, work_dir: Path, cfg: dict, check_cancel=None) -> dict:
    if not cfg["url"]:
        raise MinerUError("尚未配置私有 MinerU 服务地址")
    timeout = httpx.Timeout(config.MINERU_TRANSFER_TIMEOUT, connect=15.0)
    with httpx.Client(timeout=timeout) as client:
        file_id = _upload(client, path, cfg)
        log.info("MinerU 上传完成 %s file_id=%s", path.name, file_id)
        response = _request(
            client,
            cfg,
            "POST",
            cfg["url"] + "/v1/parse/jobs",
            json={
                "files": [{"source": {"type": "file_id", "file_id": file_id}}],
                "tier": cfg["tier"],
                "output_formats": ["zip"],
            },
        )
        job = _json(response)
        job_id = job.get("job_id")
        if not job_id:
            raise MinerUError(f"MinerU 任务响应缺少 job_id：{str(job)[:300]}")

        job = {}
        for _ in range(config.MINERU_MAX_POLLS):
            if check_cancel:
                check_cancel()
            job = _json(_request(client, cfg, "GET", cfg["url"] + f"/v1/parse/jobs/{job_id}"))
            status = job.get("status")
            if status in TERMINAL:
                break
            time.sleep(config.MINERU_POLL_INTERVAL)
        else:
            raise MinerUError(f"MinerU 解析超时（job {job_id}）")

        if job.get("status") != "completed":
            raise MinerUError(f"MinerU 解析失败：状态 {job.get('status')}（job {job_id}）")

        zip_file_id = None
        for item in job.get("files") or []:
            if item.get("status") == "completed":
                ref = (item.get("output_files") or {}).get("zip") or {}
                zip_file_id = ref.get("file_id")
                if zip_file_id:
                    break
        if not zip_file_id:
            raise MinerUError("MinerU 未返回 zip 产物")

        response = _request(client, cfg, "GET", cfg["url"] + f"/v1/files/{zip_file_id}/content")
        zip_path = work_dir / "mineru_output.zip"
        zip_path.write_bytes(response.content)

    try:
        with zipfile.ZipFile(zip_path) as zf:
            entry = "structured_content.json"
            raw = zf.read(entry)
    except (KeyError, zipfile.BadZipFile) as exc:
        raise MinerUError(f"MinerU zip 产物缺少 {entry}：{exc}") from exc
    finally:
        zip_path.unlink(missing_ok=True)

    try:
        structured = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise MinerUError("MinerU 结构化结果不是合法 JSON") from exc
    if not isinstance(structured, dict):
        raise MinerUError("MinerU 结构化结果格式异常")
    structured["page_count"] = len(structured.get("pages") or [])
    return structured


# ============================== 官方轻量 Agent ==============================


def _pdf_page_count(path: Path) -> int:
    if path.suffix.lower() != ".pdf":
        return 0
    try:
        from pypdf import PdfReader

        return len(PdfReader(str(path)).pages)
    except Exception:  # noqa: BLE001 损坏/加密的 PDF 交给服务端判断
        return 0


def _agent_create(client: httpx.Client, cfg: dict, path: Path, page_range: str | None = None) -> tuple[str, str]:
    payload = {
        "file_name": path.name,
        "language": cfg["language"],
        "enable_table": True,
        "is_ocr": False,
        "enable_formula": True,
    }
    if page_range:
        payload["page_range"] = page_range
    try:
        response = client.post(cfg["agent_url"] + "/parse/file", json=payload)
    except httpx.HTTPError as exc:
        raise MinerUError(f"MinerU 官方轻量 API 请求失败：{exc}") from exc
    if response.status_code >= 500:
        raise MinerUError(f"MinerU 官方轻量 API 返回 HTTP {response.status_code}：{response.text[:200]}")
    if response.status_code == 429:
        raise MinerUError("MinerU 官方轻量 API 触发限频（HTTP 429），请稍后重试或改用精准 API / 私有部署")
    obj = _json(response)
    if obj.get("code") not in (0, None):
        raise MinerUError(f"MinerU 官方轻量 API 返回错误：{obj.get('msg') or obj.get('code')}")
    data = obj.get("data") or {}
    task_id = data.get("task_id")
    file_url = data.get("file_url")
    if not task_id or not file_url:
        raise MinerUError(f"MinerU 官方轻量 API 响应缺少 task_id/file_url：{str(obj)[:300]}")
    return task_id, file_url


def _agent_wait(client: httpx.Client, cfg: dict, task_id: str, check_cancel=None) -> str:
    for _ in range(config.MINERU_MAX_POLLS):
        if check_cancel:
            check_cancel()
        try:
            response = client.get(f"{cfg['agent_url']}/parse/{task_id}")
        except httpx.HTTPError as exc:
            raise MinerUError(f"MinerU 官方轻量 API 轮询失败：{exc}") from exc
        if response.status_code == 429:
            raise MinerUError("MinerU 官方轻量 API 触发限频（HTTP 429），请稍后重试或改用精准 API / 私有部署")
        if response.status_code >= 500:
            raise MinerUError(f"MinerU 官方轻量 API 轮询失败：HTTP {response.status_code}")
        obj = _json(response)
        data = obj.get("data") or {}
        state = data.get("state")
        if state == "done":
            url = data.get("markdown_url")
            if not url:
                raise MinerUError("MinerU 官方轻量 API 未返回 markdown_url")
            try:
                markdown = client.get(url)
            except httpx.HTTPError as exc:
                raise MinerUError(f"下载 MinerU 轻量解析结果失败：{exc}") from exc
            if markdown.status_code >= 400:
                raise MinerUError(f"下载 MinerU 轻量解析结果失败：HTTP {markdown.status_code}")
            return markdown.text
        if state == "failed":
            code = data.get("err_code")
            message = data.get("err_msg") or "解析失败"
            if code == -30003:
                raise MinerUError(
                    "MinerU 官方轻量 API 超过 20 页限制；PDF 会自动按 20 页分批，"
                    "DOC/DOCX 请改用官方精准 API 或私有部署"
                )
            if code == -30001:
                raise MinerUError("MinerU 官方轻量 API 超过 10MB 限制，请改用官方精准 API 或私有部署")
            raise MinerUError(f"MinerU 官方轻量 API 解析失败（{code}）：{message}")
        time.sleep(config.MINERU_POLL_INTERVAL)
    raise MinerUError(f"MinerU 官方轻量 API 解析超时（task {task_id}）")


def _parse_agent(path: Path, cfg: dict, check_cancel=None) -> dict:
    size = path.stat().st_size
    if size > config.MINERU_AGENT_MAX_BYTES:
        raise MinerUError(
            f"文件 {size / 1024 / 1024:.1f}MB 超过官方轻量 API 的 "
            f"{config.MINERU_AGENT_MAX_BYTES // (1024 * 1024)}MB 限制，"
            "请改用官方精准 API 或私有部署"
        )
    pages = _pdf_page_count(path)
    limit = max(1, config.MINERU_AGENT_MAX_PAGES)
    ranges: list[str | None]
    if pages > limit:
        ranges = [f"{start}-{min(start + limit - 1, pages)}" for start in range(1, pages + 1, limit)]
    else:
        ranges = [None]

    data = path.read_bytes()
    marks: list[str] = []
    timeout = httpx.Timeout(config.MINERU_TRANSFER_TIMEOUT, connect=15.0)
    with httpx.Client(timeout=timeout) as client:
        for index, page_range in enumerate(ranges, start=1):
            if check_cancel:
                check_cancel()
            task_id, file_url = _agent_create(client, cfg, path, page_range)
            log.info(
                "MinerU 官方轻量解析 %s 批次 %d/%d（%s）task=%s",
                path.name, index, len(ranges), page_range or "全文", task_id,
            )
            try:
                upload = client.put(file_url, content=data)
            except httpx.HTTPError as exc:
                raise MinerUError(f"MinerU 官方轻量 API 上传失败：{exc}") from exc
            if upload.status_code >= 400:
                raise MinerUError(f"MinerU 官方轻量 API 上传失败：HTTP {upload.status_code}")
            marks.append(_agent_wait(client, cfg, task_id, check_cancel))

    structured = markdown_to_structured("\n\n".join(marks), page_count=pages or 1)
    log.info("MinerU 官方轻量解析完成 %s：%d 批，%d 页", path.name, len(ranges), pages or 1)
    return structured


# ============================== 官方精准 v4 ==============================


def _precision_zip(path: Path, work_dir: Path, cfg: dict, check_cancel=None) -> bytes:
    timeout = httpx.Timeout(config.MINERU_TRANSFER_TIMEOUT, connect=15.0)
    with httpx.Client(timeout=timeout) as client:
        payload = {
            "enable_formula": True,
            "language": cfg["language"],
            "enable_table": True,
            "model_version": "pipeline",
            "files": [{"name": path.name, "data_id": uuid.uuid4().hex, "is_ocr": False}],
        }
        response = _request(
            client, cfg, "POST", cfg["precise_url"] + "/file-urls/batch", json=payload
        )
        obj = _json(response)
        if obj.get("code") not in (0, None):
            raise MinerUError(f"MinerU 官方精准 API 返回错误：{obj.get('msg') or obj.get('code')}")
        batch = obj.get("data") or {}
        batch_id = batch.get("batch_id")
        upload_url = (batch.get("file_urls") or [None])[0]
        if not batch_id or not upload_url:
            raise MinerUError(f"MinerU 官方精准 API 响应缺少 batch_id/file_urls：{str(obj)[:300]}")

        try:
            upload = client.put(upload_url, content=path.read_bytes())
        except httpx.HTTPError as exc:
            raise MinerUError(f"MinerU 官方精准 API 上传失败：{exc}") from exc
        if upload.status_code >= 400:
            raise MinerUError(f"MinerU 官方精准 API 上传失败：HTTP {upload.status_code}")

        item = {}
        for _ in range(config.MINERU_MAX_POLLS):
            if check_cancel:
                check_cancel()
            response = _request(
                client, cfg, "GET", cfg["precise_url"] + f"/extract-results/batch/{batch_id}"
            )
            result = _json(response)
            data = result.get("data") or {}
            items = data.get("extract_result") or data.get("results") or []
            item = items[0] if items else {}
            state = item.get("state")
            if state in {"done", "failed"}:
                break
            time.sleep(max(config.MINERU_POLL_INTERVAL, 3.0))
        else:
            raise MinerUError(f"MinerU 官方精准 API 解析超时（batch {batch_id}）")

        if item.get("state") != "done":
            raise MinerUError(
                f"MinerU 官方精准 API 解析失败：{item.get('err_msg') or item.get('state') or '未知状态'}"
            )
        zip_url = item.get("full_zip_url")
        if not zip_url:
            raise MinerUError("MinerU 官方精准 API 未返回 full_zip_url")
        try:
            archive = client.get(zip_url)
        except httpx.HTTPError as exc:
            raise MinerUError(f"下载 MinerU 精准解析结果失败：{exc}") from exc
        if archive.status_code >= 400:
            raise MinerUError(f"下载 MinerU 精准解析结果失败：HTTP {archive.status_code}")
        return archive.content


def _parse_precision(path: Path, work_dir: Path, cfg: dict, check_cancel=None) -> dict:
    if not cfg["api_key"]:
        raise MinerUError("官方精准解析需要填写 API Token")
    archive = _precision_zip(path, work_dir, cfg, check_cancel)
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as zf:
            names = zf.namelist()
            content_name = next((n for n in names if n.endswith("content_list.json")), None)
            if content_name:
                items = json.loads(zf.read(content_name).decode("utf-8"))
                if isinstance(items, dict):
                    items = items.get("content_list") or items.get("items") or []
                structured = content_list_to_structured(items)
            else:
                md_name = next((n for n in names if n.endswith(".md")), None)
                if not md_name:
                    raise MinerUError("MinerU 精准解析 zip 中缺少 content_list.json 或 Markdown")
                markdown = zf.read(md_name).decode("utf-8", errors="replace")
                structured = markdown_to_structured(markdown, page_count=1)
    except (zipfile.BadZipFile, ValueError, UnicodeDecodeError) as exc:
        raise MinerUError(f"MinerU 精准解析结果无法读取：{exc}") from exc
    log.info("MinerU 官方精准解析完成 %s：%d 页", path.name, structured.get("page_count") or 0)
    return structured


# ============================== 结果归一化 ==============================


def markdown_to_structured(markdown: str, page_count: int = 1) -> dict:
    """把 Markdown 转成页块结构；轻量接口没有页码，统一用 page_idx=-1 表示未知。"""
    lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[dict] = []
    buffer: list[str] = []

    def flush() -> None:
        if buffer:
            text = "\n".join(buffer).strip()
            buffer.clear()
            if text:
                blocks.append({"type": "text", "content": text})

    index = 0
    while index < len(lines):
        line = lines[index].rstrip()
        stripped = line.strip()
        if not stripped:
            flush()
            index += 1
            continue
        heading = _HEADING_RE.match(stripped)
        if heading:
            flush()
            blocks.append(
                {"type": "title", "level": len(heading.group(1)), "content": heading.group(2).strip()}
            )
            index += 1
            continue
        if "<table" in stripped.lower():
            flush()
            table_lines = [line]
            while "</table>" not in table_lines[-1].lower() and index + 1 < len(lines):
                index += 1
                table_lines.append(lines[index].rstrip())
            blocks.append({"type": "table", "content": "\n".join(table_lines).strip()})
            index += 1
            continue
        if stripped.startswith("!["):
            flush()
            match = _IMAGE_RE.search(stripped)
            caption = match.group(1).strip() if match else ""
            blocks.append({"type": "image", "captions": [caption] if caption else [], "content": ""})
            index += 1
            continue
        buffer.append(line)
        index += 1
    flush()

    return {
        "pages": [{"page_idx": -1, "blocks": blocks}],
        "page_count": max(1, int(page_count or 1)),
        "metadata": {"source": "mineru-agent", "page_accurate": False},
        "is_full_document": True,
    }


def content_list_to_structured(items: list) -> dict:
    """把官方精准解析的 content_list.json 转成页块结构。"""
    pages: dict[int, list[dict]] = {}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        try:
            page_idx = int(item.get("page_idx") or 0)
        except (TypeError, ValueError):
            page_idx = 0
        kind = str(item.get("type") or "text").lower()
        if kind in {"title", "doc_title", "paragraph_title"}:
            block = {"type": "title", "content": _text_of(item)}
            try:
                block["level"] = max(1, min(int(item.get("text_level") or 1), 6))
            except (TypeError, ValueError):
                block["level"] = 1
        elif kind == "table":
            block = {"type": "table", "content": item.get("table_body") or _text_of(item)}
        elif kind == "image":
            captions = item.get("image_caption") or item.get("table_caption") or []
            if isinstance(captions, str):
                captions = [captions]
            block = {"type": "image", "captions": [str(c) for c in captions if c], "content": ""}
        elif kind in {"equation", "formula"}:
            block = {"type": "equation", "content": item.get("latex") or _text_of(item)}
        else:
            block = {"type": "text", "content": _text_of(item)}
        if block["type"] != "image" and not block.get("content"):
            continue
        pages.setdefault(page_idx, []).append(block)

    page_count = max(pages) + 1 if pages else 0
    return {
        "pages": [{"page_idx": idx, "blocks": pages[idx]} for idx in sorted(pages)],
        "page_count": page_count,
        "metadata": {"source": "mineru-precision", "page_accurate": True},
        "is_full_document": True,
    }


def _text_of(item: dict) -> str:
    for key in ("text", "content", "table_body", "latex"):
        value = item.get(key)
        if value:
            return str(value).strip()
    return ""


# ============================== 对外入口 ==============================


def parse_document(
    path: Path,
    work_dir: Path,
    conf: dict | None = None,
    check_cancel=None,
) -> dict:
    """解析 PDF/DOC/DOCX，返回统一页块结构。"""
    cfg = _conf(conf)
    work_dir.mkdir(parents=True, exist_ok=True)
    if cfg["mode"] == "agent":
        structured = _parse_agent(path, cfg, check_cancel)
    elif cfg["mode"] == "precision":
        structured = _parse_precision(path, work_dir, cfg, check_cancel)
    else:
        structured = _parse_selfhost(path, work_dir, cfg, check_cancel)
    if not structured.get("page_count"):
        structured["page_count"] = len(structured.get("pages") or [])
    log.info(
        "MinerU 解析完成 %s：模式 %s，%d 页",
        path.name,
        cfg["mode"],
        structured.get("page_count") or 0,
    )
    return structured
