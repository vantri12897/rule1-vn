import type { Metadata } from "next";
import { cache } from "react";
import { loadQuizBySlug } from "@/lib/public-quiz";
import { TakeQuiz, type QuizInfo } from "@/components/student/TakeQuiz";

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
  if (!q) return { title: "Bài kiểm tra – YD-English" };
  return {
    title: `${q.title} – YD-English`,
    description: `Bài kiểm tra trắc nghiệm tiếng Anh · ${q.question_count} câu${q.time_limit_min ? ` · ${q.time_limit_min} phút` : ""}`,
    openGraph: { title: q.title, description: `Làm bài trắc nghiệm ${q.question_count} câu trên YD-English`, siteName: "YD-English" },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TakeQuiz slug={slug} initialQuiz={await info(slug)} />;
}
