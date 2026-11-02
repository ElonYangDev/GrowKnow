"""PostgreSQL 访问层：连接池、建表、简单查询助手。"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import config

log = logging.getLogger(__name__)

_pool: ConnectionPool | None = None

SCHEMA = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS kb (
    id            BIGSERIAL PRIMARY KEY,
    kb_key        TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    kind          TEXT NOT NULL CHECK (kind IN ('vector', 'triple', 'graph')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill (
    id            BIGSERIAL PRIMARY KEY,
    slug          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    target        TEXT NOT NULL DEFAULT 'any' CHECK (target IN ('triple', 'graph', 'any')),
    content       TEXT NOT NULL,
    builtin       BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_file (
    id              BIGSERIAL PRIMARY KEY,
    kb_id           BIGINT NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    rel_path        TEXT NOT NULL,
    size            BIGINT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'extracting', 'ready', 'failed', 'canceled')),
    status_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    stage           TEXT NOT NULL DEFAULT '',
    progress        SMALLINT,
    page_slices     INTEGER NOT NULL DEFAULT 5,
    skill_id        BIGINT REFERENCES skill(id) ON DELETE SET NULL,
    error           TEXT,
    page_count      INTEGER,
    knowledge_count INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_file_kb_idx ON kb_file (kb_id, id);

CREATE TABLE IF NOT EXISTS kb_chunk (
    id          BIGSERIAL PRIMARY KEY,
    kb_id       BIGINT NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
    file_id     BIGINT NOT NULL REFERENCES kb_file(id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    page_start  INTEGER,
    page_end    INTEGER,
    section     TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (file_id, seq)
);
CREATE INDEX IF NOT EXISTS kb_chunk_kb_idx ON kb_chunk (kb_id, file_id);
CREATE INDEX IF NOT EXISTS kb_chunk_trgm_idx ON kb_chunk USING gin (content gin_trgm_ops);

CREATE TABLE IF NOT EXISTS kb_chunk_embedding (
    chunk_id   BIGINT PRIMARY KEY REFERENCES kb_chunk(id) ON DELETE CASCADE,
    kb_id      BIGINT NOT NULL,
    model      TEXT NOT NULL,
    dims       INTEGER NOT NULL,
    embedding  vector NOT NULL
);
CREATE INDEX IF NOT EXISTS kb_chunk_embedding_kb_idx ON kb_chunk_embedding (kb_id);

CREATE TABLE IF NOT EXISTS kb_triple (
    id            BIGSERIAL PRIMARY KEY,
    kb_id         BIGINT NOT NULL REFERENCES kb(id) ON DELETE CASCADE,
    file_id       BIGINT NOT NULL REFERENCES kb_file(id) ON DELETE CASCADE,
    seq           INTEGER NOT NULL DEFAULT 0,
    page_start    INTEGER,
    page_end      INTEGER,
    subject       TEXT NOT NULL,
    subject_type  TEXT NOT NULL DEFAULT '',
    predicate     TEXT NOT NULL,
    object        TEXT NOT NULL,
    object_type   TEXT NOT NULL DEFAULT '',
    evidence      TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_triple_kb_idx ON kb_triple (kb_id, file_id);
CREATE INDEX IF NOT EXISTS kb_triple_trgm_idx ON kb_triple
    USING gin ((subject || ' ' || predicate || ' ' || object || ' ' || evidence) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS extract_job (
    id          BIGSERIAL PRIMARY KEY,
    file_id     BIGINT NOT NULL UNIQUE REFERENCES kb_file(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'done', 'failed', 'canceled')),
    attempts    INTEGER NOT NULL DEFAULT 0,
    session_id  TEXT,
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS extract_job_status_idx ON extract_job (status, id);

CREATE TABLE IF NOT EXISTS app_setting (
    id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    value       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 旧库迁移：进度、阶段、会话 ID 与「已取消」状态
ALTER TABLE kb_file ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT '';
ALTER TABLE kb_file ADD COLUMN IF NOT EXISTS progress SMALLINT;
ALTER TABLE extract_job ADD COLUMN IF NOT EXISTS session_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kb_file_status_check'
      AND conrelid = 'kb_file'::regclass
      AND pg_get_constraintdef(oid) LIKE '%canceled%'
  ) THEN
    ALTER TABLE kb_file DROP CONSTRAINT IF EXISTS kb_file_status_check;
    ALTER TABLE kb_file ADD CONSTRAINT kb_file_status_check
      CHECK (status IN ('queued', 'extracting', 'ready', 'failed', 'canceled'));
  END IF;
END $$;
"""


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            config.PG_CONNINFO,
            min_size=1,
            max_size=max(4, config.EXTRACT_CONCURRENCY * 2 + 2),
            kwargs={"row_factory": dict_row},
            open=False,
        )
        _pool.open(wait=False)
    return _pool


def init_db(wait_seconds: int = 60) -> None:
    """建库表；容器启动顺序不确定时等待数据库就绪。"""
    start = time.time()
    while True:
        try:
            with pool().connection() as conn:
                conn.execute(SCHEMA)
            log.info("数据库结构检查完成")
            return
        except Exception as exc:  # noqa: BLE001
            if time.time() - start > wait_seconds:
                raise
            log.warning("等待数据库就绪：%s", exc)
            time.sleep(2)


@contextmanager
def connection():
    with pool().connection() as conn:
        yield conn


def fetch_all(sql: str, params=None) -> list[dict]:
    with connection() as conn:
        return conn.execute(sql, params).fetchall()


def fetch_one(sql: str, params=None) -> dict | None:
    with connection() as conn:
        return conn.execute(sql, params).fetchone()


def execute(sql: str, params=None) -> int:
    with connection() as conn:
        cur = conn.execute(sql, params)
        return cur.rowcount


def insert_returning(sql: str, params=None) -> dict:
    with connection() as conn:
        row = conn.execute(sql, params).fetchone()
        if row is None:
            raise RuntimeError("写入未返回结果")
        return row


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
