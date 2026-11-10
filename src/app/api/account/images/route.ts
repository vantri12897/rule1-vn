import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/api-auth";
import { compactQuestions, migrateImages } from "@/lib/image-store";
import { rateLimited } from "@/lib/public-quiz";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Chuyển hình của giáo viên (còn nằm trong cơ sở dữ liệu) sang kho file, từng đợt ~40 giây.
 * Trang Tài khoản gọi lặp lại tới khi còn 0 hình. Xong hết thì thu gọn bảng câu hỏi để giải phóng dung lượng.
 */
export async function POST() {
  const user = await requireTeacher();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (rateLimited(`imgmig:${user.id}`, 30, 600_000)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  try {
    const r = await migrateImages({ ownerId: user.id, budgetMs: 40_000 });
    const compacted = r.moved > 0 && r.remaining === 0 ? await compactQuestions() : false;
    return NextResponse.json({ ...r, compacted });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
