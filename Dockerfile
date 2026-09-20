FROM node:20-alpine

WORKDIR /app

# 先拷贝依赖清单（便于利用层缓存），再拷贝全部源码
COPY package.json package-lock.json* ./
COPY . .

# 依赖安装与构建在容器启动时执行（见 docker-entrypoint.sh）
RUN chmod +x docker-entrypoint.sh

EXPOSE 8080

CMD ["./docker-entrypoint.sh"]
