import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activeAttempt, clientIp, deadlineOf, loadQuizBySlug, rateLimited, toPublicQuestions } from "@/lib/public-quiz";
import type { Attempt } from "@/lib/types";

const Body = z.object({
  token: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  student_class: z.string().trim().max(60).optional().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  if (rateLimited(clientIp(req), 20)) return NextResponse.json({ error: "Thao tác quá nhanh, thử lại sau 1 phút" }, { status: 429 });
  const { slug } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Vui lòng nhập họ tên" }, { status: 400 });

  const data = await loadQuizBySlug(slug);
  if (!data) return NextResponse.json({ error: "Không tìm thấy đề" }, { status: 404 });
  const { quiz, questions } = data;

  let attempt = await activeAttempt(quiz.id, parsed.data.token);
  if (!attempt) {
    if (quiz.status !== "open") return NextResponse.json({ error: "Đề này đã đóng, không nhận bài mới" }, { status: 403 });
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
      if (!attempt) return NextResponse.json({ error: "Không tạo được bài làm" }, { status: 500 });
    } else attempt = created;
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
