import type { DraftQuestion, Section } from "./types";

export type ChunkResult = {
  title?: string | null;
  sections: Section[];
  questions: (DraftQuestion & { section_ref?: number | null })[];
  answer_key?: Record<string, string> | null;
};

function sectionKey(s: Section) {
  return `${(s.instruction ?? "").trim().slice(0, 80)}|${(s.passage ?? "").trim().slice(0, 120)}`;
}

/**
 * Ghép kết quả các cụm trang (có chồng lấn 1 trang):
 * - Khử trùng lặp câu theo số câu; giữ bản có nhiều phương án/nội dung hơn.
 * - Gộp section trùng nhau.
 * - Áp bảng đáp án tìm được ở bất kỳ cụm nào (thường ở cuối đề).
 */
export function mergeChunks(chunks: ChunkResult[]): { title: string | null; sections: Section[]; questions: DraftQuestion[] } {
  const sections: Section[] = [];
  const secIndex = new Map<string, number>();
  const byNumber = new Map<number, DraftQuestion>();
  let title: string | null = null;
  const key: Record<number, string> = {};

  for (const c of chunks) {
    if (!title && c.title) title = c.title;
    const localMap: number[] = [];
    c.sections.forEach((s, i) => {
      const k = sectionKey(s);
      if (!secIndex.has(k)) {
        secIndex.set(k, sections.length);
        sections.push(s);
      } else {
        // nếu bản sau có passage đầy đủ hơn thì cập nhật
        const idx = secIndex.get(k)!;
        if ((s.passage?.length ?? 0) > (sections[idx].passage?.length ?? 0)) sections[idx] = s;
      }
      localMap[i] = secIndex.get(k)!;
    });
    for (const q of c.questions) {
      const ref = q.section_ref ?? q.section_index;
      const mapped: DraftQuestion = {
        number: q.number,
        section_index: ref != null && localMap[ref] != null ? localMap[ref] : null,
        stem: q.stem,
        options: q.options,
        correct_label: q.correct_label,
        answer_source: q.answer_source,
        confidence: q.confidence,
        needs_review: q.needs_review,
        explanation: q.explanation,
        image: q.image ?? null,
      };
      const prev = byNumber.get(q.number);
      const score = (x: DraftQuestion) => x.options.length * 1000 + x.stem.length + x.options.reduce((a, o) => a + o.text.length, 0);
      if (!prev || score(mapped) > score(prev)) {
        if (prev && !mapped.image && prev.image) mapped.image = prev.image;
        if (prev && !mapped.correct_label && prev.correct_label) {
          mapped.correct_label = prev.correct_label;
          mapped.answer_source = prev.answer_source;
        }
        byNumber.set(q.number, mapped);
      } else {
        if (!prev.correct_label && mapped.correct_label) {
          prev.correct_label = mapped.correct_label;
          prev.answer_source = mapped.answer_source;
        }
        if (!prev.image && mapped.image) prev.image = mapped.image;
      }
    }
    if (c.answer_key) {
      for (const [n, l] of Object.entries(c.answer_key)) {
        if (/^[A-F]$/i.test(l)) key[Number(n)] = l.toUpperCase();
      }
    }
  }

  const questions = [...byNumber.values()].sort((a, b) => a.number - b.number);
  for (const q of questions) {
    if (key[q.number]) {
      q.correct_label = key[q.number];
      q.answer_source = "from_pdf";
      q.needs_review = false;
    }
  }
  return { title, sections, questions };
}
