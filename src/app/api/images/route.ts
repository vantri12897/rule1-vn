import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/api-auth";
import { storeDataUrl } from "@/lib/image-store";
import { rateLimited } from "@/lib/public-quiz";
import { logError } from "@/lib/errlog";

export const dynamic = "force-dynamic";

/** Giáo viên tải 1 hình (data URL) lên kho file → trả về link để lưu vào câu hỏi */
export async function POST(req: Request) {
  const user = await requireTeacher();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (rateLimited(`img:${user.id}`, 600, 600_000)) return NextResponse.json({ error: "too many images" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { data?: unknown } | null;
  const data = typeof body?.data === "string" ? body.data : "";
  if (!data.startsWith("data:image/") || data.length > 3_000_000) return NextResponse.json({ error: "bad image" }, { status: 400 });
  try {
    return NextResponse.json({ url: await storeDataUrl(user.id, data) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not a JPEG|out of range|base64/.test(msg)) return NextResponse.json({ error: msg }, { status: 400 });
    void logError({ source: "server", kind: "image-upload", message: msg.slice(0, 300) });
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 502 });
  }
}
