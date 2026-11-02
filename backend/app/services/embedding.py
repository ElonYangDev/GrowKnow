"""OpenAI 兼容 /embeddings 客户端：分批、去重、维度校验。"""

from __future__ import annotations

import logging

import httpx

from .. import config
from . import settings

log = logging.getLogger(__name__)


class EmbeddingError(Exception):
    pass


def _endpoint(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/embeddings"):
        return base
    return base + "/embeddings"


def embed_texts(
    texts: list[str],
    conf: dict | None = None,
    on_batch=None,
) -> list[list[float]]:
    if not texts:
        return []
    conf = conf or settings.effective_embedding()
    base_url = (conf.get("base_url") or "").strip()
    model = (conf.get("model") or "").strip()
    if not base_url or not model:
        raise EmbeddingError("尚未配置向量嵌入模型（系统设置 → 向量嵌入服务）")

    normalized = [" ".join(str(text).split()) for text in texts]
    if any(not text for text in normalized):
        raise EmbeddingError("Embedding 输入不能为空")
    unique = list(dict.fromkeys(normalized))
    headers = {"Content-Type": "application/json"}
    if conf.get("api_key"):
        headers["Authorization"] = "Bearer " + conf["api_key"]

    vectors: dict[str, list[float]] = {}
    dims: int | None = None
    batch_size = config.EMBEDDING_BATCH_SIZE
    total_batches = (len(unique) + batch_size - 1) // batch_size
    if on_batch:
        on_batch(0, total_batches)
    try:
        with httpx.Client(timeout=config.EMBEDDING_TIMEOUT_SECONDS) as client:
            for index, start in enumerate(range(0, len(unique), batch_size)):
                batch = unique[start : start + batch_size]
                if on_batch:
                    on_batch(index, total_batches)
                response = client.post(
                    _endpoint(base_url),
                    json={"model": model, "input": batch},
                    headers=headers,
                )
                if response.status_code >= 400:
                    raise EmbeddingError(
                        f"向量服务返回 HTTP {response.status_code}：{response.text[:300]}"
                    )
                data = response.json().get("data")
                if not isinstance(data, list) or len(data) != len(batch):
                    raise EmbeddingError("向量服务返回数量与请求数量不一致")
                indices = [item.get("index") for item in data if isinstance(item, dict)]
                if sorted(indices) != list(range(len(batch))):
                    raise EmbeddingError("向量服务返回的 index 缺失或重复")
                for item in data:
                    vector = item.get("embedding")
                    if (
                        not isinstance(vector, list)
                        or not vector
                        or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in vector)
                    ):
                        raise EmbeddingError("向量服务返回了非法向量")
                    if dims is not None and len(vector) != dims:
                        raise EmbeddingError("同一批向量维度不一致")
                    dims = len(vector)
                    vectors[batch[item["index"]]] = [float(v) for v in vector]
                if on_batch:
                    on_batch(index + 1, total_batches)
    except httpx.HTTPError as exc:
        raise EmbeddingError(f"向量服务连接失败：{exc}") from exc
    return [vectors[text] for text in normalized]


def embed_query(query: str) -> tuple[list[float], str, int]:
    conf = settings.effective_embedding()
    vector = embed_texts([query], conf)[0]
    return vector, conf["model"], len(vector)
