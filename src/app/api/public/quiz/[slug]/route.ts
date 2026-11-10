import { NextResponse } from "next/server";
import { resultFor, deadlineOf, loadQuizAndAttempt, toPublicQuestions } from "@/lib/public-quiz";
import { langOf, translate, type Vars } from "@/lib/i18n/core";

export const dynamic = "force-dynamic";

/** Lấy đề cho học viên — tuyệt đối không trả correct_label trước khi nộp */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const T = (k: string, v?: Vars) => translate(langOf(req), k, v);
  const { slug } = await ctx.params;
  const token = new URL(req.url).searchParams.get("token");
  const data = await loadQuizAndAttempt(slug, token);
  if (!data) return NextResponse.json({ error: T("Không tìm thấy đề hoặc đề chưa được xuất bản") }, { status: 404 });
  const { quiz, questions, attempt, roster } = data;

  const base = {
    quiz: {
      title: quiz.title,
      status: quiz.status,
      sections: quiz.sections,
      part_titles: quiz.part_titles ?? {},
      roster: quiz.status === "open" ? roster : null,
      time_limit_min: quiz.time_limit_min,
      question_count: questions.length,
    },
  };

  if (attempt?.status === "submitted") {
    return NextResponse.json({
      ...base,
      questions: toPublicQuestions(quiz, questions, token),
      attempt: { status: "submitted", student_name: attempt.student_name },
      result: await resultFor(quiz, questions, attempt),
    });
  }
  return NextResponse.json({
    ...base,
    questions: attempt ? toPublicQuestions(quiz, questions, token) : [],
    attempt: attempt
      ? {
          status: attempt.status,
          student_name: attempt.student_name,
          started_at: attempt.started_at,
          deadline: deadlineOf(quiz, attempt),
          answers: attempt.answers,
        }
      : null,
    server_time: new Date().toISOString(),
  });
}
