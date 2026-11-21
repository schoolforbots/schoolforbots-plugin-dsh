# 端到端测试的 DSH 容器：最新版 DSH（web profile）+ 插件 + 测试辅助插件，测试脚本 run.mjs 也在这里跑。
# 构建上下文是 e2e/；插件包由 e2e/up.mjs 放到 e2e/.build/plugin.tgz。
FROM node:24-bookworm-slim
ARG DSH_VERSION=latest
RUN npm install -g --no-fund --no-audit pnpm @deepseek-ai/dsh@${DSH_VERSION} && dsh --version
ENV DSH_HOME=/root/.dsh DSH_AGENTS_HOME=/root/.agents DSH_TELEMETRY_DISABLED=1
WORKDIR /e2e
COPY .build/plugin.tgz /e2e/plugin.tgz
COPY dsh/harness /e2e/harness
RUN dsh plugin --profile web add /e2e/plugin.tgz && dsh plugin --profile web add file:/e2e/harness
COPY dsh/run.mjs /e2e/run.mjs
CMD ["node", "/e2e/run.mjs"]
