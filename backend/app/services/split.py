"""文档切片：按「每 N 页 + 章节边界」切分 MinerU 结构化结果，并生成片段 Markdown。"""

from __future__ import annotations

import re
from dataclasses import dataclass

HEADING_TYPES = {"doc_title", "title", "paragraph_title", "subtitle", "heading"}
SKIP_TYPES = {"header", "footer", "page_number", "footnote", "page_footer", "page_header"}


@dataclass
class Part:
    no: int            # 片段序号：从 1 开始；未切片时为 0
    page_start: int    # 0 基（MinerU page_idx）
    page_end: int      # 0 基，含
    section: str
    text: str

    @property
    def pages_label(self) -> str:
        if self.page_start < 0:
            return "未知"
        return f"{self.page_start + 1}-{self.page_end + 1}"

    @property
    def location_label(self) -> str:
        """供抽取提示词使用；轻量解析没有页码时明确告诉模型。"""
        if self.page_start < 0:
            return "未提供页码（本段按全文处理）"
        return f"第 {self.pages_label} 页"


def _page_count(structured: dict) -> int:
    if isinstance(structured, dict):
        explicit = structured.get("page_count")
        if isinstance(explicit, int) and explicit > 0:
            return explicit
        pages = structured.get("pages")
        if isinstance(pages, list):
            return len(pages)
    return 0


def _flatten(structured: dict) -> list[tuple[int, dict]]:
    flat: list[tuple[int, dict]] = []
    for index, page in enumerate(structured.get("pages") or []):
        if not isinstance(page, dict):
            continue
        page_idx = page.get("page_idx", index)
        for block in page.get("blocks") or []:
            if isinstance(block, dict):
                flat.append((int(page_idx), block))
    return flat


def _block_text(block: dict) -> str:
    btype = block.get("type")
    if btype in SKIP_TYPES:
        return ""
    content = block.get("content")
    if content is None:
        content = block.get("text") or ""
    content = str(content).strip()
    if not content:
        if btype == "image":
            captions = block.get("captions") or []
            return "\n".join(str(c) for c in captions if c)
        return ""
    if btype in HEADING_TYPES:
        level = block.get("level", block.get("text_level", 1))
        try:
            level = int(str(level))
        except (TypeError, ValueError):
            level = 1
        level = max(1, min(level, 6))
        return "#" * level + " " + content
    if btype == "equation":
        return f"$$\n{content}\n$$"
    return content


def _section_for(flat: list[tuple[int, dict]], start: int) -> str:
    for index in range(start, -1, -1):
        block = flat[index][1]
        if block.get("type") in HEADING_TYPES:
            text = str(block.get("content") or block.get("text") or "").strip()
            if text:
                return text[:120]
    return ""


def slice_document(structured: dict, slice_pages: int) -> list[Part]:
    slice_pages = max(1, int(slice_pages))
    flat = _flatten(structured)
    if not flat:
        return []
    pages = _page_count(structured)

    if pages <= slice_pages:
        text = "\n\n".join(t for t in (_block_text(b) for _, b in flat) if t)
        return [
            Part(
                no=0,
                page_start=flat[0][0],
                page_end=flat[-1][0],
                section=_section_for(flat, 0),
                text=text,
            )
        ]

    parts: list[Part] = []
    start = 0
    number = 1
    total = len(flat)
    while start < total:
        start_page = flat[start][0]
        boundary = start_page + slice_pages - 1
        cut = total
        for index in range(start + 1, total):
            page_idx, block = flat[index]
            # 先满足页数上限：下一页的任意块都作为切点；页数内遇到章节标题则提前切
            if page_idx > boundary:
                cut = index
                break
            if block.get("type") in HEADING_TYPES:
                cut = index
                break
        end = cut - 1
        blocks = flat[start : end + 1]
        text = "\n\n".join(t for t in (_block_text(b) for _, b in blocks) if t)
        parts.append(
            Part(
                no=number,
                page_start=flat[start][0],
                page_end=flat[end][0],
                section=_section_for(flat, start),
                text=text,
            )
        )
        if cut >= total:
            break
        start = cut
        number += 1
    return parts


def _split_sentences(block: str) -> list[str]:
    return [s for s in re.split(r"(?<=[。！？!?；;\n])", block) if s]


def _hard_split(block: str, size: int, overlap: int) -> list[str]:
    chunks: list[str] = []
    current = ""
    for sentence in _split_sentences(block):
        while len(sentence) > size:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(sentence[:size])
            sentence = sentence[size - overlap :] if overlap else sentence[size:]
        if current and len(current) + len(sentence) > size:
            chunks.append(current)
            current = ""
        current += sentence
    if current.strip():
        chunks.append(current)
    return [c.strip() for c in chunks if c.strip()]


def split_long_text(text: str, size: int, overlap: int = 0) -> list[str]:
    """按空行段落贪心合并；超长段落按句切分。用于向量切片与超长抽取片段。"""
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return []
    size = max(300, int(size))
    overlap = max(0, min(int(overlap), size // 3))
    if len(text) <= size:
        return [text]

    chunks: list[str] = []
    current: list[str] = []
    length = 0
    for raw_block in text.split("\n\n"):
        block = raw_block.strip()
        if not block:
            continue
        if len(block) > size:
            if current:
                chunks.append("\n\n".join(current))
                current, length = [], 0
            chunks.extend(_hard_split(block, size, overlap))
            continue
        extra = len(block) + (2 if current else 0)
        if current and length + extra > size:
            previous = "\n\n".join(current)
            chunks.append(previous)
            current, length = [], 0
            if overlap:
                tail = previous[-overlap:]
                cut = tail.find("\n")
                tail = tail[cut + 1 :] if 0 <= cut < len(tail) - 1 else tail
                if tail.strip():
                    current = [tail.strip()]
                    length = len(tail)
        current.append(block)
        length += len(block) + (2 if len(current) > 1 else 0)
    if current:
        chunks.append("\n\n".join(current))
    return [c for c in chunks if c.strip()]
