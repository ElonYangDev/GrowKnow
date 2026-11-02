#!/bin/bash
# 全新数据卷首次初始化：安装 AGE 扩展，并给直连工具补 ag_catalog 搜索路径。
# 已有数据卷不会执行本脚本；扩展与图由应用启动时幂等创建。
set -e
cat > /tmp/growknow_age_init.sql <<EOSQL
CREATE EXTENSION IF NOT EXISTS age;
ALTER DATABASE "$POSTGRES_DB" SET search_path = "\$user", public, ag_catalog;
EOSQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /tmp/growknow_age_init.sql
rm -f /tmp/growknow_age_init.sql
