import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Trang kiểm tra: máy chủ đang chạy ở vùng nào, database ở vùng nào, gọi database mất bao lâu. Không lộ khoá bí mật. */
export async function GET() {
  const host = (() => {
    const raw = process.env.POSTGRES_HOST || process.env.POSTGRES_URL || "";
    try {
      return raw.includes("://") ? new URL(raw).hostname : raw;
    } catch {
      return raw;
    }
  })();
  const dbRegion = /aws-\d+-([a-z]+-[a-z]+-\d)/.exec(host)?.[1] ?? (host ? "không xác định từ tên máy" : "không có POSTGRES_HOST");

  const times: number[] = [];
  let ok = true;
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    const { error } = await supabaseAdmin().from("quizzes").select("id", { head: true, count: "exact" });
    times.push(Date.now() - t);
    if (error) ok = false;
  }
  return NextResponse.json({
    ok,
    server_region: process.env.VERCEL_REGION ?? "local",
    database_region: dbRegion,
    database_ms: times,
    hint: "database_ms nên dưới ~30ms nếu máy chủ và database cùng vùng",
  });
}
