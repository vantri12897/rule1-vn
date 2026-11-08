"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate, quizLink, STATUS_LABEL } from "@/lib/ui";
import type { Quiz } from "@/lib/types";
import { CardsSkeleton } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n/client";
import { cacheGet, cacheSet } from "@/lib/cache";
import { prefetchQuizDetail } from "@/lib/quiz-load";

type Card = Quiz & { qcount: number; submitted: number; avgPct: number | null };

export default function Dashboard() {
  const { t } = useT();
  // Hiện ngay danh sách đã xem lần trước (nếu có), rồi tải mới ở phía sau
  const [cards, setCards] = useState<Card[] | null>(() => cacheGet<Card[]>("list") ?? null);
  const [copied, setCopied] = useState<string | null>(null);
  const [reminder, setReminder] = useState<string | null>(null);

  useEffect(() => {
    const backupCheck = () => {
      const last = localStorage.getItem("yd-last-backup");
      if (!last || Date.now() - new Date(last).getTime() > 7 * 86400_000) setReminder(t("Đã hơn 7 ngày chưa sao lưu dữ liệu (hoặc chưa sao lưu lần nào trên máy này)."));
    };
    // Đã biết có mã khôi phục trong phiên này → khỏi hỏi máy chủ mỗi lần về trang danh sách
    if (sessionStorage.getItem("yd-rc-ok") === "1") return backupCheck();
    fetch("/api/account/recovery-code", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.exists) sessionStorage.setItem("yd-rc-ok", "1");
        if (!d.exists) return setReminder(t("Bạn chưa tạo mã khôi phục mật khẩu — nếu quên mật khẩu sẽ không vào lại được website."));
        const last = localStorage.getItem("yd-last-backup");
        if (!last || Date.now() - new Date(last).getTime() > 7 * 86400_000) setReminder(t("Đã hơn 7 ngày chưa sao lưu dữ liệu (hoặc chưa sao lưu lần nào trên máy này)."));
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    // Đếm số câu ngay trong truy vấn đề (questions(count)) thay vì tải mọi dòng câu hỏi về máy
    const [{ data: quizzes }, { data: atts }] = await Promise.all([
      sb.from("quizzes").select("*, questions(count)").order("created_at", { ascending: false }),
      sb.from("attempts").select("quiz_id, score, total").eq("status", "submitted"),
    ]);
    if (!quizzes) return setCards((c) => c ?? []);
    const next = (quizzes as (Quiz & { questions: { count: number }[] })[]).map(({ questions, ...q }) => {
        const mine = (atts ?? []).filter((a) => a.quiz_id === q.id);
        const pcts = mine.filter((a) => a.total).map((a) => (a.score / a.total) * 100);
        return {
          ...q,
          qcount: questions?.[0]?.count ?? 0,
          submitted: mine.length,
          avgPct: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
        } as Card;
      });
    cacheSet("list", next);
    setCards((old) => (old && JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("📚 Đề của tôi")}</h1>
        <Link href="/dashboard/new" className="btn-primary">{t("+ Tạo đề mới")}</Link>
      </div>

      {reminder && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-warn">
          <span className="flex-1">⚠️ {reminder}</span>
          <Link href="/dashboard/account" className="btn-outline border-orange-300 text-warn">{t("Mở Tài khoản & sao lưu")}</Link>
        </div>
      )}

      {cards === null ? (
        <CardsSkeleton />
      ) : cards.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg font-semibold">{t("Chưa có đề nào")}</p>
          <p className="mt-1 text-sm text-muted">{t("Upload file PDF đầu tiên để bắt đầu.")}</p>
          <Link href="/dashboard/new" className="btn-primary mt-4">{t("+ Tạo đề mới")}</Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c, idx) => {
            const st = STATUS_LABEL[c.status];
            const accent = ["border-t-primary", "border-t-sky", "border-t-sun", "border-t-teal"][idx % 4];
            return (
              <div key={c.id} className={`card flex flex-col border-t-4 p-5 transition hover:-translate-y-0.5 hover:shadow-md ${accent}`}>
                <Link
                  href={`/dashboard/quiz/${c.id}`}
                  prefetch
                  className="group flex-1"
                  onMouseEnter={() => prefetchQuizDetail(c.id)}
                  onTouchStart={() => prefetchQuizDetail(c.id)}
                  onFocus={() => prefetchQuizDetail(c.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="line-clamp-2 font-bold group-hover:text-primary-dark">{c.title}</h2>
                    <span className={`badge shrink-0 ${st.cls}`}>{t(st.text)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{t("{n} câu · tạo {d}", { n: c.qcount, d: fmtDate(c.created_at) })}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-sky-soft p-3">
                      <div className="text-2xl font-extrabold text-sky-ink">{c.submitted}</div>
                      <div className="text-xs text-muted">{t("bài đã nộp")}</div>
                    </div>
                    <div className="rounded-xl bg-sun-soft p-3">
                      <div className="text-2xl font-extrabold text-sun-ink">{c.avgPct == null ? "—" : `${c.avgPct.toFixed(0)}%`}</div>
                      <div className="text-xs text-muted">{t("điểm trung bình")}</div>
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
                    {copied === c.id ? t("✓ Đã copy link") : t("Copy link cho học viên")}
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
