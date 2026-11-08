import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Giữ trang vừa xem trong bộ nhớ trình duyệt một lúc → bấm Back / chuyển qua lại tức thì.
    // Dữ liệu (đề, kết quả) vẫn luôn được tải mới ở phía sau nên không bị cũ.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
