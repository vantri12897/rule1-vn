"use client";
import { isDataUrl, isStoredUrl } from "./images";
import { reportError } from "./report";

/** Tải 1 hình (data URL) lên kho file → link. Lỗi thì trả null (câu hỏi giữ hình như cũ, máy chủ tự chuyển sau). */
export async function uploadDataUrl(data: string): Promise<string | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch("/api/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
      if (r.ok) {
        const { url } = (await r.json()) as { url?: string };
        return isStoredUrl(url) ? url : null;
      }
      if (r.status < 500 && r.status !== 429) return null;
    } catch {}
    await new Promise((res) => setTimeout(res, 600 * (i + 1)));
  }
  return null;
}

/**
 * Trước khi lưu câu hỏi: tải các hình còn dạng data URL lên kho file (3 hình cùng lúc), thay bằng link.
 * Hình nào tải không được vẫn giữ nguyên dạng cũ để không mất hình.
 */
export async function uploadQuestionImages<T extends { image?: string | null }>(items: T[]): Promise<{ items: T[]; failed: number }> {
  const out = [...items];
  const todo = out.map((q, i) => [q, i] as const).filter(([q]) => isDataUrl(q.image));
  const cache = new Map<string, Promise<string | null>>(); // cùng 1 hình dùng ở nhiều câu → tải 1 lần
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const [q, i] = todo[next++];
      const src = q.image as string;
      if (!cache.has(src)) cache.set(src, uploadDataUrl(src));
      const url = await cache.get(src)!;
      if (url) out[i] = { ...q, image: url };
      else failed++;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (failed) reportError("image-upload", `image upload failed for ${failed} image(s)`, {});
  return { items: out, failed };
}

/** Đổi link hình về data URL (để file sao lưu / file Word tự mang theo hình) */
export async function urlToDataUrl(src: string): Promise<string | null> {
  if (isDataUrl(src)) return src;
  try {
    const r = await fetch(src);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(typeof fr.result === "string" ? fr.result : null);
      fr.onerror = () => res(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
