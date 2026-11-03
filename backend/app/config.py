"""growknow 部署级配置：环境变量单一出口，业务代码只从这里取配置。"""

from __future__ import annotations

import os
from pathlib import Path


def _str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def _int(name: str, default: int) -> int:
    try:
        value = os.environ.get(name)
        return int(value) if value not in (None, "") else default
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        value = os.environ.get(name)
        return float(value) if value not in (None, "") else default
    except ValueError:
        return default


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(_str("DATA_DIR", str(PROJECT_ROOT / "data")))
UPLOAD_DIR = DATA_DIR / "uploads"
WORK_DIR = DATA_DIR / "work"
CORS_ORIGINS = [item.strip() for item in _str("CORS_ORIGINS", "*").split(",") if item.strip()]

# PostgreSQL（全文向量库 / 三元组库 / 元数据）
PG_HOST = _str("PG_HOST", "localhost")
PG_PORT = _int("PG_PORT", 5432)
PG_USER = _str("PG_USER", "growknow")
# 口令不内置默认值，必须由 .env 或部署环境提供
PG_PASSWORD = _str("PG_PASSWORD", "")
PG_DATABASE = _str("PG_DATABASE", "growknow")
# search_path 追加 ag_catalog：Apache AGE 的 cypher()/create_graph() 等函数在该 schema
# （图库本身也是一个 schema，图名不能与数据库用户同名，否则会被 "$user" 抢先解析）
# keepalive：一个文件要抽几十分钟，期间连接大部分时间是空闲的，Docker/WSL 的连接跟踪
# 会把这种空闲连接悄悄回收，下一次使用就报 "server closed the connection unexpectedly"
PG_CONNINFO = (
    f"host={PG_HOST} port={PG_PORT} user={PG_USER} "
    f"password={PG_PASSWORD} dbname={PG_DATABASE} "
    f"keepalives=1 keepalives_idle=30 keepalives_interval=10 keepalives_count=5 "
    f"options='-c search_path=\"$user\",public,ag_catalog'"
)

# 知识图谱（PostgreSQL + Apache AGE，不再依赖 Neo4j）
AGE_GRAPH_NAME = _str("AGE_GRAPH_NAME", "growknow_graph")
GRAPH_RENDER_MAX_NODES = _int("GRAPH_RENDER_MAX_NODES", 800)
GRAPH_RENDER_MAX_EDGES = _int("GRAPH_RENDER_MAX_EDGES", 2000)

# opencode 抽取引擎（官方镜像，HTTP API）
OPENCODE_URL = _str("OPENCODE_URL", "http://localhost:4096").rstrip("/")
OPENCODE_CONFIG_PATH = Path(
    _str("OPENCODE_CONFIG_PATH", str(DATA_DIR / "opencode" / "config" / "opencode.json"))
)
OPENCODE_MODEL_PROVIDER = "growknow"
OPENCODE_TIMEOUT_SECONDS = _float("OPENCODE_TIMEOUT_SECONDS", 1800.0)
OPENCODE_MAX_RETRIES = _int("OPENCODE_MAX_RETRIES", 2)

# MinerU（文档解析）
#   agent    官方 Agent 轻量解析，免 Token，单文件 10MB / 20 页，仅返回 Markdown
#   precision 官方精准解析，需 Token，单文件 200MB / 200 页，返回结构化 zip
#   selfhost 私有部署的 MinerU V1 API（GPU 自建）
MINERU_MODE = _str("MINERU_MODE", "agent").strip().lower()
MINERU_AGENT_URL = _str("MINERU_AGENT_URL", "https://mineru.net/api/v1/agent").rstrip("/")
MINERU_PRECISE_URL = _str("MINERU_PRECISE_URL", "https://mineru.net/api/v4").rstrip("/")
MINERU_URL = _str("MINERU_URL", "").rstrip("/")
MINERU_API_KEY = _str("MINERU_API_KEY", "")
MINERU_TIER = _str("MINERU_TIER", "standard")
MINERU_LANGUAGE = _str("MINERU_LANGUAGE", "ch")
MINERU_AGENT_MAX_BYTES = _int("MINERU_AGENT_MAX_MB", 10) * 1024 * 1024
MINERU_AGENT_MAX_PAGES = _int("MINERU_AGENT_MAX_PAGES", 20)
MINERU_REQUEST_TIMEOUT = _float("MINERU_REQUEST_TIMEOUT", 60.0)
MINERU_TRANSFER_TIMEOUT = _float("MINERU_TRANSFER_TIMEOUT", 300.0)
MINERU_MAX_POLLS = _int("MINERU_MAX_POLLS", 600)
MINERU_POLL_INTERVAL = _float("MINERU_POLL_INTERVAL", 2.0)

# 抽取流水线
EXTRACT_CONCURRENCY = max(1, _int("EXTRACT_CONCURRENCY", 2))
MAX_EXTRACT_CHARS = max(2000, _int("MAX_EXTRACT_CHARS", 8000))
VECTOR_CHUNK_CHARS = max(300, _int("VECTOR_CHUNK_CHARS", 1200))
VECTOR_CHUNK_OVERLAP = max(0, _int("VECTOR_CHUNK_OVERLAP", 120))
EMBEDDING_BATCH_SIZE = max(1, _int("EMBEDDING_BATCH_SIZE", 32))
EMBEDDING_TIMEOUT_SECONDS = _float("EMBEDDING_TIMEOUT_SECONDS", 120.0)

# 上传
MAX_UPLOAD_BYTES = _int("MAX_UPLOAD_MB", 100) * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}

# 对外访问地址（「调用方法」中展示；为空则按请求 Host 自动推断）
PUBLIC_BASE_URL = _str("PUBLIC_BASE_URL", "").rstrip("/")

# 初始模型配置（系统设置页面保存的配置优先）
ENV_LLM = {
    "base_url": _str("LLM_BASE_URL", ""),
    "model": _str("LLM_MODEL", ""),
    "api_key": _str("LLM_API_KEY", ""),
}
ENV_EMBEDDING = {
    "base_url": _str("EMBEDDING_BASE_URL", ""),
    "model": _str("EMBEDDING_MODEL", ""),
    "api_key": _str("EMBEDDING_API_KEY", ""),
}
