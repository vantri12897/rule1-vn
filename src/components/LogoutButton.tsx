"use client";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";
import { cacheClear } from "@/lib/cache";

export function LogoutButton() {
  const { t } = useT();
  const router = useRouter();
  return (
    <button
      className="btn-ghost px-3 py-2"
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        cacheClear();
        try {
          sessionStorage.removeItem("yd-rc-ok");
        } catch {}
        router.replace("/login");
        router.refresh();
      }}
    >
      {t("Đăng xuất")}
    </button>
  );
}
