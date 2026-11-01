"use client";

/** Chỉ hiện "YD-English"; rê chuột (hoặc chạm trên điện thoại) mới hiện email đăng nhập. */
export function AccountBadge({ email }: { email: string }) {
  return (
    <div className="group relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-ink hover:bg-primary-soft focus:bg-primary-soft focus:outline-none"
        aria-label={`Tài khoản: ${email}`}
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-white">
          {email.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden sm:inline">YD-English</span>
      </button>
      <div className="pointer-events-none absolute right-0 top-full z-40 mt-1 whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-muted opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100">
        Đăng nhập: <b className="text-ink">{email}</b>
      </div>
    </div>
  );
}
