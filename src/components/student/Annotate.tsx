"use client";
/**
 * Công cụ cho học viên khi làm bài:
 *  - Tô màu (highlight) chữ trong đề, chọn được màu
 *  - Ghi chú dạng đám mây (cloud) gắn vào một vị trí trong đề
 *  - Thanh kéo ở giữa để chỉnh độ rộng 2 cột
 *
 * Cách lưu: mỗi vùng chữ có thuộc tính data-zone="…" (render bằng dangerouslySetInnerHTML).
 * Vết tô / ghi chú lưu theo vị trí ký tự trong vùng đó, nên khi React vẽ lại vùng
 * (ví dụ đổi câu đang làm) thì chỉ cần áp lại. Lưu trong máy học viên (localStorage).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";

export type Hl = { id: string; z: string; s: number; e: number; c: string };
export type Note = { id: string; z: string; o: number; text: string; open: boolean; dx?: number; dy?: number };
type Popup = { kind: "sel"; x: number; y: number; parts: { z: string; s: number; e: number }[]; at: { z: string; o: number } } | { kind: "hl"; x: number; y: number; id: string };

export const HL_COLORS = [
  { c: "#fde047", name: "Vàng" },
  { c: "#86efac", name: "Xanh lá" },
  { c: "#7dd3fc", name: "Xanh dương" },
  { c: "#f9a8d4", name: "Hồng" },
  { c: "#fdba74", name: "Cam" },
];

const uid = () => Math.random().toString(36).slice(2, 9);
let focusNote: string | null = null;
/** Vùng chữ đã áp vết tô gì (để bỏ qua khi không đổi) */
const applied = new WeakMap<HTMLElement, { sig: string; html: string }>(); // ghi chú vừa tạo → đặt con trỏ vào ô viết

