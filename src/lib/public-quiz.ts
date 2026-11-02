import "server-only";
import { supabaseAdmin } from "./supabase/admin";
import { grade, seededShuffle } from "./grading";
import type { Attempt, PublicQuestion, Quiz, QuestionRow } from "./types";
import { canShuffle, displayOptions, identityPerm, optionPerm, toDisplay, toOriginal } from "./option-shuffle";

/** Hoán vị đáp án cho học viên này (không xáo nếu đề tắt tuỳ chọn hoặc câu dạng "All of the above") */
export function permFor(quiz: Quiz, q: Pick<QuestionRow, "id" | "options">, token: string | null) {
  if (!quiz.shuffle_options || !token || !canShuffle(q.options)) return identityPerm(q.options.length);
  return optionPerm(token, q.id, q.options.length);
}

/** Đổi đáp án học viên chọn (theo chữ cái hiển thị) về chữ cái gốc để chấm và lưu */
export function answersToOriginal(quiz: Quiz, questions: QuestionRow[], token: string, answers: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const a = answers[q.id];
    if (!a) continue;
    const o = toOriginal(a, q.options, permFor(quiz, q, token));
    if (o) out[q.id] = o;
  }
  return out;
}

const hits = new Map<string, { n: number; t: number }>();
/** Rate limit đơn giản theo IP (best-effort, theo từng instance serverless). */
export function rateLimited(ip: string, max = 30, windowMs = 60_000) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > windowMs) {
    hits.set(ip, { n: 1, t: now });
    return false;
  }
  h.n++;
  return h.n > max;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GRACE_SEC = 60;

export async function loadQuizBySlug(slug: string) {
  const sb = supabaseAdmin();
  const { data: quiz } = await sb.from("quizzes").select("*").eq("slug", slug).maybeSingle<Quiz>();
  if (!quiz || quiz.status === "draft") return null;
  const { data: questions } = await sb
    .from("questions")
    .select("id, quiz_id, position, number, section_index, stem, options, correct_label, image")
    .eq("quiz_id", quiz.id)
    .order("position");
  return { quiz, questions: (questions ?? []) as QuestionRow[] };
}

export async function activeAttempt(quizId: string, token: string) {
  const { data } = await supabaseAdmin()
    .from("attempts")
    .select("*")
    .eq("quiz_id", quizId)
    .eq("student_token", token)
    .neq("status", "archived")
    .maybeSingle<Attempt>();
  return data ?? null;
}

export function toPublicQuestions(quiz: Quiz, questions: QuestionRow[], token: string | null): PublicQuestion[] {
  const pub = questions.map((q) => ({
    id: q.id,
    number: q.number,
    section_index: q.section_index,
    stem: q.stem,
    options: displayOptions(q.options, permFor(quiz, q, token)),
    image: q.image ?? null,
  }));
  if (!quiz.shuffle_questions || !token) return pub;
  // Xáo theo nhóm section để câu đọc hiểu vẫn đi cùng đoạn văn
  const groups: PublicQuestion[][] = [];
  for (const q of pub) {
    const last = groups[groups.length - 1];
    if (last && q.section_index != null && last[0].section_index === q.section_index) last.push(q);
    else groups.push([q]);
  }
  return seededShuffle(groups, token).flat();
}

export function buildResult(quiz: Quiz, questions: QuestionRow[], attempt: Attempt) {
  const g = grade(questions, attempt.answers ?? {});
  return {
    score: attempt.score ?? g.score,
    total: attempt.total ?? g.total,
    submitted_at: attempt.submitted_at,
    show_answers: quiz.show_answers,
    // Trả về theo chữ cái học viên đã thấy (nếu đề có xáo đáp án)
    details: g.details.map((d) => {
      const q = questions.find((x) => x.id === d.question_id)!;
      const perm = permFor(quiz, q, attempt.student_token);
      return {
        question_id: d.question_id,
        number: d.number,
        selected: toDisplay(d.selected, q.options, perm),
        is_correct: d.is_correct,
        correct: quiz.show_answers ? toDisplay(d.correct, q.options, perm) : null,
      };
    }),
  };
}

export function deadlineOf(quiz: Quiz, attempt: Attempt): string | null {
  if (!quiz.time_limit_min) return null;
  return new Date(new Date(attempt.started_at).getTime() + quiz.time_limit_min * 60_000).toISOString();
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
