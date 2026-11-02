import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { grade } from "@/lib/grading";
import { activeAttempt, answersToOriginal, buildResult, clientIp, GRACE_SEC, loadQuizBySlug, rateLimited } from "@/lib/public-quiz";
import type { Attempt } from "@/lib/types";

const Body = z.object({
  token: z.string().uuid(),
  answers: z.record(z.string().uuid(), z.string().regex(/^[A-Fa-f]$/)),
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  if (rateLimited(clientIp(req), 20)) return NextResponse.json({ error: "Thao tác quá nhanh, thử lại sau 1 phút" }, { status: 429 });
  const { slug } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dữ liệu bài làm không hợp lệ" }, { status: 400 });

  const data = await loadQuizBySlug(slug);
  if (!data) return NextResponse.json({ error: "Không tìm thấy đề" }, { status: 404 });
  const { quiz, questions } = data;

  const attempt = await activeAttempt(quiz.id, parsed.data.token);
  if (!attempt) return NextResponse.json({ error: "Không tìm thấy bài làm. Hãy tải lại trang." }, { status: 404 });
  if (attempt.status === "submitted") {
    return NextResponse.json({ result: buildResult(quiz, questions, attempt) });
  }

  // Chỉ giữ câu trả lời cho câu hỏi thuộc đề này
  // Chỉ giữ câu thuộc đề này; đổi chữ cái hiển thị (nếu xáo đáp án) về chữ cái gốc
  const answers = answersToOriginal(quiz, questions, parsed.data.token, parsed.data.answers);

  // Kiểm tra giờ theo đồng hồ server
  let late = false;
  if (quiz.time_limit_min) {
    const deadline = new Date(attempt.started_at).getTime() + quiz.time_limit_min * 60_000;
    late = Date.now() > deadline + GRACE_SEC * 1000;
  }

  // Nộp trễ (vd. điện thoại ngủ lúc hết giờ) vẫn được chấm; giáo viên thấy thời gian làm bài trên bảng kết quả
  const g = grade(questions, answers);
  const { data: updated, error } = await supabaseAdmin()
    .from("attempts")
    .update({
      answers,
      score: g.score,
      total: g.total,
      status: "submitted",
      submitted_at: new Date().toISOString(),
    })
    .eq("id", attempt.id)
    .eq("status", "in_progress")
    .select("*")
    .maybeSingle<Attempt>();
  if (error) return NextResponse.json({ error: "Không lưu được bài làm, thử lại" }, { status: 500 });
  const final = updated ?? (await activeAttempt(quiz.id, parsed.data.token))!;
  return NextResponse.json({ result: buildResult(quiz, questions, final), late });
}