/** Vị trí ký tự (node, offset) tính từ đầu vùng */
function offsetIn(zone: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(zone, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** Bỏ các vết tô/ghim cũ rồi áp lại theo dữ liệu */
function applyZone(zone: HTMLElement, hls: Hl[], notes: Note[]) {
  zone.querySelectorAll("mark.yd-hl").forEach((m) => {
    const p = m.parentNode!;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
  });
  zone.querySelectorAll(".yd-pin").forEach((p) => p.remove());
  zone.normalize();
  if (!hls.length && !notes.length) return;

  // Chia nhỏ text node tại mọi mốc rồi bọc từng đoạn nằm trong vết tô
  const cuts = new Set<number>();
  for (const h of hls) (cuts.add(h.s), cuts.add(h.e));
  for (const n of notes) cuts.add(n.o);
  const texts: Text[] = [];
  const w = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) texts.push(w.currentNode as Text);
  let pos = 0;
  const pieces: { node: Text; s: number; e: number }[] = [];
  for (let node of texts) {
    const start = pos;
    const end = pos + node.length;
    pos = end;
    const inner = [...cuts].filter((c) => c > start && c < end).sort((a, b) => a - b);
    let cur = start;
    for (const c of inner) {
      const rest = node.splitText(c - cur);
      pieces.push({ node, s: cur, e: c });
      node = rest;
      cur = c;
    }
    pieces.push({ node, s: cur, e: end });
  }
  for (const p of pieces) {
    if (p.e <= p.s) continue;
    // Vết tô mới nhất nằm trong cùng → màu của nó hiện lên trên
    const cover = hls.filter((h) => h.s <= p.s && h.e >= p.e).reverse();
    let el: Node = p.node;
    for (const h of cover) {
      const m = document.createElement("mark");
      m.className = "yd-hl";
      m.dataset.hid = h.id;
      m.style.backgroundColor = h.c;
      el.parentNode!.insertBefore(m, el);
      m.appendChild(el);
      el = m;
    }
  }
  // Ghim ghi chú: phần tử rỗng (biểu tượng vẽ bằng CSS) để không làm lệch vị trí ký tự
  for (const n of notes) {
    const pin = document.createElement("span");
    pin.className = "yd-pin";
    pin.dataset.pin = n.id;
    pin.setAttribute("role", "button");
    pin.setAttribute("aria-label", "note");
    const piece = pieces.find((p) => p.s === n.o) ?? null;
    if (piece) {
      let el: Node = piece.node;
      // chèn trước cả lớp mark bao ngoài để ghim không bị tô màu
      while (el.parentNode && el.parentNode !== zone && (el.parentNode as HTMLElement).classList?.contains("yd-hl")) el = el.parentNode;
      el.parentNode!.insertBefore(pin, el);
    } else zone.appendChild(pin);
  }
}

export function useAnnotations(storeKey: string) {
  const [hls, setHls] = useState<Hl[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [color, setColor] = useState(HL_COLORS[0].c);
  const [pen, setPen] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [popup, setPopup] = useState<Popup | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(storeKey) || "{}");
      if (Array.isArray(d.hls)) setHls(d.hls);
      if (Array.isArray(d.notes)) setNotes(d.notes);
      if (d.color) setColor(d.color);
    } catch {}
    loaded.current = true;
  }, [storeKey]);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(storeKey, JSON.stringify({ hls, notes, color }));
    } catch {}
  }, [storeKey, hls, notes, color]);

  /** Áp lại vào mọi vùng chữ — gọi sau mỗi lần vẽ */
  const applyAll = useCallback(
    (root: HTMLElement | null) => {
      if (!root) return;
      root.querySelectorAll<HTMLElement>("[data-zone]").forEach((z) => {
        const id = z.dataset.zone!;
        const zh = hls.filter((h) => h.z === id);
        const zn = notes.filter((n) => n.z === id);
        // Bỏ qua nếu vùng này không đổi gì từ lần áp trước (đỡ phải dựng lại DOM mỗi lần bấm đáp án)
        const sig = JSON.stringify([zh, zn.map((n) => [n.id, n.o])]);
        const prev = applied.get(z);
        if (prev && prev.sig === sig && prev.html === z.innerHTML) return;
        if (!prev && !zh.length && !zn.length) return;
        applyZone(z, zh, zn);
        applied.set(z, { sig, html: z.innerHTML });
      });
    },
    [hls, notes]
  );

  const addHl = (parts: { z: string; s: number; e: number }[], c: string) =>
    setHls((a) => [...a, ...parts.filter((p) => p.e > p.s).map((p) => ({ id: uid(), ...p, c }))]);
  const addNote = (z: string, o: number) => {
    const id = uid();
    focusNote = id;
    setNotes((a) => [...a, { id, z, o, text: "", open: true }]);
  };

  return { hls, setHls, notes, setNotes, color, setColor, pen, setPen, noteMode, setNoteMode, popup, setPopup, applyAll, addHl, addNote };
}
export type Ann = ReturnType<typeof useAnnotations>;

/** Đọc vùng chọn hiện tại → các đoạn [s,e) theo từng vùng chữ */
function readSelection(root: HTMLElement) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const parts: { z: string; s: number; e: number }[] = [];
  root.querySelectorAll<HTMLElement>("[data-zone]").forEach((zone) => {
    if (!zone.offsetParent || !range.intersectsNode(zone)) return;
    const s = zone.contains(range.startContainer) ? offsetIn(zone, range.startContainer, range.startOffset) : 0;
    const e = zone.contains(range.endContainer) ? offsetIn(zone, range.endContainer, range.endOffset) : (zone.textContent ?? "").length;
    if (e > s) parts.push({ z: zone.dataset.zone!, s, e });
  });
  if (!parts.length) return null;
  const rect = range.getBoundingClientRect();
  return { parts, rect };
}

