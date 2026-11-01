"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">(params.get("mode") === "signup" ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "info"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = supabaseBrowser();
    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/dashboard");
        router.refresh();
      } else {
        const r = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-signup-code": code },
          body: JSON.stringify({ email, password }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (d.needCode) setNeedCode(true);
          throw new Error(d.error || "Không tạo được tài khoản");
        }
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/dashboard");
        router.refresh();
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      const vi = /Invalid login/i.test(m)
        ? "Sai email hoặc mật khẩu."
        : /already registered/i.test(m)
          ? "Email này đã có tài khoản. Hãy đăng nhập."
          : /Password should be/i.test(m)
            ? "Mật khẩu cần ít nhất 6 ký tự."
            : /Email not confirmed/i.test(m)
              ? "Email chưa được xác nhận. Kiểm tra hộp thư của bạn."
              : m;
      setMsg({ type: "error", text: vi });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-primary-soft px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <h1 className="mb-4 text-center text-xl font-bold">{mode === "login" ? "Đăng nhập giáo viên" : "Tạo tài khoản giáo viên"}</h1>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div>
            <label className="label">Mật khẩu</label>
            <input className="input" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </div>
          {mode === "signup" && needCode && (
            <div>
              <label className="label">Mã đăng ký giáo viên</label>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
          )}
          {msg && (
            <p className={`rounded-lg p-2 text-sm ${msg.type === "error" ? "bg-red-50 text-danger" : "bg-primary-soft text-primary-dark"}`}>{msg.text}</p>
          )}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Đăng ký"}</button>
        </form>
        <button className="mt-4 w-full text-center text-sm text-primary-dark hover:underline" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMsg(null); }}>
          {mode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
