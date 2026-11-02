import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientIp, rateLimited } from "@/lib/public-quiz";
import { langOf, translate, type Vars } from "@/lib/i18n/core";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(6).max(200) });

/** Tạo tài khoản giáo viên đã xác nhận sẵn — không cần cấu hình gửi email xác nhận. */
export async function POST(req: Request) {
  const T = (k: string, v?: Vars) => translate(langOf(req), k, v);
  if (rateLimited("signup:" + clientIp(req), 5)) return NextResponse.json({ error: T("Thử lại sau 1 phút") }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: T("Email không hợp lệ hoặc mật khẩu dưới 6 ký tự.") }, { status: 400 });

  // Tài khoản đầu tiên = chủ website. Tài khoản sau cần mã TEACHER_SIGNUP_CODE (nếu chủ đặt),
  // để người lạ không tự đăng ký và dùng hết lượt AI miễn phí.
  const admin = supabaseAdmin();
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if ((existing?.users?.length ?? 0) > 0) {
    const code = process.env.TEACHER_SIGNUP_CODE;
    if (!code || req.headers.get("x-signup-code") !== code) {
      return NextResponse.json(
        { error: T("Website đã có tài khoản chủ. Muốn thêm giáo viên, cần mã đăng ký do chủ website cung cấp."), needCode: true },
        { status: 403 }
      );
    }
  }
  const { error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (error) {
    const msg = /already|registered|exists/i.test(error.message) ? T("Email này đã có tài khoản. Hãy đăng nhập.") : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
