"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate, quizLink, STATUS_LABEL } from "@/lib/ui";
import type { Quiz } from "@/lib/types";

type Card = Quiz & { qcount: number; submitted: number; avgPct: number | null };

export default function Dashboard() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [usage, setUsage] = useState<number>(0);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data: quizzes }, { data: qs }, { data: atts }, { data: use }] = await Promise.all([
      sb.from("quizzes").select("*").order("created_at", { ascending: false }),
      sb.from("questions").select("quiz_id"),
      sb.from("attempts").select("quiz_id, score, total, status").eq("status", "submitted"),
      sb.from("ai_usage").select("calls, day").order("day", { ascending: false }).limit(1),
    ]);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
    setUsage(use?.[0]?.day === today ? use[0].calls : 0);
    setCards(
      (quizzes ?? []).map((q: Quiz) => {
        const mine = (atts ?? []).filter((a) => a.quiz_id === q.id);
        const pcts = mine.filter((a) => a.total).map((a) => (a.score / a.total) * 100);
        return {
          ...q,
          qcount: (qs ?? []).filter((x) => x.quiz_id === q.id).length,
          submitted: mine.length,
          avgPct: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
        };
      })
    );
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Đề của tôi</h1>
          <p className="text-sm text-muted">Lượt gọi AI hôm nay: <b>{usage}</b> (gói miễn phí của Gemini có giới hạn theo ngày)</p>
        </div>
        <Link href="/dashboard/new" className="btn-primary">+ Tạo đề mới</Link>
      </div>

      {cards === null ? (
        <p className="text-muted">Đang tải…</p>
      ) : cards.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg font-semibold">Chưa có đề nào</p>
          <p className="mt-1 text-sm text-muted">Upload file PDF đầu tiên để bắt đầu.</p>
          <Link href="/dashboard/new" className="btn-primary mt-4">+ Tạo đề mới</Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => {
            const st = STATUS_LABEL[c.status];
            return (
              <div key={c.id} className="card flex flex-col p-5">
                <Link href={`/dashboard/quiz/${c.id}`} className="group flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="line-clamp-2 font-bold group-hover:text-primary-dark">{c.title}</h2>
                    <span className={`badge shrink-0 ${st.cls}`}>{st.text}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{c.qcount} câu · tạo {fmtDate(c.created_at)}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-primary-soft p-3">
                      <div className="text-2xl font-extrabold text-primary-dark">{c.submitted}</div>
                      <div className="text-xs text-muted">bài đã nộp</div>
                    </div>
                    <div className="rounded-xl bg-primary-soft p-3">
                      <div className="text-2xl font-extrabold text-primary-dark">{c.avgPct == null ? "—" : `${c.avgPct.toFixed(0)}%`}</div>
                      <div className="text-xs text-muted">điểm trung bình</div>
                    </div>
                  </div>
                </Link>
                {c.status !== "draft" && (
                  <button
                    className="btn-outline mt-4 w-full"
                    onClick={() => {
                      navigator.clipboard.writeText(quizLink(c.slug));
                      setCopied(c.id);
                      setTimeout(() => setCopied(null), 1500);
                    }}
                  >
                    {copied === c.id ? "✓ Đã copy link" : "Copy link cho học viên"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
