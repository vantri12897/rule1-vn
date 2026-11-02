import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { AccountBadge } from "@/components/AccountBadge";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");
  return (
    <div className="bg-dots min-h-screen print:bg-white">
      <header className="sticky top-0 z-30 border-b border-primary-line bg-white/95 backdrop-blur print:hidden">
        <div className="stripe h-1" />
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <AccountBadge email={data.user.email ?? ""} />
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6 print:max-w-none print:p-0">{children}</div>
    </div>
  );
}
