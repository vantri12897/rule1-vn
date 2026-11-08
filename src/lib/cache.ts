"use client";
/**
 * Bộ nhớ đệm nhỏ trong trình duyệt (chỉ tồn tại trong tab đang mở).
 * Dùng để hiện ngay dữ liệu đã xem khi quay lại trang, rồi tải mới ở phía sau
 * (stale-while-revalidate). Xoá sạch khi đăng xuất / đăng nhập.
 */
const store = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}
export function cacheSet<T>(key: string, value: T) {
  store.set(key, value);
}
export function cacheDelete(prefix: string) {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
export function cacheClear() {
  store.clear();
  inflight.clear();
}
/** Tải trước (vd. khi rê chuột vào thẻ đề) — gộp các lần gọi trùng nhau */
export function prefetchOnce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cur = inflight.get(key) as Promise<T> | undefined;
  if (cur) return cur;
  const p = fn()
    .then((v) => (cacheSet(key, v), v))
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
