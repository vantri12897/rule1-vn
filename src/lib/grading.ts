import type { QuestionRow } from "./types";

export type GradeDetail = {
  question_id: string;
  number: number;
  selected: string | null;
  correct: string | null;
  is_correct: boolean;
};

/** Chấm bài: chỉ chạy ở server (hoặc khi giáo viên chấm lại). */
export function grade(
  questions: Pick<QuestionRow, "id" | "number" | "correct_label">[],
  answers: Record<string, string | null | undefined>
): { score: number; total: number; details: GradeDetail[] } {
  let score = 0;
  const details = questions.map((q) => {
    const selected = answers[q.id] ? String(answers[q.id]).toUpperCase() : null;
    const correct = q.correct_label ? q.correct_label.toUpperCase() : null;
    const ok = !!selected && !!correct && selected === correct;
    if (ok) score++;
    return { question_id: q.id, number: q.number, selected, correct, is_correct: ok };
  });
  return { score, total: questions.length, details };
}

/** Thứ tự câu hỏi xáo trộn ổn định theo token (cùng học viên luôn thấy cùng thứ tự). */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
