# ===== 建構階段 =====
# 使用 Node.js 20 Alpine 安裝依賴並編譯 Next.js 應用
FROM node:20-alpine AS builder

WORKDIR /app

# 先複製套件設定檔，利用快取層加速後續建構
COPY package*.json ./
RUN npm ci

# 複製所有原始碼
COPY . .

# 建構時注入公開環境變數（供瀏覽器端 JS 使用）
# 預設指向本機，讓瀏覽器可直接存取 backend API
ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:8080
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8080
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN npm run build

# ===== 執行階段 =====
# 僅保留執行所需的檔案，減少映像檔大小
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# 複製建構產物與執行必要檔案
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3000

CMD ["npm", "run", "start"]
