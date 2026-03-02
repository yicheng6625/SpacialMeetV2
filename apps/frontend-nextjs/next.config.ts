import type { NextConfig } from "next";

// 使用環境變數區分路由目標：
// - Docker 環境：NEXT_BACKEND_INTERNAL_URL=http://backend:8080（服務名稱）
// - 本地開發：預設 http://localhost:8080
const backendUrl = process.env.NEXT_BACKEND_INTERNAL_URL || "http://localhost:8080";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
      // Cloudflare Tunnel 的 catch-all 會將 /ws/* 轉到此 Next.js 服務
      // 必須在此補上代理，才能讓 WebSocket 連線穿透到 Spring Boot backend
      // 若缺少此設定，玩家雖可進入遊戲場景，但無法收到其他玩家的訊息
      {
        source: "/ws/:path*",
        destination: `${backendUrl}/ws/:path*`,
      },
    ];
  },
};

export default nextConfig;
