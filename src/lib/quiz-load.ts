"use client";
import { supabaseBrowser } from "./supabase/client";
import { prefetchOnce } from "./cache";
import type { Quiz, QuestionRow } from "./types";

export type QuizDetail = { quiz: Quiz | null; questions: QuestionRow[]; submitted: number };

/** Dữ liệu trang chi tiết đề: đề + câu hỏi + số bài đã nộp (3 truy vấn chạy song song) */
export async function fetchQuizDetail(id: string): Promise<QuizDetail> {
  const sb = supabaseBrowser();
  const [{ data: q }, { data: qs }, { count }] = await Promise.all([
    sb.from("quizzes").select("*").eq("id", id).maybeSingle(),
    sb.from("questions").select("*").eq("quiz_id", id).order("position"),
    sb.from("attempts").select("id", { count: "exact", head: true }).eq("quiz_id", id).eq("status", "submitted"),
  ]);
  return { quiz: (q as Quiz) ?? null, questions: (qs as QuestionRow[]) ?? [], submitted: count ?? 0 };
}

/** Tải trước khi giáo viên rê chuột / chạm vào thẻ đề → bấm vào là hiện ngay */
export const prefetchQuizDetail = (id: string) => prefetchOnce(`quiz:${id}`, () => fetchQuizDetail(id)).catch(() => undefined);
