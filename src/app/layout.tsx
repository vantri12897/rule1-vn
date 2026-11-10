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
import { ErrorReporter } from "@/components/ErrorReporter";
import { LangProvider } from "@/lib/i18n/client";
import { getLang, getT } from "@/lib/i18n/server";
import { cookies } from "next/headers";
import { FS_COOKIE, THEME_COOKIE, normalizeFs, normalizeTheme, themeSwatch } from "@/lib/appearance";

/** Màu & cỡ chữ người xem đã chọn (cookie) → vẽ đúng ngay từ máy chủ, không nháy màu */
async function getAppearance() {
  const c = await cookies();
  return { theme: normalizeTheme(c.get(THEME_COOKIE)?.value), fs: normalizeFs(c.get(FS_COOKIE)?.value) };
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: t("YD-English — Tạo & chấm đề trắc nghiệm tiếng Anh"),
    description: t("Upload đề PDF, tự tạo đáp án, chia sẻ link cho học viên làm bài online và chấm điểm tự động."),
  };
}

export async function generateViewport(): Promise<Viewport> {
  const { theme } = await getAppearance();
  return { width: "device-width", initialScale: 1, themeColor: themeSwatch(theme) };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [lang, { theme, fs }] = await Promise.all([getLang(), getAppearance()]);
  return (
    <html lang={lang} data-theme={theme === "green" ? undefined : theme} style={fs !== 1 ? ({ "--fs": fs } as React.CSSProperties) : undefined}>
      <body className="min-h-screen antialiased">
        <LangProvider lang={lang}>
          {children}
          <FeedbackHost />
          <ErrorReporter />
        </LangProvider>
      </body>
    </html>
  );
}
