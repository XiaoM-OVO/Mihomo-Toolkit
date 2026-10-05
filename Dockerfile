# ------------------------------------------------------------------------------
# Mihomo-Toolkit Production Dockerfile
# Lightweight, Multi-arch, Secure Alpine Node.js Runner
# ------------------------------------------------------------------------------

FROM node:20-alpine AS runner

# 设置生产环境变量
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    CONFIG_PATH=/app/config.yaml

WORKDIR /app

# 先复制依赖清单利用 Docker 缓存层
COPY package.json package-lock.json ./

# 仅安装生产依赖并清理 npm 缓存
RUN npm ci --omit=dev && npm cache clean --force

# 复制运行时所需核心资产
COPY src/ ./src/
COPY index.d.ts ./
COPY config.example.yaml ./

# 暴露服务端口
EXPOSE 3000

# 容器健康检查 (利用内置 /healthz 端点)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

# 启动常驻订阅转换服务
CMD ["node", "src/targets/server.js"]
