"""HTTP 接口层：统一响应 {code, message, data}，业务错误由 ApiError 表达。"""

from __future__ import annotations

import io
import re
import shutil
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Body, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from . import config, db, i18n
from .services import age_store, embedding, mineru, opencode_client, settings

router = APIRouter(prefix="/api/v1")

KB_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$")
KINDS = ("vector", "triple", "graph")


class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        self.status = status
        self.message = message
        super().__init__(message)


def ok(data=None, message: str = "ok") -> dict:
    return {"code": 0, "message": i18n.translate(message), "data": data}


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ============================== 健康检查 ==============================


@router.get("/health")
def health() -> dict:
    db.fetch_one("SELECT 1 AS ok")
    return ok({"status": "ok", "time": _now(), "version": "1.0.0"})


@router.get("/health/deps")
def health_deps() -> dict:
    result = {}
    try:
        db.fetch_one("SELECT 1 AS ok")
        result["postgres"] = {"ok": True}
    except Exception as exc:  # noqa: BLE001
        result["postgres"] = {"ok": False, "error": str(exc)[:300]}
    result["age"] = age_store.health()
    try:
        result["opencode"] = {"ok": True, **opencode_client.health()}
    except Exception as exc:  # noqa: BLE001
        result["opencode"] = {"ok": False, "error": str(exc)[:300]}
    try:
        result["mineru"] = {"ok": True, **mineru.health(settings.get_settings()["mineru"])}
    except Exception as exc:  # noqa: BLE001
        result["mineru"] = {"ok": False, "error": str(exc)[:300]}
    return ok(result)


# ============================== 知识库 ==============================

KB_STATS_SQL = """
SELECT k.id, k.kb_key, k.name, k.description, k.kind, k.created_at, k.updated_at,
       count(f.id) AS file_count,
       coalesce(sum(f.knowledge_count), 0) AS knowledge_count,
       count(f.id) FILTER (WHERE f.status IN ('queued', 'extracting')) AS pending_count
FROM kb k
LEFT JOIN kb_file f ON f.kb_id = k.id
"""


def _kb_row(kb_key: str) -> dict:
    row = db.fetch_one(
        KB_STATS_SQL + " WHERE k.kb_key = %s GROUP BY k.id", (kb_key,)
    )
    if not row:
        raise ApiError(404, "知识库不存在")
    return row


def _kb_payload(row: dict) -> dict:
    data = dict(row)
    data["kind_label"] = i18n.kind_label(row["kind"])
    if row["kind"] == "graph":
        try:
            data["graph_stats"] = age_store.stats(row["kb_key"])
        except Exception:  # noqa: BLE001
            data["graph_stats"] = {"nodes": 0, "edges": 0}
    return data


@router.get("/kb")
def list_kb() -> dict:
    rows = db.fetch_all(KB_STATS_SQL + " GROUP BY k.id ORDER BY k.created_at DESC")
    return ok([_kb_payload(row) for row in rows])


@router.post("/kb")
def create_kb(payload: dict = Body(...)) -> dict:
    name = " ".join(str(payload.get("name") or "").split())
    kb_key = str(payload.get("kb_key") or "").strip()
    description = str(payload.get("description") or "").strip()[:1000]
    kind = str(payload.get("kind") or "").strip()
    if not name or len(name) > 60:
        raise ApiError(400, "知识库名称需为 1-60 个字符")
    if not KB_KEY_RE.match(kb_key):
        raise ApiError(400, "知识库 ID 需以英文字母或数字开头，仅包含字母、数字、- 和 _，长度 2-64")
    if kind not in KINDS:
        raise ApiError(400, "知识库类型不合法")
    if db.fetch_one("SELECT id FROM kb WHERE kb_key = %s", (kb_key,)):
        raise ApiError(409, "知识库 ID 已被占用")
    row = db.insert_returning(
        """
        INSERT INTO kb (kb_key, name, description, kind)
        VALUES (%s, %s, %s, %s) RETURNING id
        """,
        (kb_key, name, description, kind),
    )
    return ok(_kb_payload(_kb_row(kb_key)), "知识库已创建")


@router.get("/kb/{kb_key}")
def get_kb(kb_key: str) -> dict:
    return ok(_kb_payload(_kb_row(kb_key)))


