import "server-only";
import crypto from "node:crypto";
import { supabaseAdmin } from "./supabase/admin";
import { alertRecipient, esc, mailEnabled, sendMail } from "./mailer";

export type ErrEntry = {
  source: "client" | "server";
  kind: string;
  message: string;
  detail?: string | null;
  path?: string | null;
  quiz_slug?: string | null;
  user_agent?: string | null;
  client_hash?: string | null;
};

/** Lỗi nghiêm trọng (học viên không bắt đầu / không nộp được) → báo ngay, không chờ email tóm tắt hằng ngày */
export const URGENT_KINDS = new Set(["submit-failed", "start-failed", "server-error"]);
const URGENT_GAP_MS = 30 * 60_000; // tối đa 1 email khẩn mỗi 30 phút

export const hashClient = (ip: string) => crypto.createHash("sha256").update(`yd:${ip}`).digest("hex").slice(0, 12);
const cut = (s: unknown, n: number) => (s == null ? null : String(s).slice(0, n));

/** Ghi 1 lỗi vào nhật ký. Không bao giờ ném lỗi ra ngoài (ghi log hỏng không được làm hỏng trang). */
export async function logError(e: ErrEntry) {
  try {
    await supabaseAdmin()
      .from("error_logs")
      .insert({
        source: e.source,
        kind: cut(e.kind, 40) ?? "error",
        message: cut(e.message, 500) ?? "",
        detail: cut(e.detail, 4000),
        path: cut(e.path, 300),
        quiz_slug: cut(e.quiz_slug, 40),
        user_agent: cut(e.user_agent, 300),
        client_hash: cut(e.client_hash, 20),
      });
    if (URGENT_KINDS.has(e.kind)) await urgentAlert(e);
  } catch {
    /* bỏ qua */
  }
}

async function getState<T>(key: string): Promise<T | null> {
  const { data } = await supabaseAdmin().from("app_state").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}
async function setState(key: string, value: unknown) {
  await supabaseAdmin().from("app_state").upsert({ key, value, updated_at: new Date().toISOString() });
}

const KINDS: Record<"vi" | "en", Record<string, string>> = {
  vi: {
    "submit-failed": "Học viên KHÔNG nộp được bài",
    "start-failed": "Học viên KHÔNG bắt đầu làm bài được",
    "server-error": "Lỗi máy chủ",
    "js-error": "Lỗi trên trình duyệt",
    "render-error": "Trang bị lỗi khi hiển thị",
    "load-failed": "Không tải được đề",
    "backup-failed": "Sao lưu tự động lỗi",
  },
  en: {
    "submit-failed": "A student could NOT submit",
    "start-failed": "A student could NOT start the test",
    "server-error": "Server error",
    "js-error": "Browser error",
    "render-error": "Page failed to render",
    "load-failed": "Test failed to load",
    "backup-failed": "Automatic backup failed",
  },
};
const M = {
  vi: {
    detail: "Chi tiết", quiz: "Đề", page: "Trang", test: "đề",
    urgentNote: "Email khẩn được gửi tối đa 1 lần mỗi 30 phút. Các lỗi khác (nếu có) sẽ nằm trong email tóm tắt sáng hôm sau, hoặc xem ở trang <b>Tài khoản &amp; sao lưu</b>.",
    digestSubject: (n: number) => `📋 YD-English: ${n} lỗi trong 24 giờ qua`,
    digestIntro: "Tóm tắt lỗi ghi nhận trên website trong 24 giờ qua (giờ Việt Nam):",
    cols: ["Lỗi", "Số lần", "Gần nhất"], devices: "máy",
    more: (n: number) => `…và ${n} nhóm lỗi khác.`,
    footer: (site: string) => `Xem thêm ở <a href="${site}/dashboard/account" style="color:#15803d">Tài khoản &amp; sao lưu</a>. Có thể chuyển email này cho người hỗ trợ kỹ thuật để sửa.`,
  },
  en: {
    detail: "Details", quiz: "Test", page: "Page", test: "test",
    urgentNote: "Urgent emails are sent at most once every 30 minutes. Other errors (if any) are in the next morning's summary, or on the <b>Account &amp; backup</b> page.",
    digestSubject: (n: number) => `📋 YD-English: ${n} errors in the last 24 hours`,
    digestIntro: "Errors recorded on the website in the last 24 hours (Vietnam time):",
    cols: ["Error", "Count", "Latest"], devices: "devices",
    more: (n: number) => `…and ${n} more error groups.`,
    footer: (site: string) => `More on <a href="${site}/dashboard/account" style="color:#15803d">Account &amp; backup</a>. You can forward this email to whoever helps you with technical issues.`,
  },
};

/** Ngôn ngữ email cảnh báo = ngôn ngữ giáo viên đang dùng trên website (mặc định tiếng Việt) */
async function alertLang(): Promise<"vi" | "en"> {
  const { data } = await supabaseAdmin().from("teacher_backups").select("lang").limit(1).maybeSingle();
  return data?.lang === "en" ? "en" : "vi";
}

