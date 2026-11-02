import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashCode, newRecoveryCode } from "@/lib/recovery";

export const dynamic = "force-dynamic";

/** Kiểm tra đã có mã khôi phục chưa */
export async function GET() {
  const user = await requireTeacher();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { data } = await supabaseAdmin().from("recovery_codes").select("created_at").eq("user_id", user.id).maybeSingle();
  return NextResponse.json({ exists: !!data, created_at: data?.created_at ?? null });
}

/** Tạo (hoặc tạo lại) mã khôi phục — mã chỉ hiện 1 lần, DB chỉ lưu bản băm */
export async function POST() {
  const user = await requireTeacher();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const code = newRecoveryCode();
  const { error } = await supabaseAdmin()
    .from("recovery_codes")
    .upsert({ user_id: user.id, code_hash: hashCode(code), created_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: "Không tạo được mã: " + error.message }, { status: 500 });
  return NextResponse.json({ code });
}
