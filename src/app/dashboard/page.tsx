"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate, quizLink, STATUS_LABEL } from "@/lib/ui";
import type { Quiz } from "@/lib/types";
import { CardsSkeleton } from "@/components/ui/Skeleton";

type Card = Quiz & { qcount: number; submitted: number; avgPct: number | null };

export default function Dashboard() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [reminder, setReminder] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account/recovery-code", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.exists) return setReminder("Bạn chưa tạo mã khôi phục mật khẩu — nếu quên mật khẩu sẽ không vào lại được website.");
        const last = localStorage.getItem("yd-last-backup");
        if (!last || Date.now() - new Date(last).getTime() > 7 * 86400_000) setReminder("Đã hơn 7 ngày chưa sao lưu dữ liệu (hoặc chưa sao lưu lần nào trên máy này).");
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data: quizzes }, { data: qs }, { data: atts }] = await Promise.all([
      sb.from("quizzes").select("*").order("created_at", { ascending: false }),
      sb.from("questions").select("quiz_id"),
      sb.from("attempts").select("quiz_id, score, total, status").eq("status", "submitted"),
    ]);
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
        <h1 className="text-2xl font-bold">📚 Đề của tôi</h1>
        <Link href="/dashboard/new" className="btn-primary">+ Tạo đề mới</Link>
      </div>

      {reminder && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-warn">
          <span className="flex-1">⚠️ {reminder}</span>
          <Link href="/dashboard/account" className="btn-outline border-orange-300 text-warn">Mở Tài khoản & sao lưu</Link>
        </div>
      )}

      {cards === null ? (
        <CardsSkeleton />
      ) : cards.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg font-semibold">Chưa có đề nào</p>
          <p className="mt-1 text-sm text-muted">Upload file PDF đầu tiên để bắt đầu.</p>
          <Link href="/dashboard/new" className="btn-primary mt-4">+ Tạo đề mới</Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c, idx) => {
            const st = STATUS_LABEL[c.status];
            const accent = ["border-t-primary", "border-t-sky", "border-t-sun", "border-t-teal"][idx % 4];
            return (
              <div key={c.id} className={`card flex flex-col border-t-4 p-5 transition hover:-translate-y-0.5 hover:shadow-md ${accent}`}>
                <Link href={`/dashboard/quiz/${c.id}`} className="group flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="line-clamp-2 font-bold group-hover:text-primary-dark">{c.title}</h2>
                    <span className={`badge shrink-0 ${st.cls}`}>{st.text}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{c.qcount} câu · tạo {fmtDate(c.created_at)}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-sky-soft p-3">
                      <div className="text-2xl font-extrabold text-sky-ink">{c.submitted}</div>
                      <div className="text-xs text-muted">bài đã nộp</div>
                    </div>
                    <div className="rounded-xl bg-sun-soft p-3">
                      <div className="text-2xl font-extrabold text-sun-ink">{c.avgPct == null ? "—" : `${c.avgPct.toFixed(0)}%`}</div>
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
