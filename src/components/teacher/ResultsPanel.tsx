"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { regradeQuiz } from "@/lib/quiz-db";
import { fmtDate, fmtDuration } from "@/lib/ui";
import type { Attempt, Quiz, QuestionRow } from "@/lib/types";
import { confirmDialog, toast } from "@/components/ui/feedback";
import { Skel } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n/client";

export function ResultsPanel({
  quiz,
  questions,
  onCountChange,
}: {
  quiz: Quiz;
  questions: QuestionRow[];
  onCountChange: (n: number) => void;
}) {
  const { t } = useT();
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("attempts")
      .select("*")
      .eq("quiz_id", quiz.id)
      .order("submitted_at", { ascending: false, nullsFirst: true });
    setAttempts((data as Attempt[]) ?? []);
  }, [quiz.id]);

  // Cập nhật gần thời gian thực: hỏi lại mỗi 5 giây khi tab đang mở
  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => clearInterval(t);
  }, [load]);

  const active = useMemo(() => (attempts ?? []).filter((a) => a.status !== "archived"), [attempts]);
  const submitted = useMemo(() => active.filter((a) => a.status === "submitted"), [active]);
  const archived = useMemo(() => (attempts ?? []).filter((a) => a.status === "archived"), [attempts]);
  useEffect(() => onCountChange(submitted.length), [submitted.length, onCountChange]);

  const dupNames = useMemo(() => {
    const c = new Map<string, number>();
    active.forEach((a) => c.set(a.student_name.trim().toLowerCase(), (c.get(a.student_name.trim().toLowerCase()) ?? 0) + 1));
    return new Set([...c.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [active]);

  const qStats = useMemo(() => {
    return questions.map((q) => {
      const counts: Record<string, number> = {};
      let correct = 0;
      submitted.forEach((a) => {
        const s = a.answers?.[q.id];
        if (s) counts[s] = (counts[s] ?? 0) + 1;
        if (s && s === q.correct_label) correct++;
      });
      const wrong = Object.entries(counts).filter(([l]) => l !== q.correct_label).sort((a, b) => b[1] - a[1])[0];
      return { q, pct: submitted.length ? (correct / submitted.length) * 100 : 0, wrong };
    });
  }, [questions, submitted]);

  async function resetOne(a: Attempt) {
    if (!(await confirmDialog({ title: t("Reset bài làm"), message: t("Reset bài của “{name}”? Học viên sẽ làm lại được qua cùng link. Bài cũ được lưu vào lịch sử.", { name: a.student_name }), confirmText: "Reset", danger: true }))) return;
    const sb = supabaseBrowser();
    const { data: u } = await sb.auth.getUser();
    await sb.from("attempts").update({ status: "archived" }).eq("id", a.id);
    await sb.from("reset_logs").insert({ quiz_id: quiz.id, attempt_id: a.id, scope: "single", reset_by: u.user?.id });
    toast(t("Đã reset bài của {name}", { name: a.student_name }));
    load();
  }

  async function deleteHistory(one?: Attempt) {
    const ok = await confirmDialog(
      one
        ? { title: t("Xoá bài trong lịch sử"), message: t("Xoá vĩnh viễn bài đã reset của “{name}”? Không thể hoàn tác.", { name: one.student_name }), confirmText: t("Xoá"), danger: true }
        : { title: t("Xoá toàn bộ lịch sử"), message: t("Xoá vĩnh viễn {n} bài đã reset của đề này? Không thể hoàn tác.\n\nBài đang làm và bài đã nộp hiện tại không bị ảnh hưởng.", { n: archived.length }), confirmText: t("Xoá lịch sử"), danger: true }
    );
    if (!ok) return;
    const sb = supabaseBrowser();
    const q = sb.from("attempts").delete().eq("quiz_id", quiz.id).eq("status", "archived");
    const { error } = one ? await q.eq("id", one.id) : await q;
    if (error) return toast(t("Không xoá được: ") + error.message, "error");
    if (!one) await sb.from("reset_logs").delete().eq("quiz_id", quiz.id);
    toast(one ? t("Đã xoá bài của {name} khỏi lịch sử", { name: one.student_name }) : t("Đã xoá toàn bộ lịch sử"));
    load();
  }

  async function resetAll() {
    if (!active.length) return;
    if (!(await confirmDialog({ title: t("Reset toàn bộ"), message: t("Reset TOÀN BỘ {n} bài làm của đề này? Mọi học viên sẽ làm lại từ đầu.", { n: active.length }), confirmText: t("Reset toàn bộ"), danger: true }))) return;
    const sb = supabaseBrowser();
    const { data: u } = await sb.auth.getUser();
    await sb.from("attempts").update({ status: "archived" }).eq("quiz_id", quiz.id).neq("status", "archived");
    await sb.from("reset_logs").insert({ quiz_id: quiz.id, scope: "all", reset_by: u.user?.id });
    toast(t("Đã reset toàn bộ bài làm"));
    load();
  }

  async function regrade() {
    setBusy(true);
    const n = await regradeQuiz(quiz.id);
    setMsg(t("Đã chấm lại {n} bài theo đáp án hiện tại.", { n }));
    setBusy(false);
    load();
  }

  function exportCsv() {
    const header = [t("STT"), t("Họ tên"), t("Lớp/Mã"), t("Điểm"), t("Tổng"), "%", t("Bắt đầu"), t("Nộp lúc"), t("Thời gian làm"), ...questions.map((q) => t("Câu {n}", { n: q.number }))];
    const rows = submitted.map((a, i) => [
      i + 1,
      a.student_name,
      a.student_class ?? "",
      a.score ?? 0,
      a.total ?? 0,
      a.total ? ((100 * (a.score ?? 0)) / a.total).toFixed(1) : "",
      fmtDate(a.started_at),
      fmtDate(a.submitted_at),
      fmtDuration(a.started_at, a.submitted_at),
      ...questions.map((q) => {
        const s = a.answers?.[q.id];
        return s ? `${s}${s === q.correct_label ? " ✓" : " ✗"}` : "";
      }),
    ]);
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${quiz.title.replace(/[^\p{L}\p{N}]+/gu, "_")}_ket_qua.csv`;
    a.click();
  }

  if (attempts === null)
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="grid grid-cols-3 gap-3">
          <Skel className="h-20" />
          <Skel className="h-20" />
          <Skel className="h-20" />
        </div>
        <Skel className="h-48" />
      </div>
    );

  const avg = submitted.length ? submitted.reduce((s, a) => s + (a.total ? (a.score ?? 0) / a.total : 0), 0) / submitted.length : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Stat value={submitted.length} label={t("đã nộp")} tone="green" />
        <Stat value={active.length - submitted.length} label={t("đang làm")} tone="sky" />
        <Stat value={avg == null ? "—" : `${Math.round(avg * 100)}%`} label={t("điểm TB")} tone="sun" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-outline" onClick={exportCsv} disabled={!submitted.length}>{t("⬇️ Xuất Excel (CSV)")}</button>
        <button className="btn-outline" onClick={regrade} disabled={busy || !submitted.length}>{t("↻ Chấm lại toàn bộ")}</button>
        <button className="btn-danger ml-auto" onClick={resetAll} disabled={!active.length}>{t("Reset toàn bộ")}</button>
      </div>
      {msg && <p className="rounded-xl bg-primary-soft p-3 text-sm text-primary-dark">{msg}</p>}
      {dupNames.size > 0 && (
        <p className="rounded-xl bg-orange-50 p-3 text-sm text-warn">{t("⚠️ Có nhiều bài trùng họ tên (tô cam bên dưới) — có thể một học viên làm trên nhiều thiết bị.")}</p>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3 className="font-bold">{t("Bảng kết quả")}</h3>
          <span className="text-xs text-muted">{t("Tự cập nhật mỗi 5 giây")}</span>
        </div>
        {active.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">{t("Chưa có học viên nào làm bài.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-2">{t("Họ tên")}</th>
                  <th className="px-4 py-2">{t("Điểm")}</th>
                  <th className="hidden px-4 py-2 sm:table-cell">{t("Thời gian")}</th>
                  <th className="hidden px-4 py-2 sm:table-cell">{t("Nộp lúc")}</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {active.map((a) => (
                  <Fragment key={a.id}>
                    <tr
                      className={`cursor-pointer border-t border-gray-100 hover:bg-gray-50 ${dupNames.has(a.student_name.trim().toLowerCase()) ? "bg-orange-50/60" : ""}`}
                      onClick={() => setOpen(open === a.id ? null : a.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold">{a.student_name}</div>
                        {a.student_class && <div className="text-xs text-muted">{a.student_class}</div>}
                      </td>
                      <td className="px-4 py-3">
                        {a.status === "submitted" ? (
                          <span className="font-bold text-primary-dark">
                            {a.score}/{a.total}{" "}
                            <span className="text-xs font-normal text-muted">({a.total ? Math.round((100 * (a.score ?? 0)) / a.total) : 0}%)</span>
                          </span>
                        ) : (
                          <span className="badge bg-blue-50 text-blue-700">{t("Đang làm")}</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">{fmtDuration(a.started_at, a.submitted_at)}</td>
                      <td className="hidden px-4 py-3 sm:table-cell">{fmtDate(a.submitted_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className="btn-ghost px-2 py-1 text-xs text-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            resetOne(a);
                          }}
                        >
                          Reset
                        </button>
                      </td>
                    </tr>
                    {open === a.id && a.status === "submitted" && (
                      <tr className="bg-gray-50">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {questions.map((q) => {
                              const s = a.answers?.[q.id];
                              const ok = !!s && s === q.correct_label;
                              return (
                                <span
                                  key={q.id}
                                  title={t("Câu {n}: chọn {s}, đúng {c}", { n: q.number, s: s ?? "—", c: q.correct_label })}
                                  className={`rounded-lg px-2 py-1 text-xs font-semibold ${ok ? "bg-primary-soft text-primary-dark" : "bg-red-50 text-danger"}`}
                                >
                                  {q.number}: {s ?? "—"} {ok ? "✓" : `✗(${q.correct_label ?? "—"})`}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {submitted.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-3 font-bold">{t("Thống kê từng câu")}</h3>
          <p className="mb-3 text-xs text-muted">{t("Câu có tỉ lệ đúng rất thấp nên xem lại — có thể câu khó, hoặc đáp án đang bị đặt sai.")}</p>
          <div className="space-y-2">
            {qStats.map(({ q, pct, wrong }) => (
              <div key={q.id} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 font-semibold">{t("Câu {n}", { n: q.number })}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div className={`h-full ${pct < 30 ? "bg-danger" : pct < 60 ? "bg-warn" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-12 text-right">{Math.round(pct)}%</span>
                <span className="hidden w-40 text-xs text-muted sm:inline">{wrong ? t("Sai nhiều: {l} ({n})", { l: wrong[0], n: wrong[1] }) : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <button className="text-sm text-primary-dark hover:underline" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? t("Ẩn lịch sử bài đã reset ({n})", { n: archived.length }) : t("Xem lịch sử bài đã reset ({n})", { n: archived.length })}
          </button>
          {showHistory && (
            <div className="card mt-2 overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
                <span className="text-xs text-muted">{t("Bài cũ của học viên trước khi bị reset")}</span>
                <button className="btn-danger px-3 py-1.5 text-xs" onClick={() => deleteHistory()}>
                  {t("🗑️ Xoá toàn bộ lịch sử")}
                </button>
              </div>
              <div className="divide-y divide-gray-100">
                {archived.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{a.student_name}</span>
                    <span className="shrink-0 text-muted">
                      {a.score != null ? `${a.score}/${a.total}` : t("chưa nộp")} · {fmtDate(a.submitted_at ?? a.started_at)}
                    </span>
                    <button
                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-danger hover:bg-red-50"
                      aria-label={t("Xoá bài của {name} khỏi lịch sử", { name: a.student_name })}
                      onClick={() => deleteHistory(a)}
                    >
                      {t("Xoá")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, tone }: { value: React.ReactNode; label: string; tone: "green" | "sky" | "sun" }) {
  const c = { green: "border-t-primary text-primary-dark", sky: "border-t-sky text-sky-ink", sun: "border-t-sun text-sun-ink" }[tone];
  return (
    <div className={`card border-t-4 p-4 text-center ${c}`}>
      <div className="text-2xl font-extrabold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
