# Single portable container for the chat API (the web app is static and
# deploys to Cloudflare Pages separately). The same image runs on Fly.io
# today and on AWS (ECS/EC2) later — only the deployment manifest changes.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Pin pnpm for reproducible installs (no packageManager drift in corepack).
RUN corepack enable

# Workspace sources only — the API runs via tsx (no separate build step,
# since workspace packages export TS source directly).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages packages/
COPY apps apps/

RUN pnpm install --frozen-lockfile

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@portfolio/api", "exec", "tsx", "src/server.ts"]
