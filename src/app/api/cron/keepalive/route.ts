import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Vercel Cron gọi mỗi ngày để project Supabase gói Free không bị tạm dừng sau 7 ngày */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { count, error } = await supabaseAdmin().from("quizzes").select("id", { count: "exact", head: true });
  return NextResponse.json({ ok: !error, quizzes: count ?? 0, at: new Date().toISOString() });
}
