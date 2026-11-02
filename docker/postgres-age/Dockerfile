# growknow PostgreSQL 镜像：pgvector + Apache AGE
#
# 在 pgvector/pgvector:pg16 基础上源码编译 Apache AGE 1.6.0（openCypher 图扩展，
# 官方 release/PG16/1.6.0 分支即 PG16 维护版），让「知识图谱」与
# 「向量 / 三元组 / 元数据」同库同事务，不再依赖 Neo4j。
#
# 图与标签由应用启动时自动创建（见 age_store._ensure_ready），
# 该 initdb 脚本只为全新数据卷补一个兜底 search_path。
FROM pgvector/pgvector:pg16

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates \
        build-essential \
        postgresql-server-dev-16 \
        git \
        flex \
        bison \
 && rm -rf /var/lib/apt/lists/* \
 && git clone --branch release/PG16/1.6.0 --depth 1 https://github.com/apache/age.git /usr/src/age \
 && make -C /usr/src/age -j"$(nproc)" \
 && make -C /usr/src/age install \
 && rm -rf /usr/src/age

COPY initdb/00-age-setup.sh /docker-entrypoint-initdb.d/00-age-setup.sh
RUN chmod +x /docker-entrypoint-initdb.d/00-age-setup.sh
