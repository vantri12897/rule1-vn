import "server-only";
import { NextResponse } from "next/server";
import { supabaseServer } from "./supabase/server";
import { supabaseAdmin } from "./supabase/admin";
import { RateLimitError } from "./gemini";

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

export function aiErrorResponse(e: unknown) {
  if (e instanceof RateLimitError) {
    return NextResponse.json({ error: "RATE_LIMIT", retryAfter: e.retryAfterSec, daily: e.daily }, { status: 429 });
  }
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[AI]", msg);
  return NextResponse.json({ error: msg.slice(0, 300) }, { status: 502 });
}
