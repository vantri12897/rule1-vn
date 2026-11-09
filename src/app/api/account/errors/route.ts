import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { alertRecipient, mailEnabled } from "@/lib/mailer";
import { langOf, translate } from "@/lib/i18n/core";

export const dynamic = "force-dynamic";

/** 7 ngày gần nhất: số lỗi + 15 lỗi mới nhất (không có tên học viên) */
export async function GET(req: Request) {
  const user = await requireTeacher();
  if (!user) return NextResponse.json({ error: translate(langOf(req), "Chưa đăng nhập") }, { status: 401 });
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ count }, { data }] = await Promise.all([
    supabaseAdmin().from("error_logs").select("id", { count: "exact", head: true }).gt("created_at", since),
    supabaseAdmin().from("error_logs").select("created_at, source, kind, message, path, quiz_slug").gt("created_at", since).order("created_at", { ascending: false }).limit(15),
  ]);
  const to = alertRecipient();
  return NextResponse.json({ count: count ?? 0, items: data ?? [], alerts_to: mailEnabled() && to ? to.replace(/^(.{2}).*(@.*)$/, "$1•••$2") : null });
}
