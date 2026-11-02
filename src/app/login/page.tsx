"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useT } from "@/lib/i18n/client";

function LoginForm() {
  const { t } = useT();
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
          throw new Error(d.error || t("Không tạo được tài khoản"));
        }
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/dashboard");
        router.refresh();
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      const vi = /Invalid login/i.test(m)
        ? t("Sai email hoặc mật khẩu.")
        : /already registered/i.test(m)
          ? t("Email này đã có tài khoản. Hãy đăng nhập.")
          : /Password should be/i.test(m)
            ? t("Mật khẩu cần ít nhất 6 ký tự.")
            : /Email not confirmed/i.test(m)
              ? t("Email chưa được xác nhận. Kiểm tra hộp thư của bạn.")
              : m;
      setMsg({ type: "error", text: vi });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="bg-hero grid min-h-screen place-items-center px-4">
      <div className="fixed right-4 top-4 z-40">
        <LanguageSwitcher />
      </div>
      <div className="card w-full max-w-sm overflow-hidden p-6 pt-0 shadow-lg">
        <div className="stripe -mx-6 mb-6 h-1.5" />
        <div className="mb-6 flex justify-center"><Logo /></div>
        <h1 className="mb-4 text-center text-xl font-bold">{mode === "login" ? t("Đăng nhập giáo viên") : t("Tạo tài khoản giáo viên")}</h1>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="f404" className="label">Email</label>
            <input id="f404" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div>
            <label htmlFor="f81253" className="label">{t("Mật khẩu")}</label>
            <input id="f81253" className="input" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </div>
          {mode === "signup" && needCode && (
            <div>
              <label htmlFor="f92651" className="label">{t("Mã đăng ký giáo viên")}</label>
              <input id="f92651" className="input" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
          )}
          {msg && (
            <p className={`rounded-lg p-2 text-sm ${msg.type === "error" ? "bg-red-50 text-danger" : "bg-primary-soft text-primary-dark"}`}>{msg.text}</p>
          )}
          {mode === "login" && (
            <div className="text-right">
              <a href="/forgot-password" className="text-sm text-primary-dark hover:underline">{t("Quên mật khẩu?")}</a>
            </div>
          )}
          <button className="btn-primary w-full" disabled={busy}>{busy ? t("Đang xử lý…") : mode === "login" ? t("Đăng nhập") : t("Đăng ký")}</button>
        </form>
        <button className="mt-4 w-full text-center text-sm text-primary-dark hover:underline" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMsg(null); }}>
          {mode === "login" ? t("Chưa có tài khoản? Đăng ký") : t("Đã có tài khoản? Đăng nhập")}
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