/** Gắn sự kiện chuột/chạm cho khu làm bài */
export function useAnnotationEvents(rootRef: React.RefObject<HTMLElement | null>, ann: Ann) {
  const annRef = useRef(ann);
  annRef.current = ann;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onUp = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as HTMLElement;
      if (target.closest(".yd-ann-ui")) return;
      setTimeout(() => {
        const a = annRef.current;
        const got = readSelection(root);
        if (got) {
          if (a.pen) {
            a.addHl(got.parts, a.color);
            window.getSelection()?.removeAllRanges();
            a.setPopup(null);
          } else {
            const last = got.parts[got.parts.length - 1];
            a.setPopup({ kind: "sel", x: got.rect.left + got.rect.width / 2, y: got.rect.top, parts: got.parts, at: { z: last.z, o: last.e } });
          }
          return;
        }
        if (a.noteMode && "clientX" in ev) {
          let zone = target.closest<HTMLElement>("[data-zone]");
          const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null; caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
          let node: Node | null = null;
          let off = 0;
          if (doc.caretPositionFromPoint) {
            const p = doc.caretPositionFromPoint(ev.clientX, ev.clientY);
            if (p) (node = p.offsetNode, off = p.offset);
          } else if (doc.caretRangeFromPoint) {
            const r = doc.caretRangeFromPoint(ev.clientX, ev.clientY);
            if (r) (node = r.startContainer, off = r.startOffset);
          }
          // bấm vào khoảng trống cuối dòng: lấy vùng chữ gần nhất theo con trỏ
          if (!zone && node) zone = (node.nodeType === 3 ? node.parentElement : (node as HTMLElement))?.closest<HTMLElement>("[data-zone]") ?? null;
          if (zone && node && zone.contains(node)) {
            // đặt ghim ở cuối từ, không chen vào giữa chữ
            const text = zone.textContent ?? "";
            let o = offsetIn(zone, node, off);
            while (o < text.length && /[\p{L}\p{N}'’-]/u.test(text[o])) o++;
            a.addNote(zone.dataset.zone!, o);
            a.setNoteMode(false);
          }
        }
      }, 0);
    };
    const onClick = (ev: MouseEvent) => {
      const el = ev.target as HTMLElement;
      const pin = el.closest<HTMLElement>(".yd-pin");
      if (pin) {
        const id = pin.dataset.pin!;
        annRef.current.setNotes((ns) => ns.map((n) => {
          if (n.id !== id) return n;
          if (!n.open) focusNote = id;
          return { ...n, open: !n.open };
        }));
        return;
      }
      const mark = el.closest<HTMLElement>("mark.yd-hl");
      const sel = window.getSelection();
      if (mark && (!sel || sel.isCollapsed) && !annRef.current.pen) {
        annRef.current.setPopup({ kind: "hl", x: ev.clientX, y: ev.clientY - 8, id: mark.dataset.hid! });
      }
    };
    const close = () => annRef.current.setPopup(null);
    // Esc: thoát bút tô / chế độ ghi chú, đóng bảng màu, bỏ vùng bôi đen
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      const a = annRef.current;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest(".yd-cloud")) {
        active.blur();
        return;
      }
      if (a.pen || a.noteMode || a.popup) ev.preventDefault();
      a.setPen(false);
      a.setNoteMode(false);
      a.setPopup(null);
      window.getSelection()?.removeAllRanges();
    };
    window.addEventListener("keydown", onKey);
    root.addEventListener("mouseup", onUp);
    root.addEventListener("touchend", onUp);
    root.addEventListener("click", onClick);
    window.addEventListener("resize", close);
    root.addEventListener("scroll", close, true);
    return () => {
      root.removeEventListener("mouseup", onUp);
      root.removeEventListener("touchend", onUp);
      root.removeEventListener("click", onClick);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      root.removeEventListener("scroll", close, true);
    };
  }, [rootRef]);
}

