import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientIp, rateLimited } from "@/lib/public-quiz";
import { hashCode, sameHash } from "@/lib/recovery";

const Body = z.object({
  email: z.string().email().max(200),
  code: z.string().min(6).max(40),
  password: z.string().min(6).max(200),
});

const FAIL = "Email hoặc mã không đúng.";

/**
 * Đặt lại mật khẩu bằng:
 *  - mã 6 số vừa gửi qua email (hết hạn 15 phút, tối đa 5 lần nhập sai), hoặc
 *  - mã khôi phục dạng ABCD-EFGH-JKLM-NPQR (dùng 1 lần).
 */
export async function POST(req: Request) {
  if (rateLimited("reset:" + clientIp(req), 8)) return NextResponse.json({ error: "Thử quá nhiều lần, đợi 1 phút." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Vui lòng nhập đủ email, mã và mật khẩu mới (từ 6 ký tự)." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: userId } = await admin.rpc("user_id_by_email", { p_email: parsed.data.email });
  if (!userId) return NextResponse.json({ error: FAIL }, { status: 400 });

  const raw = parsed.data.code.trim();
  if (/^\d{6}$/.test(raw)) {
    const { data: row } = await admin.from("password_reset_codes").select("*").eq("user_id", userId).maybeSingle();
    if (!row) return NextResponse.json({ error: "Mã không đúng hoặc đã hết hạn. Hãy gửi mã mới." }, { status: 400 });
    if (new Date(row.expires_at).getTime() < Date.now() || row.attempts >= 5) {
      await admin.from("password_reset_codes").delete().eq("user_id", userId);
      return NextResponse.json({ error: "Mã đã hết hạn hoặc nhập sai quá 5 lần. Hãy gửi mã mới." }, { status: 400 });
    }
    if (!sameHash(row.code_hash, hashCode("email:" + raw))) {
      await admin.from("password_reset_codes").update({ attempts: row.attempts + 1 }).eq("user_id", userId);
      return NextResponse.json({ error: `Mã không đúng. Còn ${Math.max(0, 4 - row.attempts)} lần thử.` }, { status: 400 });
    }
    const { error } = await admin.auth.admin.updateUserById(userId, { password: parsed.data.password });
    if (error) return NextResponse.json({ error: "Không đổi được mật khẩu: " + error.message }, { status: 500 });
    await admin.from("password_reset_codes").delete().eq("user_id", userId);
    return NextResponse.json({ ok: true, via: "email" });
  }

  const { data: row } = await admin.from("recovery_codes").select("code_hash").eq("user_id", userId).maybeSingle();
  if (!row || !sameHash(row.code_hash, hashCode(raw))) return NextResponse.json({ error: FAIL }, { status: 400 });
  const { error } = await admin.auth.admin.updateUserById(userId, { password: parsed.data.password });
  if (error) return NextResponse.json({ error: "Không đổi được mật khẩu: " + error.message }, { status: 500 });
  await admin.from("recovery_codes").delete().eq("user_id", userId); // mã khôi phục dùng 1 lần
  return NextResponse.json({ ok: true, via: "recovery" });
}
