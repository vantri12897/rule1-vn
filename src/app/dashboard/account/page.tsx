"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { downloadBackup, restoreBackup } from "@/lib/backup";
import { fmtDate } from "@/lib/ui";

export default function AccountPage() {
  const [email, setEmail] = useState("");
  useEffect(() => {
    supabaseBrowser().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/dashboard" className="text-sm text-primary-dark hover:underline">← Về danh sách đề</Link>
      <h1 className="text-2xl font-bold">Tài khoản & sao lưu</h1>
      <p className="text-sm text-muted">Đăng nhập: <b className="text-ink">{email}</b></p>
      <RecoveryCard email={email} />
      <BackupCard />
      <PasswordCard />
    </div>
  );
}

function RecoveryCard({ email }: { email: string }) {
  const [status, setStatus] = useState<{ exists: boolean; created_at: string | null } | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => fetch("/api/account/recovery-code", { cache: "no-store" }).then((r) => r.json()).then(setStatus).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (status?.exists && !confirm("Tạo mã mới sẽ làm mã cũ hết hiệu lực. Tiếp tục?")) return;
    setBusy(true);
    const r = await fetch("/api/account/recovery-code", { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return alert(d.error || "Không tạo được mã");
    setCode(d.code);
    load();
  }

  function downloadTxt() {
    if (!code) return;
    const text = `YD-English — MÃ KHÔI PHỤC MẬT KHẨU\n\nEmail: ${email}\nMã: ${code}\nTạo lúc: ${fmtDate(new Date().toISOString())}\nTrang dùng mã: ${window.location.origin}/forgot-password\n\nGiữ file này ở nơi an toàn. Mã chỉ dùng được 1 lần.\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = "YD-English-ma-khoi-phuc.txt";
    a.click();
  }

  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">🔑 Mã khôi phục mật khẩu</h2>
      <p className="mt-1 text-sm text-muted">
        Nếu quên mật khẩu, bạn dùng mã này ở trang <b>Quên mật khẩu</b> để đặt mật khẩu mới — không cần email. Mã chỉ hiện <b>một lần</b> và dùng được <b>một lần</b>.
      </p>
      {status && (
        <p className={`mt-3 rounded-xl p-3 text-sm ${status.exists ? "bg-primary-soft text-primary-dark" : "bg-orange-50 text-warn"}`}>
          {status.exists ? `✓ Đã có mã khôi phục (tạo ${fmtDate(status.created_at)}).` : "⚠️ Bạn chưa có mã khôi phục. Hãy tạo ngay để không bị mất quyền vào website."}
        </p>
      )}
      {code && (
        <div className="mt-3 rounded-xl border-2 border-dashed border-primary bg-primary-soft p-4 text-center">
          <div className="text-xs font-semibold uppercase text-muted">Mã của bạn — hãy lưu lại ngay</div>
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
              {copied ? "✓ Đã copy" : "Copy"}
            </button>
            <button className="btn-outline" onClick={downloadTxt}>Tải file .txt</button>
          </div>
          <p className="mt-2 text-xs text-muted">Sau khi rời trang này, mã sẽ không hiện lại nữa.</p>
        </div>
      )}
      <button className="btn-primary mt-4" disabled={busy} onClick={create}>
        {busy ? "Đang tạo…" : status?.exists ? "Tạo mã mới" : "Tạo mã khôi phục"}
      </button>
    </section>
  );
}

function BackupCard() {
  const [busy, setBusy] = useState<"down" | "up" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setLast(localStorage.getItem("yd-last-backup")), []);

  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">💾 Sao lưu dữ liệu</h2>
      <p className="mt-1 text-sm text-muted">
        Tải toàn bộ đề, đáp án, hình ảnh và kết quả học viên về máy thành 1 file. Nên sao lưu mỗi tuần và trước khi xoá đề.
      </p>
      <p className="mt-2 text-sm">Lần sao lưu gần nhất trên máy này: <b>{last ? fmtDate(last) : "chưa có"}</b></p>
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
              setMsg({ ok: true, text: `Đã tải file sao lưu: ${r.quizzes} đề, ${r.questions} câu hỏi, ${r.attempts} bài làm.` });
            } catch (e) {
              setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
            }
            setBusy(null);
          }}
        >
          {busy === "down" ? "Đang tạo file…" : "⬇️ Tải file sao lưu"}
        </button>
        <button className="btn-outline" disabled={!!busy} onClick={() => fileRef.current?.click()}>
          {busy === "up" ? "Đang khôi phục…" : "⬆️ Khôi phục từ file"}
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
            if (!confirm("Khôi phục sẽ thêm lại các đề có trong file mà hiện không còn trên website (đề đang có giữ nguyên). Tiếp tục?")) return;
            setBusy("up");
            setMsg(null);
            try {
              const r = await restoreBackup(f);
              setMsg({ ok: true, text: r.restored ? `Đã khôi phục ${r.restored} đề (bỏ qua ${r.skipped} đề đang có).` : "Không có đề nào cần khôi phục — mọi đề trong file đều đang có trên website." });
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
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">🔒 Đổi mật khẩu</h2>
      <form
        className="mt-3 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw !== pw2) return setMsg({ ok: false, text: "Hai lần nhập không khớp." });
          setBusy(true);
          const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
          setBusy(false);
          if (error) setMsg({ ok: false, text: /should be|at least/i.test(error.message) ? "Mật khẩu cần ít nhất 6 ký tự." : error.message });
          else {
            setMsg({ ok: true, text: "Đã đổi mật khẩu." });
            setPw("");
            setPw2("");
          }
        }}
      >
        <input className="input" type="password" placeholder="Mật khẩu mới" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <input className="input" type="password" placeholder="Nhập lại mật khẩu mới" minLength={6} required value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        {msg && <p className={`rounded-xl p-3 text-sm ${msg.ok ? "bg-primary-soft text-primary-dark" : "bg-red-50 text-danger"}`}>{msg.text}</p>}
        <button className="btn-outline" disabled={busy}>{busy ? "Đang lưu…" : "Đổi mật khẩu"}</button>
      </form>
    </section>
  );
}