/** Thanh công cụ: bút tô, màu, ghi chú, xoá hết */
export function AnnotationToolbar({ ann, className = "" }: { ann: Ann; className?: string }) {
  const { t } = useT();
  return (
    <div className={`yd-ann-ui flex flex-wrap items-center gap-1.5 ${className}`} role="toolbar" aria-label={t("Công cụ ghi chú")}>
      <button
        type="button"
        onClick={() => (ann.setPen(!ann.pen), ann.setNoteMode(false))}
        aria-pressed={ann.pen}
        title={t("Bật bút: bôi đen chữ là tô màu ngay")}
        className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-bold transition ${ann.pen ? "border-primary bg-primary text-white shadow" : "border-gray-300 bg-white text-ink hover:border-primary"}`}
      >
        🖍️ {t("Tô màu")}
      </button>
      <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1.5 py-1">
        {HL_COLORS.map((h) => (
          <button
            key={h.c}
            type="button"
            onClick={() => (ann.setColor(h.c), ann.setPen(true), ann.setNoteMode(false))}
            aria-label={t(h.name)}
            title={t(h.name)}
            className={`h-5 w-5 rounded-full border border-black/10 transition ${ann.color === h.c ? "scale-110 ring-2 ring-ink/60 ring-offset-1" : "hover:scale-110"}`}
            style={{ backgroundColor: h.c }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => (ann.setNoteMode(!ann.noteMode), ann.setPen(false))}
        aria-pressed={ann.noteMode}
        title={t("Bấm nút này rồi bấm vào chỗ muốn ghi chú trong đề")}
        className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-bold transition ${ann.noteMode ? "border-sky bg-sky text-white shadow" : "border-gray-300 bg-white text-ink hover:border-sky"}`}
      >
        💭 {t("Ghi chú")}
      </button>
      {(ann.hls.length > 0 || ann.notes.length > 0) && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t("Xoá toàn bộ vết tô màu và ghi chú?"))) (ann.setHls([]), ann.setNotes([]));
          }}
          className="flex h-8 items-center rounded-lg px-2 text-xs font-semibold text-muted hover:bg-red-50 hover:text-danger"
          title={t("Xoá toàn bộ vết tô màu và ghi chú?")}
        >
          🗑️
        </button>
      )}
      {(ann.pen || ann.noteMode) && (
        <span className="w-full text-[calc(0.6875rem*var(--fs,1))] font-medium text-muted">
          {ann.pen ? t("Bôi đen chữ trong đề để tô màu. Bấm vào chỗ đã tô để đổi màu hoặc xoá. Nhấn Esc để thoát.") : t("Bấm vào vị trí trong đề để thêm ghi chú. Nhấn Esc để thoát.")}
        </span>
      )}
    </div>
  );
}

