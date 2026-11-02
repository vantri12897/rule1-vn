"use client";
import { useRef, useState } from "react";
import { cropFigure, makeChunks, openPdf, renderPage, savePdfLocal, sha256, type PagePayload } from "@/lib/pdf-client";
import { callAi, DailyQuotaError, solveMissing, TimeoutError } from "@/lib/ai-client";
import { mergeChunks, type ChunkResult } from "@/lib/merge";
import { parseAnswerKey, parseQuizText } from "@/lib/parse";
import { createQuiz } from "@/lib/quiz-db";

const MAX_PAYLOAD = 3_800_000; // dưới giới hạn request body ~4.5 MB của Vercel
const CHUNK_PAGES = 3;
const RENDER_LEVELS: [number, number][] = [
  [1500, 0.72],
  [1200, 0.6],
  [950, 0.5],
];

type Step = { key: string; label: string; state: "todo" | "doing" | "done" | "error"; detail?: string };

export function PdfFlow({ onDone }: { onDone: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<{ pages: number; chunks: number } | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitSec, setWaitSec] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const setStep = (key: string, patch: Partial<Step>) => setSteps((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function pick(f: File | null) {
    setFile(f);
    setInfo(null);
    setError(null);
    setSteps([]);
    if (!f) return;
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) {
      setError("Vui lòng chọn file PDF.");
      return;
    }
    try {
      const doc = await openPdf(f);
      setInfo({ pages: doc.numPages, chunks: makeChunks(doc.numPages, CHUNK_PAGES).length });
      await doc.destroy();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function run() {
    if (!file) return;
    setRunning(true);
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    setSteps([
      { key: "read", label: "Đọc PDF & tách câu hỏi", state: "todo" },
      { key: "solve", label: "Xác định đáp án", state: "todo" },
      { key: "save", label: "Lưu đề", state: "todo" },
    ]);
    let doc: Awaited<ReturnType<typeof openPdf>> | null = null;
    try {
      const hash = await sha256(file);
      const progressKey = `yd-progress-${hash}`;
      const saved: Record<number, ChunkResult> = JSON.parse(localStorage.getItem(progressKey) || "{}");
      doc = await openPdf(file);
      const chunks = makeChunks(doc.numPages, CHUNK_PAGES);

      setStep("read", { state: "doing" });
      for (let i = 0; i < chunks.length; i++) {
        if (saved[i]) continue;
        const pages = chunks[i];
        setStep("read", { detail: `Trang ${pages[0]}–${pages[pages.length - 1]} / ${doc.numPages} (cụm ${i + 1}/${chunks.length})` });

        // Render với chất lượng giảm dần cho tới khi vừa giới hạn dung lượng
        let groups: PagePayload[][] = [];
        for (const [side, q] of RENDER_LEVELS) {
          const payload: PagePayload[] = [];
          for (const p of pages) payload.push(await renderPage(doc, p, side, q));
          if (JSON.stringify({ pages: payload }).length <= MAX_PAYLOAD) {
            groups = [payload];
            break;
          }
          if (side === RENDER_LEVELS[RENDER_LEVELS.length - 1][0]) groups = payload.map((p) => [p]); // gửi từng trang
        }

        const merged: ChunkResult = { sections: [], questions: [], answer_key: {} };
        // Nếu cả cụm bị quá thời gian (504) thì tự chia ra gửi từng trang
        const extract = async (pagesPayload: PagePayload[]): Promise<(ChunkResult & { title: string | null })[]> => {
          try {
            const r = await callAi<ChunkResult & { title: string | null }>("/api/ai/extract", { pages: pagesPayload }, (w) => setWaitSec(w), ac.signal);
            // Cắt hình minh hoạ (biển báo, thông báo…) từ ảnh trang cho các câu cần hình
            for (const q of r.questions as (ChunkResult["questions"][number] & { figure?: { page: number; box: [number, number, number, number] } | null })[]) {
              const pg = q.figure ? pagesPayload.find((p) => p.page === q.figure!.page) : null;
              if (q.figure && pg?.image) q.image = await cropFigure(pg.image, q.figure.box);
              delete q.figure;
            }
            return [r];
          } catch (err) {
            if (err instanceof TimeoutError && pagesPayload.length > 1) {
              const out: (ChunkResult & { title: string | null })[] = [];
              for (const p of pagesPayload) out.push(...(await extract([p])));
              return out;
            }
            throw err;
          }
        };
        for (const g of groups) for (const r of await extract(g)) {
          const offset = merged.sections.length;
          merged.title = merged.title || r.title;
          merged.sections.push(...r.sections);
          merged.questions.push(
            ...r.questions.map((q) => ({ ...q, section_ref: q.section_ref != null ? q.section_ref + offset : null }))
          );
          Object.assign(merged.answer_key!, r.answer_key ?? {});
        }
        saved[i] = merged;
        try {
          localStorage.setItem(progressKey, JSON.stringify(saved));
        } catch {
          /* bộ nhớ trình duyệt đầy (đề nhiều hình): bỏ qua lưu tiến độ, vẫn xử lý tiếp */
        }
      }
      const result = mergeChunks(chunks.map((_, i) => saved[i]));
      if (result.questions.length === 0) {
        throw new Error("Không tìm thấy câu hỏi trắc nghiệm nào trong file. Hãy kiểm tra lại file, hoặc dùng chế độ Dán nội dung.");
      }
      setStep("read", { state: "done", detail: `Tìm thấy ${result.questions.length} câu` });

      const missing = result.questions.filter((q) => !q.correct_label).length;
      setStep("solve", { state: "doing", detail: missing ? `AI đang giải ${missing} câu chưa có đáp án…` : "Đề có sẵn đáp án" });
      let questions = result.questions;
      if (missing) {
        questions = await solveMissing(
          result.sections,
          result.questions,
          (d, t, w) => {
            setWaitSec(w);
            setStep("solve", { detail: `AI đang giải ${missing} câu (lượt ${Math.min(d + 1, t)}/${t})` });
          },
          ac.signal
        );
      }
      const review = questions.filter((q) => q.needs_review).length;
      setStep("solve", { state: "done", detail: `${questions.length - missing} câu lấy từ PDF, ${missing} câu AI giải${review ? `, ${review} câu cần kiểm tra` : ""}` });

      setStep("save", { state: "doing" });
      await savePdfLocal(hash, file);
      const id = await createQuiz({
        title: result.title || file.name.replace(/\.pdf$/i, ""),
        sections: result.sections,
        questions,
        source_file_hash: hash,
      });
      localStorage.removeItem(progressKey);
      setStep("save", { state: "done" });
      onDone(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSteps((s) => s.map((x) => (x.state === "doing" ? { ...x, state: "error" } : x)));
      setError(
        e instanceof DailyQuotaError
          ? `${msg} Tiến độ đã được lưu — ngày mai chọn lại đúng file này và bấm Bắt đầu để làm tiếp. Hoặc dùng chế độ "Dán nội dung (không cần AI)".`
          : msg
      );
    } finally {
      setWaitSec(0);
      setRunning(false);
      await doc?.destroy().catch(() => {});
    }
  }

  return (
    <div className="card p-5">
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary-line bg-primary-soft px-4 py-10 text-center hover:border-primary">
        <span className="text-4xl">📄</span>
        <span className="mt-2 font-semibold">{file ? file.name : "Chọn file PDF đề trắc nghiệm"}</span>
        <span className="text-sm text-muted">
          {file ? `${file.size < 1048576 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / 1048576).toFixed(1)} MB`}${info ? ` · ${info.pages} trang` : ""}` : "Không giới hạn dung lượng · hỗ trợ cả PDF scan"}
        </span>
        <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={running} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </label>

      {info && !running && steps.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          Cần khoảng <b>{info.chunks}</b> lượt gọi AI để đọc đề, cộng thêm vài lượt nếu đề chưa có đáp án. Giữ tab này mở trong lúc xử lý.
        </p>
      )}

      {steps.length > 0 && (
        <ol className="mt-5 space-y-3">
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-3">
              <span
                className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  s.state === "done" ? "bg-primary text-white" : s.state === "doing" ? "animate-pulse bg-primary-line text-primary-dark" : s.state === "error" ? "bg-red-100 text-danger" : "bg-gray-100 text-muted"
                }`}
              >
                {s.state === "done" ? "✓" : s.state === "error" ? "!" : "•"}
              </span>
              <div>
                <div className="font-semibold">{s.label}</div>
                {s.detail && <div className="text-sm text-muted">{s.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {waitSec > 0 && (
        <p className="mt-4 rounded-xl bg-orange-50 p-3 text-sm text-warn">
          ⏳ Đã chạm giới hạn miễn phí của AI, hệ thống sẽ tự tiếp tục sau <b>{waitSec}</b> giây…
        </p>
      )}
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-danger">⚠️ {error}</p>}

      <div className="mt-5 flex gap-2">
        {!running ? (
          <button className="btn-primary flex-1" disabled={!file || !info} onClick={run}>
            {error ? "Thử tiếp" : "Bắt đầu xử lý"}
          </button>
        ) : (
          <button className="btn-danger flex-1" onClick={() => abortRef.current?.abort()}>
            Dừng
          </button>
        )}
      </div>
    </div>
  );
}

export function TextFlow({ onDone }: { onDone: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = parseQuizText(text);
  const keyMap = parseAnswerKey(key);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const qs = preview.map((q) => (keyMap[q.number] ? { ...q, correct_label: keyMap[q.number] } : q));
      const id = await createQuiz({ title: title || "Đề trắc nghiệm", sections: [], questions: qs });
      onDone(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4 p-5">
      <div>
        <label className="label">Tên đề</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Unit 5 - Test 1" />
      </div>
      <div>
        <label className="label">Nội dung câu hỏi</label>
        <textarea
          className="input min-h-56 font-mono text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"1. She ___ to school every day.\nA. go   B. goes   C. going   D. gone\n2. ..."}
        />
        <p className="mt-1 text-sm text-muted">Nhận diện được <b>{preview.length}</b> câu. Mỗi câu bắt đầu bằng số thứ tự, phương án bắt đầu bằng A. B. C. D.</p>
      </div>
      <div>
        <label className="label">Bảng đáp án (tuỳ chọn)</label>
        <textarea className="input min-h-20 font-mono text-sm" value={key} onChange={(e) => setKey(e.target.value)} placeholder="1A 2C 3B 4D …" />
        <p className="mt-1 text-sm text-muted">Đọc được <b>{Object.keys(keyMap).length}</b> đáp án. Câu thiếu đáp án có thể bổ sung ở bước duyệt.</p>
      </div>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-danger">⚠️ {error}</p>}
      <button className="btn-primary w-full" disabled={busy || preview.length === 0} onClick={save}>
        {busy ? "Đang lưu…" : `Tạo đề (${preview.length} câu)`}
      </button>
    </div>
  );
}
