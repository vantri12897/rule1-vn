import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activeAttempt, buildResult, clientIp, deadlineOf, loadQuizAndAttempt, rateLimited, toPublicQuestions } from "@/lib/public-quiz";
import type { Attempt } from "@/lib/types";
import { langOf, translate, type Vars } from "@/lib/i18n/core";

const Body = z.object({
  token: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  student_class: z.string().trim().max(60).optional().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const T = (k: string, v?: Vars) => translate(langOf(req), k, v);
  if (rateLimited(clientIp(req), 20)) return NextResponse.json({ error: T("Thao tác quá nhanh, thử lại sau 1 phút") }, { status: 429 });
  const { slug } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: T("Vui lòng nhập họ tên") }, { status: 400 });

  const data = await loadQuizAndAttempt(slug, parsed.data.token);
  if (!data) return NextResponse.json({ error: T("Không tìm thấy đề") }, { status: 404 });
  const { quiz, questions } = data;

  let attempt = data.attempt;
  if (!attempt) {
    if (quiz.status !== "open") return NextResponse.json({ error: T("Đề này đã đóng, không nhận bài mới") }, { status: 403 });
    const { data: created, error } = await supabaseAdmin()
      .from("attempts")
      .insert({
        quiz_id: quiz.id,
        student_token: parsed.data.token,
        student_name: parsed.data.name,
        student_class: parsed.data.student_class || null,
        status: "in_progress",
      })
      .select("*")
      .single<Attempt>();
    if (error || !created) {
      attempt = await activeAttempt(quiz.id, parsed.data.token); // trường hợp bấm 2 lần
      if (!attempt) return NextResponse.json({ error: T("Không tạo được bài làm") }, { status: 500 });
    } else attempt = created;
  }

  if (attempt.status === "submitted") {
    return NextResponse.json({
      attempt: { status: "submitted", student_name: attempt.student_name },
      questions: toPublicQuestions(quiz, questions, parsed.data.token),
      result: buildResult(quiz, questions, attempt),
    });
  }

  return NextResponse.json({
    attempt: {
      status: attempt.status,
      student_name: attempt.student_name,
      started_at: attempt.started_at,
      deadline: deadlineOf(quiz, attempt),
      answers: attempt.answers,
    },
    questions: toPublicQuestions(quiz, questions, parsed.data.token),
    server_time: new Date().toISOString(),
  });
}
