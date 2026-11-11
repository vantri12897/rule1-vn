import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activeAttempt, activeRosterAttempt, resultFor, clientIp, loadQuizAndAttempt, takingPayload, studentLimited, toPublicQuestions } from "@/lib/public-quiz";
import type { Attempt } from "@/lib/types";
import { langOf, translate, type Vars } from "@/lib/i18n/core";

const Body = z.object({
  token: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  student_class: z.string().trim().max(60).optional().nullable(),
  // Đề dùng danh sách lớp: mã học viên đã chọn trong danh sách
  roster_id: z.string().trim().min(1).max(20).optional().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const T = (k: string, v?: Vars) => translate(langOf(req), k, v);
  const { slug } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: T("Vui lòng nhập họ tên") }, { status: 400 });
  if (studentLimited("start", clientIp(req), parsed.data.token)) {
    return NextResponse.json({ error: T("Thao tác quá nhanh, thử lại sau 1 phút") }, { status: 429, headers: { "Retry-After": "5" } });
  }

  const data = await loadQuizAndAttempt(slug, parsed.data.token);
  if (!data) return NextResponse.json({ error: T("Không tìm thấy đề") }, { status: 404 });
  const { quiz, questions, roster } = data;

  let attempt = data.attempt;
  if (!attempt) {
    if (quiz.status !== "open") return NextResponse.json({ error: T("Đề này đã đóng, không nhận bài mới") }, { status: 403 });
    // Đề dùng danh sách lớp: tên lấy theo danh sách, mỗi học viên chỉ 1 bài đang hoạt động
    let name = parsed.data.name;
    let cls = parsed.data.student_class || null;
    let rosterId: string | null = null;
    if (roster) {
      const st = roster.students.find((s) => s.id === parsed.data.roster_id);
      if (!st) return NextResponse.json({ error: T("Vui lòng chọn tên của bạn trong danh sách lớp") }, { status: 400 });
      const taken = await activeRosterAttempt(quiz.id, st.id);
      if (taken && taken.student_token !== parsed.data.token) {
        return NextResponse.json({ error: T("“{name}” đã làm bài này trên một máy khác. Nếu đó không phải bạn, hoặc bạn cần làm lại, hãy báo giáo viên.", { name: st.name }), code: "ROSTER_TAKEN" }, { status: 409 });
      }
      name = st.name;
      cls = roster.class_name;
      rosterId = st.id;
    }
    const { data: created, error } = await supabaseAdmin()
      .from("attempts")
      .insert({
        quiz_id: quiz.id,
        student_token: parsed.data.token,
        student_name: name,
        student_class: cls,
        roster_id: rosterId,
        status: "in_progress",
      })
      .select("*")
      .single<Attempt>();
    if (error || !created) {
      attempt = await activeAttempt(quiz.id, parsed.data.token); // trường hợp bấm 2 lần
      if (!attempt && rosterId) {
        // 2 máy chọn cùng 1 tên đúng cùng lúc
        return NextResponse.json({ error: T("“{name}” đã làm bài này trên một máy khác. Nếu đó không phải bạn, hoặc bạn cần làm lại, hãy báo giáo viên.", { name }), code: "ROSTER_TAKEN" }, { status: 409 });
      }
      if (!attempt) return NextResponse.json({ error: T("Không tạo được bài làm") }, { status: 500 });
    } else attempt = created;
  }

  if (attempt.status === "submitted") {
    return NextResponse.json({
      attempt: { status: "submitted", student_name: attempt.student_name },
      questions: toPublicQuestions(quiz, questions, parsed.data.token),
      result: await resultFor(quiz, questions, attempt),
    });
  }

  return NextResponse.json({
    attempt: takingPayload(quiz, questions, attempt),
    questions: toPublicQuestions(quiz, questions, parsed.data.token),
    server_time: new Date().toISOString(),
  });
}
