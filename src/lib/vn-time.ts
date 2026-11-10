/**
 * Ngày giờ theo giờ Việt Nam (UTC+7, không có giờ mùa hè) — cố định múi giờ để máy chủ (Vercel chạy giờ UTC)
 * và trình duyệt hiện giống hệt nhau (tránh lỗi "hydration" khi 2 bên lệch giờ).
 */
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const d = new Date(ms + 7 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
