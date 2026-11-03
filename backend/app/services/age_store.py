"""PostgreSQL + Apache AGE 图存储：实体/关系写入、按文件引用计数删除、子图查询与关键词检索。

与旧 neo4j_store 的接口保持一致，差异在底层实现与数据模型：

- 单图（config.AGE_GRAPH_NAME，独立 schema），顶点标签 :Entity，边标签 :REL；
- 顶点以 (kb_key, name) 唯一，边以（有序端点 + predicate）唯一；
- 除 name / type / description 三个固定字段外，**任意数量的附加属性**统一放进
  attrs（JSON 文本），skill 抽多少存多少，后写入的同名键覆盖旧值；
- 每个节点/关系带 file_ids（来源 kb_file.id 列表），删除文件时按引用计数清理。

AGE 1.6 的实测限制（决定了上面的 JSON 文本形态）：
- cypher 不支持查询参数，所有值必须经 _agstr 按 Cypher 规则转义后内联（SQL 的双写
  单引号在这里不成立）；正文用 $gk$ 定界，避免文本里的 $$ 提前闭合；
- map 字面量的键只能是裸 ASCII 标识符（中文键会报错或丢失），成对数组的行内
  下标访问也不可靠，因此 attrs 整体序列化为 JSON 文本；
- AGE 语句必须经 psycopg 以 params=None 发送，否则正文中的 % 会被当作格式化
  占位符解析（中文文档里 50% 这类内容极常见）。
"""

from __future__ import annotations

import json
import logging
import re
import secrets
from typing import Iterable

from .. import config, db

log = logging.getLogger(__name__)

_LABEL = "Entity"
_REL = "REL"

ENTITY_RESERVED = {"name", "type", "description", "page", "attributes", "file_ids"}
RELATION_RESERVED = {
    "source",
    "target",
    "source_type",
    "target_type",
    "predicate",
    "description",
    "page",
    "attributes",
    "file_ids",
}

_ready = False
_to_lower_ok: bool | None = None


class GraphStoreError(Exception):
    pass


# ----------------------------- 基础工具 -----------------------------


def _graph_name() -> str:
    name = config.AGE_GRAPH_NAME
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name or ""):
        raise GraphStoreError(f"非法的图名：{name!r}")
    if name == config.PG_USER:
        raise GraphStoreError("图名不能与数据库用户同名，请修改 AGE_GRAPH_NAME")
    return name


# Cypher 字符串字面量的合法转义只有 \" \' \\ \b \f \n \r \t \uXXXX；
# 单引号双写（''）是 SQL 的规则，Cypher 解析器会把 'model''s' 切成两段而报语法错误。
# 顺序很重要：先补反斜杠，再转义其余字符。
_CYPHER_ESCAPE = (("\\", "\\\\"), ("'", "\\'"), ("\r", "\\r"), ("\n", "\\n"), ("\t", "\\t"))


def _agstr(value) -> str:
    """Python 值 → agtype 字符串字面量（按 Cypher 规则转义反斜杠、单引号与控制字符）。"""
    if value is None:
        return "NULL"
    text = str(value)
    for needle, replacement in _CYPHER_ESCAPE:
        text = text.replace(needle, replacement)
    return "'" + text + "'"


def _agstrlist(values: Iterable[str]) -> str:
    return "[" + ",".join(_agstr(v) for v in values) + "]"


def _aglist(values: Iterable[int]) -> str:
    return "[" + ",".join(str(int(v)) for v in (values or [])) + "]"


def _agjson(value) -> str:
    text = json.dumps(value or {}, ensure_ascii=False, separators=(",", ":"))
    return _agstr(text)


def _parse_agtype(raw):
    """agtype SQL 输出 → Python 对象；裸键名规范化后按 JSON 解析。"""
    if raw is None or isinstance(raw, (int, float, list, dict, bool)):
        return raw
    text = str(raw).strip()
    if not text or text == "NULL":
        return None
    for candidate in (
        text,
        re.sub(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)', r'\1"\2"\3', text),
    ):
        try:
            return json.loads(candidate)
        except (ValueError, TypeError):
            continue
    return text


