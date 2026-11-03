<div align="center">

<img src="frontend/public/logo-badge.svg" alt="GrowKnow" width="150">

# GrowKnow

English · [简体中文](#growknow-1)

</div>

> Turn a general-purpose LLM Agent into an expert Agent that understands your field and your business better.  

How do you make a general-purpose LLM Agent an expert that really understands your field and your business? Building a knowledge base is currently the most mainstream approach. Yet building one is still not an easy thing to do.

GrowKnow is dedicated to building a complete and easy-to-use knowledge base solution: you upload files, GrowKnow automatically mines knowledge out of them and builds the knowledge base, and supports incremental updates. Your Agent supplies the keywords, and GrowKnow recalls the relevant knowledge from the knowledge base you specify and returns it to the Agent.

## 🎞️ Video

https://github.com/user-attachments/assets/f4e9cb9d-ee8e-4c44-8194-c1b56f5db349

⬆️ If the video above does not work, please click on the backup link: [https://www.bilibili.com/video/BV1qZ4g6tEAz](…)  


## ⭐ Key Features

**1. Three knowledge forms** —— Full-text vector base, triples, and knowledge graph each have their strengths and trade-offs; pick the one that best suits the knowledge you have.  

**2. Broad file format support** —— Upload PDF, doc, ppt and image files straight into GrowKnow, with no preprocessing on your side.  

**3. A friendly interface** —— Once the deployment is up, open the GrowKnow WebUI in a browser and carry out every operation there.  

**4. Customizable extraction rules** —— What knowledge to extract and how to extract it are both defined in the extraction skill, edited directly in the WebUI with no code changes, so you can tailor the knowledge base to your own needs.  

**5. Plug-and-play integration** —— GrowKnow exposes a compact HTTP API that can be wired into any LLM Agent you use daily (ChatGPT, Claude Code, Qoder, WorkBuddy, to name a few), turning them into agents that understand you.  

## 🧭 Quick Start

### Step 1: Configure the environment

Make a copy of the environment template .env.example

```bash
cp .env.example .env
```

Open .env with the text editor you like and fill in the following:

1. Configure the LLM: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`
2. Configure the embedding model: `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY` (OpenAI-compatible; any model works, for example bge-m3 or Qwen3-Embedding)

> Note: GrowKnow's knowledge extraction needs an LLM and an embedding model. You prepare the models yourself — they are not included in the GrowKnow repository.

### Step 2: Choose how to deploy the document layout module (optional)

GrowKnow's pipeline uses [MinerU](https://github.com/opendatalab/MinerU), an excellent multi-format document layout tool. MinerU is not included in the GrowKnow repository, so configure it in one of the following ways:

> Note: If you just want a quick feel for GrowKnow, skip this step and go to Step 3 — GrowKnow uses the "official lightweight API" by default.
> 
> You can change the MinerU calling mode at any time later on the "System Settings" page of the GrowKnow WebUI. Settings made in the WebUI take precedence over .env.

1. Call the official lightweight API (used by default; no registration, free). Change this 1 field in .env:

```bash
MINERU_MODE=agent
```

2. Call the official precision API (best performance; registration and payment required). Change these 2 fields in .env:

```bash
MINERU_MODE=precision
MINERU_API_KEY=XXX       # Register on the MinerU website and apply for a token
```

3. Deploy it locally (recommended if your machine has a GPU)

Deploy following the [official MinerU manual](https://opendatalab.github.io/MinerU/quick_start/#webui-and-api) and start the mineru-kit api-server service. Then change these 2 fields in .env to point at that service's URL:

```bash
MINERU_MODE=selfhost
MINERU_URL=              # the URL of the mineru-kit api-server you just started
```

### Step 3: Start GrowKnow

```bash
docker compose up -d --build
```

### Using GrowKnow

Open <http://localhost:8090> in a browser and start using GrowKnow.

## 🤖 Connect GrowKnow to Your Agent

GrowKnow serves knowledge base retrieval through the API endpoint http://localhost:8090/api/v1/kb/{kb-id}/search.

**Each knowledge base has its own {kb-id}, so replace it with the correct knowledge base ID**.  

You can feed the prompt below directly to your Agent, or wrap it into a Skill:

````markdown

Before answering a question, consult the knowledge base first — it may help you answer more accurately.

Step 1: List the knowledge bases:

```bash
curl -s http://localhost:8090/api/v1/kb
```

Note down the `kb-id` of the knowledge base you want to use.

Step 2: Search inside that knowledge base:

```bash
curl -s -X POST http://localhost:8090/api/v1/kb/{kb-id}/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "keyword1 keyword2", "top_k": 5}'
```

Replace `kb-id` with the knowledge base to search.  
Write 2–6 retrieval keywords in `query`, not a whole sentence; if nothing matches, try synonyms or shorter words and search once more.

Step 3: Read the retrieval results:

- If `data.kind` is `vector` or `triple`: read `data.results[]`, where `text` is the knowledge itself (a slice of the source text in a vector base, "subject predicate object" in a triple base); take the top 3–5 by `score`.

- If `data.kind` is `graph`: read `data.nodes[]` (`name` / `type` / `description` / `attributes`) and `data.edges[]` (`source` / `predicate` / `target`), which together form the one-hop neighborhood of the matched entities.

- `file_name` and `page_start` tell you which page of which file the knowledge came from.

````

## 💻 Local Development

```bash
docker compose up -d db            # image with pgvector and Apache AGE included

cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
python -m app.worker               # in another terminal

cd frontend && npm install && npm run dev   # http://localhost:5173
```

To run against an existing PostgreSQL, compile AGE 1.6 (for PG16) yourself, set `shared_preload_libraries='age'`, and install the `vector` extension; the backend creates the graph on first startup.

```
backend/app/         api.py routes · worker.py queue · db.py schema · i18n.py API copy
  services/          mineru.py parsing adapter · split.py chunking · pipeline.py extraction
                     embedding.py vectors · age_store.py graph · settings.py settings
frontend/src/        pages/ five pages · components/ modals and graph · i18n.tsx bilingual dictionary
tools/smoke_test.py  end-to-end smoke test
```

End-to-end smoke test (create base → upload → extract → search → download → delete):

```bash
python tools/smoke_test.py --base http://localhost:8090 --pdf ./sample.pdf
```

## 📄 License

GrowKnow is released under the [MIT License](LICENSE). Third-party components and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

<a id="growknow-1"></a>

<div align="center">

The following content is in Chinese  
以下是中文版本

---

<br />

[English](#growknow) · 简体中文

</div>
<br />

> 让通用 LLM Agent 变成一位更懂你专业、更懂你业务的专家 Agent。

如何让一个通用 LLM Agent 变成一位更懂你专业、更懂你业务的专家？构建知识库是目前最主流的做法。然而，构建知识库目前并不是一件容易的事情。

GrowKnow 致力于构建一套完善、易用的知识库解决方案：你上传文件，GrowKnow 自动从文件中挖掘知识并构建知识库，并支持增量更新。Agent 提供关键词，GrowKnow 从指定的知识库中召回相关知识并返回给 Agent。

## ⭐ 主要特性

**1. 三种知识形态** —— 全文向量库、三元组、知识图谱各有优劣，根据知识特点选择最合适的一种。  

**2. 兼容多种文件格式** —— 你可以直接把 PDF、doc、ppt、图片等文件上传到 GrowKnow，无需提前处理。  

**3. 友好的操作界面** —— 部署成功后，通过浏览器即可打开 GrowKnow WebUI，所有操作在 WebUI 上完成。  

**4. 知识抽取规则自定义** —— 抽什么知识、怎么抽，都定义在知识抽取 skill 里，WebUI 中直接编辑，无需改代码。你可以深度定制属于自己的知识库。  

**5. 即插即用的接入能力** —— GrowKnow 提供简洁的 HTTP API，可以被接入任何一款你常用的 LLM Agent（包括但不限于 ChatGPT、Claude Code、Qoder、WorkBuddy），即刻把它们变成更懂你的专属 Agent。  

## 🧭 快速开始

### Step1: 配置环境信息

复制一份环境配置文件模板 .env.example

```bash
cp .env.example .env
```

使用你习惯的文本编辑器打开 .env ，填写以下内容：

1. 配置 LLM：`LLM_BASE_URL`，`LLM_MODEL`，`LLM_API_KEY`
2. 配置 Embedding 模型：`EMBEDDING_BASE_URL`，`EMBEDDING_MODEL`，`EMBEDDING_API_KEY`（兼容 OpenAI 协议，种类不限，例如 bge-m3、Qwen3-Embedding）

> 注：GrowKnow 的知识抽取功能需要 LLM 和 Embedding 模型，你需要自行准备模型，这不包含在 GrowKnow 的仓库中

### Step2: 选择文档版面处理模块的部署方式 （非必须步骤）

GrowKnow 的流水线中使用了 [MinerU](https://github.com/opendatalab/MinerU) ，这是一款出色的多格式文档版面处理工具。但 MinerU 不包含在 GrowKnow 的仓库中，需要你选择以下其中一种方式配置 MinerU：

> 注：如果你想先快速体验 GrowKnow，可以跳过这一步，直接进入 Step 3，GrowKnow将默认使用“官方轻量 API”。
> 
> 此后如需调整 MinerU 调用模式，可以随时在 GrowKnow WebUI 的「系统设置」页面切换。WebUI的配置优先级高于 .env。

1. 调用官方轻量 API（默认使用此方式，免注册、免费），修改 .env 中的以下1个字段：

```bash
MINERU_MODE=agent
```

2. 调用官方精准 API（性能最好，需注册、付费），修改 .env 中的以下2个字段：

```bash
MINERU_MODE=precision
MINERU_API_KEY=XXX       # 请自行在 MinerU 官网注册并申请
```

3. 本地部署（推荐，如果你的电脑里有 GPU）

按照 [MinerU 官方手册](https://opendatalab.github.io/MinerU/quick_start/#webui-and-api) 部署，启动 mineru-kit api-server 服务。再修改 .env 中的以下2个字段，指向这个服务的 URL：

```bash
MINERU_MODE=selfhost
MINERU_URL=              # 填写刚刚你启动的 mineru-kit api-server 的URL
```

### Step3: 启动 GrowKnow

```bash
docker compose up -d --build
```

### 使用 GrowKnow

在浏览器中打开 <http://localhost:8090>，使用 GrowKnow。

## 🤖 将 GrowKnow 接入你的 Agent

GrowKnow 通过 API 端点 http://localhost:8090/api/v1/kb/{kb-id}/search 对外提供知识库检索服务。

**不同知识库通过 {kb-id} 区分，请将其替换成正确的知识库ID**。  

你可以直接将下面这段 prompt 输入给 Agent，或将其封装进 Skill：

````markdown

在回答问题之前，先查阅知识库，这或许有助于你更准确地回答问题。

Step 1: 查询知识库列表：

```bash
curl -s http://localhost:8090/api/v1/kb
```

记下你要使用的知识库的 `kb-id`。

Step 2: 在指定知识库中搜索：

```bash
curl -s -X POST http://localhost:8090/api/v1/kb/{kb-id}/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "keyword1 keyword2", "top_k": 5}'
```

`kb-id` 替换成要检索的目标知识库。  
`query` 写 2–6 个检索关键词，不要写整句；没命中就换同义词或更短的词再查一次。

Step 3: 解析知识库查询结果：

- 如果`data.kind` 是 `vector` 或 `triple`：读 `data.results[]`，`text` 就是知识本身（向量库是原文切片，三元组库是「主体 关系 客体」），按 `score` 从高到低取前 3–5 条。

- 如果 `data.kind` 是 `graph`：读 `data.nodes[]`（`name` / `type` / `description` / `attributes`）与 `data.edges[]`（`source` / `predicate` / `target`），它们构成命中实体的一跳邻域。

- `file_name` 和 `page_start` 表明知识来自于哪个文件的第几页。

````

## 💻 本地开发

```bash
docker compose up -d db            # 自带 pgvector 与 Apache AGE 的镜像

cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
python -m app.worker               # 另一个终端

cd frontend && npm install && npm run dev   # http://localhost:5173
```

用已有的 PostgreSQL 需自行编译 AGE 1.6（PG16）并设置 `shared_preload_libraries='age'`，安装 `vector` 扩展；后端首次启动会自动建图。

```
backend/app/         api.py 路由 · worker.py 队列 · db.py 表结构 · i18n.py 接口文案
  services/          mineru.py 解析适配 · split.py 切片 · pipeline.py 抽取
                     embedding.py 向量 · age_store.py 图谱 · settings.py 设置
frontend/src/        pages/ 五个页面 · components/ 弹窗与图谱 · i18n.tsx 双语词典
tools/smoke_test.py  端到端冒烟测试
```

端到端冒烟测试（建库 → 上传 → 抽取 → 检索 → 下载 → 删除）：

```bash
python tools/smoke_test.py --base http://localhost:8090 --pdf ./sample.pdf
```

## 📄 许可证

GrowKnow 采用 [MIT 许可证](LICENSE) 发布。第三方组件及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
