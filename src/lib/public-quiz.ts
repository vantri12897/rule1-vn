import "server-only";
import { supabaseAdmin } from "./supabase/admin";
import { grade, seededShuffle } from "./grading";
import type { Attempt, PublicQuestion, Quiz, QuestionRow, RosterStudent } from "./types";
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
/** Đếm số lượt theo khoá trong 1 cửa sổ thời gian (best-effort, theo từng instance serverless). */
export function rateLimited(key: string, max = 30, windowMs = 60_000) {
  const now = Date.now();
  // Dọn bớt khoá đã hết hạn để bộ nhớ không phình ra
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > windowMs) hits.delete(k);
  const h = hits.get(key);
  if (!h || now - h.t > windowMs) {
    hits.set(key, { n: 1, t: now });
    return false;
  }
  h.n++;
  return h.n > max;
}

/**
 * Giới hạn cho học viên làm bài.
 * Cả lớp dùng chung Wi-Fi trường thường ra Internet bằng CÙNG 1 địa chỉ IP, nên:
 *  - mỗi thiết bị (token) tối đa 12 lượt/phút cho từng thao tác → chặn bấm liên tục / phá
 *  - mỗi IP tối đa 600 lượt/phút cho từng thao tác → đủ cho vài lớp cùng lúc, vẫn chặn tấn công dồn dập
 * Thao tác "start" và "submit" đếm riêng, không ăn chung hạn mức.
 */
export function studentLimited(action: "start" | "submit", ip: string, token: string) {
  return rateLimited(`${action}:ip:${ip}`, 600) || rateLimited(`${action}:t:${token}`, 12);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GRACE_SEC = 60;

const QUESTION_COLS = "id, quiz_id, position, number, section_index, stem, options, correct_label, image, kind";

/** Lấy đề + câu hỏi trong 1 lần gọi database */
export async function loadQuizBySlug(slug: string) {
  const { data } = await supabaseAdmin()
    .from("quizzes")
    .select(`*, questions(${QUESTION_COLS}), classes(name, students)`)
    .eq("slug", slug)
    .order("position", { referencedTable: "questions" })
    .maybeSingle<Quiz & { questions: QuestionRow[]; classes: { name: string; students: RosterStudent[] } | null }>();
  if (!data || data.status === "draft") return null;
  const { questions, classes, ...quiz } = data;
  // Danh sách lớp (nếu đề dùng): học viên chọn tên trong danh sách
  const roster = quiz.class_id && classes ? { class_name: classes.name, students: (classes.students ?? []).map((s) => ({ id: s.id, name: s.name })) } : null;
  return { quiz: quiz as Quiz, questions: (questions ?? []) as QuestionRow[], roster };
}

/** Bài làm đang hoạt động, tra theo slug đề — chạy song song với loadQuizBySlug */
export async function activeAttemptBySlug(slug: string, token: string) {
  const { data } = await supabaseAdmin()
    .from("attempts")
    .select("*, quizzes!inner(slug)")
    .eq("quizzes.slug", slug)
    .eq("student_token", token)
    .neq("status", "archived")
    .maybeSingle<Attempt & { quizzes?: unknown }>();
  if (!data) return null;
  const { quizzes: _q, ...attempt } = data;
  void _q;
  return attempt as Attempt;
}

/** Đề + bài làm của học viên: 2 truy vấn chạy song song */
export async function loadQuizAndAttempt(slug: string, token: string | null) {
  const [data, attempt] = await Promise.all([
    loadQuizBySlug(slug),
    token && UUID_RE.test(token) ? activeAttemptBySlug(slug, token) : Promise.resolve(null),
  ]);
  return data ? { ...data, attempt } : null;
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
    kind: q.kind ?? null,
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

/** Điểm các lần làm trước (đã được giáo viên cho làm lại) của CÙNG máy/trình duyệt — chỉ theo mã máy để không lộ điểm người khác */
export async function previousResults(quizId: string, token: string) {
  const { data } = await supabaseAdmin()
    .from("attempts")
    .select("score, total, submitted_at")
    .eq("quiz_id", quizId)
    .eq("student_token", token)
    .eq("status", "archived")
    .not("score", "is", null)
    .order("submitted_at", { ascending: true })
    .limit(20);
  return (data ?? []) as { score: number; total: number; submitted_at: string | null }[];
}

/** Kết quả bài làm + điểm các lần trước (để học viên thấy mình tiến bộ thế nào) */
export async function resultFor(quiz: Quiz, questions: QuestionRow[], attempt: Attempt) {
  return { ...buildResult(quiz, questions, attempt), previous: await previousResults(quiz.id, attempt.student_token) };
}

/** Bài đang hoạt động (đang làm / đã nộp, chưa bị cho làm lại) của 1 học viên trong danh sách lớp */
export async function activeRosterAttempt(quizId: string, rosterId: string) {
  const { data } = await supabaseAdmin()
    .from("attempts")
    .select("id, student_token, status")
    .eq("quiz_id", quizId)
    .eq("roster_id", rosterId)
    .neq("status", "archived")
    .maybeSingle<{ id: string; student_token: string; status: string }>();
  return data ?? null;
}