async function urgentAlert(e: ErrEntry) {
  const to = alertRecipient();
  if (!to || !mailEnabled()) return;
  const last = await getState<{ at: number }>("last_urgent_alert");
  if (last && Date.now() - last.at < URGENT_GAP_MS) return;
  await setState("last_urgent_alert", { at: Date.now() });
  const lang = await alertLang();
  const T = M[lang];
  const what = KINDS[lang][e.kind] ?? e.kind;
  await sendMail({
    to,
    subject: `🚨 YD-English: ${what}${e.quiz_slug ? ` (${T.test} ${e.quiz_slug})` : ""}`,
    text: `${what}\n${e.message}\n${e.path ?? ""}`,
    html: `<p style="font-size:16px"><b>🚨 ${esc(what)}</b></p>
<p><b>${T.detail}:</b> ${esc(e.message)}</p>
${e.quiz_slug ? `<p><b>${T.quiz}:</b> ${esc(e.quiz_slug)}</p>` : ""}${e.path ? `<p><b>${T.page}:</b> ${esc(e.path)}</p>` : ""}
${e.user_agent ? `<p style="color:#556070;font-size:12px">${esc(e.user_agent)}</p>` : ""}
<p style="color:#556070;font-size:13px">${T.urgentNote}</p>`,
  });
}

/** Email tóm tắt lỗi 24 giờ qua (gọi mỗi ngày bởi cron). Trả về số lỗi đã tóm tắt. */
export async function sendErrorDigest(site: string) {
  const to = alertRecipient();
  if (!to || !mailEnabled()) return 0;
  const last = await getState<{ at: string }>("last_error_digest");
  if (last && Date.now() - new Date(last.at).getTime() < 20 * 3600_000) return 0; // đã gửi hôm nay
  const since = last?.at ?? new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data } = await supabaseAdmin().from("error_logs").select("*").gt("created_at", since).order("created_at", { ascending: false }).limit(2000);
  await setState("last_error_digest", { at: new Date().toISOString() });
  const rows = data ?? [];
  if (!rows.length) return 0;

  const lang = await alertLang();
  const T = M[lang];
  const KIND = KINDS[lang];
  // Gộp lỗi giống nhau (bỏ qua khác biệt về con số, vd. "câu 3" / "câu 7")
  const groups = new Map<string, { kind: string; message: string; n: number; users: Set<string>; last: string; path: string | null; slug: string | null; ua: string | null }>();
  for (const r of rows) {
    const k = `${r.kind}|${String(r.message).replace(/\d+/g, "#")}`;
    const g = groups.get(k) ?? { kind: r.kind, message: r.message, n: 0, users: new Set<string>(), last: r.created_at, path: r.path, slug: r.quiz_slug, ua: r.user_agent };
    g.n++;
    if (r.client_hash) g.users.add(r.client_hash);
    groups.set(k, g);
  }
  const all = [...groups.values()].sort((a, b) => Number(URGENT_KINDS.has(b.kind)) - Number(URGENT_KINDS.has(a.kind)) || b.n - a.n);
  const list = all.slice(0, 25);
  const fmt = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
  const trs = list
    .map(
      (g) => `<tr><td style="padding:8px;border-top:1px solid #e5e7eb;vertical-align:top"><b>${esc(KIND[g.kind] ?? g.kind)}</b><br><span style="color:#374151">${esc(g.message)}</span>
${g.slug || g.path ? `<br><span style="color:#6b7280;font-size:12px">${esc(g.slug ? `${T.test} ${g.slug}` : "")} ${esc(g.path ?? "")}</span>` : ""}</td>
<td style="padding:8px;border-top:1px solid #e5e7eb;text-align:center;vertical-align:top"><b>${g.n}</b><br><span style="font-size:11px;color:#6b7280">${g.users.size || "?"} ${T.devices}</span></td>
<td style="padding:8px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;vertical-align:top">${fmt(g.last)}</td></tr>`
    )
    .join("");
  await sendMail({
    to,
    subject: T.digestSubject(rows.length),
    text: list.map((g) => `${g.n}x ${g.kind}: ${g.message}`).join("\n"),
    html: `<p>${T.digestIntro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border:1px solid #e5e7eb;border-radius:10px">
<tr style="background:#f0fdf4"><th align="left" style="padding:8px">${T.cols[0]}</th><th style="padding:8px">${T.cols[1]}</th><th align="left" style="padding:8px">${T.cols[2]}</th></tr>${trs}</table>
${all.length > list.length ? `<p style="color:#556070;font-size:13px">${T.more(all.length - list.length)}</p>` : ""}
<p style="color:#556070;font-size:13px">${T.footer(site)}</p>`,
  });
  return rows.length;
}

/** Dọn nhật ký cũ hơn 30 ngày */
export async function pruneErrorLogs() {
  await supabaseAdmin().from("error_logs").delete().lt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString());
}
