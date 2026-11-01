import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YD-English — Tạo & chấm đề trắc nghiệm tiếng Anh",
  description: "Upload đề PDF, tự tạo đáp án, chia sẻ link cho học viên làm bài online và chấm điểm tự động.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#16a34a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
