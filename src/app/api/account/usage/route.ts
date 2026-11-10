import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/api-auth";
import { STORAGE_LIMIT, dbUsage } from "@/lib/db-usage";
import { countDataImages, storageUsage } from "@/lib/image-store";
import { langOf, translate } from "@/lib/i18n/core";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireTeacher();
  if (!user) return NextResponse.json({ error: translate(langOf(req), "Chưa đăng nhập") }, { status: 401 });
  const [u, st, mine] = await Promise.all([
    dbUsage(),
    storageUsage().catch(() => null),
    countDataImages(user.id).catch(() => 0),
  ]);
  if (!u) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json({ ...u, storage: st ? { ...st, limit: STORAGE_LIMIT } : null, my_db_images: mine });
}
