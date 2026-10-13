# AWS EKS(Fargate)용 이미지. ALB가 화면과 API를 같은 호스트에서 경로로 나누므로
# SAME_ORIGIN_API=true로 빌드해 Next의 API rewrite를 끄고 standalone 서버만 담는다.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 SAME_ORIGIN_API=true
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 SAME_ORIGIN_API=true PORT=3000 HOSTNAME=0.0.0.0
# 클러스터 Pod 보안 설정(runAsUser/runAsGroup 10001)과 같은 비루트 계정.
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app
COPY --from=build --chown=10001:10001 /app/.next/standalone ./
COPY --from=build --chown=10001:10001 /app/.next/static ./.next/static
COPY --from=build --chown=10001:10001 /app/public ./public
USER 10001:10001
EXPOSE 3000
CMD ["node", "server.js"]
