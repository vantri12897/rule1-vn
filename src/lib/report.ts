"use client";
/** Gửi lỗi về máy chủ để ghi nhật ký (không làm chậm trang, không báo gì cho người dùng). */
const sent = new Set<string>();
let count = 0;

export function reportError(kind: string, message: string, extra: { detail?: string; slug?: string } = {}) {
  try {
    const key = `${kind}|${message}`;
    if (sent.has(key) || count >= 15) return; // mỗi lỗi chỉ gửi 1 lần / lần mở trang
    sent.add(key);
    count++;
    const body = JSON.stringify({
      kind,
      message: message.slice(0, 500),
      detail: extra.detail?.slice(0, 3500) ?? null,
      path: location.pathname,
      slug: extra.slug ?? /^\/q\/([a-z0-9]+)/.exec(location.pathname)?.[1] ?? null,
    });
    const ok = navigator.sendBeacon?.("/api/log", new Blob([body], { type: "application/json" }));
    if (!ok) fetch("/api/log", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
  } catch {
    /* bỏ qua */
  }
}

/** Lỗi không cần báo: do tiện ích trình duyệt, mạng chập chờn (đã có xử lý riêng), hoặc vô hại */
const NOISE = [/ResizeObserver loop/i, /^Script error\.?$/i, /chrome-extension:|moz-extension:|safari-extension:/i, /Failed to fetch|NetworkError|Load failed|network error/i, /AbortError|The operation was aborted/i, /Non-Error promise rejection/i];
export const isNoise = (msg: string, src = "") => NOISE.some((r) => r.test(msg) || r.test(src));
