"""知识抽取流水线：MinerU 解析 → 按页切片 → 向量化 / 三元组 / 图谱 → 落库。

对同一文件重跑是幂等的：开始前清空该文件已产生的切片、三元组与图谱节点。
"""

from __future__ import annotations

import json
import logging
import re
import shutil
from pathlib import Path

from .. import config, db
from . import age_store, embedding, mineru, opencode_client, settings, split

log = logging.getLogger(__name__)

TRIPLE_CONTRACT = {
    "triples": [
        {
            "subject": "",
            "subject_type": "",
            "predicate": "",
            "object": "",
            "object_type": "",
            "evidence": "",
            "page": 1,
        }
    ]
}

GRAPH_CONTRACT = {
    "entities": [
        {
            "name": "实体名称",
            "type": "实体类型",
            "description": "一句话说明它是什么 / 做什么",
            "page": 1,
            "attributes": {
                "按 skill 要求的属性名": "属性值（数量不限，没有可省略 attributes）"
            },
        }
    ],
    "relations": [
        {
            "source": "",
            "source_type": "",
            "target": "",
            "target_type": "",
            "predicate": "",
            "description": "",
            "page": 1,
            "attributes": {"关系的附加属性": "没有可省略"},
        }
    ],
}

FALLBACK_TRIPLE_SKILL = """你是严谨的知识工程师，负责把专业文档中的客观事实抽取为（主体，关系，客体）三元组。
要求：指代消解到明确名称；数值保留单位与条件；不确定内容不输出；证据摘录最短原文。"""

FALLBACK_GRAPH_SKILL = """你是严谨的知识工程师，负责从专业文档中抽取实体与有向关系，构建可检索的知识图谱。
要求：实体名使用文档中的规范名称；同一实体全篇同一写法；关系用简短动词短语；不确定内容不输出。"""


class PipelineError(Exception):
    pass


class CancelledError(Exception):
    """用户主动取消抽取。"""


def _job_status(file_id: int) -> str | None:
    row = db.fetch_one("SELECT status FROM extract_job WHERE file_id = %s", (file_id,))
    return row["status"] if row else None


def _check_cancel(file_id: int) -> None:
    if _job_status(file_id) == "canceled":
        raise CancelledError("抽取已取消")


def _set_progress(file_id: int, stage: str, progress: int | None = None) -> None:
    """progress 为 None 表示该阶段耗时不可预估，前端显示不确定进度条。"""
    db.execute(
        "UPDATE kb_file SET stage = %s, progress = %s WHERE id = %s",
        (stage, progress, file_id),
    )


def _set_session(file_id: int, session_id: str | None) -> None:
    db.execute(
        "UPDATE extract_job SET session_id = %s WHERE file_id = %s AND status = 'running'",
        (session_id, file_id),
    )


def _system_prompt(skill_content: str | None, kind: str, kb_description: str) -> str:
    base = (skill_content or "").strip() or (
        FALLBACK_TRIPLE_SKILL if kind == "triple" else FALLBACK_GRAPH_SKILL
    )
    contract = TRIPLE_CONTRACT if kind == "triple" else GRAPH_CONTRACT
    scope = "三元组" if kind == "triple" else "实体与关系"
    empty_example = '{"triples": []}' if kind == "triple" else '{"entities": [], "relations": []}'
    return f"""{base}

## 知识库背景
{kb_description or "通用专业知识库"}

## 输出契约（优先级最高）
只返回一个 JSON 对象，字段固定为下面示例的结构，不要 Markdown 代码块，不要任何解释：
{json.dumps(contract, ensure_ascii=False, indent=2)}

硬性要求：
1. 只输出本段正文中明确出现的{scope}，不得根据常识补全，不得虚构。
2. 主体/客体或 source/target 必须有明确名称；指代不明的事实直接放弃。
3. 每条事实一条记录，不重复；同一段内不要输出语义相同的记录。
4. page 填写事实所在页码（整数），无法确定时留空。
5. evidence / description 摘录支撑事实的最短原文，不超过 80 字。
6. 本段没有可抽取内容时，返回空结果，例如 {empty_example}。
7. 除固定字段外，skill 中要求的任何附加属性（如 year、author、journal），
   请放入 entities / relations 的 attributes 对象；键名与 skill 保持一致，
   数量不限，没有可填属性时省略 attributes。"""


