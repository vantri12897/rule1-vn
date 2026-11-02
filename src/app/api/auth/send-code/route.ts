import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientIp, rateLimited } from "@/lib/public-quiz";
import { hashCode, newEmailCode } from "@/lib/recovery";
import { mailEnabled, sendResetCodeMail } from "@/lib/mailer";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({ email: z.string().email().max(200) });
const OK_MSG = "Nếu email này có tài khoản, mã 6 số đã được gửi. Hãy kiểm tra hộp thư (cả mục Spam/Quảng cáo).";

/** Gửi mã 6 số đặt lại mật khẩu qua email. Luôn trả lời giống nhau để không lộ email nào có tài khoản. */
export async function POST(req: Request) {
  if (!mailEnabled()) {
    return NextResponse.json({ error: "Website chưa được cài đặt gửi email. Hãy dùng mã khôi phục.", noMail: true }, { status: 503 });
  }
  if (rateLimited("sendcode:" + clientIp(req), 5)) return NextResponse.json({ error: "Thử quá nhiều lần, đợi 1 phút." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Email không hợp lệ." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: userId } = await admin.rpc("user_id_by_email", { p_email: parsed.data.email });
  if (!userId) return NextResponse.json({ ok: true, message: OK_MSG });

  const { data: prev } = await admin.from("password_reset_codes").select("sent_at").eq("user_id", userId).maybeSingle();
  if (prev && Date.now() - new Date(prev.sent_at).getTime() < 60_000) {
    return NextResponse.json({ error: "Vừa gửi mã cách đây chưa tới 1 phút. Hãy kiểm tra hộp thư hoặc đợi rồi gửi lại." }, { status: 429 });
  }

  const code = newEmailCode();
  const now = new Date();
  const { error } = await admin.from("password_reset_codes").upsert({
    user_id: userId,
    code_hash: hashCode("email:" + code),
    expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
    attempts: 0,
    sent_at: now.toISOString(),
  });
  if (error) return NextResponse.json({ error: "Không tạo được mã: " + error.message }, { status: 500 });

  try {
    const site = new URL(req.url).origin;
    await sendResetCodeMail(parsed.data.email.trim(), code, site);
  } catch (e) {
    await admin.from("password_reset_codes").delete().eq("user_id", userId);
    console.error("[mail]", e);
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /Invalid login|Username and Password not accepted|535/i.test(msg)
      ? " (Gmail từ chối đăng nhập — kiểm tra lại GMAIL_USER và mật khẩu ứng dụng trên Vercel)"
      : "";
    return NextResponse.json({ error: "Không gửi được email" + hint + ". Hãy dùng mã khôi phục." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, message: OK_MSG });
}
