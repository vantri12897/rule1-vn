"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { Lang } from "@/lib/i18n/core";

const OPTIONS: { code: Lang; flag: string; label: string; short: string }[] = [
  { code: "vi", flag: "🇻🇳", label: "Tiếng Việt", short: "VI" },
  { code: "en", flag: "🇬🇧", label: "English", short: "EN" },
];

/** Nút "🌐 Tiếng Việt ▾" ở góc phải: chọn English / Tiếng Việt, ghi nhớ bằng cookie 1 năm */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cur = OPTIONS.find((o) => o.code === lang)!;

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

  function choose(code: Lang) {
    setOpen(false);
    if (code === lang) return;
    document.cookie = `yd-lang=${code}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Language / Ngôn ngữ"
        className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-sm font-semibold text-ink hover:border-primary-line hover:bg-primary-soft"
      >
        <span aria-hidden>🌐</span>
        <span className={compact ? "" : "sm:hidden"}>{cur.short}</span>
        {!compact && <span className="hidden sm:inline">{cur.label}</span>}
        <span className={`text-xs transition ${open ? "rotate-180" : ""}`} aria-hidden>▾</span>
      </button>
      {open && (
        <div role="menu" className="yd-pop absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white text-sm shadow-lg">
          <div className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-muted">Language / Ngôn ngữ</div>
          {OPTIONS.map((o) => (
            <button
              key={o.code}
              role="menuitemradio"
              aria-checked={o.code === lang}
              onClick={() => choose(o.code)}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-primary-soft ${o.code === lang ? "font-bold text-primary-dark" : ""}`}
            >
              <span aria-hidden>{o.flag}</span>
              <span className="flex-1">{o.label}</span>
              {o.code === lang && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
