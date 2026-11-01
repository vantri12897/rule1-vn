import type { DraftQuestion, Option } from "./types";

/**
 * Đọc bảng đáp án dạng text: "1A 2C 3B", "1-A, 2.C", "1) b", "Câu 4: D",
 * hoặc dạng bảng nhiều dòng. Trả về map số câu -> chữ cái.
 */
export function parseAnswerKey(text: string): Record<number, string> {
  const out: Record<number, string> = {};
  const re = /(?:c[âa]u\s*)?(\d{1,3})\s*[\.\-\):=]?\s*([A-Fa-f])(?![A-Za-z])/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out[Number(m[1])] = m[2].toUpperCase();
  }
  return out;
}

/**
 * Parser không cần AI cho đề dạng text phổ biến:
 *   1. She ___ to school every day.
 *   A. go   B. goes   C. going   D. gone
 * Phương án có thể nằm cùng dòng hoặc mỗi dòng một phương án.
 */
export function parseQuizText(text: string): DraftQuestion[] {
  const norm = text.replace(/\r/g, "").replace(/ /g, " ");
  // Tách theo đầu câu: số ở đầu dòng, theo sau là ". " / ") " / ": "  (hoặc "Question 12.")
  const blocks: { number: number; body: string }[] = [];
  const startRe = /^\s*(?:question|câu|cau)?\s*(\d{1,3})\s*[\.\):]\s+/gimu;
  const starts: { idx: number; number: number; len: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(norm)) !== null) {
    starts.push({ idx: m.index, number: Number(m[1]), len: m[0].length });
  }
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].idx : norm.length;
    blocks.push({ number: s.number, body: norm.slice(s.idx + s.len, end) });
  }

  const questions: DraftQuestion[] = [];
  for (const b of blocks) {
    const optRe = /(?:^|\s)\(?([A-F])[\.\)]\s+/g;
    const marks: { label: string; idx: number; len: number }[] = [];
    let om: RegExpExecArray | null;
    let expected = "A";
    while ((om = optRe.exec(b.body)) !== null) {
      // chỉ nhận phương án theo đúng thứ tự A, B, C...
      if (om[1] === expected) {
        marks.push({ label: om[1], idx: om.index, len: om[0].length });
        expected = String.fromCharCode(expected.charCodeAt(0) + 1);
      }
    }
    if (marks.length < 2) continue;
    const stem = b.body.slice(0, marks[0].idx).trim().replace(/\s*\n\s*/g, " ");
    const options: Option[] = marks.map((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].idx : b.body.length;
      return { label: mk.label, text: b.body.slice(mk.idx + mk.len, end).trim().replace(/\s*\n\s*/g, " ") };
    });
    questions.push({
      number: b.number,
      section_index: null,
      stem,
      options,
      correct_label: null,
      answer_source: "manual",
      confidence: null,
      needs_review: false,
      explanation: null,
    });
  }
  return questions;
}
