import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { grade } from "@/lib/grading";
import { activeAttempt, answersToOriginal, resultFor, clientIp, GRACE_SEC, loadQuizAndAttempt, studentLimited } from "@/lib/public-quiz";
import type { Attempt } from "@/lib/types";
import { langOf, translate, type Vars } from "@/lib/i18n/core";

const Body = z.object({
  token: z.string().uuid(),
  answers: z.record(z.string().regex(/^[0-9a-f-]{36}$/i), z.string().regex(/^[A-Fa-f]$/)),
  // Số lần rời trang làm bài (chuyển tab / mở ứng dụng khác) và tổng số giây rời
  away: z.object({ count: z.number().int().min(0).max(100_000), seconds: z.number().int().min(0).max(10_000_000) }).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const T = (k: string, v?: Vars) => translate(langOf(req), k, v);
  const { slug } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: T("Dữ liệu bài làm không hợp lệ") }, { status: 400 });
  if (studentLimited("submit", clientIp(req), parsed.data.token)) {
    return NextResponse.json({ error: T("Thao tác quá nhanh, thử lại sau 1 phút") }, { status: 429, headers: { "Retry-After": "5" } });
  }

  const data = await loadQuizAndAttempt(slug, parsed.data.token);
  if (!data) return NextResponse.json({ error: T("Không tìm thấy đề") }, { status: 404 });
  const { quiz, questions, attempt } = data;
  if (!attempt) return NextResponse.json({ error: T("Không tìm thấy bài làm. Hãy tải lại trang.") }, { status: 404 });
  if (attempt.status === "submitted") {
    return NextResponse.json({ result: await resultFor(quiz, questions, attempt) });
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
      ...(parsed.data.away ? { away_count: parsed.data.away.count, away_seconds: parsed.data.away.seconds } : {}),
    })
    .eq("id", attempt.id)
    .eq("status", "in_progress")
    .select("*")
    .maybeSingle<Attempt>();
  if (error) return NextResponse.json({ error: T("Không lưu được bài làm, thử lại") }, { status: 500 });
  const final = updated ?? (await activeAttempt(quiz.id, parsed.data.token))!;
  return NextResponse.json({ result: await resultFor(quiz, questions, final), late });
}
