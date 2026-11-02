"use client";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/Logo";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setMsg({ ok: false, text: "Hai lần nhập mật khẩu mới không khớp." });
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, password: pw }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setMsg({ ok: true, text: "Đã đặt lại mật khẩu. Mã khôi phục cũ đã hết hiệu lực — sau khi đăng nhập, hãy vào Tài khoản tạo mã mới." });
    else setMsg({ ok: false, text: d.error || "Không đặt lại được mật khẩu." });
  }

  return (
    <main className="grid min-h-screen place-items-center bg-primary-soft px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <h1 className="text-center text-xl font-bold">Quên mật khẩu</h1>
        <p className="mb-4 mt-1 text-center text-sm text-muted">Dùng <b>mã khôi phục</b> bạn đã tạo và lưu trong trang Tài khoản.</p>
        {msg?.ok ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-primary-soft p-3 text-sm text-primary-dark">{msg.text}</p>
            <Link href="/login" className="btn-primary w-full">Đăng nhập</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="f19918" className="label">Email</label>
              <input id="f19918" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div>
              <label htmlFor="f2932" className="label">Mã khôi phục</label>
              <input id="f2932" className="input font-mono uppercase" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH-JKLM-NPQR" autoComplete="off" />
            </div>
            <div>
              <label htmlFor="f89171" className="label">Mật khẩu mới</label>
              <input id="f89171" className="input" type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label htmlFor="f48274" className="label">Nhập lại mật khẩu mới</label>
              <input id="f48274" className="input" type="password" required minLength={6} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </div>
            {msg && <p className="rounded-lg bg-red-50 p-2 text-sm text-danger">{msg.text}</p>}
            <button className="btn-primary w-full" disabled={busy}>{busy ? "Đang xử lý…" : "Đặt lại mật khẩu"}</button>
          </form>
        )}
        <Link href="/login" className="mt-4 block text-center text-sm text-primary-dark hover:underline">← Quay lại đăng nhập</Link>
        <p className="mt-4 text-center text-xs text-muted">Chưa từng tạo mã khôi phục? Liên hệ người quản trị kỹ thuật để đặt lại mật khẩu trong Supabase.</p>
      </div>
    </main>
  );
}
