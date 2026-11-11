"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { downloadBackup, restoreBackup } from "@/lib/backup";
import { fmtDate } from "@/lib/ui";
import { confirmDialog, toast } from "@/components/ui/feedback";
import { useT } from "@/lib/i18n/client";

export default function AccountPage() {
  const { t } = useT();
  const [email, setEmail] = useState("");
  useEffect(() => {
    supabaseBrowser().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/dashboard" prefetch className="text-sm text-primary-dark hover:underline">{t("← Về danh sách đề")}</Link>
      <h1 className="text-2xl font-bold">{t("Tài khoản & sao lưu")}</h1>
      <p className="text-sm text-muted">{t("Đăng nhập:")} <b className="text-ink">{email}</b></p>
      <RecoveryCard email={email} />
      <BackupCard />
      <AutoBackupCard />
      <UsageCard />
      <ErrorsCard />
      <SelfTestCard />
      <PasswordCard />
    </div>
  );
}

function RecoveryCard({ email }: { email: string }) {
  const { t } = useT();
  const [status, setStatus] = useState<{ exists: boolean; created_at: string | null } | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [mailOn, setMailOn] = useState<boolean | null>(null);
  const load = () => fetch("/api/account/recovery-code", { cache: "no-store" }).then((r) => r.json()).then(setStatus).catch(() => {});
  useEffect(() => {
    load();
    fetch("/api/auth/mail-status", { cache: "no-store" }).then((r) => r.json()).then((d) => setMailOn(!!d.enabled)).catch(() => {});
  }, []);

  async function create() {
    if (status?.exists && !(await confirmDialog({ title: t("Tạo mã mới"), message: t("Tạo mã mới sẽ làm mã cũ hết hiệu lực. Tiếp tục?"), confirmText: t("Tạo mã mới") }))) return;
    setBusy(true);
    const r = await fetch("/api/account/recovery-code", { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(d.error || t("Không tạo được mã"), "error");
    setCode(d.code);
    load();
  }

  function downloadTxt() {
    if (!code) return;
    const text = t("YD-English — MÃ KHÔI PHỤC MẬT KHẨU\n\nEmail: {email}\nMã: {code}\nTạo lúc: {time}\nTrang dùng mã: {url}\n\nGiữ file này ở nơi an toàn. Mã chỉ dùng được 1 lần.\n", { email, code, time: fmtDate(new Date().toISOString()), url: `${window.location.origin}/forgot-password` });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = "YD-English-ma-khoi-phuc.txt";
    a.click();
  }

  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">{t("🔑 Mã khôi phục mật khẩu")}</h2>
      <p className="mt-1 text-sm text-muted">
        {t("Nếu quên mật khẩu, bạn dùng mã này ở trang")} <b>{t("Quên mật khẩu")}</b> {t("để đặt mật khẩu mới — không cần email. Mã chỉ hiện")} <b>{t("một lần")}</b> {t("và dùng được")} <b>{t("một lần")}</b>.
      </p>
      {mailOn !== null && (
        <p className={`mt-3 rounded-xl p-3 text-sm ${mailOn ? "bg-primary-soft text-primary-dark" : "bg-gray-50 text-muted"}`}>
          {mailOn
            ? t("✓ Đã bật đặt lại mật khẩu qua email — quên mật khẩu thì nhận mã 6 số qua Gmail. Mã khôi phục bên dưới dùng làm dự phòng.")
            : t("Chưa bật đặt lại mật khẩu qua email (cần cài GMAIL_USER và GMAIL_APP_PASSWORD trên Vercel). Hiện chỉ dùng được mã khôi phục.")}
        </p>
      )}
      {status && (
        <p className={`mt-3 rounded-xl p-3 text-sm ${status.exists ? "bg-primary-soft text-primary-dark" : "bg-orange-50 text-warn"}`}>
          {status.exists ? t("✓ Đã có mã khôi phục (tạo {d}).", { d: fmtDate(status.created_at) }) : t("⚠️ Bạn chưa có mã khôi phục. Hãy tạo ngay để không bị mất quyền vào website.")}
        </p>
      )}
      {code && (
        <div className="mt-3 rounded-xl border-2 border-dashed border-primary bg-primary-soft p-4 text-center">
          <div className="text-xs font-semibold uppercase text-muted">{t("Mã của bạn — hãy lưu lại ngay")}</div>
          <div className="my-2 select-all font-mono text-2xl font-extrabold tracking-wider text-primary-dark">{code}</div>
          <div className="flex justify-center gap-2">
            <button
              className="btn-outline"
              onClick={() => {
                navigator.clipboard.writeText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? t("✓ Đã copy") : "Copy"}
            </button>
            <button className="btn-outline" onClick={downloadTxt}>{t("Tải file .txt")}</button>
          </div>
          <p className="mt-2 text-xs text-muted">{t("Sau khi rời trang này, mã sẽ không hiện lại nữa.")}</p>
        </div>
      )}
      <button className="btn-primary mt-4" disabled={busy} onClick={create}>
        {busy ? t("Đang tạo…") : status?.exists ? t("Tạo mã mới") : t("Tạo mã khôi phục")}
      </button>
    </section>
  );
}

function BackupCard() {
  const { t } = useT();
  const [busy, setBusy] = useState<"down" | "up" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setLast(localStorage.getItem("yd-last-backup")), []);

  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">{t("💾 Sao lưu dữ liệu")}</h2>
      <p className="mt-1 text-sm text-muted">
        {t("Tải toàn bộ đề, đáp án, hình ảnh và kết quả học viên về máy thành 1 file. Nên sao lưu mỗi tuần và trước khi xoá đề.")}
      </p>
      <p className="mt-2 text-sm">{t("Lần sao lưu gần nhất trên máy này:")} <b>{last ? fmtDate(last) : t("chưa có")}</b></p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="btn-primary"
          disabled={!!busy}
          onClick={async () => {
            setBusy("down");
            setMsg(null);
            try {
              const r = await downloadBackup();
              setLast(new Date().toISOString());
              setMsg({ ok: true, text: t("Đã tải file sao lưu: {a} đề, {b} câu hỏi, {c} bài làm.", { a: r.quizzes, b: r.questions, c: r.attempts }) });
            } catch (e) {
              setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
            }
            setBusy(null);
          }}
        >
          {busy === "down" ? t("Đang tạo file…") : t("⬇️ Tải file sao lưu")}
        </button>
        <button className="btn-outline" disabled={!!busy} onClick={() => fileRef.current?.click()}>
          {busy === "up" ? t("Đang khôi phục…") : t("⬆️ Khôi phục từ file")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (!(await confirmDialog({ title: t("Khôi phục dữ liệu"), message: t("Khôi phục sẽ thêm lại các đề có trong file mà hiện không còn trên website (đề đang có giữ nguyên). Tiếp tục?"), confirmText: t("Khôi phục") }))) return;
            setBusy("up");
            setMsg(null);
            try {
              const r = await restoreBackup(f);
              setMsg({ ok: true, text: r.restored ? t("Đã khôi phục {a} đề (bỏ qua {b} đề đang có).", { a: r.restored, b: r.skipped }) : t("Không có đề nào cần khôi phục — mọi đề trong file đều đang có trên website.") });
            } catch (err) {
              setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
            }
            setBusy(null);
          }}
        />
      </div>
      {msg && <p className={`mt-3 rounded-xl p-3 text-sm ${msg.ok ? "bg-primary-soft text-primary-dark" : "bg-red-50 text-danger"}`}>{msg.text}</p>}
    </section>
  );
}

