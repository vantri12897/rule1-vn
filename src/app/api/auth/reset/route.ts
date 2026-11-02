import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientIp, rateLimited } from "@/lib/public-quiz";
import { hashCode, sameHash } from "@/lib/recovery";

const Body = z.object({
  email: z.string().email().max(200),
  code: z.string().min(8).max(40),
  password: z.string().min(6).max(200),
});

const FAIL = "Email hoặc mã khôi phục không đúng.";

/** Đặt lại mật khẩu bằng mã khôi phục (không cần gửi email). Mã dùng 1 lần. */
export async function POST(req: Request) {
  if (rateLimited("reset:" + clientIp(req), 5)) return NextResponse.json({ error: "Thử quá nhiều lần, đợi 1 phút." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Vui lòng nhập đủ email, mã khôi phục và mật khẩu mới (từ 6 ký tự)." }, { status: 400 });

  const admin = supabaseAdmin();
  const email = parsed.data.email.trim().toLowerCase();
  let userId: string | null = null;
  for (let page = 1; page <= 10 && !userId; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    userId = users.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
    if (users.length < 200) break;
  }
  if (!userId) return NextResponse.json({ error: FAIL }, { status: 400 });

  const { data: row } = await admin.from("recovery_codes").select("code_hash").eq("user_id", userId).maybeSingle();
  if (!row || !sameHash(row.code_hash, hashCode(parsed.data.code))) return NextResponse.json({ error: FAIL }, { status: 400 });

  const { error } = await admin.auth.admin.updateUserById(userId, { password: parsed.data.password });
  if (error) return NextResponse.json({ error: "Không đổi được mật khẩu: " + error.message }, { status: 500 });
  await admin.from("recovery_codes").delete().eq("user_id", userId); // mã đã dùng thì huỷ
  return NextResponse.json({ ok: true });
}
