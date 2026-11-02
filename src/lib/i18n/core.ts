/* Song ngữ Việt – Anh, không dùng thư viện ngoài.
 * Khoá dịch chính là câu tiếng Việt; bản tiếng Anh nằm trong en.ts.
 * Biến chèn vào câu dùng dạng {ten_bien}. */
import { EN } from "./en";

export type Lang = "vi" | "en";
export const LANG_COOKIE = "yd-lang";
export type Vars = Record<string, string | number | null | undefined>;

export function translate(lang: Lang, key: string, vars?: Vars): string {
  const raw = lang === "en" ? (EN[key] ?? key) : key;
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null ? m : String(vars[k]))) : raw;
}

export function normalizeLang(v: string | null | undefined): Lang {
  return v === "en" ? "en" : "vi";
}

/** Đọc ngôn ngữ từ header Cookie của một request (dùng trong API) */
export function langOf(req: Request): Lang {
  const m = /(?:^|;\s*)yd-lang=(\w+)/.exec(req.headers.get("cookie") ?? "");
  return normalizeLang(m?.[1]);
}