def _json_dict(value) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return {}
    return dict(value) if isinstance(value, dict) else {}


def _int_list(value) -> list[int]:
    if isinstance(value, str):
        value = _parse_agtype(value)
    out: list[int] = []
    if isinstance(value, list):
        for item in value:
            try:
                number = int(item)
            except (TypeError, ValueError):
                continue
            if number not in out:
                out.append(number)
    return out


def _clip_text(value, limit: int = 4000) -> str:
    return str(value or "").strip()[:limit]


def _attrs_of(item: dict, reserved: set[str]) -> dict:
    """收集 name/type/description 之外的所有附加属性（含嵌套 attributes）。"""
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
        key = str(key).strip()
        if not key:
            continue
        if isinstance(value, str):
            cleaned[key] = _clip_text(value)
        elif isinstance(value, (int, float, bool)):
            cleaned[key] = value
        elif isinstance(value, (list, dict)):
            try:
                cleaned[key] = json.loads(json.dumps(value, ensure_ascii=False))
            except (TypeError, ValueError):
                continue
    return cleaned


_DOLLAR_TAG = "$gk$"


def _dollar_tag(cypher_text: str) -> str:
    """cypher 正文的 SQL 定界符；正文里真出现 $gk$ 时改用随机 tag，避免提前闭合。"""
    if _DOLLAR_TAG in cypher_text:
        return f"$gk{secrets.token_hex(4)}$"
    return _DOLLAR_TAG


def _cypher(cypher_text: str, ncols: int = 1) -> list:
    """执行 cypher 子查询；params=None 让 psycopg 原样发送 SQL。"""
    cols = ", ".join(f"c{index} agtype" for index in range(ncols))
    tag = _dollar_tag(cypher_text)
    sql = (
        f"SELECT * FROM ag_catalog.cypher('{_graph_name()}', "
        f"{tag} {cypher_text} {tag}) AS ({cols})"
    )
    rows = db.fetch_all(sql, None)
    result = []
    for row in rows:
        values = [_parse_agtype(row[f"c{index}"]) for index in range(ncols)]
        result.append(values[0] if ncols == 1 else tuple(values))
    return result


def _as_int(rows) -> int:
    try:
        value = rows[0] if rows else 0
        return int(float(value)) if value is not None else 0
    except (ValueError, TypeError):
        return 0


def _ensure_ready() -> None:
    """扩展 / 图 / 标签就绪（幂等）。"""
    global _ready
    if _ready:
        return
    try:
        # API 与 worker 会同时启动：用会话级 advisory lock 串行化扩展安装，
        # 避免 CREATE EXTENSION 的 IF NOT EXISTS 检查竞态（报 ag_catalog 已存在）
        with db.connection() as conn:
            conn.execute("SELECT pg_advisory_lock(hashtext('growknow_age_init'))")
            try:
                conn.execute("CREATE EXTENSION IF NOT EXISTS age")
            finally:
                conn.execute("SELECT pg_advisory_unlock(hashtext('growknow_age_init'))")
        exists = db.fetch_one(
            "SELECT count(*) AS n FROM pg_namespace WHERE nspname = %s",
            (_graph_name(),),
        )
        if not exists or not exists["n"]:
            try:
                db.execute(f"SELECT ag_catalog.create_graph('{_graph_name()}')")
                log.info("AGE 图已创建：%s", _graph_name())
            except Exception as exc:  # noqa: BLE001
                # 并发启动时另一个进程可能刚创建成功
                check = db.fetch_one(
                    "SELECT count(*) AS n FROM pg_namespace WHERE nspname = %s",
                    (_graph_name(),),
                )
                if not check or not check["n"]:
                    raise exc
        for statement in (
            f"SELECT ag_catalog.create_vlabel('{_graph_name()}', '{_LABEL}')",
            f"SELECT ag_catalog.create_elabel('{_graph_name()}', '{_REL}')",
        ):
            try:
                db.execute(statement)
            except Exception:  # noqa: BLE001  标签已存在
                pass
        _ready = True
    except GraphStoreError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise GraphStoreError(
            f"Apache AGE 不可用（请确认 postgres 使用带 AGE 扩展的镜像）：{exc}"
        ) from exc


