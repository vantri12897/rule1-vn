import type { NextConfig } from "next";

// Phiên bản đang chạy = 7 ký tự đầu của mã commit trên GitHub (Vercel tự cung cấp lúc build)
const version = (process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  experimental: {
    // Giữ trang vừa xem trong bộ nhớ trình duyệt một lúc → bấm Back / chuyển qua lại tức thì.
    // Dữ liệu (đề, kết quả) vẫn luôn được tải mới ở phía sau nên không bị cũ.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
