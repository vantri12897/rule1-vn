/**
 * Giao diện do người xem tự chọn (giáo viên / học viên, theo từng trình duyệt):
 *  - màu chủ đạo (data-theme trên <html>, bảng màu nằm trong globals.css)
 *  - cỡ chữ (biến --fs trên <html>: chỉ phóng chữ, không phóng khung/khoảng cách)
 * Lưu bằng cookie để máy chủ vẽ đúng ngay từ đầu, không bị nháy màu khi tải trang.
 */
export const THEME_COOKIE = "yd-theme";
export const FS_COOKIE = "yd-fs";

export const THEMES = [
  { id: "green", name: "Xanh lá (mặc định)", swatch: "#15803d" },
  { id: "blue", name: "Xanh dương", swatch: "#1d4ed8" },
  { id: "purple", name: "Tím", swatch: "#7c3aed" },
  { id: "pink", name: "Hồng", swatch: "#be185d" },
  { id: "teal", name: "Xanh ngọc", swatch: "#0f766e" },
  { id: "slate", name: "Xám", swatch: "#334155" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "green";

/** Các mức cỡ chữ (1 = như hiện tại) */
export const FONT_STEPS = [0.9, 1, 1.1, 1.2, 1.3, 1.4] as const;

export function normalizeTheme(v: string | null | undefined): ThemeId {
  return (THEMES.find((t) => t.id === v)?.id ?? DEFAULT_THEME) as ThemeId;
}

export function normalizeFs(v: string | number | null | undefined): number {
  const n = Number(v);
  return (FONT_STEPS as readonly number[]).includes(n) ? n : 1;
}

export const themeSwatch = (id: ThemeId) => THEMES.find((t) => t.id === id)!.swatch;