def _probe_to_lower() -> bool:
    global _to_lower_ok
    if _to_lower_ok is None:
        try:
            rows = _cypher("RETURN toLower('Xy')", 1)
            _to_lower_ok = bool(rows) and str(rows[0]).lower() == "xy"
        except Exception:  # noqa: BLE001
            _to_lower_ok = False
    return _to_lower_ok


def _contains(prop: str, term: str) -> str:
    literal = _agstr(term)
    if _probe_to_lower():
        return f"toLower(coalesce({prop}, '')) CONTAINS toLower({literal})"
    return f"coalesce({prop}, '') CONTAINS {literal}"


def ensure_indexes() -> None:
    """兼容旧调用名：AGE 依赖标签而非索引，这里只做初始化。"""
    _ensure_ready()


def close() -> None:
    """连接由 db 连接池统一管理，无需单独关闭。"""
    return None


def health() -> dict:
    try:
        _ensure_ready()
        rows = _cypher("RETURN 1", 1)
        return {
            "ok": bool(rows) and _as_int(rows) == 1,
            "engine": "postgres-age",
            "graph": _graph_name(),
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:300]}


# ----------------------------- 写入 -----------------------------


def _upsert_node(
    kb_key: str,
    file_id: int,
    name: str,
    node_type: str,
    description: str,
    attrs: dict,
) -> None:
    kb = _agstr(kb_key)
    rows = _cypher(
        f"MATCH (n:{_LABEL}) WHERE n.kb_key = {kb} AND n.name = {_agstr(name)} "
        "RETURN id(n), n.type, n.description, n.attrs, n.file_ids",
        5,
    )
    if rows and rows[0][0] is not None:
        nid, cur_type, cur_desc, cur_attrs, cur_files = rows[0]
        merged_attrs = {**_json_dict(cur_attrs), **attrs}
        files = _int_list(cur_files)
        if file_id not in files:
            files.append(file_id)
        final_type = str(cur_type or "").strip() or node_type
        final_desc = str(cur_desc or "").strip() or description
        _cypher(
            f"MATCH (n:{_LABEL}) WHERE id(n) = {int(nid)} "
            f"SET n.type = {_agstr(final_type)}, "
            f"n.description = {_agstr(final_desc)}, "
            f"n.attrs = {_agjson(merged_attrs)}, "
            f"n.file_ids = {_aglist(files)}"
        )
    else:
        _cypher(
            f"CREATE (n:{_LABEL} {{kb_key: {kb}, name: {_agstr(name)}, "
            f"type: {_agstr(node_type)}, description: {_agstr(description)}, "
            f"attrs: {_agjson(attrs)}, file_ids: [{int(file_id)}]}})"
        )


def _upsert_edge(
    kb_key: str,
    file_id: int,
    source: str,
    target: str,
    predicate: str,
    description: str,
    attrs: dict,
) -> None:
    kb = _agstr(kb_key)
    a_where = f"a.kb_key = {kb} AND a.name = {_agstr(source)}"
    b_where = f"b.kb_key = {kb} AND b.name = {_agstr(target)}"
    rows = _cypher(
        f"MATCH (a:{_LABEL})-[r:{_REL}]->(b:{_LABEL}) "
        f"WHERE {a_where} AND {b_where} AND r.predicate = {_agstr(predicate)} "
        "RETURN id(r), r.description, r.attrs, r.file_ids",
        4,
    )
    if rows and rows[0][0] is not None:
        rid, cur_desc, cur_attrs, cur_files = rows[0]
        merged_attrs = {**_json_dict(cur_attrs), **attrs}
        files = _int_list(cur_files)
        if file_id not in files:
            files.append(file_id)
        final_desc = str(cur_desc or "").strip() or description
        _cypher(
            f"MATCH (r:{_REL}) WHERE id(r) = {int(rid)} "
            f"SET r.description = {_agstr(final_desc)}, "
            f"r.attrs = {_agjson(merged_attrs)}, "
            f"r.file_ids = {_aglist(files)}"
        )
    else:
        _cypher(
            f"MATCH (a:{_LABEL}) WHERE {a_where} "
            f"MATCH (b:{_LABEL}) WHERE {b_where} "
            f"CREATE (a)-[r:{_REL} {{kb_key: {kb}, predicate: {_agstr(predicate)}, "
            f"description: {_agstr(description)}, attrs: {_agjson(attrs)}, "
            f"file_ids: [{int(file_id)}]}}]->(b)"
        )