function PasswordCard() {
  const { t } = useT();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">{t("🔒 Đổi mật khẩu")}</h2>
      <form
        className="mt-3 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw !== pw2) return setMsg({ ok: false, text: t("Hai lần nhập không khớp.") });
          setBusy(true);
          const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
          setBusy(false);
          if (error) setMsg({ ok: false, text: /should be|at least/i.test(error.message) ? t("Mật khẩu cần ít nhất 6 ký tự.") : error.message });
          else {
            setMsg({ ok: true, text: t("Đã đổi mật khẩu.") });
            setPw("");
            setPw2("");
          }
        }}
      >
        <input className="input" type="password" placeholder={t("Mật khẩu mới")} minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <input className="input" type="password" placeholder={t("Nhập lại mật khẩu mới")} minLength={6} required value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        {msg && <p className={`rounded-xl p-3 text-sm ${msg.ok ? "bg-primary-soft text-primary-dark" : "bg-red-50 text-danger"}`}>{msg.text}</p>}
        <button className="btn-outline" disabled={busy}>{busy ? t("Đang lưu…") : t("Đổi mật khẩu")}</button>
      </form>
    </section>
  );
}

type AutoStatus = { mail: boolean; enabled: boolean; last_sent_at: string | null; last_info: string | null; email?: string };