@router.patch("/kb/{kb_key}")
def update_kb(kb_key: str, payload: dict = Body(...)) -> dict:
    current = _kb_row(kb_key)
    name = current["name"]
    description = current["description"]
    new_key = kb_key
    if "name" in payload:
        name = " ".join(str(payload.get("name") or "").split())
        if not name or len(name) > 60:
            raise ApiError(400, "知识库名称需为 1-60 个字符")
    if "description" in payload:
        description = str(payload.get("description") or "").strip()[:1000]
    if "kb_key" in payload:
        candidate = str(payload.get("kb_key") or "").strip()
        if candidate != kb_key:
            if not KB_KEY_RE.match(candidate):
                raise ApiError(400, "知识库 ID 需以英文字母或数字开头，仅包含字母、数字、- 和 _，长度 2-64")
            if db.fetch_one("SELECT id FROM kb WHERE kb_key = %s", (candidate,)):
                raise ApiError(409, "知识库 ID 已被占用")
            new_key = candidate

    if new_key != kb_key:
        old_dir = config.UPLOAD_DIR / kb_key
        new_dir = config.UPLOAD_DIR / new_key
        if new_dir.exists():
            raise ApiError(409, "目标上传目录已存在，请更换 ID")
        if current["kind"] == "graph":
            age_store.rename_kb(kb_key, new_key)
        if old_dir.exists():
            old_dir.rename(new_dir)
            with db.connection() as conn:
                conn.execute(
                    """
                    UPDATE kb_file
                    SET rel_path = %s || substring(rel_path FROM %s)
                    WHERE kb_id = %s
                    """,
                    (new_key, len(kb_key) + 1, current["id"]),
                )
    db.execute(
        "UPDATE kb SET kb_key = %s, name = %s, description = %s, updated_at = now() WHERE id = %s",
        (new_key, name, description, current["id"]),
    )
    return ok(_kb_payload(_kb_row(new_key)), "知识库已更新")


@router.delete("/kb/{kb_key}")
def delete_kb(kb_key: str) -> dict:
    current = _kb_row(kb_key)
    ids = [
        row["id"]
        for row in db.fetch_all("SELECT id FROM kb_file WHERE kb_id = %s", (current["id"],))
    ]
    _abort_sessions(ids)
    if current["kind"] == "graph":
        try:
            age_store.delete_kb(kb_key)
        except Exception as exc:  # noqa: BLE001
            raise ApiError(502, f"删除图谱数据失败：{exc}") from exc
    db.execute("DELETE FROM kb WHERE id = %s", (current["id"],))
    shutil.rmtree(config.UPLOAD_DIR / kb_key, ignore_errors=True)
    return ok(None, "知识库已删除")


# ============================== 文件 ==============================


def _file_list(kb_id: int, file_ids: list[int] | None = None) -> list[dict]:
    rows = db.fetch_all(
        """
        SELECT f.id, f.kb_id, f.name, f.size, f.status, f.status_at, f.stage, f.progress,
               f.page_slices, f.skill_id, s.name AS skill_name, f.error, f.page_count,
               f.knowledge_count, f.created_at
        FROM kb_file f
        LEFT JOIN skill s ON s.id = f.skill_id
        WHERE f.kb_id = %s
        ORDER BY f.created_at DESC, f.id DESC
        """,
        (kb_id,),
    )
    if file_ids is not None:
        allowed = set(file_ids)
        rows = [row for row in rows if row["id"] in allowed]
    for row in rows:
        row["status_label"] = i18n.status_label(row["status"])
    return rows


@router.get("/kb/{kb_key}/files")
def list_files(kb_key: str) -> dict:
    kb = _kb_row(kb_key)
    return ok(_file_list(kb["id"]))


def _safe_name(name: str) -> str:
    base = Path(str(name or "document")).name.replace("\x00", "").strip()
    base = base or "document"
    return base[:180]


def _enqueue(file_id: int) -> None:
    db.execute(
        """
        INSERT INTO extract_job (file_id, status) VALUES (%s, 'queued')
        ON CONFLICT (file_id) DO UPDATE
        SET status = 'queued', error = NULL, started_at = NULL, finished_at = NULL,
            session_id = NULL
        """,
        (file_id,),
    )