def upsert_graph(
    kb_key: str, file_id: int, entities: Iterable[dict], relations: Iterable[dict]
) -> int:
    """写入一个文件片段的知识；同一实体/关系按 file_ids 聚合。返回本次处理的条目数。"""
    _ensure_ready()
    fid = int(file_id)
    entity_rows = [e for e in (entities or []) if isinstance(e, dict)]
    relation_rows = [r for r in (relations or []) if isinstance(r, dict)]

    names: set[str] = set()
    for entity in entity_rows:
        name = _clip_text(entity.get("name"), 200)
        if not name:
            continue
        names.add(name)
        _upsert_node(
            kb_key,
            fid,
            name,
            _clip_text(entity.get("type"), 60),
            _clip_text(entity.get("description"), 600),
            _attrs_of(entity, ENTITY_RESERVED),
        )

    edges = 0
    for relation in relation_rows:
        source = _clip_text(relation.get("source"), 200)
        target = _clip_text(relation.get("target"), 200)
        predicate = _clip_text(relation.get("predicate"), 120)
        if not (source and target and predicate) or source == target:
            continue
        # 关系端点不在本批 entities 中时补建节点，避免边悬空
        for endpoint, type_key in ((source, "source_type"), (target, "target_type")):
            if endpoint not in names:
                names.add(endpoint)
                _upsert_node(
                    kb_key,
                    fid,
                    endpoint,
                    _clip_text(relation.get(type_key), 60),
                    "",
                    {},
                )
        _upsert_edge(
            kb_key,
            fid,
            source,
            target,
            predicate,
            _clip_text(relation.get("description"), 600),
            _attrs_of(relation, RELATION_RESERVED),
        )
        edges += 1
    return len(names) + edges


# ----------------------------- 删除 / 改名 -----------------------------


def delete_file(kb_key: str, file_id: int) -> None:
    """删除文件关联的图谱知识：仅本文件引用的删除，共用的摘除引用。"""
    _ensure_ready()
    kb, fid = _agstr(kb_key), int(file_id)
    only = _aglist([fid])

    # 仅本文件引用的关系
    for rid in _cypher(
        f"MATCH (a:{_LABEL})-[r:{_REL}]->(b:{_LABEL}) "
        f"WHERE a.kb_key = {kb} AND b.kb_key = {kb} AND r.file_ids = {only} "
        "RETURN id(r)"
    ):
        if rid is not None:
            _cypher(f"MATCH (r:{_REL}) WHERE id(r) = {int(rid)} DELETE r")

    # 共用关系：摘除引用
    for rid, files in _cypher(
        f"MATCH (a:{_LABEL})-[r:{_REL}]->(b:{_LABEL}) "
        f"WHERE a.kb_key = {kb} AND b.kb_key = {kb} AND r.file_ids <> {only} "
        f"AND size([x IN r.file_ids WHERE x = {fid}]) > 0 "
        "RETURN id(r), r.file_ids",
        2,
    ):
        if rid is None:
            continue
        remaining = [x for x in _int_list(files) if x != fid]
        _cypher(
            f"MATCH (r:{_REL}) WHERE id(r) = {int(rid)} "
            f"SET r.file_ids = {_aglist(remaining)}"
        )

    # 共用节点：摘除引用
    for nid, files in _cypher(
        f"MATCH (n:{_LABEL}) WHERE n.kb_key = {kb} AND n.file_ids <> {only} "
        f"AND size([x IN n.file_ids WHERE x = {fid}]) > 0 "
        "RETURN id(n), n.file_ids",
        2,
    ):
        if nid is None:
            continue
        remaining = [x for x in _int_list(files) if x != fid]
        _cypher(
            f"MATCH (n:{_LABEL}) WHERE id(n) = {int(nid)} "
            f"SET n.file_ids = {_aglist(remaining)}"
        )

    # 仅本文件引用的节点（级联删除残余关系）
    for nid in _cypher(
        f"MATCH (n:{_LABEL}) WHERE n.kb_key = {kb} AND n.file_ids = {only} RETURN id(n)"
    ):
        if nid is not None:
            _cypher(f"MATCH (n:{_LABEL}) WHERE id(n) = {int(nid)} DETACH DELETE n")


