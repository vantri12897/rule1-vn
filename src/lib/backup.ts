"use client";
import { customAlphabet } from "nanoid";
import { supabaseBrowser } from "./supabase/client";
import { tc } from "./i18n/client";
import { isStoredUrl } from "./images";
import { uploadQuestionImages, urlToDataUrl } from "./image-upload";

const slugId = customAlphabet("23456789abcdefghijkmnpqrstuvwxyz", 10);

type Row = Record<string, unknown>;
export type BackupFile = {
  app: "YD-English";
  version: 1;
  exported_at: string;
  quizzes: Row[];
  questions: Row[];
  attempts: Row[];
};

async function fetchAll(table: string): Promise<Row[]> {
  const sb = supabaseBrowser();
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").range(from, from + 999);
    if (error) throw new Error(tc("Không đọc được {t}: {e}", { t: table, e: error.message }));
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Tải toàn bộ đề, câu hỏi, bài làm của giáo viên đang đăng nhập về 1 file JSON. */
export async function downloadBackup(): Promise<{ quizzes: number; questions: number; attempts: number }> {
  const [quizzes, rawQuestions, attempts] = await Promise.all([fetchAll("quizzes"), fetchAll("questions"), fetchAll("attempts")]);
  // Hình nằm ở kho file → tải về gộp vào file sao lưu, để file tự đủ (khôi phục được cả khi kho file mất)
  const questions = await Promise.all(
    rawQuestions.map(async (q) => (isStoredUrl(q.image as string) ? { ...q, image: (await urlToDataUrl(q.image as string)) ?? q.image } : q))
  );
  const data: BackupFile = { app: "YD-English", version: 1, exported_at: new Date().toISOString(), quizzes, questions, attempts };
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const name = `YD-English-saoluu-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  localStorage.setItem("yd-last-backup", d.toISOString());
  return { quizzes: quizzes.length, questions: questions.length, attempts: attempts.length };
}

async function upsertBatches(table: string, rows: Row[]) {
  const sb = supabaseBrowser();
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 300), { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(tc("Lỗi khôi phục {t}: {e}", { t: table, e: error.message }));
  }
}

/**
 * Khôi phục từ file sao lưu. Chỉ THÊM những gì đang thiếu (đề đã bị xoá),
 * không ghi đè đề đang có. Đề được khôi phục giữ nguyên link cũ (nếu link chưa bị dùng).
 */
export async function restoreBackup(file: File): Promise<{ restored: number; skipped: number }> {
  let data: BackupFile;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error(tc("File không đúng định dạng sao lưu."));
  }
  if (data?.app !== "YD-English" || !Array.isArray(data.quizzes)) throw new Error(tc("Đây không phải file sao lưu của YD-English."));

  const sb = supabaseBrowser();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) throw new Error(tc("Chưa đăng nhập"));
  const { data: existing } = await sb.from("quizzes").select("id");
  const have = new Set((existing ?? []).map((r) => r.id as string));

  const missing = data.quizzes.filter((q) => !have.has(q.id as string));
  const ids = new Set(missing.map((q) => q.id as string));
  for (const q of missing) {
    const row = { ...q, owner_id: u.user.id };
    let { error } = await sb.from("quizzes").insert(row);
    if (error && /slug/i.test(error.message)) {
      ({ error } = await sb.from("quizzes").insert({ ...row, slug: slugId() })); // link cũ đã bị dùng → tạo link mới
    }
    if (error) throw new Error(tc("Không khôi phục được đề “{title}”: {e}", { title: String(q.title), e: error.message }));
  }
  // Hình trong file sao lưu (dạng data URL) → tải lên kho file trước khi lưu câu hỏi
  const { items: qs } = await uploadQuestionImages((data.questions ?? []).filter((r) => ids.has(r.quiz_id as string)) as (Row & { image?: string | null })[]);
  await upsertBatches("questions", qs);
  await upsertBatches("attempts", (data.attempts ?? []).filter((r) => ids.has(r.quiz_id as string)));
  return { restored: missing.length, skipped: data.quizzes.length - missing.length };
}
