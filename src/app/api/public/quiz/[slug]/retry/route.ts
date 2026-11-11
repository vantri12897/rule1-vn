import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { grade } from "@/lib/grading";
import { clientIp, loadQuizAndAttempt, retryInfo, studentLimited, takingPayload, toPublicQuestions } from "@/lib/public-quiz";
import { langOf, translate } from "@/lib/i18n/core";
import type { Attempt } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({ token: z.string().uuid() });

/**
 * Học viên bấm "Làm lại các câu sai": bài vừa nộp chuyển thành "lần làm trước" (giáo viên vẫn xem được),
 * tạo bài mới chỉ cần làm các câu sai — câu đúng giữ nguyên đáp án và bị khoá.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const T = (k: string, v?: Record<string, string | number>) => translate(langOf(req), k, v);
  const { slug } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: T("Dữ liệu không hợp lệ") }, { status: 400 });
  if (studentLimited("retry", clientIp(req), parsed.data.token)) return NextResponse.json({ error: T("Thao tác quá nhanh, đợi một chút") }, { status: 429 });

  const data = await loadQuizAndAttempt(slug, parsed.data.token);
  if (!data?.attempt) return NextResponse.json({ error: T("Không tìm thấy bài làm") }, { status: 404 });
  const { quiz, questions, attempt } = data;
  const info = retryInfo(quiz, questions, attempt);
  if (!info.allowed) return NextResponse.json({ error: T("Đề này không cho làm lại câu sai (hoặc đã hết lượt)") }, { status: 403 });

  const g = grade(questions, attempt.answers ?? {});
  const locked: Record<string, string> = {};
  const prev: Record<string, string> = {};
  for (const d of g.details) {
    if (d.is_correct && d.selected) locked[d.question_id] = d.selected;
    else if (d.selected) prev[d.question_id] = d.selected;
  }
  const { data: newId, error } = await supabaseAdmin().rpc("retry_wrong_swap", { p_old: attempt.id, p_locked: locked, p_prev: prev });
  if (error || !newId) return NextResponse.json({ error: T("Không bắt đầu làm lại được, thử lại") }, { status: 500 });
  const { data: fresh } = await supabaseAdmin().from("attempts").select("*").eq("id", newId as string).single<Attempt>();
  if (!fresh) return NextResponse.json({ error: T("Không bắt đầu làm lại được, thử lại") }, { status: 500 });
  return NextResponse.json({
    attempt: takingPayload(quiz, questions, fresh),
    questions: toPublicQuestions(quiz, questions, parsed.data.token),
    server_time: new Date().toISOString(),
  });
}
