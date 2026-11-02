"""抽取任务 worker：从 PostgreSQL 队列领取文件，按并发度执行流水线。"""

from __future__ import annotations

import logging
import signal
import threading
from concurrent.futures import Future, ThreadPoolExecutor

from . import config, db
from .services import age_store, pipeline, seed, settings


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


def recover_stale() -> None:
    """进程重启时，把上次中断的任务放回队列，已取消的任务直接收尾。"""
    jobs = db.execute(
        "UPDATE extract_job SET status = 'queued', started_at = NULL, session_id = NULL "
        "WHERE status = 'running'"
    )
    files = db.execute(
        """
        UPDATE kb_file f SET status = 'queued', stage = '排队中', progress = 0
        FROM extract_job j
        WHERE j.file_id = f.id AND j.status = 'queued' AND f.status = 'extracting'
        """
    )
    canceled = db.execute(
        """
        UPDATE kb_file f SET status = 'canceled', stage = '已取消', progress = NULL,
                            knowledge_count = 0, status_at = now()
        FROM extract_job j
        WHERE j.file_id = f.id AND j.status = 'canceled'
          AND f.status IN ('queued', 'extracting')
        """
    )
    if jobs or files or canceled:
        logging.info(
            "恢复中断任务：%d 个任务，%d 个文件，%d 个取消收尾", jobs, files, canceled
        )


def claim_job() -> dict | None:
    row = db.fetch_one(
        """
        WITH next AS (
            SELECT id FROM extract_job
            WHERE status = 'queued'
            ORDER BY id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE extract_job j
        SET status = 'running', attempts = j.attempts + 1, started_at = now(), error = NULL
        FROM next
        WHERE j.id = next.id
        RETURNING j.id, j.file_id, j.attempts
        """
    )
    if row:
        db.execute(
            """
            UPDATE kb_file SET status = 'extracting', status_at = now(), error = NULL,
                               stage = '解析文档', progress = NULL
            WHERE id = %s
            """,
            (row["file_id"],),
        )
    return row


def finish_job(job_id: int, status: str, error: str | None = None) -> None:
    """只有仍在运行的任务才会被收尾，避免覆盖用户刚提交的取消。"""
    db.execute(
        """
        UPDATE extract_job
        SET status = %s, error = %s, finished_at = now(), session_id = NULL
        WHERE id = %s AND status = 'running'
        """,
        (status, (error or "")[:1000] or None, job_id),
    )


class Worker:
    def __init__(self) -> None:
        self.stop = threading.Event()
        self.executor = ThreadPoolExecutor(
            max_workers=config.EXTRACT_CONCURRENCY, thread_name_prefix="extract"
        )
        self.running: dict[Future, dict] = {}

    def _run(self, job: dict) -> None:
        try:
            pipeline.process_file(job["file_id"])
        except pipeline.CancelledError:
            logging.info("任务 %s 已取消", job["id"])
            finish_job(job["id"], "canceled")
        except Exception as exc:  # noqa: BLE001
            finish_job(job["id"], "failed", str(exc))
        else:
            finish_job(job["id"], "done")

    def _collect(self) -> None:
        for future in [f for f in self.running if f.done()]:
            job = self.running.pop(future)
            exc = future.exception()
            if exc is not None:
                logging.error("任务 %s 异常：%s", job["id"], exc)

    def serve_forever(self) -> None:
        _setup_logging()
        db.init_db()
        age_store.ensure_indexes()
        seed.seed_skills()
        settings.sync_opencode_config(apply=True)
        recover_stale()
        logging.info(
            "worker 启动：并发 %d，队列轮询中", config.EXTRACT_CONCURRENCY
        )
        while not self.stop.is_set():
            self._collect()
            if len(self.running) < config.EXTRACT_CONCURRENCY:
                job = claim_job()
                if job:
                    logging.info("领取任务 %s（文件 %s）", job["id"], job["file_id"])
                    self.running[self.executor.submit(self._run, job)] = job
                    continue
            self.stop.wait(1.0)
        self.shutdown()

    def shutdown(self) -> None:
        logging.info("worker 正在退出，等待进行中的任务…")
        self.executor.shutdown(wait=True, cancel_futures=False)
        db.close_pool()
        age_store.close()


def main() -> None:
    worker = Worker()

    def _stop(signum, frame):  # noqa: ARG001
        worker.stop.set()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    worker.serve_forever()


if __name__ == "__main__":
    main()
