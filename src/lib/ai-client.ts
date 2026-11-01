"use client";
import type { DraftQuestion, Section } from "./types";

export class DailyQuotaError extends Error {}

/** Gọi API AI; tự chờ khi gặp giới hạn 429 của gói miễn phí. */
export async function callAi<T>(
  url: string,
  body: unknown,
  onWait?: (secondsLeft: number) => void,
  signal?: AbortSignal
): Promise<T> {
  let fails = 0;
  for (;;) {
    if (signal?.aborted) throw new Error("Đã dừng");
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    } catch {
      if (signal?.aborted) throw new Error("Đã dừng");
      if (++fails > 3) throw new Error("Mất kết nối mạng. Kiểm tra internet rồi bấm Thử tiếp.");
      await sleep(3000 * fails);
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) {
      if (data.daily) throw new DailyQuotaError("Đã dùng hết lượt AI miễn phí trong ngày của Gemini.");
      let left = Math.min(Number(data.retryAfter) || 30, 300);
      while (left > 0) {
        onWait?.(left);
        await sleep(1000);
        left--;
        if (signal?.aborted) throw new Error("Đã dừng");
      }
      onWait?.(0);
      continue;
    }
    if (res.status === 401) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
    if (res.status === 413) throw new Error("Cụm trang quá lớn để gửi.");
    if (++fails > 3) throw new Error(data.error || `Lỗi máy chủ (${res.status})`);
    await sleep(2000 * fails);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type SolveOut = { answers: { number: number; label: string; confidence: number; explanation: string }[] };

/**
 * Cho AI giải các câu chưa có đáp án. Chạy 2 lượt độc lập; khác nhau hoặc confidence < 0.8 → "Cần kiểm tra".
 * Trả về mảng câu hỏi mới (không sửa mảng cũ).
 */
export async function solveMissing(
  sections: Section[],
  questions: DraftQuestion[],
  onProgress: (done: number, total: number, waitSec: number) => void,
  signal?: AbortSignal
): Promise<DraftQuestion[]> {
  const todo = questions.filter((q) => !q.correct_label);
  if (todo.length === 0) return questions;
  const batches: DraftQuestion[][] = [];
  for (let i = 0; i < todo.length; i += 20) batches.push(todo.slice(i, i + 20));
  const total = batches.length * 2;
  let done = 0;
  const passes: Map<number, { label: string; confidence: number; explanation: string }>[] = [new Map(), new Map()];

  for (let pass = 0; pass < 2; pass++) {
    for (const b of batches) {
      const payload = {
        questions: (pass === 1 ? [...b].reverse() : b).map((q) => {
          const s = q.section_index != null ? sections[q.section_index] : null;
          return { number: q.number, instruction: s?.instruction ?? null, passage: s?.passage ?? null, stem: q.stem, options: q.options };
        }),
      };
      const out = await callAi<SolveOut>("/api/ai/solve", payload, (w) => onProgress(done, total, w), signal);
      for (const a of out.answers) passes[pass].set(a.number, a);
      done++;
      onProgress(done, total, 0);
    }
  }

  return questions.map((q) => {
    if (q.correct_label) return q;
    const a = passes[0].get(q.number);
    const b = passes[1].get(q.number);
    const labels = new Set(q.options.map((o) => o.label));
    const okA = a && labels.has(a.label) ? a : null;
    const okB = b && labels.has(b.label) ? b : null;
    const pick = okA && okB ? (okA.confidence >= okB.confidence ? okA : okB) : okA ?? okB;
    if (!pick) return { ...q, needs_review: true };
    const agree = !!okA && !!okB && okA.label === okB.label;
    const conf = agree ? Math.min(okA!.confidence, okB!.confidence) : Math.min(pick.confidence, 0.5);
    return {
      ...q,
      correct_label: pick.label,
      answer_source: "ai_solved",
      confidence: conf,
      needs_review: !agree || conf < 0.8,
      explanation: pick.explanation || null,
    };
  });
}
