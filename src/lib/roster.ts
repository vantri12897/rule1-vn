/**
 * Danh sách lớp: đọc danh sách tên giáo viên dán vào (gõ tay hoặc copy từ Excel),
 * giữ nguyên mã của học viên cũ khi sửa danh sách (để các bài làm cũ vẫn khớp).
 */
export type RosterStudent = { id: string; name: string };

/** Chuẩn hoá để so khớp: bỏ dấu, chữ thường, gộp khoảng trắng ("Nguyễn  Văn Ân" ≈ "nguyen van an") */
export function foldName(s: string | null | undefined) {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Chuẩn hoá nhẹ để nhóm bài làm theo học viên (giữ dấu) */
export function normName(s: string | null | undefined) {
  return (s ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 1 dòng → tên học viên. Dán từ Excel: các cột cách nhau bằng Tab — bỏ cột số thứ tự / ngày sinh / mã số,
 * ghép các cột chữ (vd "Nguyễn Văn" | "An" → "Nguyễn Văn An"). Bỏ số thứ tự đầu dòng "1.", "01 -", "2)".
 */
export function lineToName(line: string) {
  const cells = line.split("\t").map((c) => c.trim()).filter(Boolean);
  const words = (cells.length > 1 ? cells.filter((c) => /\p{L}/u.test(c) && !/\d/.test(c)) : cells).join(" ");
  return words
    .replace(/^\s*\d{1,3}\s*[.)\-–:]?\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-2);

/** Dán danh sách → học viên (giữ mã cũ cho tên trùng với danh sách cũ) + các tên bị trùng nhau */
export function parseRoster(text: string, existing: RosterStudent[] = []) {
  const pool = new Map<string, RosterStudent[]>();
  for (const s of existing) pool.set(foldName(s.name), [...(pool.get(foldName(s.name)) ?? []), s]);
  const students: RosterStudent[] = [];
  const seen = new Map<string, number>();
  for (const raw of text.split(/\r?\n/)) {
    const name = lineToName(raw);
    // bỏ dòng tiêu đề của bảng Excel ("STT | Họ và tên | …")
    if (!name || /^stt\b|\bho( va)? ten\b|^(full )?name$/.test(foldName(name))) continue;
    const key = foldName(name);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const reuse = pool.get(key)?.shift();
    students.push({ id: reuse?.id ?? newId(), name });
    if (students.length >= 500) break;
  }
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => students.find((s) => foldName(s.name) === k)!.name);
  return { students, duplicates };
}