def delete_kb(kb_key: str) -> None:
    _ensure_ready()
    kb = _agstr(kb_key)
    _cypher(
        f"MATCH (a:{_LABEL})-[r:{_REL}]->(b:{_LABEL}) "
        f"WHERE r.kb_key = {kb} DELETE r"
    )
    _cypher(f"MATCH (n:{_LABEL}) WHERE n.kb_key = {kb} DETACH DELETE n")


def rename_kb(old_key: str, new_key: str) -> None:
    _ensure_ready()
    old, new = _agstr(old_key), _agstr(new_key)
    _cypher(f"MATCH (n:{_LABEL}) WHERE n.kb_key = {old} SET n.kb_key = {new}")
    _cypher(
        f"MATCH ()-[r:{_REL}]->() WHERE r.kb_key = {old} SET r.kb_key = {new}"
    )


# ----------------------------- 读取 -----------------------------


def _node_payload(name, node_type, description, attrs, files) -> dict:
    return {
        "id": str(name),
        "name": str(name),
        "type": str(node_type or ""),
        "description": str(description or ""),
        "attributes": _json_dict(attrs),
        "file_ids": _int_list(files),
    }


def _edge_payload(source, target, predicate, description, attrs) -> dict:
    return {
        "id": f"{source}|{predicate}|{target}",
        "source": str(source),
        "target": str(target),
        "predicate": str(predicate or ""),
        "description": str(description or ""),
        "attributes": _json_dict(attrs),
    }


def fetch_graph(kb_key: str, file_ids: list[int] | None = None, limit: int | None = None) -> dict:
    _ensure_ready()
    kb = _agstr(kb_key)
    max_nodes = int(limit or config.GRAPH_RENDER_MAX_NODES)
    max_edges = config.GRAPH_RENDER_MAX_EDGES
    ids = [int(value) for value in (file_ids or [])]
    files_lit = _aglist(ids)
    node_filter = (
        f" AND size([x IN n.file_ids WHERE x IN {files_lit}]) > 0" if ids else ""
    )
    edge_filter = (
        f" AND size([x IN r.file_ids WHERE x IN {files_lit}]) > 0" if ids else ""
    )

    node_rows = _cypher(
        f"MATCH (n:{_LABEL}) WHERE n.kb_key = {kb}{node_filter} "
        f"RETURN n.name, n.type, n.description, n.attrs, n.file_ids "
        f"LIMIT {max_nodes + 1}",
        5,
    )
    truncated = len(node_rows) > max_nodes
    nodes: list[dict] = []
    known: set[str] = set()
    for name, node_type, description, attrs, files in node_rows[:max_nodes]:
        name = str(name or "")
        if not name or name in known:
            continue
        known.add(name)
        nodes.append(_node_payload(name, node_type, description, attrs, files))

    edge_rows = _cypher(
        f"MATCH (a:{_LABEL})-[r:{_REL}]->(b:{_LABEL}) "
        f"WHERE a.kb_key = {kb} AND b.kb_key = {kb}{edge_filter} "
        "RETURN a.name, b.name, r.predicate, r.description, r.attrs "
        f"LIMIT {max_edges + 1}",
        5,
    )
    if len(edge_rows) > max_edges:
        truncated = True
    edges: list[dict] = []
    seen_edges: set[str] = set()
    for source, target, predicate, description, attrs in edge_rows[:max_edges]:
        source, target = str(source or ""), str(target or "")
        if source not in known or target not in known:
            continue
        edge = _edge_payload(source, target, predicate, description, attrs)
        if edge["id"] in seen_edges:
            continue
        seen_edges.add(edge["id"])
        edges.append(edge)
    return {"nodes": nodes, "edges": edges, "truncated": truncated}


