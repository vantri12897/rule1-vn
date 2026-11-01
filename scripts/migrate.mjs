// Tự tạo bảng trong Supabase khi deploy (chạy trước "next build"). An toàn khi chạy lại nhiều lần.
import fs from "node:fs";
import pg from "pg";

const raw = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!raw) {
  console.log("[migrate] Không có POSTGRES_URL — bỏ qua (hãy chạy supabase/schema.sql thủ công).");
  process.exit(0);
}
const url = new URL(raw);
url.searchParams.delete("sslmode");
url.searchParams.delete("supa");
const sql = fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

for (let attempt = 1; attempt <= 6; attempt++) {
  const client = new pg.Client({ connectionString: url.toString(), ssl: process.env.NO_SSL ? false : { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(sql);
    await client.end();
    console.log("[migrate] Đã cập nhật database YD-English.");
    process.exit(0);
  } catch (e) {
    await client.end().catch(() => {});
    console.log(`[migrate] Lần ${attempt} lỗi: ${e.message}`);
    if (attempt === 6) {
      console.error("[migrate] Không kết nối được database. Kiểm tra tích hợp Supabase rồi Redeploy.");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}
