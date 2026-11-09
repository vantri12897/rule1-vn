import "server-only";
import { NextResponse } from "next/server";
import { supabaseServer } from "./supabase/server";
import { supabaseAdmin } from "./supabase/admin";
import { RateLimitError } from "./gemini";
import { logError } from "./errlog";

export async function requireTeacher() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

export async function bumpUsage(userId: string) {
  try {
    await supabaseAdmin().rpc("bump_ai_usage", { p_owner: userId });
  } catch {
    /* không chặn luồng chính nếu đếm lỗi */
  }
}

let lastQuotaLog = 0;
export function aiErrorResponse(e: unknown) {
  if (e instanceof RateLimitError) {
    // Hết lượt AI trong ngày ở mọi model → ghi nhật ký (tối đa 1 lần/giờ) để có trong email tóm tắt
    if (e.daily && Date.now() - lastQuotaLog > 3600_000) {
      lastQuotaLog = Date.now();
      void logError({ source: "server", kind: "ai-quota", message: "Gemini: hết lượt miễn phí trong ngày ở mọi model (tự có lại sau ~15:00 giờ VN)" });
    }
    return NextResponse.json({ error: "RATE_LIMIT", retryAfter: e.retryAfterSec, daily: e.daily }, { status: 429 });
  }
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[AI]", msg);
  void logError({ source: "server", kind: "ai-error", message: msg.slice(0, 300) });
  return NextResponse.json({ error: msg.slice(0, 300) }, { status: 502 });
}
