"use client";
import { memo, useEffect, useRef } from "react";
import type { PublicQuestion } from "@/lib/types";
import { partTitle, type Part } from "@/lib/parts";
import { useT } from "@/lib/i18n/client";

/** Chú thích màu ô số câu */
export function NavLegend({ className = "" }: { className?: string }) {
  const { t } = useT();
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted ${className}`}>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-[4px] border border-gray-300 bg-white" />
        {t("Chưa làm")}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-[4px] bg-primary" />
        {t("Đã làm")}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full bg-orange-400 ring-2 ring-orange-100" />
        {t("Đang cân nhắc")}
      </span>
    </div>
  );
}

/**
 * Các ô "Phần" trên thanh điều hướng: mỗi ô gom các câu cùng dạng bài, bấm số câu để nhảy tới.
 * layout "strip": 1 hàng ngang cuộn được (máy tính) · "grid": xếp dọc từng phần (điện thoại).
 */
export const PartsNav = memo(function PartsNav({
  layout,
  parts,
  questions,
  answers,
  flags,
  current,
  onJump,
}: {
  layout: "strip" | "grid";
  parts: Part[];
  questions: PublicQuestion[];
  answers: Record<string, string>;
  flags: Set<string>;
  current: string | null;
  onJump: (qid: string) => void;
}) {
  const { t } = useT();
  const stripRef = useRef<HTMLDivElement>(null);

  // Thanh ngang: tự cuộn để ô của câu đang làm luôn nằm trong tầm nhìn
  useEffect(() => {
    if (layout !== "strip" || !current) return;
    const box = stripRef.current;
    const btn = box?.querySelector<HTMLElement>(`[data-qid="${current}"]`);
    if (!box || !btn) return;
    const b = btn.getBoundingClientRect();
    const c = box.getBoundingClientRect();
    if (b.left < c.left + 8 || b.right > c.right - 8) box.scrollTo({ left: box.scrollLeft + (b.left - c.left) - c.width / 2 + b.width / 2, behavior: "smooth" });
  }, [current, layout]);

  const numBtn = (i: number) => {
    const q = questions[i];
    const done = !!answers[q.id];
    const flag = flags.has(q.id);
    const cur = current === q.id;
    const label = t("Câu {n}", { n: i + 1 }) + (done ? `, ${t("đã làm")}` : `, ${t("chưa làm")}`) + (flag ? `, ${t("đang cân nhắc")}` : "");
    return (
      <button
        key={q.id}
        type="button"
        data-qid={q.id}
        onClick={() => onJump(q.id)}
        aria-label={label}
        aria-current={cur ? "true" : undefined}
        title={label}
        className={`relative grid h-9 min-w-9 shrink-0 place-items-center rounded-lg px-1 text-sm font-semibold tabular-nums transition duration-150 active:scale-95 ${
          done ? "bg-primary text-white hover:bg-primary-dark" : "border border-gray-300 bg-white text-ink hover:border-primary hover:text-primary-dark"
        } ${cur ? "ring-2 ring-primary ring-offset-2" : ""}`}
      >
        {i + 1}
        {flag && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-orange-400 ring-2 ring-white" aria-hidden />}
      </button>
    );
  };

  if (layout === "grid")
    return (
      <div className="space-y-3">
        {parts.map((p, k) => {
          const n = p.items.filter((i) => answers[questions[i].id]).length;
          return (
            <section key={p.kind}>
              <h3 className="mb-1.5 flex items-baseline gap-2 text-sm font-bold text-primary-dark">
                <span className="min-w-0 break-words">{partTitle(p, k, parts.length, t)}</span>
                <span className="shrink-0 text-xs font-semibold text-muted">
                  {n}/{p.items.length}
                </span>
              </h3>
              <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-12">{p.items.map(numBtn)}</div>
            </section>
          );
        })}
      </div>
    );

  return (
    <div ref={stripRef} className="yd-strip flex items-stretch gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1.5 pt-1">
      {parts.map((p, k) => {
        const n = p.items.filter((i) => answers[questions[i].id]).length;
        const here = p.items.some((i) => questions[i].id === current);
        const title = partTitle(p, k, parts.length, t);
        return (
          <section
            key={p.kind}
            className={`shrink-0 rounded-xl border px-2.5 pb-2 pt-1.5 transition-colors ${here ? "border-primary/60 bg-primary-soft/60" : "border-gray-200 bg-white"}`}
          >
            <h3 className="mb-1.5 flex max-w-[26rem] items-baseline gap-2 text-xs font-bold">
              <span className="truncate text-primary-dark underline decoration-primary/40 underline-offset-4" title={title}>
                {title}
              </span>
              <span className="shrink-0 font-semibold text-muted">
                {n}/{p.items.length}
              </span>
            </h3>
            <div className="flex gap-1.5">{p.items.map(numBtn)}</div>
          </section>
        );
      })}
    </div>
  );
});