/** Sao lưu tự động: mỗi Chủ nhật gửi file sao lưu vào email của giáo viên */
function AutoBackupCard() {
  const { t } = useT();
  const [st, setSt] = useState<AutoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/account/auto-backup", { cache: "no-store" }).then((r) => r.json()).then(setSt).catch(() => {});
  }, []);
  if (!st) return null;
  const failed = st.last_info?.startsWith("ERROR");
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">{t("📧 Sao lưu tự động qua email")}</h2>
      {!st.mail ? (
        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t("Cần cài GMAIL_USER và GMAIL_APP_PASSWORD trên Vercel thì mới gửi được email.")}</p>
      ) : (
        <>
          <label className="mt-3 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 accent-primary"
              checked={st.enabled}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setSt({ ...st, enabled });
                const r = await fetch("/api/account/auto-backup", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
                if (r.ok) toast(enabled ? t("Đã bật sao lưu tự động") : t("Đã tắt sao lưu tự động"));
              }}
            />
            <span className="text-sm">
              <b>{t("Tự gửi bản sao lưu vào email mỗi Chủ nhật")}</b>
              <span className="block text-muted">{t("Gửi tới {email} khoảng 8 giờ sáng. Tệp đính kèm dùng được ngay với nút Khôi phục từ file.", { email: st.email ?? "" })}</span>
            </span>
          </label>
          <p className={`mt-3 text-sm ${failed ? "text-danger" : ""}`}>
            {t("Lần gửi gần nhất:")} <b>{st.last_sent_at ? fmtDate(st.last_sent_at) : t("chưa có")}</b>
            {st.last_info && <span className="text-muted"> · {failed ? st.last_info : t("{n} (đề/câu hỏi/bài làm)", { n: st.last_info })}</span>}
          </p>
          <button
            className="btn-outline mt-3"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await fetch("/api/account/auto-backup", { method: "POST" });
              const d = await r.json().catch(() => ({}));
              setBusy(false);
              if (!r.ok) return toast(d.error || t("Không gửi được email"), "error");
              setSt({ ...st, last_sent_at: d.last_sent_at, last_info: d.last_info });
              toast(t("Đã gửi bản sao lưu tới {email}", { email: d.email }));
            }}
          >
            {busy ? t("Đang gửi…") : t("📨 Gửi thử ngay")}
          </button>
        </>
      )}
    </section>
  );
}

type ErrItem = { created_at: string; source: string; kind: string; message: string; path: string | null; quiz_slug: string | null };
const KIND_LABEL: Record<string, string> = {
  "submit-failed": "Học viên không nộp được bài",
  "start-failed": "Học viên không bắt đầu được",
  "server-error": "Lỗi máy chủ",
  "js-error": "Lỗi trên trình duyệt",
  "render-error": "Trang lỗi khi hiển thị",
  "load-failed": "Không tải được đề",
  "backup-failed": "Sao lưu tự động lỗi",
  "ai-quota": "AI hết lượt miễn phí trong ngày",
  "ai-error": "AI gặp lỗi",
  "ai-model-gone": "Google đã đổi/ngừng một model AI",
  "db-near-full": "Cơ sở dữ liệu sắp đầy",
};

/** Nhật ký lỗi 7 ngày gần nhất */
type SelfCheck = { key: string; status: "ok" | "warn" | "fail"; detail: string };
const CHECK_LABEL: Record<string, string> = {
  db: "Cơ sở dữ liệu",
  schema: "Bảng & cột của các chức năng mới",
  storage: "Kho hình ảnh (tải lên, đọc, xoá thử)",
  auth_admin: "Quyền quản trị tài khoản (dọn hình, sao lưu)",
  email: "Email (sao lưu, báo lỗi)",
  gemini: "Khoá AI Gemini (đọc PDF)",
  cron: "Tác vụ tự động mỗi sáng",
  images: "Hình còn nằm trong cơ sở dữ liệu",
};

