#!/bin/sh
set -eu

if [ "$#" -gt 1 ]; then
  echo "Cách dùng: sh scripts/bootstrap.sh [studio.tenmiencuaban.vn]" >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Cần cài Docker trước khi tạo cấu hình." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Cần Docker Compose v2 (lệnh docker compose)." >&2
  exit 1
fi

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
# Node runs in a short-lived container; installing Node on the VPS is optional.
# Preserve the invoking user's ownership and never print generated credentials.
docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$project_dir,dst=/project" \
  --workdir /project node:24-alpine node scripts/setup-env.mjs "$@"

echo "Điền thông tin Meta trong .env, rồi chạy: docker compose up -d --build"