/** Bảng nổi nhỏ khi bôi đen chữ hoặc bấm vào chỗ đã tô */
export function AnnotationPopup({ ann }: { ann: Ann }) {
  const { t } = useT();
  const p = ann.popup;
  if (!p) return null;
  const x = Math.min(Math.max(p.x, 140), window.innerWidth - 140);
  const y = Math.max(p.y, 70);
  return (
    <div
      className="yd-ann-ui yd-pop fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg"
      style={{ left: x, top: y - 6 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {HL_COLORS.map((h) => (
        <button
          key={h.c}
          type="button"
          aria-label={t(h.name)}
          title={t(h.name)}
          className="h-7 w-7 rounded-full border border-black/10 transition hover:scale-110"
          style={{ backgroundColor: h.c }}
          onClick={() => {
            if (p.kind === "sel") ann.addHl(p.parts, h.c);
            else ann.setHls((a) => a.map((x) => (x.id === p.id ? { ...x, c: h.c } : x)));
            ann.setColor(h.c);
            window.getSelection()?.removeAllRanges();
            ann.setPopup(null);
          }}
        />
      ))}
      <span className="mx-0.5 h-6 w-px bg-gray-200" />
      {p.kind === "sel" ? (
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-bold text-sky-ink hover:bg-sky-soft"
          onClick={() => {
            ann.addNote(p.at.z, p.at.o);
            window.getSelection()?.removeAllRanges();
            ann.setPopup(null);
          }}
        >
          💭 {t("Ghi chú")}
        </button>
      ) : (
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-bold text-danger hover:bg-red-50"
          onClick={() => {
            ann.setHls((a) => a.filter((x) => x.id !== p.id));
            ann.setPopup(null);
          }}
        >
          🧽 {t("Xoá tô")}
        </button>
      )}
    </div>
  );
}

/**
 * Lớp đám mây ghi chú cho một cột. Đặt bên trong phần nội dung cuộn (position: relative),
 * mỗi đám mây được đặt ngay dưới ghim 💭 của nó và cuộn theo nội dung.
 */
export function NoteClouds({ ann, layer }: { ann: Ann; layer: HTMLElement | null }) {
  const { t } = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; dx: number; dy: number; el: HTMLElement } | null>(null);

  const place = useCallback(() => {
    const box = boxRef.current;
    if (!box || !layer) return;
    const lr = layer.getBoundingClientRect();
    box.querySelectorAll<HTMLElement>("[data-cloud]").forEach((c) => {
      const pin = [...layer.querySelectorAll<HTMLElement>(`[data-pin="${c.dataset.cloud}"]`)].find((p) => p.offsetParent !== null);
      if (!pin || c.dataset.open !== "1") {
        c.style.display = "none";
        return;
      }
      const r = pin.getBoundingClientRect();
      c.style.display = "block";
      const w = Math.min(240, lr.width - 8);
      c.style.width = `${w}px`;
      const dx = Number(c.dataset.dx || 0);
      const dy = Number(c.dataset.dy || 0);
      const baseLeft = Math.min(Math.max(r.left - lr.left - 22, 4), lr.width - w - 4);
      const left = Math.min(Math.max(baseLeft + dx, 0), lr.width - w);
      const top = Math.max(r.bottom - lr.top + 8 + dy, 0);
      c.style.left = `${left}px`;
      c.style.top = `${top}px`;
      c.classList.toggle("yd-cloud-free", dx !== 0 || dy !== 0); // đã kéo đi chỗ khác → ẩn bong bóng nối
      if (focusNote === c.dataset.cloud) {
        focusNote = null;
        c.querySelector("textarea")?.focus({ preventScroll: true });
      }
      c.style.setProperty("--tail", `${Math.min(Math.max(r.left - lr.left - left + 2, 12), w - 20)}px`);
    });
  }, [layer]);

  useLayoutEffect(place);
  useEffect(() => {
    if (!layer) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(layer);
    window.addEventListener("yd-ann-applied", place);
    return () => (ro.disconnect(), window.removeEventListener("yd-ann-applied", place));
  }, [layer, place]);

  if (!layer) return null;
  return createPortal(
    <div ref={boxRef} className="yd-ann-ui">
      {ann.notes.map((n) => (
        <div key={n.id} data-cloud={n.id} data-open={n.open ? "1" : "0"} data-dx={n.dx ?? 0} data-dy={n.dy ?? 0} className="yd-cloud yd-pop absolute z-20" style={{ display: "none" }}>
          <div
            className="mb-1 flex cursor-move touch-none select-none items-center justify-between gap-2"
            title={t("Kéo để di chuyển ghi chú. Bấm đúp để đưa về cạnh chữ.")}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              e.preventDefault();
              const cloud = (e.currentTarget as HTMLElement).parentElement!;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { id: n.id, x: e.clientX, y: e.clientY, dx: n.dx ?? 0, dy: n.dy ?? 0, el: cloud };
              cloud.classList.add("yd-cloud-drag");
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== n.id) return;
              d.el.dataset.dx = String(d.dx + e.clientX - d.x);
              d.el.dataset.dy = String(d.dy + e.clientY - d.y);
              place();
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              if (!d || d.id !== n.id) return;
              drag.current = null;
              d.el.classList.remove("yd-cloud-drag");
              // lưu vị trí đã kẹp trong khung (tính lại từ chỗ hiện tại)
              const ndx = d.dx + e.clientX - d.x;
              const ndy = d.dy + e.clientY - d.y;
              ann.setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...x, dx: Math.round(ndx), dy: Math.round(ndy) } : x)));
            }}
            onDoubleClick={() => ann.setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...x, dx: 0, dy: 0 } : x)))}
          >
            <span className="text-[calc(0.6875rem*var(--fs,1))] font-bold uppercase tracking-wide text-sky-ink">⠿ 💭 {t("Ghi chú")}</span>
            <span className="flex gap-0.5">
              <button
                type="button"
                className="grid h-6 w-6 place-items-center rounded-md text-sm text-muted hover:bg-white"
                title={t("Thu gọn")}
                aria-label={t("Thu gọn")}
                onClick={() => ann.setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...x, open: false } : x)))}
              >
                –
              </button>
              <button
                type="button"
                className="grid h-6 w-6 place-items-center rounded-md text-sm text-muted hover:bg-red-50 hover:text-danger"
                title={t("Xoá ghi chú")}
                aria-label={t("Xoá ghi chú")}
                onClick={() => ann.setNotes((ns) => ns.filter((x) => x.id !== n.id))}
              >
                ×
              </button>
            </span>
          </div>
          <textarea
            value={n.text}
            rows={Math.min(8, Math.max(2, n.text.split("\n").length + Math.floor(n.text.length / 28)))}
            placeholder={t("Viết ghi chú…")}
            onChange={(e) => {
              const v = e.target.value.slice(0, 1000);
              ann.setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...x, text: v } : x)));
            }}
            className="w-full resize-none rounded-lg border border-sky/30 bg-white/90 px-2 py-1.5 text-sm leading-snug outline-none focus:border-sky focus:ring-2 focus:ring-sky/20"
          />
        </div>
      ))}
    </div>,
    layer
  );
}

