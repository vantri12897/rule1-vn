import { tc } from "./i18n/client";

export { fmtDate } from "./vn-time";

export function fmtDuration(fromIso: string, toIso: string | null) {
  if (!toIso) return "—";
  const s = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? tc("{m} phút {s}s", { m, s: s % 60 }) : `${s}s`;
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