def _abort_sessions(file_ids: list[int]) -> None:
    """中止这些文件正在运行的 opencode 会话，让取消/删除尽早生效。"""
    if not file_ids:
        return
    rows = db.fetch_all(
        """
        SELECT session_id FROM extract_job
        WHERE file_id = ANY(%s) AND status = 'running' AND session_id IS NOT NULL
        """,
        (file_ids,),
    )
    for row in rows:
        opencode_client.delete_session(row["session_id"])


@router.post("/kb/{kb_key}/files")
async def upload_files(
    kb_key: str,
    files: list[UploadFile] = File(...),
    page_slices: int = Form(5),
    skill_id: int | None = Form(None),
) -> dict:
    kb = _kb_row(kb_key)
    if not files:
        raise ApiError(400, "请选择要上传的文件")
    slices = max(1, min(int(page_slices or 5), 200))
    skill = None
    if kb["kind"] != "vector":
        if skill_id:
            skill = db.fetch_one("SELECT * FROM skill WHERE id = %s", (skill_id,))
            if not skill:
                raise ApiError(400, "知识抽取 skill 不存在")
            if skill["target"] not in ("any", kb["kind"]):
                raise ApiError(400, "该 skill 与知识库类型不匹配")
        else:
            default_slug = "generic-graph" if kb["kind"] == "graph" else "generic-triple"
            skill = db.fetch_one("SELECT * FROM skill WHERE slug = %s", (default_slug,))
    target_dir = config.UPLOAD_DIR / kb_key
    target_dir.mkdir(parents=True, exist_ok=True)
    created = []
    for upload in files:
        name = _safe_name(upload.filename or "document")
        suffix = Path(name).suffix.lower()
        if suffix not in config.ALLOWED_EXTENSIONS:
            raise ApiError(400, f"不支持的文件类型：{name}（仅支持 PDF / DOC / DOCX）")
        raw = await upload.read()
        if not raw:
            raise ApiError(400, f"文件为空：{name}")
        if len(raw) > config.MAX_UPLOAD_BYTES:
            raise ApiError(400, f"文件超过 {config.MAX_UPLOAD_BYTES // 1024 // 1024}MB：{name}")
        rel_name = f"{uuid.uuid4().hex[:10]}_{name}"
        (target_dir / rel_name).write_bytes(raw)
        row = db.insert_returning(
            """
            INSERT INTO kb_file (kb_id, name, rel_path, size, status, stage, progress,
                                 page_slices, skill_id)
            VALUES (%s, %s, %s, %s, 'queued', '排队中', 0, %s, %s)
            RETURNING id
            """,
            (kb["id"], name, f"{kb_key}/{rel_name}", len(raw), slices, skill["id"] if skill else None),
        )
        _enqueue(row["id"])
        created.append(row["id"])
    return ok(_file_list(kb["id"], created), "文件已上传，抽取任务已排队")


@router.post("/kb/{kb_key}/files/{file_id}/retry")
def retry_file(kb_key: str, file_id: int) -> dict:
    kb = _kb_row(kb_key)
    row = db.fetch_one(
        "SELECT id FROM kb_file WHERE id = %s AND kb_id = %s", (file_id, kb["id"])
    )
    if not row:
        raise ApiError(404, "文件不存在")
    db.execute(
        """
        UPDATE kb_file SET status = 'queued', status_at = now(), error = NULL,
                           knowledge_count = 0, stage = '排队中', progress = 0
        WHERE id = %s
        """,
        (file_id,),
    )
    _enqueue(file_id)
    return ok({"id": file_id}, "已重新排队")


