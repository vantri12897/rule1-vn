// Next.js gọi hàm này khi có lỗi chưa được xử lý ở máy chủ (API, trang) → ghi vào nhật ký lỗi
export async function register() {}

export async function onRequestError(err: unknown, request: { path: string; method: string; headers: Record<string, string | string[] | undefined> }) {
  // Chỉ chạy ở môi trường Node (bản Edge không có các thư viện gửi mail / mã hoá)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { logError } = await import("./lib/errlog");
      const e = err as Error & { digest?: string };
      const ua = request.headers["user-agent"];
      await logError({
        source: "server",
        kind: "server-error",
        message: `${request.method} ${request.path.split("?")[0]}: ${e?.message ?? String(err)}`,
        detail: e?.stack?.split("\n").slice(0, 8).join("\n") ?? null,
        path: request.path.split("?")[0],
        quiz_slug: /\/q(?:uiz)?\/([a-z0-9]{6,20})/.exec(request.path)?.[1] ?? null,
        user_agent: Array.isArray(ua) ? ua[0] : (ua ?? null),
      });
    } catch {
      /* bỏ qua */
    }
  }
}