/** Thanh kéo ở giữa 2 cột */
export function Splitter({ value, onChange, containerRef }: { value: number; onChange: (v: number) => void; containerRef: React.RefObject<HTMLElement | null> }) {
  const { t } = useT();
  const [drag, setDrag] = useState(false);
  const clamp = (v: number) => Math.min(72, Math.max(28, v));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={28}
      aria-valuemax={72}
      aria-valuenow={Math.round(value)}
      aria-label={t("Kéo để chỉnh độ rộng 2 cột")}
      title={t("Kéo sang trái / phải để chỉnh độ rộng. Bấm đúp để về mặc định.")}
      tabIndex={0}
      className="group relative z-10 flex w-4 shrink-0 cursor-col-resize touch-none select-none justify-center outline-none"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setDrag(true);
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const box = containerRef.current?.getBoundingClientRect();
        if (box) onChange(clamp(((e.clientX - box.left) / box.width) * 100));
      }}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onDoubleClick={() => onChange(72)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(clamp(value - 3));
        if (e.key === "ArrowRight") onChange(clamp(value + 3));
      }}
    >
      <span className={`h-full w-0.5 rounded-full transition-colors ${drag ? "bg-primary" : "bg-primary-line group-hover:bg-primary group-focus-visible:bg-primary"}`} />
      <span
        className={`absolute top-1/2 grid h-12 w-4 -translate-y-1/2 place-items-center rounded-full border bg-white text-[calc(0.625rem*var(--fs,1))] leading-none text-primary-dark shadow-sm transition ${drag ? "border-primary bg-primary-soft" : "border-primary-line group-hover:border-primary"}`}
        aria-hidden
      >
        ⋮
      </span>
    </div>
  );
}
