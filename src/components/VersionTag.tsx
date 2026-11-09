"use client";
import { fmtDate } from "@/lib/ui";
import { useT } from "@/lib/i18n/client";

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || "";

/** "Phiên bản 1ace449 · cập nhật 09/11/2026 13:55" — để biết lần cập nhật mới nhất đã lên web chưa */
export function VersionTag({ className = "" }: { className?: string }) {
  const { t } = useT();
  return (
    <span className={className} title={t("Mã phiên bản = 7 ký tự đầu của lần cập nhật trên GitHub")}>
      {t("Phiên bản {v} · cập nhật {d}", { v: APP_VERSION, d: BUILD_TIME ? fmtDate(BUILD_TIME) : "—" })}
    </span>
  );
}