@router.post("/kb/{kb_key}/files/{file_id}/cancel")
def cancel_file(kb_key: str, file_id: int) -> dict:
    """取消排队中或运行中的抽取；运行中的会话会被中止，部分知识清理后丢弃。"""
    kb = _kb_row(kb_key)
    file_row = db.fetch_one(
        "SELECT id, status FROM kb_file WHERE id = %s AND kb_id = %s", (file_id, kb["id"])
    )
    if not file_row:
        raise ApiError(404, "文件不存在")
    job = db.fetch_one(
        "SELECT id, status, session_id FROM extract_job WHERE file_id = %s", (file_id,)
    )
    if not job or job["status"] not in ("queued", "running"):
        raise ApiError(400, "当前状态不可取消")
    running = job["status"] == "running"
    db.execute(
        "UPDATE extract_job SET status = 'canceled', finished_at = now() WHERE id = %s",
        (job["id"],),
    )
    if running:
        # 先标记取消，再中止会话；worker 会把中断当作取消收尾
        db.execute(
            "UPDATE kb_file SET status = 'extracting', stage = '取消中…', "
            "progress = NULL WHERE id = %s AND status IN ('queued', 'extracting')",
            (file_id,),
        )
        if job["session_id"]:
            opencode_client.delete_session(job["session_id"])
        message = "正在取消抽取"
    else:
        db.execute(
            """
            UPDATE kb_file SET status = 'canceled', status_at = now(), stage = '已取消',
                               progress = NULL, knowledge_count = 0, error = NULL
            WHERE id = %s
            """,
            (file_id,),
        )
        message = "已取消排队中的任务"
    return ok({"id": file_id}, message)


@router.delete("/kb/{kb_key}/files")
def delete_files(kb_key: str, payload: dict = Body(...)) -> dict:
    kb = _kb_row(kb_key)
    ids = payload.get("file_ids") or []
    if not isinstance(ids, list) or not ids:
        raise ApiError(400, "请选择要删除的文件")
    ids = [int(item) for item in ids]
    rows = db.fetch_all(
        "SELECT id, rel_path FROM kb_file WHERE kb_id = %s AND id = ANY(%s)",
        (kb["id"], ids),
    )
    if not rows:
        raise ApiError(404, "文件不存在")
    _abort_sessions([row["id"] for row in rows])
    if kb["kind"] == "graph":
        for row in rows:
            try:
                age_store.delete_file(kb_key, row["id"])
            except Exception as exc:  # noqa: BLE001
                raise ApiError(502, f"删除图谱数据失败：{exc}") from exc
    db.execute("DELETE FROM kb_file WHERE kb_id = %s AND id = ANY(%s)", (kb["id"], ids))
    for row in rows:
        (config.UPLOAD_DIR / row["rel_path"]).unlink(missing_ok=True)
    return ok({"deleted": len(rows), "file_ids": ids}, f"已删除 {len(rows)} 个文件")


@router.get("/kb/{kb_key}/files/{file_id}/download")
def download_file(kb_key: str, file_id: int) -> FileResponse:
    kb = _kb_row(kb_key)
    row = db.fetch_one(
        "SELECT name, rel_path FROM kb_file WHERE id = %s AND kb_id = %s",
        (file_id, kb["id"]),
    )
    if not row:
        raise ApiError(404, "文件不存在")
    path = config.UPLOAD_DIR / row["rel_path"]
    if not path.is_file():
        raise ApiError(410, "原始文件已丢失")
    return FileResponse(path, filename=row["name"])


@router.get("/kb/{kb_key}/files/archive")
def download_archive(kb_key: str, ids: str = Query("")) -> StreamingResponse:
    kb = _kb_row(kb_key)
    wanted = [int(item) for item in re.findall(r"\d+", ids)]
    if not wanted:
        raise ApiError(400, "请选择要下载的文件")
    rows = db.fetch_all(
        "SELECT name, rel_path FROM kb_file WHERE kb_id = %s AND id = ANY(%s) ORDER BY id",
        (kb["id"], wanted),
    )
    if not rows:
        raise ApiError(404, "文件不存在")
    buffer = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for row in rows:
            path = config.UPLOAD_DIR / row["rel_path"]
            if not path.is_file():
                continue
            arcname = row["name"]
            counter = 1
            while arcname in used:
                stem, dot, suffix = arcname.rpartition(".")
                arcname = f"{stem or arcname}({counter}){dot}{suffix}" if dot else f"{arcname}({counter})"
                counter += 1
            used.add(arcname)
            zf.write(path, arcname)
    buffer.seek(0)
    filename = quote(f"{kb_key}-files.zip")
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


# ============================== 知识内容 ==============================