def search(kb_key: str, query: str, limit: int = 30) -> dict:
    _ensure_ready()
    term = (query or "").strip()
    if not term:
        return {"matches": [], "nodes": [], "edges": []}
    kb = _agstr(kb_key)
    limit = max(1, min(int(limit or 30), 100))
    conditions = " OR ".join(
        [
            _contains("n.name", term),
            _contains("n.type", term),
            _contains("n.description", term),
            _contains("n.attrs", term),
        ]
    )
    hit_rows = _cypher(
        f"MATCH (n:{_LABEL}) WHERE n.kb_key = {kb} AND ({conditions}) "
        f"RETURN n.name, n.type, n.description, n.attrs, n.file_ids LIMIT {limit}",
        5,
    )
    matches: list[dict] = []
    nodes: list[dict] = []
    known: set[str] = set()
    for name, node_type, description, attrs, files in hit_rows:
        name = str(name or "")
        if not name or name in known:
            continue
        known.add(name)
        payload = _node_payload(name, node_type, description, attrs, files)
        matches.append({**payload, "sources": len(payload["file_ids"])})
        nodes.append(payload)

    if not known:
        return {"matches": [], "nodes": [], "edges": []}

    names_lit = _agstrlist(known)
    edges: list[dict] = []
    seen_edges: set[str] = set()
    neighbor_names: set[str] = set()
    for tail in ("out", "in"):
        a, b = ("a", "b") if tail == "out" else ("b", "a")
        rows = _cypher(
            f"MATCH (a:{_LABEL})-[r:{_REL}]->(b:{_LABEL}) "
            f"WHERE a.kb_key = {kb} AND b.kb_key = {kb} AND {a}.name IN {names_lit} "
            f"RETURN {a}.name, {b}.name, r.predicate, r.description, r.attrs",
            5,
        )
        for source, target, predicate, description, attrs in rows:
            if source is None or target is None:
                continue
            edge = _edge_payload(source, target, predicate, description, attrs)
            if edge["id"] in seen_edges:
                continue
            seen_edges.add(edge["id"])
            edges.append(edge)
            neighbor_names.add(str(source))
            neighbor_names.add(str(target))

    missing = neighbor_names - known
    if missing:
        rows = _cypher(
            f"MATCH (n:{_LABEL}) WHERE n.kb_key = {kb} AND n.name IN {_agstrlist(missing)} "
            "RETURN n.name, n.type, n.description, n.attrs, n.file_ids",
            5,
        )
        for name, node_type, description, attrs, files in rows:
            name = str(name or "")
            if not name or name in known:
                continue
            known.add(name)
            nodes.append(_node_payload(name, node_type, description, attrs, files))

    return {"matches": matches, "nodes": nodes, "edges": edges}


def stats(kb_key: str) -> dict:
    try:
        kb = _agstr(kb_key)
        node_rows = _cypher(
            f"MATCH (n:{_LABEL}) WHERE n.kb_key = {kb} RETURN count(n)", 1
        )
        edge_rows = _cypher(
            f"MATCH (a:{_LABEL})-[r:{_REL}]->(b:{_LABEL}) WHERE r.kb_key = {kb} "
            "RETURN count(r)",
            1,
        )
        return {"nodes": _as_int(node_rows), "edges": _as_int(edge_rows)}
    except Exception as exc:  # noqa: BLE001
        log.warning("AGE 图统计失败：%s", exc)
        return {"nodes": 0, "edges": 0}
