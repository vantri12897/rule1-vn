"use client";
/* Xử lý PDF ngay trong trình duyệt: không upload nguyên file lên cloud. */

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas: HTMLCanvasElement }) => { promise: Promise<void> };
    getTextContent: () => Promise<{ items: { str?: string; hasEOL?: boolean }[] }>;
    cleanup: () => void;
  }>;
  /** Giải phóng bộ nhớ (pdf.js v6: huỷ qua loadingTask) */
  destroy: () => Promise<void>;
};

export async function openPdf(file: File): Promise<PdfDoc> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  try {
    const doc = (await task.promise) as unknown as Omit<PdfDoc, "destroy">;
    return {
      numPages: doc.numPages,
      getPage: (n: number) => doc.getPage(n),
      destroy: () => task.destroy(),
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/password/i.test(m)) throw new Error("File PDF có mật khẩu. Hãy gỡ mật khẩu rồi upload lại.");
    throw new Error("Không đọc được file PDF (file hỏng hoặc không phải PDF).");
  }
}

export type PagePayload = { page: number; text: string | null; image: string | null };

/** Trích text + render ảnh JPEG nén cho 1 trang. maxSide = cạnh dài tối đa (px). */
export async function renderPage(doc: PdfDoc, n: number, maxSide = 1500, quality = 0.72): Promise<PagePayload> {
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  const text = tc.items.map((it) => (it.str ?? "") + (it.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim();

  const v1 = page.getViewport({ scale: 1 });
  const scale = maxSide / Math.max(v1.width, v1.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  page.cleanup();
  canvas.width = canvas.height = 0;
  return { page: n, text: text.length > 0 ? text : null, image: dataUrl.split(",")[1] };
}

/** Chia trang thành các cụm chồng lấn 1 trang: [1-3],[3-5],[5-7]... */
export function makeChunks(numPages: number, size = 3): number[][] {
  if (numPages <= size) return [Array.from({ length: numPages }, (_, i) => i + 1)];
  const chunks: number[][] = [];
  let start = 1;
  while (start <= numPages) {
    const end = Math.min(numPages, start + size - 1);
    chunks.push(Array.from({ length: end - start + 1 }, (_, i) => start + i));
    if (end === numPages) break;
    start = end; // chồng lấn 1 trang
  }
  return chunks;
}

export async function sha256(file: File): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- Lưu file PDF cục bộ (IndexedDB) để giáo viên đối chiếu khi duyệt đề ---------- */
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("yd-english", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("pdfs");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function savePdfLocal(hash: string, file: File) {
  try {
    const db = await idb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction("pdfs", "readwrite");
      tx.objectStore("pdfs").put(file, hash);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* trình duyệt chặn IndexedDB: bỏ qua */
  }
}
export async function loadPdfLocal(hash: string): Promise<Blob | null> {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const r = db.transaction("pdfs").objectStore("pdfs").get(hash);
      r.onsuccess = () => res((r.result as Blob) ?? null);
      r.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}
