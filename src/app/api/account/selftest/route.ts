import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureBucket, storageUsage, storeImage } from "@/lib/image-store";
import { IMAGE_BUCKET, storedPath } from "@/lib/images";
import { rateLimited } from "@/lib/public-quiz";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Check = { key: string; status: "ok" | "warn" | "fail"; detail: string };

/** Ảnh PNG 1×1 dùng để thử kho hình (tải lên rồi xoá ngay) */
const TINY_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

const timed = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms / 1000}s`)), ms))]);

/**
 * 🩺 Kiểm tra hệ thống trên CHÍNH website đang chạy: cơ sở dữ liệu (đủ bảng/cột mới), kho hình (tải lên/đọc/xoá thử),
 * quyền quản trị tài khoản, email, khoá Gemini, lần chạy gần nhất của tác vụ tự động mỗi sáng.
 * Không tốn lượt AI, không gửi email, không thay đổi dữ liệu của giáo viên.
 */
export async function GET() {
  const user = await requireTeacher();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (rateLimited(`selftest:${user.id}`, 6, 600_000)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  const sb = supabaseAdmin();

  const run = async (key: string, fn: () => Promise<Omit<Check, "key">>): Promise<Check> => {
    try {
      return { key, ...(await timed(fn(), 20_000)) };
    } catch (e) {
      return { key, status: "fail", detail: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
    }
  };

  const checks = await Promise.all([
    run("db", async () => {
      const { count, error } = await sb.from("quizzes").select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return { status: "ok", detail: `${count ?? 0} quizzes` };
    }),
    run("schema", async () => {
      const probes: [string, string][] = [
        ["quizzes", "id, part_titles, class_id, allow_retry_wrong, retry_max"],
        ["questions", "id, kind, image"],
        ["attempts", "id, away_count, away_seconds, roster_id, retry_round, retry_locked, retry_prev"],
        ["classes", "id, name, students"],
        ["error_logs", "id"],
        ["app_state", "key"],
      ];
      const missing: string[] = [];
      for (const [table, cols] of probes) {
        const { error } = await sb.from(table).select(cols).limit(1);
        if (error) missing.push(`${table}: ${error.message}`);
      }
      const { error: rpcErr } = await sb.rpc("retry_wrong_swap", { p_old: "00000000-0000-0000-0000-000000000000", p_locked: {}, p_prev: {} });
      if (rpcErr) missing.push(`retry_wrong_swap: ${rpcErr.message}`);
      const { error: usageErr } = await sb.rpc("db_usage");
      if (usageErr) missing.push(`db_usage: ${usageErr.message}`);
      return missing.length ? { status: "fail", detail: missing.join(" | ") } : { status: "ok", detail: "all tables, columns and functions present" };
    }),
    run("storage", async () => {
      await ensureBucket();
      const url = await storeImage(user.id, TINY_PNG);
      const r = await fetch(url, { cache: "no-store" });
      const type = r.headers.get("content-type") ?? "";
      await sb.storage.from(IMAGE_BUCKET).remove([storedPath(url)!]);
      if (!r.ok || !type.startsWith("image/")) return { status: "fail", detail: `uploaded but public read failed: HTTP ${r.status} ${type}` };
      const u = await storageUsage().catch(() => null);
      return { status: "ok", detail: `upload + public read + delete OK${u ? ` · ${u.count} files, ${(u.bytes / 1048576).toFixed(1)} MB` : ""}` };
    }),
    run("auth_admin", async () => {
      const { data, error } = await sb.auth.admin.getUserById(user.id);
      if (error || !data?.user) throw new Error(error?.message ?? "no user");
      return { status: "ok", detail: "service role can read accounts" };
    }),
    run("email", async () => {
      const ok = !!(process.env.SMTP_HOST || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD));
      const to = process.env.ALERT_EMAIL || process.env.GMAIL_USER || "";
      return ok ? { status: "ok", detail: `configured · alerts → ${to.replace(/^(.).*(@.*)$/, "$1***$2")}` } : { status: "warn", detail: "GMAIL_USER / GMAIL_APP_PASSWORD not set — backup & error emails are off" };
    }),
    run("gemini", async () => {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return { status: "fail", detail: "GEMINI_API_KEY not set — cannot read PDFs" };
      const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
      // Chỉ liệt kê model (không tạo nội dung) → không tốn lượt miễn phí
      const r = await fetch(`${base}/v1beta/models?pageSize=1`, { headers: { "x-goog-api-key": key }, cache: "no-store" });
      if (r.status === 400 || r.status === 401 || r.status === 403) return { status: "fail", detail: `API key rejected (HTTP ${r.status})` };
      if (!r.ok) return { status: "warn", detail: `Google API answered HTTP ${r.status}` };
      return { status: "ok", detail: "API key valid" };
    }),
    run("cron", async () => {
      if (!process.env.CRON_SECRET) return { status: "warn", detail: "CRON_SECRET not set" };
      const { data } = await sb.from("app_state").select("value, updated_at").eq("key", "last_cron").maybeSingle();
      if (!data) return { status: "warn", detail: "no run recorded yet (runs every morning ~08:00)" };
      const hours = (Date.now() - Date.parse(data.updated_at as string)) / 3600_000;
      return { status: hours <= 30 ? "ok" : "warn", detail: `last run ${hours.toFixed(1)} h ago` };
    }),
    run("images", async () => {
      const { count } = await sb.from("questions").select("id", { count: "exact", head: true }).like("image", "data:%");
      return count ? { status: "warn", detail: `${count} image(s) still inside the database` } : { status: "ok", detail: "all images in file storage" };
    }),
  ]);

  return NextResponse.json({ version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev", at: new Date().toISOString(), checks });
}
