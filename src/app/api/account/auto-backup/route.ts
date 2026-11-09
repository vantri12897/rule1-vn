import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mailEnabled } from "@/lib/mailer";
import { emailBackup } from "@/lib/server-backup";
import { logError } from "@/lib/errlog";
import { langOf, translate, type Vars } from "@/lib/i18n/core";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function row(id: string) {
  const { data } = await supabaseAdmin().from("teacher_backups").select("*").eq("owner_id", id).maybeSingle();
  return data;
}

/** Trạng thái sao lưu tự động của giáo viên */
export async function GET(req: Request) {
  const user = await requireTeacher();
  if (!user) return NextResponse.json({ error: translate(langOf(req), "Chưa đăng nhập") }, { status: 401 });
  const r = await row(user.id);
  // nhớ ngôn ngữ giáo viên đang dùng để email hằng tuần viết đúng ngôn ngữ
  const lang = langOf(req);
  if (r?.lang !== lang) await supabaseAdmin().from("teacher_backups").upsert({ owner_id: user.id, lang, enabled: r?.enabled ?? true });
  return NextResponse.json({ mail: mailEnabled(), enabled: r?.enabled ?? true, last_sent_at: r?.last_sent_at ?? null, last_info: r?.last_info ?? null, email: user.email });
}

/** Bật / tắt */
export async function PATCH(req: Request) {
  const user = await requireTeacher();
  if (!user) return NextResponse.json({ error: translate(langOf(req), "Chưa đăng nhập") }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  await supabaseAdmin().from("teacher_backups").upsert({ owner_id: user.id, enabled: !!body.enabled, lang: langOf(req) });
  return NextResponse.json({ ok: true });
}

/** Gửi ngay 1 bản sao lưu vào email (để thử) */
export async function POST(req: Request) {
  const T = (k: string, v?: Vars) => translate(langOf(req), k, v);
  const user = await requireTeacher();
  if (!user?.email) return NextResponse.json({ error: T("Chưa đăng nhập") }, { status: 401 });
  if (!mailEnabled()) return NextResponse.json({ error: T("Website chưa được cài đặt gửi email. Hãy dùng mã khôi phục.") }, { status: 400 });
  const r = await row(user.id);
  if (r?.last_sent_at && Date.now() - new Date(r.last_sent_at).getTime() < 5 * 60_000) {
    return NextResponse.json({ error: T("Vừa gửi xong, đợi 5 phút rồi thử lại.") }, { status: 429 });
  }
  try {
    const info = await emailBackup(user.id, user.email, langOf(req));
    const now = new Date().toISOString();
    await supabaseAdmin().from("teacher_backups").upsert({ owner_id: user.id, last_sent_at: now, last_info: info, lang: langOf(req), enabled: r?.enabled ?? true });
    return NextResponse.json({ ok: true, last_sent_at: now, last_info: info, email: user.email });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logError({ source: "server", kind: "backup-failed", message: msg });
    return NextResponse.json({ error: T("Không gửi được email") + `: ${msg}` }, { status: 500 });
  }
}
