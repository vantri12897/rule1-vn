import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mailEnabled } from "@/lib/mailer";
import { emailBackup } from "@/lib/server-backup";
import { logError, pruneErrorLogs, sendErrorDigest } from "@/lib/errlog";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel Cron gọi mỗi ngày lúc ~08:00 giờ Việt Nam:
 *  1. Giữ project Supabase gói Free không bị tạm dừng sau 7 ngày
 *  2. Chủ nhật: gửi bản sao lưu vào email của từng giáo viên (đã bật)
 *  3. Gửi email tóm tắt lỗi 24 giờ qua (nếu có lỗi) + dọn nhật ký cũ
 * Gọi lại nhiều lần trong ngày cũng an toàn: mỗi việc tự kiểm tra đã làm hôm nay chưa.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { count, error } = await supabaseAdmin().from("quizzes").select("id", { count: "exact", head: true });
  const out: Record<string, unknown> = { ok: !error, quizzes: count ?? 0, at: new Date().toISOString() };
  const site = new URL(req.url).origin;

  // 2. Sao lưu hằng tuần (Chủ nhật theo giờ Việt Nam; ?force=backup để chạy thử khi đã đặt CRON_SECRET)
  const vnDay = new Date(Date.now() + 7 * 3600_000).getUTCDay();
  const force = new URL(req.url).searchParams.get("force");
  if (mailEnabled() && (vnDay === 0 || (force === "backup" && secret))) {
    out.backups = await weeklyBackups();
  }
  // 3. Tóm tắt lỗi + dọn dẹp
  try {
    out.errors_digested = await sendErrorDigest(site);
    await pruneErrorLogs();
  } catch (e) {
    out.digest_error = String(e);
  }
  return NextResponse.json(out);
}

async function weeklyBackups() {
  const sb = supabaseAdmin();
  const [{ data: teachers }, { data: prefs }, { data: owners }] = await Promise.all([
    sb.rpc("teacher_list"),
    sb.from("teacher_backups").select("*"),
    sb.from("quizzes").select("owner_id"),
  ]);
  const pref = new Map((prefs ?? []).map((p) => [p.owner_id as string, p]));
  const hasQuiz = new Set((owners ?? []).map((o) => o.owner_id as string));
  const results: string[] = [];
  for (const tch of (teachers ?? []) as { id: string; email: string }[]) {
    const p = pref.get(tch.id);
    if (p?.enabled === false || !hasQuiz.has(tch.id)) continue;
    if (p?.last_sent_at && Date.now() - new Date(p.last_sent_at).getTime() < 6 * 86400_000) continue; // tuần này đã gửi
    try {
      const info = await emailBackup(tch.id, tch.email, p?.lang === "en" ? "en" : "vi");
      await sb.from("teacher_backups").upsert({ owner_id: tch.id, last_sent_at: new Date().toISOString(), last_info: info });
      results.push(`ok ${info}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sb.from("teacher_backups").upsert({ owner_id: tch.id, last_info: `ERROR ${msg}`.slice(0, 300) });
      await logError({ source: "server", kind: "backup-failed", message: msg });
      results.push(`error ${msg}`);
    }
  }
  return results;
}
