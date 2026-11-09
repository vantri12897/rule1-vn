"use client";
import { useEffect } from "react";
import { reportError } from "@/lib/report";

/** Lỗi ở tầng ngoài cùng (hiếm) — trang tối giản, song ngữ */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    reportError("render-error", error.message || "global error", { detail: `${error.digest ?? ""}\n${error.stack ?? ""}` });
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 40 }}>
        <p style={{ fontSize: 40 }}>😕</p>
        <h1>Something went wrong / Trang gặp lỗi</h1>
        <p>The error has been recorded. / Lỗi đã được ghi lại.</p>
        <button onClick={() => location.reload()} style={{ padding: "10px 18px", borderRadius: 10, border: 0, background: "#15803d", color: "#fff", fontWeight: 700 }}>
          Reload / Tải lại
        </button>
      </body>
    </html>
  );
}
