"use client";
/**
 * Ô soạn thảo có định dạng cho giáo viên: B / I / U và tô màu (5 màu).
 * Giá trị lưu là chuỗi gọn: chữ thường + <b> <i> <u> + <mark data-c="y|g|b|p|o"> + xuống dòng "\n"
 * — đúng tập thẻ mà safeHtml() cho phép hiển thị cho học viên và xuất Word.
 */
import { useEffect, useRef, useState } from "react";
import { safeHtml } from "@/lib/sanitize";
import { useT } from "@/lib/i18n/client";

export const TEACHER_COLORS = [
  { k: "y", c: "#fde047", name: "Vàng" },
  { k: "g", c: "#86efac", name: "Xanh lá" },
  { k: "b", c: "#7dd3fc", name: "Xanh dương" },
  { k: "p", c: "#f9a8d4", name: "Hồng" },
  { k: "o", c: "#fdba74", name: "Cam" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** DOM của ô soạn thảo → chuỗi lưu */
function serialize(root: HTMLElement): string {
  let out = "";
  const walk = (n: Node, isFirstBlock: { v: boolean }) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += esc((n.textContent ?? "").replace(/ /g, " "));
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
      out += "\n";
      return;
    }
    const block = tag === "div" || tag === "p";
    if (block) {
      if (!isFirstBlock.v && !out.endsWith("\n")) out += "\n";
      isFirstBlock.v = false;
    }
    // Chuẩn hoá: strong→b, em→i, span có style đậm/nghiêng/gạch chân cũng nhận
    const st = el.style;
    const b = tag === "b" || tag === "strong" || (tag === "span" && (st.fontWeight === "bold" || Number(st.fontWeight) >= 600));
    const i = tag === "i" || tag === "em" || (tag === "span" && st.fontStyle === "italic");
    const u = tag === "u" || (tag === "span" && /underline/.test(st.textDecoration));
    const c = tag === "mark" && /^[ygbpo]$/.test(el.dataset.c ?? "") ? el.dataset.c : null;
    const open = (c ? `<mark data-c="${c}">` : "") + (b ? "<b>" : "") + (i ? "<i>" : "") + (u ? "<u>" : "");
    const close = (u ? "</u>" : "") + (i ? "</i>" : "") + (b ? "</b>" : "") + (c ? "</mark>" : "");
    const before = out.length;
    out += open;
    el.childNodes.forEach((ch) => walk(ch, isFirstBlock));
    if (out.length === before + open.length) out = out.slice(0, before); // bỏ thẻ rỗng
    else out += close;
  };
  const first = { v: true };
  root.childNodes.forEach((ch) => walk(ch, first));
  return out.replace(/\n$/, "");
}

function unwrap(el: Element) {
  const p = el.parentNode!;
  while (el.firstChild) p.insertBefore(el.firstChild, el);
  p.removeChild(el);
}

