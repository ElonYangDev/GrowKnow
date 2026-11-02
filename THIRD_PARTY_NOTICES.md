# Third-Party Notices

GrowKnow is released under the [MIT License](LICENSE). The components that carry obligations, and
what GrowKnow does about them:

**Apache AGE 1.6.0 — Apache-2.0.** Compiled into the `growknow-postgres-age:16` image from tag
`release/PG16/1.6.0`. Section 4(d) requires its NOTICE to accompany distributions, so it is
reproduced verbatim from
[apache/age@release/PG16/1.6.0/NOTICE](https://github.com/apache/age/blob/release/PG16/1.6.0/NOTICE):

```
Apache AGE
Copyright 2023 The Apache Software Foundation.
This product includes software developed at
The Apache Software Foundation (http://www.apache.org/).


Portions of Apache AGE were originally developed by Bitnine Co., Ltd. and were
donated to the Apache Software Foundation. Copyright 2019-2020 Bitnine Co., Ltd.
```

**MinerU — Apache-2.0 with additional terms**
([LICENSE.md](https://github.com/opendatalab/MinerU/blob/master/LICENSE.md)). Document parsing is
powered by MinerU. MinerU is not bundled here: GrowKnow calls a MinerU endpoint that the user
deploys, or mineru.net's hosted API. The commercial thresholds in section 1 (100 million MAU or
USD 20 million monthly revenue) and the online-service attribution duty in section 2 therefore sit
with whoever operates the parsing service. The self-hosted model weights
([MinerU2.5-2509-1.2B](https://huggingface.co/OpenDataLab/MinerU2.5-2509-1.2B)) are AGPL-3.0, which
binds modifications to MinerU and its serving code — not programs that call it over an HTTP API.

**psycopg, psycopg-pool, psycopg-binary — LGPL-3.0.** Used unmodified through their public
database API and left pip-replaceable, so the LGPL stays within the library.

**certifi — MPL-2.0** (file-level copyleft; GrowKnow modifies none of its files) and
**caniuse-lite — CC-BY-4.0** (browser-compatibility data read while bundling; not part of the
shipped frontend).

Everything else is permissive: FastAPI, uvicorn, httpx, pydantic, pypdf, React, React Router, Vite
and lucide-react under MIT / BSD-3-Clause / ISC; python-multipart and TypeScript under Apache-2.0
(neither ships a NOTICE); PostgreSQL and pgvector under the PostgreSQL License; opencode under MIT,
run from the project's own image `ghcr.io/anomalyco/opencode`; the `python`, `node` and `nginx`
base images under PSF / MIT / BSD-2-Clause. No GPL or AGPL code appears anywhere in the dependency
tree, so nothing here constrains GrowKnow's own license.
