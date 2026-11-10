"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import { supabaseBrowser } from "@/lib/supabase/client";
import { uploadDataUrl } from "@/lib/image-upload";
import { toast } from "@/components/ui/feedback";
import type { TeacherProfile } from "@/lib/profile";

const DEFAULT_NAME = "YD-English";

/** Ảnh vuông 256×256 (cắt giữa, nén JPEG) — ảnh đại diện nhỏ gọn, tải nhanh */
async function squareAvatar(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 256, 256);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  bmp.close?.();
  return c.toDataURL("image/jpeg", 0.86);
}

function Avatar({ profile, email, size }: { profile: TeacherProfile; email: string; size: number }) {
  const letter = (profile.name || email || "Y").trim().slice(0, 1).toUpperCase();
  if (profile.avatar)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={profile.avatar} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover ring-2 ring-white" style={{ width: size, height: size }} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-primary font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {letter}
    </span>
  );
}

/**
 * Góc phải trên cùng: ảnh đại diện + tên hiển thị do giáo viên tự đặt.
 * Bấm vào: đổi ảnh, đổi tên, mở trang Tài khoản & sao lưu.
 */
export function AccountBadge({ email, profile: initial }: { email: string; profile: TeacherProfile }) {
  const { t } = useT();
  const [profile, setProfile] = useState(initial);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.name ?? "");
  const [busy, setBusy] = useState<null | "photo" | "name">(null);
  const box = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  /** Lưu vào tài khoản rồi làm mới phiên đăng nhập để mọi trang thấy ngay */
  async function save(patch: { display_name?: string | null; avatar_url?: string | null }) {
    const sb = supabaseBrowser();
    const { data, error } = await sb.auth.updateUser({ data: patch });
    if (error) throw new Error(error.message);
    await sb.auth.refreshSession().catch(() => {});
    const m = data.user?.user_metadata ?? {};
    setProfile({ name: (m.display_name as string) || null, avatar: (m.avatar_url as string) || null });
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast(t("Hãy chọn một file ảnh"), "error");
    setBusy("photo");
    try {
      const url = await uploadDataUrl(await squareAvatar(file));
      if (!url) throw new Error(t("Không tải ảnh lên được, thử lại."));
      await save({ avatar_url: url });
      toast(t("Đã đổi ảnh đại diện"));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function onName() {
    setBusy("name");
    try {
      const v = name.replace(/\s+/g, " ").trim().slice(0, 40);
      await save({ display_name: v || null });
      toast(t("Đã lưu tên hiển thị"));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const shown = profile.name || DEFAULT_NAME;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("Tài khoản: {email}", { email })}
        className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-semibold text-ink hover:bg-primary-soft focus:bg-primary-soft focus:outline-none sm:px-3"
      >
        <Avatar profile={profile} email={email} size={30} />
        <span className="hidden max-w-[11rem] truncate sm:inline">{shown}</span>
      </button>

      {open && (
        <div role="dialog" aria-label={t("Hồ sơ giáo viên")} className="yd-pop absolute right-0 z-50 mt-1 w-[19rem] max-w-[92vw] overflow-hidden rounded-2xl border border-gray-200 bg-white text-sm shadow-xl">
          <div className="flex items-center gap-3 bg-gradient-to-br from-primary-soft via-white to-sky-soft p-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!!busy}
              className="group relative shrink-0 rounded-full"
              title={t("Đổi ảnh đại diện")}
              aria-label={t("Đổi ảnh đại diện")}
            >
              <Avatar profile={profile} email={email} size={64} />
              <span className="absolute inset-0 grid place-items-center rounded-full bg-black/40 text-lg text-white opacity-0 transition group-hover:opacity-100">📷</span>
              {busy === "photo" && <span className="absolute inset-0 grid place-items-center rounded-full bg-white/70 text-xs font-semibold">…</span>}
            </button>
            <div className="min-w-0">
              <div className="truncate text-base font-bold">{shown}</div>
              <div className="truncate text-xs text-muted">{email}</div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
                <button type="button" className="text-primary-dark hover:underline" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                  📷 {profile.avatar ? t("Đổi ảnh") : t("Chọn ảnh")}
                </button>
                {profile.avatar && (
                  <button
                    type="button"
                    className="text-danger hover:underline"
                    disabled={!!busy}
                    onClick={() => save({ avatar_url: null }).then(() => toast(t("Đã xoá ảnh đại diện")), (e) => toast(String(e.message ?? e), "error"))}
                  >
                    {t("Xoá ảnh")}
                  </button>
                )}
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => (onPhoto(e.target.files?.[0]), (e.target.value = ""))} />
          </div>

          <form
            className="space-y-2 border-t border-gray-100 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              onName();
            }}
          >
            <label htmlFor="disp-name" className="label">
              {t("Tên hiển thị")}
            </label>
            <div className="flex gap-2">
              <input id="disp-name" className="input min-w-0 flex-1 py-2" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder={DEFAULT_NAME} />
              <button className="btn-primary shrink-0 px-4" disabled={!!busy || name.trim() === (profile.name ?? "")}>
                {busy === "name" ? "…" : t("Lưu")}
              </button>
            </div>
            <p className="text-xs text-muted">{t("Tên và ảnh chỉ hiện trên trang giáo viên, học viên không thấy.")}</p>
          </form>

          <Link href="/dashboard/account" onClick={() => setOpen(false)} className="flex items-center justify-between border-t border-gray-100 px-4 py-3 font-semibold text-primary-dark hover:bg-primary-soft">
            ⚙️ {t("Tài khoản & sao lưu")} <span aria-hidden>→</span>
          </Link>
        </div>
      )}
    </div>
  );
}
