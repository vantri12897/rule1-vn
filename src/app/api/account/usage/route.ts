import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/api-auth";
import { dbUsage } from "@/lib/db-usage";
import { langOf, translate } from "@/lib/i18n/core";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireTeacher();
  if (!user) return NextResponse.json({ error: translate(langOf(req), "Chưa đăng nhập") }, { status: 401 });
  const u = await dbUsage();
  if (!u) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json(u);
}
