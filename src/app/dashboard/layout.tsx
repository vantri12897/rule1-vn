import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { VersionTag } from "@/components/VersionTag";
import { supabaseServer } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { AccountBadge } from "@/components/AccountBadge";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AppearanceButtons } from "@/components/AppearanceButtons";
import { profileFromMeta, type TeacherProfile } from "@/lib/profile";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Middleware đã xác thực và chuyển email xuống → không gọi Supabase thêm lần nữa
  const h = await headers();
  const fromMw = h.get("x-yd-user-email");
  let email: string;
  let profile: TeacherProfile = { name: null, avatar: null };
  if (fromMw != null) {
    email = decodeURIComponent(fromMw);
    try {
      profile = profileFromMeta(JSON.parse(decodeURIComponent(h.get("x-yd-user-profile") ?? "")));
    } catch {}
  } else {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getClaims();
    if (!data?.claims?.sub) redirect("/login");
    email = (data.claims.email as string | undefined) ?? "";
    profile = profileFromMeta(data.claims.user_metadata);
  }
  return (
    <div className="bg-dots min-h-screen print:bg-white">
      <header className="sticky top-0 z-30 border-b border-primary-line bg-white/95 backdrop-blur print:hidden">
        <div className="stripe h-1" />
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-1.5 sm:gap-2">
            <AppearanceButtons />
            <LanguageSwitcher />
            <AccountBadge email={email} profile={profile} />
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6 print:max-w-none print:p-0">{children}</div>
      <footer className="pb-6 text-center text-[calc(0.6875rem*var(--fs,1))] text-muted/80 print:hidden">
        YD-English · <VersionTag />
      </footer>
    </div>
  );
}
