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
    ];
  },
};

export default nextConfig;
