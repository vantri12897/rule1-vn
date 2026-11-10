"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { DEFAULT_THEME, FONT_STEPS, FS_COOKIE, THEME_COOKIE, THEMES, normalizeFs, normalizeTheme, themeSwatch, type ThemeId } from "@/lib/appearance";

const YEAR = 31536000;
const setCookie = (k: string, v: string) => (document.cookie = `${k}=${v}; path=/; max-age=${YEAR}; samesite=lax`);

/** Đổi màu mượt trong chốc lát (không để hiệu ứng chuyển màu chạy thường trực) */
function softly() {
  const html = document.documentElement;
  html.classList.add("yd-anim");
  window.setTimeout(() => html.classList.remove("yd-anim"), 450);
}

export function applyTheme(id: ThemeId) {
  const html = document.documentElement;
  softly();
  if (id === DEFAULT_THEME) delete html.dataset.theme;
  else html.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeSwatch(id));
  setCookie(THEME_COOKIE, id);
}

export function applyFs(n: number) {
  const html = document.documentElement;
  if (n === 1) html.style.removeProperty("--fs");
  else html.style.setProperty("--fs", String(n));
  setCookie(FS_COOKIE, String(n));
  // Báo cho các phần tự tính kích thước (2 cột, thanh dưới, ghi chú) tính lại
  window.dispatchEvent(new Event("resize"));
}

/** Đóng bảng chọn khi bấm ra ngoài hoặc nhấn Esc */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const btnCls =
  "flex min-h-[38px] min-w-[38px] items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white px-2 text-sm font-semibold text-ink hover:border-primary-line hover:bg-primary-soft";

/** Nút 🎨: chọn màu giao diện */
export function ThemeButton() {
  const { t } = useT();
  const { open, setOpen, ref } = usePopover();
  const [cur, setCur] = useState<ThemeId>(DEFAULT_THEME);
  useEffect(() => setCur(normalizeTheme(document.documentElement.dataset.theme)), []);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={t("Màu giao diện")} aria-label={t("Màu giao diện")} className={btnCls}>
        <span aria-hidden>🎨</span>
      </button>
      {open && (
        <div role="menu" className="yd-pop absolute right-0 z-50 mt-1 w-max min-w-56 max-w-[90vw] overflow-hidden rounded-xl border border-gray-200 bg-white text-sm shadow-lg">
          <div className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-muted">{t("Màu giao diện")}</div>
          {THEMES.map((o) => {
            const on = o.id === cur;
            return (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  applyTheme(o.id);
                  setCur(o.id);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-primary-soft ${on ? "font-bold text-primary-dark" : ""}`}
              >
                <span className="h-5 w-5 shrink-0 rounded-full ring-2 ring-white" style={{ background: o.swatch, boxShadow: `0 0 0 1px ${o.swatch}` }} aria-hidden />
                <span className="flex-1">{t(o.name)}</span>
                {on && <span aria-hidden>✓</span>}
              </button>
            );
          })}
          <p className="border-t border-gray-100 px-3 py-2 text-xs text-muted">{t("Chỉ đổi trên máy này, không ảnh hưởng người khác.")}</p>
        </div>
      )}
    </div>
  );
}

/** Nút "Aa": phóng to / thu nhỏ chữ */
export function FontSizeButton() {
  const { t } = useT();
  const { open, setOpen, ref } = usePopover();
  const [fs, setFs] = useState(1);
  useEffect(() => setFs(normalizeFs(document.documentElement.style.getPropertyValue("--fs") || 1)), []);
  const idx = FONT_STEPS.indexOf(fs as (typeof FONT_STEPS)[number]);
  const go = (i: number) => {
    const n = FONT_STEPS[Math.max(0, Math.min(FONT_STEPS.length - 1, i))];
    applyFs(n);
    setFs(n);
  };
  const step = "grid h-10 w-10 place-items-center rounded-xl border border-gray-200 font-bold hover:border-primary hover:bg-primary-soft disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:bg-transparent";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} title={t("Cỡ chữ")} aria-label={t("Cỡ chữ")} className={btnCls}>
        <span aria-hidden className="leading-none">
          <span className="text-[13px]">A</span>
          <span className="text-[17px]">a</span>
        </span>
      </button>
      {open && (
        <div role="dialog" aria-label={t("Cỡ chữ")} className="yd-pop absolute right-0 z-50 mt-1 w-max min-w-56 max-w-[90vw] overflow-hidden rounded-xl border border-gray-200 bg-white text-sm shadow-lg">
          <div className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-muted">{t("Cỡ chữ")}</div>
          <div className="flex items-center justify-between gap-2 px-3 py-3">
            <button type="button" className={step} onClick={() => go(idx - 1)} disabled={idx <= 0} aria-label={t("Thu nhỏ chữ")} title={t("Thu nhỏ chữ")}>
              <span className="text-[13px]">A−</span>
            </button>
            <span className="min-w-14 text-center text-base font-extrabold tabular-nums text-primary-dark" aria-live="polite">
              {Math.round(fs * 100)}%
            </span>
            <button type="button" className={step} onClick={() => go(idx + 1)} disabled={idx >= FONT_STEPS.length - 1} aria-label={t("Phóng to chữ")} title={t("Phóng to chữ")}>
              <span className="text-[19px]">A+</span>
            </button>
          </div>
          <div className="flex justify-center gap-1 pb-2" aria-hidden>
            {FONT_STEPS.map((n) => (
              <span key={n} className={`h-1.5 w-5 rounded-full ${n <= fs ? "bg-primary" : "bg-gray-200"}`} />
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(FONT_STEPS.indexOf(1))}
            disabled={fs === 1}
            className="w-full border-t border-gray-100 px-3 py-2.5 text-left text-sm font-semibold text-primary-dark hover:bg-primary-soft disabled:text-muted disabled:hover:bg-transparent"
          >
            ↺ {t("Cỡ chữ mặc định (100%)")}
          </button>
        </div>
      )}
    </div>
  );
}

/** 2 nút cạnh nút ngôn ngữ: màu giao diện + cỡ chữ */
export function AppearanceButtons() {
  return (
    <>
      <ThemeButton />
      <FontSizeButton />
    </>
  );
}
