#!/bin/sh
# Собирает reset_and_install.sql из шапки и всех миграций
cd "$(dirname "$0")" && cat reset_header.sql migrations/*.sql > reset_and_install.sql && echo "reset_and_install.sql: $(wc -l < reset_and_install.sql) строк"
