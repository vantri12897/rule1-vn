"use client";
import { useEffect, useRef, useState } from "react";

/* Hộp thoại & thông báo nhỏ theo màu YD-English, thay cho confirm()/alert() xám của trình duyệt. */

type DialogOpts = { title?: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean; alertOnly?: boolean };
type DialogState = DialogOpts & { resolve: (v: boolean) => void };
type Toast = { id: number; text: string; type: "success" | "error" | "info" };

let dialogState: DialogState | null = null;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function confirmDialog(opts: DialogOpts | string): Promise<boolean> {
  const o = typeof opts === "string" ? { message: opts } : opts;
  return new Promise((resolve) => {
    dialogState?.resolve(false);
    dialogState = { ...o, resolve };
    emit();
  });
}

export async function alertDialog(message: string, title = "Thông báo") {
  await confirmDialog({ title, message, alertOnly: true, confirmText: "Đã hiểu" });
}

let seq = 0;
export function toast(text: string, type: Toast["type"] = "success") {
  const id = ++seq;
  toasts = [...toasts, { id, text, type }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, type === "error" ? 4500 : 2800);
}

export function FeedbackHost() {
  const [, force] = useState(0);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const d = dialogState;
  const close = (v: boolean) => {
    const r = dialogState?.resolve;
    dialogState = null;
    emit();
    r?.(v);
  };

  useEffect(() => {
    if (!d) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d]);

  return (
    <>
      {d && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 backdrop-blur-[2px] sm:items-center" onClick={() => close(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="yd-dialog-title"
            className="yd-pop w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="yd-dialog-title" className={`text-lg font-bold ${d.danger ? "text-danger" : "text-ink"}`}>
              {d.title ?? (d.danger ? "Xác nhận thao tác" : "Xác nhận")}
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{d.message}</p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {!d.alertOnly && (
                <button className="btn-ghost border border-gray-200" onClick={() => close(false)}>
                  {d.cancelText ?? "Huỷ"}
                </button>
              )}
              <button ref={okRef} className={d.danger ? "btn bg-danger text-white hover:bg-red-700" : "btn-primary"} onClick={() => close(true)}>
                {d.confirmText ?? "Đồng ý"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[110] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`yd-pop pointer-events-auto rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg ${
              t.type === "error" ? "bg-danger" : t.type === "info" ? "bg-ink" : "bg-primary-dark"
            }`}
          >
            {t.type === "success" ? "✓ " : t.type === "error" ? "⚠️ " : ""}
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
