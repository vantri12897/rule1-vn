"use client";
import { createContext, useContext, useMemo } from "react";
import { translate, type Lang, type Vars } from "./core";

const Ctx = createContext<Lang>("vi");

// Ngôn ngữ hiện tại cho các hàm tiện ích chạy trong trình duyệt (bấm nút, xử lý file…)
let currentLang: Lang = "vi";

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  if (typeof window !== "undefined") currentLang = lang;
  return <Ctx.Provider value={lang}>{children}</Ctx.Provider>;
}

/** Dùng trong component: const { t, lang } = useT(); */
export function useT() {
  const lang = useContext(Ctx);
  return useMemo(() => ({ lang, t: (key: string, vars?: Vars) => translate(lang, key, vars) }), [lang]);
}

/** Dùng ngoài component (chỉ trong trình duyệt, sau khi trang đã chạy) */
export function tc(key: string, vars?: Vars) {
  return translate(currentLang, key, vars);
}
export function clientLang(): Lang {
  return currentLang;
}
