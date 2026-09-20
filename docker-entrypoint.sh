#!/bin/sh
# 容器启动入口：安装依赖 → 类型检查与构建 → 启动静态服务
set -e

echo "[swiss-pairing] 安装依赖…"
npm install --no-audit --no-fund

echo "[swiss-pairing] 构建生产包（tsc + vite build）…"
npm run build

echo "[swiss-pairing] 启动服务，监听 0.0.0.0:${PORT:-8080}"
exec npx vite preview --host 0.0.0.0 --port "${PORT:-8080}"
