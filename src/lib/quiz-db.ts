"use client";
import { customAlphabet } from "nanoid";
import { supabaseBrowser } from "./supabase/client";
import type { DraftQuestion, Section } from "./types";
import { tc } from "./i18n/client";
import { uploadQuestionImages } from "./image-upload";

const slugId = customAlphabet("23456789abcdefghijkmnpqrstuvwxyz", 10);

export async function createQuiz(input: {
  title: string;
  sections: Section[];
  questions: DraftQuestion[];
  source_file_hash?: string | null;
  part_titles?: Record<string, string> | null;
  class_id?: string | null;
}): Promise<string> {
  const sb = supabaseBrowser();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) throw new Error(tc("Chưa đăng nhập"));
  const { data: quiz, error } = await sb
    .from("quizzes")
    .insert({
      owner_id: u.user.id,
      title: input.title.trim() || tc("Đề trắc nghiệm"),
      slug: slugId(),
      sections: input.sections,
      part_titles: input.part_titles ?? {},
      class_id: input.class_id ?? null,
      source_file_hash: input.source_file_hash ?? null,
    })
    .select("id")
    .single();
  if (error || !quiz) throw new Error(tc("Không lưu được đề: ") + (error?.message ?? ""));
  if (input.questions.length) {
    // Hình cắt từ PDF → tải lên kho file, câu hỏi chỉ lưu link
    const { items: questions } = await uploadQuestionImages(input.questions);
    const rows = questions.map((q, i) => ({
      quiz_id: quiz.id,
      position: i,
      number: q.number,
      section_index: q.section_index,
      stem: q.stem,
      options: q.options,
      correct_label: q.correct_label,
      answer_source: q.answer_source,
      confidence: q.confidence,
      needs_review: q.needs_review,
      explanation: q.explanation,
      image: q.image ?? null,
      kind: q.kind ?? null,
    }));
    const { error: e2 } = await sb.from("questions").insert(rows);
    if (e2) throw new Error(tc("Không lưu được câu hỏi: ") + e2.message);
  }
  return quiz.id;
}

/** Chấm lại toàn bộ bài đã nộp theo đáp án hiện tại (sau khi giáo viên sửa đáp án). */
export async function regradeQuiz(quizId: string): Promise<number> {
  const { grade } = await import("./grading");
  const sb = supabaseBrowser();
  const [{ data: qs }, { data: atts }] = await Promise.all([
    sb.from("questions").select("id, number, correct_label").eq("quiz_id", quizId),
    sb.from("attempts").select("id, answers").eq("quiz_id", quizId).eq("status", "submitted"),
  ]);
  let n = 0;
  for (const a of atts ?? []) {
    const g = grade(qs ?? [], a.answers ?? {});
    const { error } = await sb.from("attempts").update({ score: g.score, total: g.total }).eq("id", a.id);
    if (!error) n++;
  }
  return n;
}

export async function duplicateQuiz(quizId: string): Promise<string> {
  const sb = supabaseBrowser();
  const { data: q } = await sb.from("quizzes").select("*").eq("id", quizId).single();
  const { data: qs } = await sb.from("questions").select("*").eq("quiz_id", quizId).order("position");
  if (!q) throw new Error(tc("Không tìm thấy đề"));
  return createQuiz({
    title: `${q.title} ${tc("(bản sao)")}`,
    sections: q.sections,
    part_titles: q.part_titles ?? {},
    class_id: q.class_id ?? null,
    source_file_hash: q.source_file_hash,
    questions: (qs ?? []).map((x) => ({
      number: x.number,
      section_index: x.section_index,
      stem: x.stem,
      options: x.options,
      correct_label: x.correct_label,
      answer_source: x.answer_source,
      confidence: x.confidence,
      needs_review: x.needs_review,
      explanation: x.explanation,
      image: x.image ?? null,
      kind: x.kind ?? null,
    })),
  });
}