def _clean(value, limit: int = 500) -> str:
    return " ".join(str(value or "").split())[:limit]


def _extract_json(text: str) -> dict:
    text = (text or "").strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("输出中没有 JSON 对象")
    value = json.loads(text[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("JSON 根节点不是对象")
    return value


def _ask_json(
    session_id: str,
    prompt: str,
    system: str,
    model: str,
) -> dict:
    last: Exception | None = None
    for attempt in range(config.OPENCODE_MAX_RETRIES + 1):
        message = prompt
        if attempt:
            message = (
                f"上一次输出无法解析为合法 JSON（{last}）。"
                "请重新输出本段结果：只返回一个完整 JSON 对象，不要 Markdown 代码块，不要解释。"
            )
        text = opencode_client.prompt(session_id, message, system, model)
        try:
            return _extract_json(text)
        except (ValueError, json.JSONDecodeError) as exc:
            last = exc
            log.warning("模型 JSON 解析失败（第 %d 次）：%s", attempt + 1, exc)
    raise PipelineError(f"模型输出不是合法 JSON：{last}")


def _attributes(item: dict, reserved: set[str], limit: int = 40) -> dict:
    """收集固定字段之外的附加属性（skill 抽多少存多少，数量上限仅防跑飞）。"""
    attrs: dict = {}
    nested = item.get("attributes")
    if isinstance(nested, dict):
        attrs.update(nested)
    for key, value in item.items():
        if key in reserved or key == "attributes" or value is None:
            continue
        attrs[str(key)] = value
    cleaned: dict = {}
    for key, value in attrs.items():
        key = str(key).strip()[:60]
        if not key or len(cleaned) >= limit:
            continue
        if isinstance(value, str):
            cleaned[key] = _clean(value, 2000)
        elif isinstance(value, (int, float, bool)):
            cleaned[key] = value
        elif isinstance(value, (list, dict)):
            try:
                cleaned[key] = json.loads(json.dumps(value, ensure_ascii=False))
            except (TypeError, ValueError):
                continue
    return cleaned


def _page_of(item: dict, part: split.Part) -> tuple[int, int]:
    low, high = part.page_start + 1, part.page_end + 1
    raw = item.get("page") if isinstance(item, dict) else None
    try:
        page = int(raw)
    except (TypeError, ValueError):
        return low, high
    if low <= page <= high:
        return page, page
    return low, high


_UNSET = object()


def _mark(
    file_id: int,
    status: str,
    *,
    error: str | None = None,
    page_count: int | None = None,
    knowledge_count: int | None = None,
    stage: str | None = None,
    progress: object = _UNSET,
) -> None:
    assignment = ["status = %s", "status_at = now()", "error = %s"]
    params: list = [status, error]
    if page_count is not None:
        assignment.append("page_count = %s")
        params.append(page_count)
    if knowledge_count is not None:
        assignment.append("knowledge_count = %s")
        params.append(knowledge_count)
    if stage is not None:
        assignment.append("stage = %s")
        params.append(stage)
    if progress is not _UNSET:
        assignment.append("progress = %s")
        params.append(progress)
    params.append(file_id)
    db.execute(f"UPDATE kb_file SET {', '.join(assignment)} WHERE id = %s", params)


def _load(file_id: int) -> dict:
    row = db.fetch_one(
        """
        SELECT f.*, k.kb_key, k.name AS kb_name, k.description AS kb_description, k.kind,
               s.content AS skill_content
        FROM kb_file f
        JOIN kb k ON k.id = f.kb_id
        LEFT JOIN skill s ON s.id = f.skill_id
        WHERE f.id = %s
        """,
        (file_id,),
    )
    if not row:
        raise PipelineError("文件记录不存在（可能已被删除）")
    return row


def _run_vector(row: dict, parts: list[split.Part]) -> int:
    texts: list[str] = []
    with db.connection() as conn:
        conn.execute("DELETE FROM kb_chunk WHERE file_id = %s", (row["id"],))
        seq = 0
        for part in parts:
            for piece in split.split_long_text(
                part.text, config.VECTOR_CHUNK_CHARS, config.VECTOR_CHUNK_OVERLAP
            ):
                seq += 1
                chunk = conn.execute(
                    """
                    INSERT INTO kb_chunk (kb_id, file_id, seq, page_start, page_end, section, content)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        row["kb_id"],
                        row["id"],
                        seq,
                        part.page_start + 1,
                        part.page_end + 1,
                        part.section,
                        piece,
                    ),
                ).fetchone()
                texts.append(piece)
                if chunk is None:
                    raise PipelineError("切片写入失败")
        chunk_ids = [
            record["id"]
            for record in conn.execute(
                "SELECT id FROM kb_chunk WHERE file_id = %s ORDER BY seq", (row["id"],)
            ).fetchall()
        ]

    def report(done: int, total: int) -> None:
        _check_cancel(row["id"])
        if total > 1:
            _set_progress(
                row["id"], f"向量化 {done}/{total} 批", 30 + int(60 * done / total)
            )
        else:
            _set_progress(row["id"], "向量化（共 1 批）", None)

    vectors = embedding.embed_texts(texts, on_batch=report)
    if len(vectors) != len(chunk_ids):
        raise PipelineError("向量数量与切片数量不一致")
    _check_cancel(row["id"])
    _set_progress(row["id"], "写入向量", 95)
    conf = settings.effective_embedding()
    with db.connection() as conn:
        conn.cursor().executemany(
            """
            INSERT INTO kb_chunk_embedding (chunk_id, kb_id, model, dims, embedding)
            VALUES (%s, %s, %s, %s, %s::vector)
            ON CONFLICT (chunk_id) DO UPDATE
            SET model = excluded.model, dims = excluded.dims, embedding = excluded.embedding
            """,
            [
                (chunk_id, row["kb_id"], conf["model"], len(vector), _vector_literal(vector))
                for chunk_id, vector in zip(chunk_ids, vectors)
            ],
        )
    return len(chunk_ids)


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"


def _run_triple(row: dict, parts: list[split.Part], cfg: dict) -> int:
    model = (cfg["llm"].get("model") or "").strip()
    provider = settings.opencode_config(cfg)
    _check_cancel(row["id"])
    opencode_client.ensure_provider(provider, model)
    db.execute("DELETE FROM kb_triple WHERE file_id = %s", (row["id"],))

    system = _system_prompt(row["skill_content"], "triple", row["kb_description"])
    segments = [
        (part, split.split_long_text(part.text, config.MAX_EXTRACT_CHARS))
        for part in parts
    ]
    total_segments = sum(len(items) for _, items in segments)
    session_id = opencode_client.create_session(
        f"{row['kb_name']} · {row['name']}", model
    )
    _set_session(row["id"], session_id)
    seen: set[tuple[str, str, str]] = set()
    count = 0
    done = 0
    try:
        for part, chunks in segments:
            for index, segment in enumerate(chunks, start=1):
                _check_cancel(row["id"])
                done += 1
                if total_segments > 1:
                    _set_progress(
                        row["id"],
                        f"抽取第 {done}/{total_segments} 段",
                        10 + int(80 * (done - 1) / total_segments),
                    )
                else:
                    _set_progress(row["id"], "抽取第 1/1 段", None)
                prompt = (
                    f"文件名：{row['name']}\n"
                    f"切片位置：{part.location_label}"
                    + (f"，章节：{part.section}" if part.section else "")
                    + f"\n本切片共 {len(chunks)} 个子段，这是第 {index} 个；只处理本子段，不要重复前文已抽取内容。\n"
                    "请按输出契约抽取三元组，只返回 JSON。\n\n"
                    f"--- 正文开始 ---\n{segment}\n--- 正文结束 ---"
                )
                data = _ask_json(session_id, prompt, system, model)
                _check_cancel(row["id"])
                items = data.get("triples") or data.get("records") or []
                if not isinstance(items, list):
                    raise PipelineError("模型返回的 triples 不是数组")
                rows: list[tuple] = []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    subject = _clean(item.get("subject"), 200)
                    predicate = _clean(item.get("predicate"), 120)
                    obj = _clean(item.get("object"), 200)
                    if not (subject and predicate and obj):
                        continue
                    key = (subject.lower(), predicate.lower(), obj.lower())
                    if key in seen:
                        continue
                    seen.add(key)
                    page_start, page_end = _page_of(item, part)
                    rows.append(
                        (
                            row["kb_id"],
                            row["id"],
                            len(seen),
                            page_start,
                            page_end,
                            subject,
                            _clean(item.get("subject_type"), 60),
                            predicate,
                            obj,
                            _clean(item.get("object_type"), 60),
                            _clean(item.get("evidence"), 500),
                        )
                    )
                if rows:
                    with db.connection() as conn:
                        conn.cursor().executemany(
                            """
                            INSERT INTO kb_triple
                              (kb_id, file_id, seq, page_start, page_end, subject, subject_type,
                               predicate, object, object_type, evidence)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            rows,
                        )
                    count += len(rows)
                if total_segments > 1:
                    _set_progress(
                        row["id"],
                        f"已完成 {done}/{total_segments} 段",
                        10 + int(80 * done / total_segments),
                    )
    finally:
        opencode_client.delete_session(session_id)
        _set_session(row["id"], None)
    _set_progress(row["id"], "整理结果", 95)
    return count


def _run_graph(row: dict, parts: list[split.Part], cfg: dict) -> int:
    model = (cfg["llm"].get("model") or "").strip()
    provider = settings.opencode_config(cfg)
    _check_cancel(row["id"])
    opencode_client.ensure_provider(provider, model)
    age_store.delete_file(row["kb_key"], row["id"])

    system = _system_prompt(row["skill_content"], "graph", row["kb_description"])
    segments = [
        (part, split.split_long_text(part.text, config.MAX_EXTRACT_CHARS))
        for part in parts
    ]
    total_segments = sum(len(chunks) for _, chunks in segments)
    session_id = opencode_client.create_session(
        f"{row['kb_name']} · {row['name']}", model
    )
    _set_session(row["id"], session_id)
    entity_names: set[str] = set()
    relation_keys: set[tuple[str, str, str]] = set()
    done = 0
    try:
        for part, chunks in segments:
            for index, segment in enumerate(chunks, start=1):
                _check_cancel(row["id"])
                done += 1
                if total_segments > 1:
                    _set_progress(
                        row["id"],
                        f"抽取第 {done}/{total_segments} 段",
                        10 + int(80 * (done - 1) / total_segments),
                    )
                else:
                    _set_progress(row["id"], "抽取第 1/1 段", None)
                prompt = (
                    f"文件名：{row['name']}\n"
                    f"切片位置：{part.location_label}"
                    + (f"，章节：{part.section}" if part.section else "")
                    + f"\n本切片共 {len(chunks)} 个子段，这是第 {index} 个；只处理本子段，不要重复前文已抽取内容。\n"
                    "请按输出契约抽取实体与关系，只返回 JSON。\n\n"
                    f"--- 正文开始 ---\n{segment}\n--- 正文结束 ---"
                )
                data = _ask_json(session_id, prompt, system, model)
                _check_cancel(row["id"])
                entities = data.get("entities") or []
                relations = data.get("relations") or []
                if not isinstance(entities, list) or not isinstance(relations, list):
                    raise PipelineError("模型返回的 entities/relations 不是数组")
                clean_entities = []
                for item in entities:
                    if not isinstance(item, dict):
                        continue
                    name = _clean(item.get("name"), 200)
                    if not name:
                        continue
                    entity_names.add(name)
                    clean_entities.append(
                        {
                            "name": name,
                            "type": _clean(item.get("type"), 60),
                            "description": _clean(item.get("description"), 600),
                            "attributes": _attributes(
                                item, {"name", "type", "description", "page"}
                            ),
                        }
                    )
                clean_relations = []
                for item in relations:
                    if not isinstance(item, dict):
                        continue
                    source = _clean(item.get("source"), 200)
                    target = _clean(item.get("target"), 200)
                    predicate = _clean(item.get("predicate"), 120)
                    if not (source and target and predicate) or source == target:
                        continue
                    relation_keys.add((source, predicate, target))
                    entity_names.add(source)
                    entity_names.add(target)
                    clean_relations.append(
                        {
                            "source": source,
                            "source_type": _clean(item.get("source_type"), 60),
                            "target": target,
                            "target_type": _clean(item.get("target_type"), 60),
                            "predicate": predicate,
                            "description": _clean(item.get("description"), 600),
                            "attributes": _attributes(
                                item,
                                {
                                    "source",
                                    "source_type",
                                    "target",
                                    "target_type",
                                    "predicate",
                                    "description",
                                    "page",
                                },
                            ),
                        }
                    )
                if clean_entities or clean_relations:
                    age_store.upsert_graph(
                        row["kb_key"], row["id"], clean_entities, clean_relations
                    )
                if total_segments > 1:
                    _set_progress(
                        row["id"],
                        f"已完成 {done}/{total_segments} 段",
                        10 + int(80 * done / total_segments),
                    )
    finally:
        opencode_client.delete_session(session_id)
        _set_session(row["id"], None)
    _set_progress(row["id"], "整理结果", 95)
    return len(entity_names) + len(relation_keys)


def _purge_knowledge(file_id: int, kb_key: str, kind: str) -> None:
    """抽取失败时清掉本次已写入的部分知识，避免“失败状态 + 半套知识”。"""
    try:
        if kind == "graph":
            age_store.delete_file(kb_key, file_id)
        elif kind == "triple":
            db.execute("DELETE FROM kb_triple WHERE file_id = %s", (file_id,))
        else:
            db.execute("DELETE FROM kb_chunk WHERE file_id = %s", (file_id,))
    except Exception as exc:  # noqa: BLE001
        log.warning("清理文件 %s 的部分知识失败：%s", file_id, exc)


def process_file(file_id: int) -> None:
    """抽取一个文件；成功/失败/取消都会落库状态，异常继续抛给 worker 记录。"""
    row = _load(file_id)
    _mark(file_id, "extracting", error=None, stage="解析文档", progress=None)
    work_dir = config.WORK_DIR / f"file-{file_id}"
    try:
        _check_cancel(file_id)
        path = config.UPLOAD_DIR / row["rel_path"]
        if not path.is_file():
            raise PipelineError("原始文件已丢失，请重新上传")
        cfg = settings.get_settings()
        structured = mineru.parse_document(
            path, work_dir, cfg["mineru"], check_cancel=lambda: _check_cancel(file_id)
        )
        page_count = int(structured.get("page_count") or len(structured.get("pages") or []))
        _check_cancel(file_id)
        _set_progress(file_id, "整理切片", None)
        parts = split.slice_document(structured, row["page_slices"])
        if not parts:
            raise PipelineError("文档中没有可抽取的正文内容")
        log.info(
            "文件 %s 解析完成：%d 页，%d 个切片（每片 %d 页）",
            row["name"], page_count, len(parts), row["page_slices"],
        )
        if row["kind"] == "vector":
            count = _run_vector(row, parts)
        elif row["kind"] == "triple":
            count = _run_triple(row, parts, cfg)
        else:
            count = _run_graph(row, parts, cfg)
        _check_cancel(file_id)
        _set_progress(file_id, "完成", 100)
        _mark(
            file_id,
            "ready",
            error=None,
            page_count=page_count,
            knowledge_count=count,
            stage="完成",
            progress=100,
        )
        log.info("文件 %s 抽取完成：%d 条知识", row["name"], count)
    except CancelledError:
        log.info("文件 %s 抽取已取消，清理本次写入的知识", row["name"])
        _purge_knowledge(file_id, row["kb_key"], row["kind"])
        _mark(
            file_id, "canceled", error=None, knowledge_count=0, stage="已取消", progress=None
        )
        raise
    except Exception as exc:  # noqa: BLE001
        if _job_status(file_id) == "canceled":
            # 取消时中止了引擎，模型调用会抛错；这里按取消收尾而不是失败
            log.info("文件 %s 抽取在取消后中止", row["name"])
            _purge_knowledge(file_id, row["kb_key"], row["kind"])
            _mark(
                file_id, "canceled", error=None, knowledge_count=0, stage="已取消", progress=None
            )
            raise CancelledError("抽取已取消") from exc
        message = str(exc).strip()[:1000] or exc.__class__.__name__
        log.warning("文件 %s 抽取失败：%s", row["name"], message)
        _purge_knowledge(file_id, row["kb_key"], row["kind"])
        _mark(
            file_id, "failed", error=message, knowledge_count=0, stage="抽取失败", progress=None
        )
        raise
    finally:
        db.execute("UPDATE extract_job SET session_id = NULL WHERE file_id = %s", (file_id,))
        shutil.rmtree(work_dir, ignore_errors=True)
