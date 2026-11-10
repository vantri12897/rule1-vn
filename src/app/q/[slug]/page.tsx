import type { Metadata } from "next";
import { cache } from "react";
import { loadQuizBySlug } from "@/lib/public-quiz";
import { TakeQuiz, type QuizInfo } from "@/components/student/TakeQuiz";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

// cache(): metadata và trang dùng chung 1 lần gọi database
const info = cache(async (slug: string): Promise<QuizInfo | null> => {
  try {
    const data = await loadQuizBySlug(slug);
    if (!data) return null;
    return {
      title: data.quiz.title,
      status: data.quiz.status === "open" ? "open" : "closed",
      sections: data.quiz.sections,
      part_titles: data.quiz.part_titles ?? {},
      roster: data.quiz.status === "open" ? data.roster : null,
      time_limit_min: data.quiz.time_limit_min,
      question_count: data.questions.length,
    };
  } catch {
    return null;
  }
});

/** Tên đề hiện trong tab và khi gửi link qua Zalo/Messenger */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const q = await info(slug);
  const { t } = await getT();
  if (!q) return { title: t("Bài kiểm tra – YD-English") };
  return {
    title: `${q.title} – YD-English`,
    description: t("Bài kiểm tra trắc nghiệm tiếng Anh · {n} câu", { n: q.question_count }) + (q.time_limit_min ? ` · ${t("{n} phút", { n: q.time_limit_min })}` : ""),
    openGraph: { title: q.title, description: t("Làm bài trắc nghiệm {n} câu trên YD-English", { n: q.question_count }), siteName: "YD-English" },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TakeQuiz slug={slug} initialQuiz={await info(slug)} />;
}
