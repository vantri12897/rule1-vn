import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/** Tên header nội bộ: middleware đã xác thực xong thì chuyển email xuống layout, khỏi gọi Supabase lần 2 */
const USER_HEADER = "x-yd-user-email";

export async function middleware(req: NextRequest) {
  req.headers.delete(USER_HEADER); // không tin header do trình duyệt gửi lên
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    }
  );
  // getClaims: xác thực chữ ký JWT ngay tại máy chủ (không cần gọi Supabase nếu dự án dùng khoá bất đối xứng),
  // tự làm mới phiên khi hết hạn; nếu dự án dùng khoá cũ thì tự chuyển sang hỏi Supabase như trước.
  const { data } = await sb.auth.getClaims();
  const claims = data?.claims;
  const user = claims?.sub ? { email: (claims.email as string | undefined) ?? "" } : null;
  const path = req.nextUrl.pathname;
  if (user && path.startsWith("/dashboard")) {
    req.headers.set(USER_HEADER, encodeURIComponent(user.email));
    const next = NextResponse.next({ request: req });
    res.cookies.getAll().forEach((c) => next.cookies.set(c));
    return next;
  }
  if (!user && path.startsWith("/dashboard")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && (path === "/login" || path === "/")) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = { matcher: ["/", "/login", "/dashboard/:path*"] };
