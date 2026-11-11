// Chạy các bài kiểm tra tự động TRƯỚC khi cập nhật database và dựng website.
// Có bài kiểm tra hỏng → dừng ngay, Vercel giữ nguyên bản đang chạy (không đưa bản lỗi lên web).
import { spawnSync } from "node:child_process";

const [major, minor] = process.versions.node.split(".").map(Number);
// Node chạy thẳng file .ts từ bản 22.18 (và 23.6+)
const canRunTs = major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
if (!canRunTs) {
  console.log(`[test] Node ${process.versions.node} chưa chạy được file .ts — bỏ qua bài kiểm tra (GitHub Actions vẫn kiểm tra).`);
  process.exit(0);
}
const r = spawnSync(process.execPath, ["--test", "tests/logic.test.ts"], { stdio: "inherit" });
if (r.status !== 0) {
  console.error("[test] ❌ Có bài kiểm tra bị hỏng → dừng cập nhật để không đưa bản lỗi lên web.");
  process.exit(r.status ?? 1);
}
console.log("[test] ✅ Tất cả bài kiểm tra đạt.");
