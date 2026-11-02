"""请求级语言与消息本地化。

前端每次请求都会带上 ``Accept-Language``（``zh-CN`` / ``en``）。这里在 HTTP 边界
统一把响应里的提示文案翻译成对应语言，业务代码继续使用中文常量，避免改动面扩散。
未收录的文案原样返回（例如底层服务返回的技术诊断信息）。
"""

from __future__ import annotations

import re
from collections.abc import Callable
from contextvars import ContextVar

LANG_ZH = "zh"
LANG_EN = "en"

_lang: ContextVar[str] = ContextVar("growknow_lang", default=LANG_ZH)


def parse_accept_language(header: str | None) -> str:
    """按权重取出首选语言；中文之外一律回退英文。"""
    if not header:
        return LANG_ZH
    best: tuple[float, int, str] | None = None
    for index, part in enumerate(header.split(",")):
        token, _, params = part.strip().partition(";")
        token = token.strip().lower()
        if not token or token == "*":
            continue
        quality = 1.0
        matched = re.search(r"q=([0-9.]+)", params)
        if matched:
            try:
                quality = float(matched.group(1))
            except ValueError:
                quality = 1.0
        if best is None or quality > best[0]:
            best = (quality, index, token)
    if best is None:
        return LANG_ZH
    return LANG_ZH if best[2].startswith("zh") else LANG_EN


class LanguageMiddleware:
    """纯 ASGI 中间件：把请求语言放入 contextvar，供同请求内的同步/异步代码读取。"""

    def __init__(self, app) -> None:  # noqa: ANN001
        self.app = app

    async def __call__(self, scope, receive, send):  # noqa: ANN001
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers") or []}
        raw = headers.get(b"accept-language", b"")
        token = _lang.set(parse_accept_language(raw.decode("latin-1")))
        try:
            await self.app(scope, receive, send)
        finally:
            _lang.reset(token)


def current_lang() -> str:
    return _lang.get()


def lang_of(request) -> str:  # noqa: ANN001
    """从请求头读取语言；异常处理器可能位于中间件之外，不能只依赖 contextvar。"""
    headers = getattr(request, "headers", None)
    header = headers.get("accept-language") if headers is not None else None
    return parse_accept_language(header)


def _plural_files(value: str) -> str:
    return f"Deleted {value} file" if value == "1" else f"Deleted {value} files"