/** 🩺 Kiểm tra hệ thống trên chính website đang chạy (không tốn lượt AI, không đổi dữ liệu) */
function SelfTestCard() {
  const { t } = useT();
  const [res, setRes] = useState<{ version: string; at: string; checks: SelfCheck[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/account/selftest", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setRes(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const bad = res?.checks.filter((c) => c.status !== "ok").length ?? 0;
  const icon = (s: SelfCheck["status"]) => (s === "ok" ? "✅" : s === "warn" ? "⚠️" : "❌");
  const text = res ? [`YD-English ${res.version} · ${fmtDate(res.at)}`, ...res.checks.map((c) => `${icon(c.status)} ${CHECK_LABEL[c.key] ?? c.key}: ${c.detail}`)].join("\n") : "";
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">{t("🩺 Kiểm tra hệ thống")}</h2>
      <p className="mt-1 text-sm text-muted">
        {t("Kiểm tra nhanh các phần bên trong website đang chạy: cơ sở dữ liệu, kho hình, email, khoá AI, tác vụ mỗi sáng. Không tốn lượt AI, không thay đổi dữ liệu của bạn.")}
      </p>
      <button className="btn-primary mt-3" onClick={run} disabled={busy}>
        {busy ? t("Đang kiểm tra…") : res ? t("Kiểm tra lại") : t("Chạy kiểm tra")}
      </button>
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
      {res && (
        <div className="mt-4">
          <p className={`mb-2 font-semibold ${bad ? "text-warn" : "text-primary-dark"}`}>
            {bad ? t("⚠️ {n} mục cần xem", { n: bad }) : t("✅ Tất cả {n} mục đều ổn", { n: res.checks.length })}
          </p>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {res.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2 px-3 py-2 text-sm">
                <span aria-hidden>{icon(c.status)}</span>
                <span className="min-w-0 flex-1">
                  <b>{t(CHECK_LABEL[c.key] ?? c.key)}</b>
                  <span className="block break-words text-xs text-muted">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <button
            className="btn-outline mt-3"
            onClick={() => navigator.clipboard?.writeText(text).then(() => toast(t("Đã copy kết quả")), () => toast(t("Không copy được"), "error"))}
          >
            📋 {t("Copy kết quả (gửi cho người hỗ trợ)")}
          </button>
        </div>
      )}
    </section>
  );
}

function ErrorsCard() {
  const { t } = useT();
  const [d, setD] = useState<{ count: number; items: ErrItem[]; alerts_to: string | null } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    fetch("/api/account/errors", { cache: "no-store" }).then((r) => r.json()).then(setD).catch(() => {});
  }, []);
  if (!d) return null;
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">{t("🚨 Nhật ký lỗi")}</h2>
      <p className="mt-1 text-sm text-muted">
        {d.alerts_to
          ? t("Lỗi nghiêm trọng (học viên không bắt đầu / không nộp được bài) được báo ngay qua email tới {to}. Các lỗi khác được tóm tắt mỗi sáng.", { to: d.alerts_to })
          : t("Cần cài Gmail trên Vercel để nhận email báo lỗi. Nhật ký vẫn được ghi ở đây.")}
      </p>
      {d.count === 0 ? (
        <p className="mt-3 rounded-lg bg-primary-soft p-3 text-sm font-semibold text-primary-dark">{t("✓ Không có lỗi nào trong 7 ngày qua.")}</p>
      ) : (
        <>
          <p className="mt-3 text-sm">
            {t("{n} lỗi trong 7 ngày qua.", { n: d.count })}{" "}
            <button className="font-semibold text-primary-dark underline" onClick={() => setOpen(!open)}>
              {open ? t("Ẩn") : t("Xem chi tiết")}
            </button>
          </p>
          {open && (
            <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto text-sm">
              {d.items.map((e, i) => (
                <li key={i} className="rounded-lg border border-gray-200 p-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span>{fmtDate(e.created_at)}</span>
                    <b className={e.kind.endsWith("-failed") || e.kind === "server-error" ? "text-danger" : "text-ink"}>{t(KIND_LABEL[e.kind] ?? e.kind)}</b>
                    {e.quiz_slug && <span>· {e.quiz_slug}</span>}
                  </div>
                  <div className="mt-0.5 break-words">{e.message}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

type Usage = {
  total: number;
  questions: number;
  images: number;
  image_count: number;
  attempts: number;
  quizzes: number;
  logs: number;
  limit: number;
  storage: { bytes: number; count: number; limit: number } | null;
  my_db_images: number;
};
const mb = (n: number) => (n / 1048576 >= 10 ? (n / 1048576).toFixed(0) : (n / 1048576).toFixed(1));

function Meter({ label, used, limit }: { label: React.ReactNode; used: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100);
  const color = pct >= 85 ? "bg-danger" : pct >= 60 ? "bg-amber-500" : "bg-primary";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>
          {label} <b className="text-lg">{mb(used)} MB</b> / {limit >= 1073741824 ? `${(limit / 1073741824).toFixed(0)} GB` : `${mb(limit)} MB`}
        </span>
        <b className={pct >= 85 ? "text-danger" : pct >= 60 ? "text-amber-600" : "text-primary-dark"}>{pct.toFixed(pct < 10 ? 1 : 0)}%</b>
      </div>
      <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
    </div>
  );
}

/** Dung lượng đã dùng: cơ sở dữ liệu (gói Free 500 MB) + kho hình ảnh (gói Free 1 GB) */
function UsageCard() {
  const { t } = useT();
  const [u, setU] = useState<Usage | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/account/usage", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setU).catch(() => {});
  }, []);
  useEffect(load, [load]);

  /** Chuyển hình của đề cũ sang kho file: gọi lặp từng đợt ~40 giây tới khi xong */
  async function moveImages() {
    let left = u?.my_db_images ?? 0;
    let movedAll = 0;
    setMoving(t("Đang chuyển hình… còn {n}", { n: left }));
    try {
      for (let round = 0; round < 60 && left > 0; round++) {
        const r = await fetch("/api/account/images", { method: "POST" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        movedAll += d.moved;
        left = d.remaining;
        setMoving(t("Đang chuyển hình… còn {n}", { n: left }));
        if (d.moved === 0) break; // các hình còn lại đều lỗi → dừng, để máy chủ tự thử lại sáng mai
      }
      toast(left === 0 ? t("Đã chuyển {n} hình sang kho file", { n: movedAll }) : t("Đã chuyển {a} hình, còn {b} hình chưa chuyển được — website sẽ tự thử lại", { a: movedAll, b: left }), left === 0 ? "success" : "error");
    } catch (e) {
      toast(t("Chuyển hình bị lỗi: ") + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setMoving(null);
      load();
    }
  }

  if (!u) return null;
  const pct = (u.total / u.limit) * 100;
  const rows: [string, number][] = [
    [t("Câu hỏi & đoạn văn"), Math.max(0, u.questions - u.images)],
    [t("Bài làm của học viên"), u.attempts],
    [t("Nhật ký lỗi"), u.logs],
  ];
  if (u.image_count > 0) rows.unshift([t("Hình còn nằm trong cơ sở dữ liệu ({n} hình)", { n: u.image_count }), u.images]);
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">{t("📊 Dung lượng đã dùng")}</h2>
      <div className="mt-3">
        <Meter label={<span className="text-muted">🗄️ {t("Cơ sở dữ liệu:")}</span>} used={u.total} limit={u.limit} />
      </div>
      <ul className="mt-2 space-y-1 text-sm text-muted">
        {rows.map(([k, v]) => (
          <li key={k} className="flex justify-between gap-3">
            <span>{k}</span>
            <span className="tabular-nums">{mb(v)} MB</span>
          </li>
        ))}
      </ul>
      {u.storage && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <Meter label={<span className="text-muted">🖼️ {t("Kho hình ảnh:")}</span>} used={u.storage.bytes} limit={u.storage.limit} />
          <p className="mt-1 text-sm text-muted">{t("{n} hình (hình giống nhau chỉ lưu 1 lần)", { n: u.storage.count })}</p>
        </div>
      )}
      {u.my_db_images > 0 && (
        <div className="mt-4 rounded-xl bg-sky-soft p-3 text-sm">
          <p>{t("Còn {n} hình của đề cũ nằm trong cơ sở dữ liệu. Chuyển sang kho hình để cơ sở dữ liệu nhẹ hơn (website cũng tự chuyển dần mỗi sáng).", { n: u.my_db_images })}</p>
          <button className="btn-primary mt-2" onClick={moveImages} disabled={!!moving}>
            {moving ?? t("📦 Chuyển hình sang kho file ngay")}
          </button>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        {pct >= 80
          ? t("⚠️ Cơ sở dữ liệu sắp đầy. Nên xoá bớt đề/bài làm cũ (sao lưu trước) hoặc nâng gói Supabase.")
          : t("Gói Supabase miễn phí: cơ sở dữ liệu 500 MB, kho hình 1 GB. Khi cơ sở dữ liệu dùng tới 80% website sẽ báo qua email.")}
      </p>
    </section>
  );
}
