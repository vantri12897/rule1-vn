"use client";
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AttemptReview, type ReviewItem } from "@/components/AttemptReview";
import { buildParts, partTitle } from "@/lib/parts";
import { fmtDate, fmtDuration } from "@/lib/ui";
import { useT } from "@/lib/i18n/client";
import type { Attempt, QuestionRow, Quiz } from "@/lib/types";

/**
 * Giáo viên xem TOÀN BỘ 1 bài làm (kể cả bài cũ trong "Các lần làm trước"):
 * câu hỏi, đoạn văn, học viên chọn gì, đáp án đúng. In / lưu PDF được.
 */
export default function AttemptPage({ params }: { params: Promise<{ id: string; aid: string }> }) {
  const { id, aid } = use(params);
  const { t } = useT();
  const [data, setData] = useState<{ quiz: Quiz; questions: QuestionRow[]; attempt: Attempt; no: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [onlyWrong, setOnlyWrong] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    (async () => {
      const [qz, qs, at] = await Promise.all([
        sb.from("quizzes").select("*").eq("id", id).single(),
        sb.from("questions").select("*").eq("quiz_id", id).order("position"),
        sb.from("attempts").select("*").eq("id", aid).eq("quiz_id", id).single(),
      ]);
      if (qz.error || at.error || !qz.data || !at.data) throw new Error(t("Không tìm thấy bài làm này (có thể đã bị xoá)."));
      const a = at.data as Attempt;
      // Lần làm thứ mấy: cùng máy hoặc cùng tên + lớp, tính theo thời gian bắt đầu
      const norm = (v: string | null) => (v ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
      const { data: same } = await sb.from("attempts").select("id, student_token, student_name, student_class, started_at").eq("quiz_id", id);
      const mine = (same ?? []).filter((x) => x.student_token === a.student_token || (norm(x.student_name) === norm(a.student_name) && norm(x.student_class) === norm(a.student_class)));
      const no = mine.filter((x) => Date.parse(x.started_at) <= Date.parse(a.started_at)).length;
      setData({ quiz: qz.data as Quiz, questions: (qs.data ?? []) as QuestionRow[], attempt: a, no });
    })().catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [id, aid, t]);

  const items: ReviewItem[] = useMemo(() => {
    if (!data) return [];
    const ans = data.attempt.answers ?? {};
    return data.questions.map((q, i) => {
      const sel = ans[q.id] ?? null;
      return { id: q.id, idx: i + 1, number: q.number, stem: q.stem, image: q.image ?? null, options: q.options, section_index: q.section_index, selected: sel, correct: q.correct_label, is_correct: !!sel && sel === q.correct_label };
    });
  }, [data]);

  const parts = useMemo(() => {
    if (!data) return [];
    const ps = buildParts(data.quiz.sections ?? [], data.questions, data.quiz.part_titles);
    return ps.map((p, k) => ({ title: partTitle(p, k, ps.length, t), right: p.items.filter((i) => items[i]?.is_correct).length, total: p.items.length }));
  }, [data, items, t]);

  useEffect(() => {
    if (data) document.title = `${data.attempt.student_name} – ${data.quiz.title}`;
  }, [data]);

  if (err) return <p className="card p-6 text-danger">{err}</p>;
  if (!data) return <p className="p-6 text-muted">{t("Đang tải bài làm…")}</p>;
  const { quiz, attempt: a } = data;
  const submitted = a.score != null;
  const wrong = items.filter((d) => !d.is_correct).length;
  const pct = a.total ? Math.round(((a.score ?? 0) / a.total) * 100) : 0;

  return (
    <div className="attempt-print mx-auto max-w-3xl">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          body { background: #fff !important; }
          header, footer, .no-print { display: none !important; }
          .attempt-print .card { box-shadow: none !important; break-inside: avoid; }
          .attempt-print details > summary { display: none; }
        }
      `}</style>
      <Link href={`/dashboard/quiz/${id}`} className="no-print text-sm text-primary-dark hover:underline">
        ← {t("Về đề")} {quiz.title}
      </Link>

      <div className="card mt-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted">{quiz.title}</p>
            <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-xl font-extrabold">
              {a.student_name}
              {a.student_class && <span className="text-base font-semibold text-muted">· {a.student_class}</span>}
              <span className="rounded-md bg-sky-soft px-2 py-0.5 text-sm font-bold text-sky-ink">{t("Lần {n}", { n: data.no })}</span>
              {a.status === "archived" && <span className="rounded-md bg-gray-100 px-2 py-0.5 text-sm font-semibold text-muted">{t("Lần làm trước")}</span>}
              {!!a.retry_round && <span className="rounded-md bg-violet-50 px-2 py-0.5 text-sm font-semibold text-violet-700">🔁 {t("làm lại câu sai{n}", { n: a.retry_round > 1 ? ` ×${a.retry_round}` : "" })}</span>}
            </h1>
          </div>
          {submitted && (
            <div className="text-right">
              <div className="text-3xl font-extrabold text-primary-dark">
                {a.score}
                <span className="text-lg text-muted">/{a.total}</span>
              </div>
              <div className="text-sm text-muted">{pct}%</div>
            </div>
          )}
        </div>
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          <span>🕘 {t("Nộp lúc")}: {fmtDate(a.submitted_at)}</span>
          <span>⏱️ {t("Thời gian làm")}: {fmtDuration(a.started_at, a.submitted_at)}</span>
          <span>
            🚪 {t("Số lần rời trang")}: {a.away_count == null ? "—" : a.away_count === 0 ? "0" : t("Rời trang {n} lần, tổng {d}", { n: a.away_count, d: `${a.away_seconds ?? 0}s` })}
          </span>
        </p>
        {parts.length > 1 && submitted && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {parts.map((p) => {
              const v = p.total ? p.right / p.total : 0;
              return (
                <span key={p.title} className={`rounded-lg border px-2 py-1 text-xs font-semibold ${v >= 0.8 ? "border-primary-line text-primary-dark" : v >= 0.5 ? "border-amber-200 text-sun-ink" : "border-red-200 text-danger"}`}>
                  {p.title}: {p.right}/{p.total}
                </span>
              );
            })}
          </div>
        )}
        {submitted && (
          <div className="no-print mt-4 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-gray-200 p-1" role="group">
              <button className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${!onlyWrong ? "bg-primary text-white" : "text-ink hover:bg-gray-50"}`} onClick={() => setOnlyWrong(false)} aria-pressed={!onlyWrong}>
                {t("Tất cả ({n})", { n: items.length })}
              </button>
              <button className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${onlyWrong ? "bg-danger text-white" : "text-ink hover:bg-gray-50"}`} onClick={() => setOnlyWrong(true)} aria-pressed={onlyWrong}>
                {t("Chỉ câu sai ({n})", { n: wrong })}
              </button>
            </div>
            <button className="btn-outline ml-auto" onClick={() => window.print()}>
              🖨️ {t("In / Lưu PDF")}
            </button>
          </div>
        )}
      </div>

      <div className="mt-4">
        {submitted ? (
          <AttemptReview viewer="teacher" items={items} sections={quiz.sections ?? []} onlyWrong={onlyWrong} />
        ) : (
          <p className="card p-6 text-center text-sm text-muted">{t("Bài này chưa nộp khi được cho làm lại nên không có kết quả.")}</p>
        )}
      </div>
    </div>
  );
}
