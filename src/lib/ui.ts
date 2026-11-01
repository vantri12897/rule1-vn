export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDuration(fromIso: string, toIso: string | null) {
  if (!toIso) return "—";
  const s = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} phút ${s % 60}s` : `${s}s`;
}

export function quizLink(slug: string) {
  if (typeof window === "undefined") return `/q/${slug}`;
  return `${window.location.origin}/q/${slug}`;
}

export const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  draft: { text: "Nháp", cls: "bg-gray-100 text-gray-700" },
  open: { text: "Đang mở", cls: "bg-primary-soft text-primary-dark" },
  closed: { text: "Đã đóng", cls: "bg-orange-50 text-warn" },
};