def _parse_ids(raw: str) -> list[int]:
    return [int(item) for item in re.findall(r"\d+", raw or "")]


@router.get("/kb/{kb_key}/content")
def kb_content(
    kb_key: str,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    file_ids: str = Query(""),
) -> dict:
    kb = _kb_row(kb_key)
    ids = _parse_ids(file_ids)
    offset = (page - 1) * size
    if kb["kind"] == "vector":
        where = "c.kb_id = %s"
        params: list = [kb["id"]]
        if ids:
            where += " AND c.file_id = ANY(%s)"
            params.append(ids)
        total = db.fetch_one(f"SELECT count(*) AS n FROM kb_chunk c WHERE {where}", params)["n"]
        rows = db.fetch_all(
            f"""
            SELECT c.id, c.file_id, f.name AS file_name, c.seq, c.page_start, c.page_end,
                   c.section, c.content, c.created_at,
                   (e.chunk_id IS NOT NULL) AS vectorized
            FROM kb_chunk c
            JOIN kb_file f ON f.id = c.file_id
            LEFT JOIN kb_chunk_embedding e ON e.chunk_id = c.id
            WHERE {where}
            ORDER BY c.file_id, c.seq
            OFFSET %s LIMIT %s
            """,
            params + [offset, size],
        )
        return ok({"kind": "vector", "total": total, "page": page, "size": size, "items": rows})

    if kb["kind"] == "triple":
        where = "t.kb_id = %s"
        params = [kb["id"]]
        if ids:
            where += " AND t.file_id = ANY(%s)"
            params.append(ids)
        total = db.fetch_one(f"SELECT count(*) AS n FROM kb_triple t WHERE {where}", params)["n"]
        rows = db.fetch_all(
            f"""
            SELECT t.id, t.file_id, f.name AS file_name, t.seq, t.page_start, t.page_end,
                   t.subject, t.subject_type, t.predicate, t.object, t.object_type,
                   t.evidence, t.created_at
            FROM kb_triple t
            JOIN kb_file f ON f.id = t.file_id
            WHERE {where}
            ORDER BY t.file_id, t.seq, t.id
            OFFSET %s LIMIT %s
            """,
            params + [offset, size],
        )
        return ok({"kind": "triple", "total": total, "page": page, "size": size, "items": rows})

    graph = age_store.fetch_graph(kb_key, ids or None)
    stats = age_store.stats(kb_key)
    return ok(
        {
            "kind": "graph",
            "nodes": graph["nodes"],
            "edges": graph["edges"],
            "truncated": graph["truncated"],
            "stats": stats,
        }
    )


# ============================== 检索 ==============================


