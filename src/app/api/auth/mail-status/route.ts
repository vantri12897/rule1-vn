import { NextResponse } from "next/server";
import { mailEnabled } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/** Cho trang Quên mật khẩu biết có gửi mã qua email được không */
export async function GET() {
  return NextResponse.json({ enabled: mailEnabled() });
}
