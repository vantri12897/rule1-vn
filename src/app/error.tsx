"use client";
import { useEffect } from "react";
import { reportError } from "@/lib/report";
import { useT } from "@/lib/i18n/client";

/** Trang hiện ra khi một phần website bị lỗi lúc hiển thị (thay vì trang trắng) */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useT();
  useEffect(() => {
    reportError("render-error", error.message || "render error", { detail: `${error.digest ?? ""}\n${error.stack ?? ""}` });
  }, [error]);
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <div className="card p-6">
        <p className="text-4xl">😕</p>
        <h1 className="mt-2 text-lg font-bold">{t("Trang gặp lỗi khi hiển thị")}</h1>
        <p className="mt-2 text-sm text-muted">{t("Lỗi đã được ghi lại để sửa. Bài làm đang làm dở vẫn được giữ trên máy này.")}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn-primary" onClick={() => reset()}>{t("Thử lại")}</button>
          <button className="btn-outline" onClick={() => location.reload()}>{t("Tải lại trang")}</button>
        </div>
      </div>
    </div>
  );
}