def _like(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"


def _search_vector(kb: dict, query: str, top_k: int, ids: list[int]) -> dict:
    results: dict[int, dict] = {}
    mode = "keyword"
    try:
        vector, model, dims = embedding.embed_query(query)
        mode = "vector"
        params: list = [_vector_literal(vector), kb["id"], dims]
        where = "c.kb_id = %s AND e.dims = %s"
        if ids:
            where += " AND c.file_id = ANY(%s)"
            params.append(ids)
        rows = db.fetch_all(
            f"""
            SELECT c.id, c.file_id, f.name AS file_name, c.seq, c.page_start, c.page_end,
                   c.section, c.content,
                   1 - (e.embedding <=> %s::vector) AS score
            FROM kb_chunk_embedding e
            JOIN kb_chunk c ON c.id = e.chunk_id
            JOIN kb_file f ON f.id = c.file_id
            WHERE {where}
            ORDER BY e.embedding <=> %s::vector
            LIMIT %s
            """,
            params + [_vector_literal(vector), top_k * 2],
        )
        for row in rows:
            row["text"] = row.pop("content")
            results[row["id"]] = row
    except embedding.EmbeddingError as exc:
        results = {}
        mode = "keyword"
        note = str(exc)
    else:
        note = ""

    term = query.strip()
    like = _like(term)
    params: list = [term, like, kb["id"], like, term]
    where = "c.kb_id = %s AND (c.content ILIKE %s OR similarity(c.content, %s) >= 0.08)"
    if ids:
        where += " AND c.file_id = ANY(%s)"
        params.append(ids)
    keyword_rows = db.fetch_all(
        f"""
        SELECT c.id, c.file_id, f.name AS file_name, c.seq, c.page_start, c.page_end,
               c.section, c.content,
               greatest(similarity(c.content, %s), CASE WHEN c.content ILIKE %s THEN 0.35 ELSE 0 END) AS score
        FROM kb_chunk c
        JOIN kb_file f ON f.id = c.file_id
        WHERE {where}
        ORDER BY score DESC
        LIMIT %s
        """,
        params + [top_k],
    )
    for row in keyword_rows:
        row["text"] = row.pop("content")
        existing = results.get(row["id"])
        if existing:
            existing["score"] = max(existing["score"], row["score"])
        else:
            results[row["id"]] = row
        if mode == "keyword":
            mode = "keyword"
        elif mode == "vector":
            mode = "mixed"
    ordered = sorted(results.values(), key=lambda item: item["score"], reverse=True)[:top_k]
    for item in ordered:
        item["score"] = round(float(item["score"]), 4)
    return {"mode": mode, "note": note, "results": ordered}


def _search_triple(kb: dict, query: str, top_k: int, ids: list[int]) -> dict:
    term = query.strip()
    like = _like(term)
    params: list = [like, like, like, like, term, kb["id"]]
    where = "t.kb_id = %s"
    if ids:
        where += " AND t.file_id = ANY(%s)"
        params.append(ids)
    sql = f"""
        SELECT t.id, t.file_id, f.name AS file_name, t.seq, t.page_start, t.page_end,
               t.subject, t.subject_type, t.predicate, t.object, t.object_type, t.evidence,
               (
                   CASE WHEN t.subject ILIKE %s THEN 3 ELSE 0 END
                 + CASE WHEN t.predicate ILIKE %s THEN 2 ELSE 0 END
                 + CASE WHEN t.object ILIKE %s THEN 3 ELSE 0 END
                 + CASE WHEN t.evidence ILIKE %s THEN 1 ELSE 0 END
                 + similarity(t.subject || ' ' || t.predicate || ' ' || t.object, %s)
               ) AS score
        FROM kb_triple t
        JOIN kb_file f ON f.id = t.file_id
        WHERE {where}
          AND (
              t.subject ILIKE %s OR t.predicate ILIKE %s OR t.object ILIKE %s
              OR t.evidence ILIKE %s
              OR similarity(t.subject || ' ' || t.predicate || ' ' || t.object, %s) >= 0.1
          )
        ORDER BY score DESC, t.id
        LIMIT %s
    """
    rows = db.fetch_all(
        sql,
        params + [like, like, like, like, term, top_k],
    )
    for row in rows:
        row["text"] = f"{row['subject']} {row['predicate']} {row['object']}"
        row["score"] = round(float(row["score"]), 4)
    return {"mode": "keyword", "note": "", "results": rows}


@router.post("/kb/{kb_key}/search")
def search(kb_key: str, payload: dict = Body(...)) -> dict:
    kb = _kb_row(kb_key)
    query = str(payload.get("query") or "").strip()
    if not query:
        raise ApiError(400, "检索关键词不能为空")
    top_k = max(1, min(int(payload.get("top_k") or 5), 50))
    ids = [int(item) for item in (payload.get("file_ids") or []) if str(item).isdigit()]
    if kb["kind"] == "vector":
        data = _search_vector(kb, query, top_k, ids)
        data.update({"kind": "vector", "query": query, "top_k": top_k})
        return ok(data)
    if kb["kind"] == "triple":
        data = _search_triple(kb, query, top_k, ids)
        data.update({"kind": "triple", "query": query, "top_k": top_k})
        return ok(data)
    graph = age_store.search(kb_key, query, max(10, top_k * 2))
    return ok(
        {
            "kind": "graph",
            "query": query,
            "top_k": top_k,
            "mode": "graph",
            "results": graph["matches"],
            "nodes": graph["nodes"],
            "edges": graph["edges"],
        }
    )


# ============================== 调用例程 ==============================


def _public_base(request: Request) -> str:
    if config.PUBLIC_BASE_URL:
        return config.PUBLIC_BASE_URL
    return str(request.base_url).rstrip("/")


@router.get("/kb/{kb_key}/invocations")
def invocations(kb_key: str, request: Request) -> dict:
    kb = _kb_row(kb_key)
    base = _public_base(request)
    url = f"{base}/api/v1/kb/{kb_key}/search"
    kind = kb["kind"]
    if kind == "vector":
        print_line = 'for item in data["results"][:5]: print(f"{item[\'score\']:.4f}  {item[\'file_name\']} p.{item[\'page_start\']}  {item[\'text\'][:120]}")'
        shape = 'results: [{score, text, file_name, page_start, page_end, section}]'
    elif kind == "triple":
        print_line = 'for item in data["results"][:5]: print(f"{item[\'score\']:.2f}  {item[\'subject\']} {item[\'predicate\']} {item[\'object\']}  [{item[\'file_name\']}]")'
        shape = 'results: [{score, subject, predicate, object, evidence, file_name, page_start}]'
    else:
        print_line = 'for node in data["nodes"][:10]: print(node["name"], "\t", node["type"])'
        shape = 'results/nodes/edges: [{name, type, description}], [{source, predicate, target}]'
    python_code = f'''import requests

URL = "{url}"

resp = requests.post(URL, json={{"query": "二级泵房 设计流量", "top_k": 5}})
payload = resp.json()
if payload["code"] != 0:
    raise RuntimeError(payload["message"])
data = payload["data"]
{print_line}
'''
    js_code = f'''const URL = "{url}";

const resp = await fetch(URL, {{
  method: "POST",
  headers: {{ "Content-Type": "application/json" }},
  body: JSON.stringify({{ query: "二级泵房 设计流量", top_k: 5 }}),
}});
const payload = await resp.json();
if (payload.code !== 0) throw new Error(payload.message);
console.log(payload.data.results ?? payload.data.nodes);
'''
    http_code = f'''POST {url}
Content-Type: application/json

{{
  "query": "二级泵房 设计流量",
  "top_k": 5
}}

# 响应
{{ "code": 0, "message": "ok", "data": {{ "kind": "{kind}", {shape} }} }}
'''
    return ok(
        {
            "kb_key": kb_key,
            "url": url,
            "kind": kind,
            "python": python_code,
            "javascript": js_code,
            "http": http_code,
        }
    )


# ============================== skill ==============================

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


@router.get("/skills")
def list_skills() -> dict:
    rows = db.fetch_all(
        """
        SELECT s.*, (SELECT count(*) FROM kb_file f WHERE f.skill_id = s.id) AS file_count
        FROM skill s ORDER BY s.builtin DESC, s.created_at
        """
    )
    return ok(rows)


@router.get("/skills/{skill_id}")
def get_skill(skill_id: int) -> dict:
    row = db.fetch_one("SELECT * FROM skill WHERE id = %s", (skill_id,))
    if not row:
        raise ApiError(404, "skill 不存在")
    return ok(row)


def _skill_payload(payload: dict, partial: bool = False) -> dict:
    name = str(payload.get("name") or "").strip()
    slug = str(payload.get("slug") or "").strip()
    description = str(payload.get("description") or "").strip()
    target = str(payload.get("target") or "any").strip()
    content = str(payload.get("content") or "")
    result = {}
    if not partial or name:
        if not name or len(name) > 60:
            raise ApiError(400, "skill 名称需为 1-60 个字符")
        result["name"] = name
    if not partial or slug:
        if not SLUG_RE.match(slug) or len(slug) > 64:
            raise ApiError(400, "skill 标识需为小写字母、数字和 -，例如 legal-triple")
        result["slug"] = slug
    if not partial or description:
        result["description"] = description[:300]
    if not partial or target:
        if target not in ("triple", "graph", "any"):
            raise ApiError(400, "skill 适用类型不合法")
        result["target"] = target
    if not partial or content:
        if not content.strip():
            raise ApiError(400, "skill 内容不能为空")
        if len(content) > 60000:
            raise ApiError(400, "skill 内容过长（上限 60000 字符）")
        result["content"] = content
    return result


@router.post("/skills")
def create_skill(payload: dict = Body(...)) -> dict:
    data = _skill_payload(payload)
    if db.fetch_one("SELECT id FROM skill WHERE slug = %s", (data["slug"],)):
        raise ApiError(409, "skill 标识已存在")
    row = db.insert_returning(
        """
        INSERT INTO skill (slug, name, description, target, content, builtin)
        VALUES (%s, %s, %s, %s, %s, false) RETURNING *
        """,
        (data["slug"], data["name"], data["description"], data["target"], data["content"]),
    )
    return ok(row, "skill 已创建")


@router.patch("/skills/{skill_id}")
def update_skill(skill_id: int, payload: dict = Body(...)) -> dict:
    current = db.fetch_one("SELECT * FROM skill WHERE id = %s", (skill_id,))
    if not current:
        raise ApiError(404, "skill 不存在")
    data = _skill_payload(payload, partial=True)
    if "slug" in data and data["slug"] != current["slug"]:
        if db.fetch_one("SELECT id FROM skill WHERE slug = %s AND id <> %s", (data["slug"], skill_id)):
            raise ApiError(409, "skill 标识已存在")
    fields = {**{key: current[key] for key in ("slug", "name", "description", "target", "content")}, **data}
    row = db.insert_returning(
        """
        UPDATE skill SET slug = %s, name = %s, description = %s, target = %s,
                         content = %s, updated_at = now()
        WHERE id = %s RETURNING *
        """,
        (fields["slug"], fields["name"], fields["description"], fields["target"], fields["content"], skill_id),
    )
    return ok(row, "skill 已保存")


@router.delete("/skills/{skill_id}")
def delete_skill(skill_id: int) -> dict:
    row = db.fetch_one("SELECT * FROM skill WHERE id = %s", (skill_id,))
    if not row:
        raise ApiError(404, "skill 不存在")
    if row["builtin"]:
        raise ApiError(400, "内置 skill 不可删除，可直接编辑内容")
    db.execute("DELETE FROM skill WHERE id = %s", (skill_id,))
    return ok(None, "skill 已删除")


# ============================== 系统设置 ==============================


@router.get("/settings")
def get_settings() -> dict:
    return ok(settings.public_settings())


@router.put("/settings")
def put_settings(payload: dict = Body(...)) -> dict:
    try:
        settings.save_settings(payload)
    except Exception as exc:  # noqa: BLE001
        raise ApiError(500, f"保存设置失败：{exc}") from exc
    sync = settings.sync_opencode_config(apply=True)
    return ok({"settings": settings.public_settings(), "sync": sync}, "设置已保存")


@router.post("/settings/test")
def test_settings(payload: dict = Body(...)) -> dict:
    target = str(payload.get("target") or "")
    cfg = settings.get_settings()
    started = datetime.now()
    try:
        if target == "llm":
            import httpx

            llm = cfg["llm"]
            base = (llm.get("base_url") or "").rstrip("/")
            if not base or not llm.get("model"):
                raise ApiError(400, "请先填写 LLM 服务地址与模型名")
            headers = {}
            if llm.get("api_key"):
                headers["Authorization"] = "Bearer " + llm["api_key"]
            response = httpx.get(base + "/models", headers=headers, timeout=15)
            detail = {"status_code": response.status_code}
            if response.status_code >= 400:
                raise ApiError(502, f"LLM 服务返回 HTTP {response.status_code}")
        elif target == "embedding":
            conf = settings.effective_embedding()
            if not conf["base_url"] or not conf["model"]:
                raise ApiError(400, "请先填写向量嵌入服务地址与模型名")
            vector = embedding.embed_texts(["growknow 连接测试"], conf)[0]
            detail = {"model": conf["model"], "dims": len(vector)}
        elif target == "mineru":
            detail = mineru.health(cfg["mineru"])
        elif target == "opencode":
            detail = dict(opencode_client.health())
            model = (cfg["llm"].get("model") or "").strip()
            detail["provider_ready"] = opencode_client.provider_ready(model) if model else False
        else:
            raise ApiError(400, "未知的测试目标")
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ApiError(502, str(exc)[:500]) from exc
    elapsed = int((datetime.now() - started).total_seconds() * 1000)
    return ok({"ok": True, "target": target, "elapsed_ms": elapsed, "detail": detail}, "连接正常")
