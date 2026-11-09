import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimited } from "@/lib/public-quiz";
import { hashClient, logError } from "@/lib/errlog";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.string().max(40).regex(/^[a-z-]+$/),
  message: z.string().min(1).max(500),
  detail: z.string().max(4000).optional().nullable(),
  path: z.string().max(300).optional().nullable(),
  slug: z.string().max(40).optional().nullable(),
});

/** Trình duyệt (học viên / giáo viên) gửi lỗi về đây. Không cần đăng nhập, có giới hạn tần suất. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimited(`log:ip:${ip}`, 30)) return new NextResponse(null, { status: 204 });
  const text = await req.text().catch(() => "");
  if (text.length > 6000) return new NextResponse(null, { status: 413 });
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {}
  const p = Body.safeParse(raw);
  if (!p.success) return new NextResponse(null, { status: 400 });
  await logError({
    source: "client",
    kind: p.data.kind === "server-error" ? "js-error" : p.data.kind, // trình duyệt không được tự xưng lỗi máy chủ
    message: p.data.message,
    detail: p.data.detail,
    path: p.data.path,
    quiz_slug: p.data.slug,
    user_agent: req.headers.get("user-agent"),
    client_hash: hashClient(ip),
  });
  return new NextResponse(null, { status: 204 });
}
