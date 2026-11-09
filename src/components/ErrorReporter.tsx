"use client";
import { useEffect } from "react";
import { isNoise, reportError } from "@/lib/report";

/** Lắng nghe lỗi JavaScript chưa được xử lý trên mọi trang và gửi về nhật ký lỗi */
export function ErrorReporter() {
  useEffect(() => {
    const onErr = (e: ErrorEvent) => {
      const msg = e.message || String(e.error ?? "");
      if (isNoise(msg, e.filename)) return;
      reportError("js-error", msg, { detail: `${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack ?? ""}` });
    };
    const onRej = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | string;
      const msg = typeof r === "string" ? r : r?.message ?? String(r);
      if (isNoise(msg, typeof r === "string" ? "" : r?.stack ?? "")) return;
      reportError("js-error", msg, { detail: typeof r === "string" ? "" : r?.stack });
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
  return null;
}
