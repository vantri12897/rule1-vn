"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";

type Mode = "email" | "recovery";

export default function ForgotPassword() {
  const [mailOn, setMailOn] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("email");
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | "email" | "recovery">(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    fetch("/api/auth/mail-status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setMailOn(!!d.enabled);
        if (!d.enabled) setMode("recovery");
      })
      .catch(() => {
        setMailOn(false);
        setMode("recovery");
      });
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    setInfo(null);
    const r = await fetch("/api/auth/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      if (d.noMail) {
        setMailOn(false);
        setMode("recovery");
      }
      return setErr(d.error || "Không gửi được mã.");
    }
    setInfo(d.message);
    setStep(2);
    setCooldown(60);
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setErr("Hai lần nhập mật khẩu mới không khớp.");
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, password: pw }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setDone(d.via === "recovery" ? "recovery" : "email");
    else setErr(d.error || "Không đặt lại được mật khẩu.");
  }

  const switchMode = (m: Mode) => {
    setMode(m);
    setStep(1);
    setCode("");
    setErr(null);
    setInfo(null);
  };

  const pwFields = (
    <>
      <div>
        <label htmlFor="fp-pw" className="label">Mật khẩu mới</label>
        <input id="fp-pw" className="input" type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </div>
      <div>
        <label htmlFor="fp-pw2" className="label">Nhập lại mật khẩu mới</label>
        <input id="fp-pw2" className="input" type="password" required minLength={6} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
      </div>
    </>
  );

  return (
    <main className="bg-hero grid min-h-screen place-items-center px-4 py-8">
      <div className="card w-full max-w-sm overflow-hidden p-6 pt-0 shadow-lg">
        <div className="stripe -mx-6 mb-6 h-1.5" />
        <div className="mb-6 flex justify-center"><Logo /></div>
        <h1 className="text-center text-xl font-bold">Quên mật khẩu</h1>

        {done ? (
          <div className="mt-4 space-y-4">
            <p className="rounded-lg bg-primary-soft p-3 text-sm text-primary-dark">
              ✓ Đã đặt lại mật khẩu.
              {done === "recovery" && " Mã khôi phục cũ đã hết hiệu lực — sau khi đăng nhập, hãy vào Tài khoản tạo mã mới."}
            </p>
            <Link href="/login" className="btn-primary w-full">Đăng nhập</Link>
          </div>
        ) : (
          <>
            {mailOn && (
              <div className="mt-4 grid grid-cols-2 rounded-xl border border-gray-200 bg-white p-1 text-sm">
                <button className={`rounded-lg py-2 font-semibold ${mode === "email" ? "bg-primary text-white" : ""}`} onClick={() => switchMode("email")}>
                  Gửi mã qua email
                </button>
                <button className={`rounded-lg py-2 font-semibold ${mode === "recovery" ? "bg-primary text-white" : ""}`} onClick={() => switchMode("recovery")}>
                  Mã khôi phục
                </button>
              </div>
            )}

            {mode === "email" && mailOn ? (
              step === 1 ? (
                <form onSubmit={sendCode} className="mt-4 space-y-3">
                  <p className="text-sm text-muted">Nhập email đăng nhập, website sẽ gửi cho bạn mã 6 số (hiệu lực 15 phút).</p>
                  <div>
                    <label htmlFor="fp-email" className="label">Email</label>
                    <input id="fp-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                  </div>
                  {err && <p className="rounded-lg bg-red-50 p-2 text-sm text-danger">{err}</p>}
                  <button className="btn-primary w-full" disabled={busy}>{busy ? "Đang gửi…" : "Gửi mã"}</button>
                </form>
              ) : (
                <form onSubmit={reset} className="mt-4 space-y-3">
                  {info && <p className="rounded-lg bg-primary-soft p-3 text-sm text-primary-dark">{info}</p>}
                  <div>
                    <label htmlFor="fp-code" className="label">Mã 6 số trong email</label>
                    <input
                      id="fp-code"
                      className="input text-center font-mono text-2xl tracking-[0.4em]"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="••••••"
                    />
                  </div>
                  {pwFields}
                  {err && <p className="rounded-lg bg-red-50 p-2 text-sm text-danger">{err}</p>}
                  <button className="btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? "Đang xử lý…" : "Đặt lại mật khẩu"}</button>
                  <div className="flex justify-between text-sm">
                    <button type="button" className="text-primary-dark hover:underline" onClick={() => switchMode("email")}>← Đổi email</button>
                    <button type="button" className="text-primary-dark hover:underline disabled:text-muted disabled:no-underline" disabled={cooldown > 0 || busy} onClick={() => sendCode()}>
                      {cooldown > 0 ? `Gửi lại sau ${cooldown}s` : "Gửi lại mã"}
                    </button>
                  </div>
                </form>
              )
            ) : (
              <form onSubmit={reset} className="mt-4 space-y-3">
                <p className="text-sm text-muted">Dùng <b>mã khôi phục</b> bạn đã tạo và lưu trong trang Tài khoản.</p>
                <div>
                  <label htmlFor="fp-email2" className="label">Email</label>
                  <input id="fp-email2" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                </div>
                <div>
                  <label htmlFor="fp-rc" className="label">Mã khôi phục</label>
                  <input id="fp-rc" className="input font-mono uppercase" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH-JKLM-NPQR" autoComplete="off" />
                </div>
                {pwFields}
                {err && <p className="rounded-lg bg-red-50 p-2 text-sm text-danger">{err}</p>}
                <button className="btn-primary w-full" disabled={busy}>{busy ? "Đang xử lý…" : "Đặt lại mật khẩu"}</button>
              </form>
            )}
          </>
        )}
        <Link href="/login" className="mt-4 block text-center text-sm text-primary-dark hover:underline">← Quay lại đăng nhập</Link>
      </div>
    </main>
  );
}
