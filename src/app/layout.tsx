import type { Metadata, Viewport } from "next";
// Font tiếng Việt Be Vietnam Pro (tự lưu trữ, trình duyệt chỉ tải phần chữ cần dùng)
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/400-italic.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "@fontsource/be-vietnam-pro/800.css";
import "./globals.css";
import { FeedbackHost } from "@/components/ui/feedback";

export const metadata: Metadata = {
  title: "YD-English — Tạo & chấm đề trắc nghiệm tiếng Anh",
  description: "Upload đề PDF, tự tạo đáp án, chia sẻ link cho học viên làm bài online và chấm điểm tự động.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#15803d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen antialiased">
        {children}
        <FeedbackHost />
      </body>
    </html>
  );
}