_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^知识库不存在$"), "Knowledge base not found"),
    (re.compile(r"^知识库名称需为 1-60 个字符$"), "Name must be 1-60 characters"),
    (
        re.compile(r"^知识库 ID 需以英文字母或数字开头，仅包含字母、数字、- 和 _，长度 2-64$"),
        "ID must start with a letter or digit, contain only letters, digits, - and _, and be 2-64 characters",
    ),
    (re.compile(r"^知识库类型不合法$"), "Invalid knowledge base type"),
    (re.compile(r"^知识库 ID 已被占用$"), "Knowledge base ID is already taken"),
    (re.compile(r"^目标上传目录已存在，请更换 ID$"), "Upload directory already exists; choose another ID"),
    (re.compile(r"^删除图谱数据失败：(.*)$"), r"Failed to delete graph data: \1"),
    (re.compile(r"^请选择要上传的文件$"), "Please choose files to upload"),
    (re.compile(r"^知识抽取 skill 不存在$"), "Extraction skill not found"),
    (re.compile(r"^该 skill 与知识库类型不匹配$"), "This skill does not match the knowledge base type"),
    (
        re.compile(r"^不支持的文件类型：(.*)（仅支持 PDF / DOC / DOCX）$"),
        r"Unsupported file type: \1 (PDF / DOC / DOCX only)",
    ),
    (re.compile(r"^文件为空：(.*)$"), r"Empty file: \1"),
    (re.compile(r"^文件超过 (\d+)MB：(.*)$"), r"File exceeds \1 MB: \2"),
    (re.compile(r"^文件不存在$"), "File not found"),
    (re.compile(r"^当前状态不可取消$"), "This file cannot be canceled in its current state"),
    (re.compile(r"^请选择要删除的文件$"), "Please choose files to delete"),
    (re.compile(r"^原始文件已丢失$"), "Original file is missing"),
    (re.compile(r"^请选择要下载的文件$"), "Please choose files to download"),
    (re.compile(r"^检索关键词不能为空$"), "Query cannot be empty"),
    (re.compile(r"^skill 不存在$"), "Skill not found"),
    (re.compile(r"^skill 名称需为 1-60 个字符$"), "Skill name must be 1-60 characters"),
    (
        re.compile(r"^skill 标识需为小写字母、数字和 -，例如 legal-triple$"),
        "Slug must use lowercase letters, digits and -, e.g. legal-triple",
    ),
    (re.compile(r"^skill 适用类型不合法$"), "Invalid skill target"),
    (re.compile(r"^skill 内容不能为空$"), "Skill content cannot be empty"),
    (re.compile(r"^skill 内容过长（上限 60000 字符）$"), "Skill content is too long (max 60,000 characters)"),
    (re.compile(r"^skill 标识已存在$"), "Slug already exists"),
    (re.compile(r"^内置 skill 不可删除，可直接编辑内容$"), "Built-in skills cannot be deleted; edit the content instead"),
    (re.compile(r"^保存设置失败：(.*)$"), r"Failed to save settings: \1"),
    (re.compile(r"^请先填写 LLM 服务地址与模型名$"), "Enter the LLM base URL and model first"),
    (re.compile(r"^LLM 服务返回 HTTP (\d+)$"), r"LLM service returned HTTP \1"),
    (re.compile(r"^请先填写向量嵌入服务地址与模型名$"), "Enter the embedding base URL and model first"),
    (re.compile(r"^未知的测试目标$"), "Unknown test target"),
    (re.compile(r"^参数不合法：(.*)$"), r"Invalid parameters: \1"),
    (re.compile(r"^服务器内部错误：(.*)$"), r"Internal server error: \1"),
    # 成功提示
    (re.compile(r"^知识库已创建$"), "Knowledge base created"),
    (re.compile(r"^知识库已更新$"), "Knowledge base updated"),
    (re.compile(r"^知识库已删除$"), "Knowledge base deleted"),
    (re.compile(r"^文件已上传，抽取任务已排队$"), "Files uploaded; extraction queued"),
    (re.compile(r"^已重新排队$"), "Extraction re-queued"),
    (re.compile(r"^正在取消抽取$"), "Canceling extraction"),
    (re.compile(r"^已取消排队中的任务$"), "Queued task canceled"),
    (re.compile(r"^skill 已创建$"), "Skill created"),
    (re.compile(r"^skill 已保存$"), "Skill saved"),
    (re.compile(r"^skill 已删除$"), "Skill deleted"),
    (re.compile(r"^设置已保存$"), "Settings saved"),
    (re.compile(r"^连接正常$"), "Connected"),
    (re.compile(r"^请求失败$"), "Request failed"),
    # 其它
    (re.compile(r"^前端界面由 nginx 容器在 (\d+) 端口提供$"), r"The web UI is served by the nginx container on port \1"),
]

_PLURAL_RULES: list[tuple[re.Pattern[str], Callable[[str], str]]] = [
    (re.compile(r"^已删除 (\d+) 个文件$"), _plural_files),
]

KIND_LABELS_ZH = {"vector": "全文向量库", "triple": "三元组库", "graph": "知识图谱"}
KIND_LABELS_EN = {"vector": "Vector store", "triple": "Triple store", "graph": "Knowledge graph"}

STATUS_LABELS_ZH = {
    "queued": "等待中",
    "extracting": "抽取中",
    "ready": "抽取完成",
    "failed": "抽取失败",
    "canceled": "已取消",
}
STATUS_LABELS_EN = {
    "queued": "Queued",
    "extracting": "Extracting",
    "ready": "Ready",
    "failed": "Failed",
    "canceled": "Canceled",
}


def translate(text: str, lang: str | None = None) -> str:
    """把中文提示翻译为指定语言（缺省为当前请求语言）；无对应译文时原样返回。"""
    if (lang or current_lang()) != LANG_EN or not text:
        return text
    for pattern, handler in _PLURAL_RULES:
        matched = pattern.match(text)
        if matched:
            return handler(matched.group(1))
    for pattern, template in _RULES:
        matched = pattern.match(text)
        if matched:
            return matched.expand(template)
    return text


def kind_label(kind: str) -> str:
    labels = KIND_LABELS_EN if current_lang() == LANG_EN else KIND_LABELS_ZH
    return labels.get(kind, kind)


def status_label(status: str) -> str:
    labels = STATUS_LABELS_EN if current_lang() == LANG_EN else STATUS_LABELS_ZH
    return labels.get(status, status)