export function RichText({
  value,
  onChange,
  placeholder,
  className = "",
  singleLine = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  singleLine?: boolean;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [state, setState] = useState({ b: false, i: false, u: false });

  // Chỉ ghi lại nội dung khi giá trị đổi từ bên ngoài (tránh nhảy con trỏ khi đang gõ)
  useEffect(() => {
    const el = ref.current;
    if (!el || value === last.current) return;
    el.innerHTML = safeHtml(value);
    last.current = value;
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const v = serialize(el);
    last.current = v;
    if (v !== value) onChange(v);
  };

  useEffect(() => {
    if (!focus) return;
    const upd = () =>
      setState({ b: document.queryCommandState("bold"), i: document.queryCommandState("italic"), u: document.queryCommandState("underline") });
    document.addEventListener("selectionchange", upd);
    return () => document.removeEventListener("selectionchange", upd);
  }, [focus]);

  const cmd = (c: "bold" | "italic" | "underline") => {
    ref.current?.focus();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(c);
    emit();
  };

  /** Tô màu đoạn đang chọn; k = null là bỏ màu */
  const paint = (k: string | null) => {
    const root = ref.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    // Nếu đang nằm trong 1 vùng đã tô → tách vùng đó ra trước
    const host = (range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentElement : (range.commonAncestorContainer as HTMLElement))?.closest("mark[data-c]");
    if (range.collapsed) {
      if (host && k === null) (unwrap(host), emit());
      return;
    }
    const frag = range.extractContents();
    frag.querySelectorAll("mark").forEach(unwrap);
    if (host && root.contains(host)) {
      // chia vùng tô cũ làm 2 nửa quanh chỗ vừa lấy ra
      const after = document.createRange();
      after.setStart(range.endContainer, range.endOffset);
      after.setEnd(host, host.childNodes.length);
      const tail = after.extractContents();
      const tailMark = host.cloneNode(false) as HTMLElement;
      tailMark.appendChild(tail);
      host.after(tailMark);
      range.setStartAfter(host);
      range.collapse(true);
    }
    let node: Node = frag;
    if (k) {
      const m = document.createElement("mark");
      m.dataset.c = k;
      m.appendChild(frag);
      node = m;
    }
    const firstInserted = node.nodeType === 11 ? node.firstChild : node;
    const lastInserted = node.nodeType === 11 ? node.lastChild : node;
    range.insertNode(node);
    if (firstInserted && lastInserted) {
      const r = document.createRange();
      r.setStartBefore(firstInserted);
      r.setEndAfter(lastInserted);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    root.querySelectorAll("mark:empty").forEach((m) => m.remove());
    emit();
  };

  const clearAll = () => {
    const root = ref.current;
    if (!root) return;
    root.focus();
    document.execCommand("removeFormat");
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const r = sel.getRangeAt(0);
      root.querySelectorAll("mark").forEach((m) => r.intersectsNode(m) && unwrap(m));
      root.querySelectorAll("u").forEach((m) => r.intersectsNode(m) && unwrap(m));
    }
    emit();
  };

  const Btn = ({ on, label, title, onClick, cls = "" }: { on?: boolean; label: React.ReactNode; title: string; onClick: () => void; cls?: string }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()} // giữ nguyên đoạn đang bôi đen
      onClick={onClick}
      className={`grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-sm transition ${on ? "bg-primary text-white" : "text-ink hover:bg-gray-100"} ${cls}`}
    >
      {label}
    </button>
  );

  return (
    <div className="relative">
      {focus && (
        <div className="yd-pop absolute -top-10 left-0 z-20 flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-1 shadow-md" role="toolbar" aria-label={t("Định dạng chữ")}>
          <Btn on={state.b} title={t("In đậm (Ctrl+B)")} label={<b>B</b>} onClick={() => cmd("bold")} />
          <Btn on={state.i} title={t("In nghiêng (Ctrl+I)")} label={<i className="font-serif">I</i>} onClick={() => cmd("italic")} />
          <Btn on={state.u} title={t("Gạch chân (Ctrl+U)")} label={<u>U</u>} onClick={() => cmd("underline")} />
          <span className="mx-1 h-5 w-px bg-gray-200" />
          {TEACHER_COLORS.map((c) => (
            <button
              key={c.k}
              type="button"
              title={t("Tô màu: {c}", { c: t(c.name) })}
              aria-label={t("Tô màu: {c}", { c: t(c.name) })}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => paint(c.k)}
              className="mx-0.5 h-5 w-5 rounded-full border border-black/10 transition hover:scale-110"
              style={{ backgroundColor: c.c }}
            />
          ))}
          <Btn title={t("Bỏ màu tô")} label="🚫" onClick={() => paint(null)} cls="text-xs" />
          <span className="mx-1 h-5 w-px bg-gray-200" />
          <Btn title={t("Xoá định dạng đoạn đang chọn")} label={<span className="text-xs font-semibold">Tx</span>} onClick={clearAll} />
        </div>
      )}
      <div
        ref={ref}
        role="textbox"
        aria-multiline={!singleLine}
        aria-label={placeholder}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder ?? ""}
        className={`rt-editor input cursor-text whitespace-pre-wrap break-words ${className}`}
        onFocus={() => setFocus(true)}
        onBlur={() => (setFocus(false), emit())}
        onInput={emit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!singleLine) document.execCommand("insertLineBreak");
            emit();
          }
          if ((e.ctrlKey || e.metaKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) {
            e.preventDefault();
            cmd(({ b: "bold", i: "italic", u: "underline" } as const)[e.key.toLowerCase() as "b" | "i" | "u"]);
          }
        }}
        onPaste={(e) => {
          // dán chữ thường (bỏ định dạng lạ từ Word/web)
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, singleLine ? text.replace(/\s*\n\s*/g, " ") : text);
          emit();
        }}
      />
    </div>
  );
}
