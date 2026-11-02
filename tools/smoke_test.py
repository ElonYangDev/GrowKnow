#!/usr/bin/env python3
"""growknow 端到端冒烟测试。

对已启动的实例依次验证：健康检查 → 建三种知识库 → 上传 → 轮询抽取 →
内容/检索/下载/打包 → 改 ID → 级联删除 → 删库。

用法：
    python tools/smoke_test.py --base http://localhost:8090 --pdf ./sample.pdf
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile
import io


def call(method: str, url: str, body: dict | None = None, timeout: float = 60) -> dict:
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return json.loads(raw)
        except ValueError:
            raise SystemExit(f"HTTP {exc.code} {url}: {raw[:300]}") from exc


def post_file(url: str, path: str, page_slices: int = 5, timeout: float = 300) -> dict:
    boundary = "----growknow" + uuid.uuid4().hex
    name = path.replace("\\", "/").rsplit("/", 1)[-1]
    chunks: list[bytes] = []
    chunks.append(f"--{boundary}\r\n".encode())
    chunks.append(
        f'Content-Disposition: form-data; name="files"; filename="{name}"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n".encode()
    )
    with open(path, "rb") as handle:
        chunks.append(handle.read())
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}\r\n".encode())
    chunks.append(b'Content-Disposition: form-data; name="page_slices"\r\n\r\n')
    chunks.append(str(page_slices).encode())
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    payload = b"".join(chunks)
    request = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def must(payload: dict, what: str) -> dict:
    if payload.get("code") != 0:
        raise AssertionError(f"{what} 失败：{payload.get('code')} {payload.get('message')}")
    return payload.get("data")


def wait_ready(base: str, key: str, file_ids: list[int], timeout: float = 900) -> list[dict]:
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        files = must(call("GET", f"{base}/kb/{key}/files"), "文件列表")
        mine = [item for item in files if item["id"] in file_ids]
        state = ", ".join(f'{item["name"]}={item["status"]}' for item in mine)
        if state != last:
            print(f"  [{key}] {state}")
            last = state
        if mine and all(item["status"] in ("ready", "failed") for item in mine):
            for item in mine:
                if item["status"] == "failed":
                    raise AssertionError(f"抽取失败 {item['name']}：{item.get('error')}")
            return mine
        time.sleep(3)
    raise AssertionError(f"{key} 抽取超时")


def download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def run(base: str, pdf: str) -> None:
    base = base.rstrip("/") + "/api/v1"
    suffix = uuid.uuid4().hex[:6]
    print("1. 健康检查")
    health = must(call("GET", f"{base}/health"), "健康检查")
    print("  ", health)

    created: list[str] = []
    extracted: dict[str, int] = {}
    kernels = {
        "vector": "smoke-vec-" + suffix,
        "triple": "smoke-tri-" + suffix,
        "graph": "smoke-gra-" + suffix,
    }
    try:
        for kind, key in kernels.items():
            print(f"2. 创建 {kind} 知识库 {key}")
            must(
                call(
                    "POST",
                    f"{base}/kb",
                    {"name": f"冒烟-{kind}", "kb_key": key, "kind": kind, "description": "自动测试"},
                ),
                f"创建 {kind} 知识库",
            )
            created.append(key)
            result = post_file(f"{base}/kb/{key}/files", pdf)
            files = must(result, "上传文件")
            file_id = files[0]["id"]
            extracted[kind] = file_id
            print(f"   上传 {files[0]['name']} ({files[0]['size']} bytes) id={file_id}")

            ready = wait_ready(base, key, [file_id])
            count = ready[0]["knowledge_count"]
            print(f"   完成，知识数 = {count}，页数 = {ready[0]['page_count']}")
            if count <= 0:
                raise AssertionError(f"{kind} 没有抽取到知识")

            content = must(
                call("GET", f"{base}/kb/{key}/content?page=1&size=10"), f"{kind} 内容"
            )
            if kind == "graph":
                if not content.get("nodes"):
                    raise AssertionError("图谱为空")
                print(f"   图谱节点 {len(content['nodes'])}，边 {len(content['edges'])}")
            else:
                if content.get("total", 0) <= 0 or not content.get("items"):
                    raise AssertionError(f"{kind} 内容为空")
                sample = content["items"][0]
                text = sample.get("text") or sample.get("content") or sample.get("subject")
                print(f"   内容样例：{str(text)[:40]}")

            search = must(
                call("POST", f"{base}/kb/{key}/search", {"query": "示例", "top_k": 5}),
                f"{kind} 检索",
            )
            print(f"   检索 mode={search.get('mode')} 命中 {len(search.get('results') or [])}")

            raw = download(f"{base}/kb/{key}/files/{file_id}/download")
            with open(pdf, "rb") as handle:
                if raw != handle.read():
                    raise AssertionError("下载内容与上传不一致")
            archive = download(f"{base}/kb/{key}/files/archive?ids={file_id}")
            with zipfile.ZipFile(io.BytesIO(archive)) as zf:
                if not zf.namelist():
                    raise AssertionError("打包下载为空")
            print(f"   原件下载 {len(raw)} bytes，打包 {len(archive)} bytes")

            invocations = must(
                call("GET", f"{base}/kb/{key}/invocations"), "调用示例"
            )
            if "python" not in invocations or key not in invocations["url"]:
                raise AssertionError("调用示例内容不完整")
            print(f"   调用地址 {invocations['url']}")

        print("3. 修改知识库 ID（向量库与图谱库）")
        for kind in ("vector", "graph"):
            old = kernels[kind]
            new = old + "-renamed"
            must(call("PATCH", f"{base}/kb/{old}", {"kb_key": new, "name": "冒烟-改名"}), "修改 ID")
            created[created.index(old)] = new
            kernels[kind] = new
            files = must(call("GET", f"{base}/kb/{new}/files"), "改名后文件列表")
            if not files:
                raise AssertionError("改名后文件列表为空")
            raw = download(f"{base}/kb/{new}/files/{files[0]['id']}/download")
            if not raw:
                raise AssertionError("改名后下载失败")
            missing = call("GET", f"{base}/kb/{old}/files")
            if missing.get("code") == 0:
                raise AssertionError("旧 ID 仍然可访问")
            if kind == "graph":
                content = must(call("GET", f"{base}/kb/{new}/content"), "改名后图谱")
                if not content.get("nodes"):
                    raise AssertionError("改 ID 后图谱丢失")
            print(f"   {old} → {new}，文件、原件与知识均保留")

        print("4. 批量删除文件并确认知识级联清空")
        for kind in ("vector", "graph"):
            key = kernels[kind]
            file_id = extracted[kind]
            must(call("DELETE", f"{base}/kb/{key}/files", {"file_ids": [file_id]}), "删除文件")
            content = must(call("GET", f"{base}/kb/{key}/content"), "删除后内容")
            if kind == "graph":
                if content.get("nodes") or content.get("edges"):
                    raise AssertionError("删除文件后图谱节点/边未清空")
            elif content.get("total", 0) != 0:
                raise AssertionError("删除文件后切片未清空")
            print(f"   {kind} 知识已清空")

        print("5. 删除全部知识库")
        for key in created:
            must(call("DELETE", f"{base}/kb/{key}"), f"删除 {key}")
        listed = must(call("GET", f"{base}/kb"), "知识库列表")
        if any(item["kb_key"].startswith("smoke-") for item in listed):
            raise AssertionError("删除后仍能列出冒烟知识库")
        created.clear()
        print("   OK")
        print("\n全部冒烟用例通过。")
    finally:
        for key in created:
            call("DELETE", f"{base}/kb/{key}")


def main() -> None:
    # Windows 控制台默认 GBK，文档里常有 ∘、ﬁ 等字符，统一按 UTF-8 输出
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:8090")
    parser.add_argument("--pdf", required=True, help="用于测试的 PDF / DOCX 路径")
    args = parser.parse_args()
    run(args.base, args.pdf)


if __name__ == "__main__":
    try:
        main()
    except AssertionError as exc:
        print(f"\n冒烟失败：{exc}", file=sys.stderr)
        sys.exit(1)
