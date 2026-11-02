"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { regradeQuiz } from "@/lib/quiz-db";
import { fmtDate, fmtDuration } from "@/lib/ui";
import type { Attempt, Quiz, QuestionRow } from "@/lib/types";
import { confirmDialog, toast } from "@/components/ui/feedback";
import { Skel } from "@/components/ui/Skeleton";

export function ResultsPanel({
  quiz,
  questions,
  onCountChange,
}: {
  quiz: Quiz;
  questions: QuestionRow[];
  onCountChange: (n: number) => void;
}) {
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
    if (!(await confirmDialog({ title: "Reset bài làm", message: `Reset bài của "${a.student_name}"? Học viên sẽ làm lại được qua cùng link. Bài cũ được lưu vào lịch sử.`, confirmText: "Reset", danger: true }))) return;
    const sb = supabaseBrowser();
    const { data: u } = await sb.auth.getUser();
    await sb.from("attempts").update({ status: "archived" }).eq("id", a.id);
    await sb.from("reset_logs").insert({ quiz_id: quiz.id, attempt_id: a.id, scope: "single", reset_by: u.user?.id });
    toast(`Đã reset bài của ${a.student_name}`);
    load();
  }

  async function resetAll() {
    if (!active.length) return;
    if (!(await confirmDialog({ title: "Reset toàn bộ", message: `Reset TOÀN BỘ ${active.length} bài làm của đề này? Mọi học viên sẽ làm lại từ đầu.`, confirmText: "Reset toàn bộ", danger: true }))) return;
    const sb = supabaseBrowser();
    const { data: u } = await sb.auth.getUser();
    await sb.from("attempts").update({ status: "archived" }).eq("quiz_id", quiz.id).neq("status", "archived");
    await sb.from("reset_logs").insert({ quiz_id: quiz.id, scope: "all", reset_by: u.user?.id });
    toast("Đã reset toàn bộ bài làm");
    load();
  }

  async function regrade() {
    setBusy(true);
    const n = await regradeQuiz(quiz.id);
    setMsg(`Đã chấm lại ${n} bài theo đáp án hiện tại.`);
    setBusy(false);
    load();
  }

  function exportCsv() {
    const header = ["STT", "Họ tên", "Lớp/Mã", "Điểm", "Tổng", "%", "Bắt đầu", "Nộp lúc", "Thời gian làm", ...questions.map((q) => `Câu ${q.number}`)];
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
        <Stat value={submitted.length} label="đã nộp" />
        <Stat value={active.length - submitted.length} label="đang làm" />
        <Stat value={avg == null ? "—" : `${Math.round(avg * 100)}%`} label="điểm TB" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn-outline" onClick={exportCsv} disabled={!submitted.length}>⬇️ Xuất Excel (CSV)</button>
        <button className="btn-outline" onClick={regrade} disabled={busy || !submitted.length}>↻ Chấm lại toàn bộ</button>
        <button className="btn-danger ml-auto" onClick={resetAll} disabled={!active.length}>Reset toàn bộ</button>
      </div>
      {msg && <p className="rounded-xl bg-primary-soft p-3 text-sm text-primary-dark">{msg}</p>}
      {dupNames.size > 0 && (
        <p className="rounded-xl bg-orange-50 p-3 text-sm text-warn">⚠️ Có nhiều bài trùng họ tên (tô cam bên dưới) — có thể một học viên làm trên nhiều thiết bị.</p>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3 className="font-bold">Bảng kết quả</h3>
          <span className="text-xs text-muted">Tự cập nhật mỗi 5 giây</span>
        </div>
        {active.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">Chưa có học viên nào làm bài.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-2">Họ tên</th>
                  <th className="px-4 py-2">Điểm</th>
                  <th className="hidden px-4 py-2 sm:table-cell">Thời gian</th>
                  <th className="hidden px-4 py-2 sm:table-cell">Nộp lúc</th>
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
                          <span className="badge bg-blue-50 text-blue-700">Đang làm</span>
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
                                  title={`Câu ${q.number}: chọn ${s ?? "—"}, đúng ${q.correct_label}`}
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
          <h3 className="mb-3 font-bold">Thống kê từng câu</h3>
          <p className="mb-3 text-xs text-muted">Câu có tỉ lệ đúng rất thấp nên xem lại — có thể câu khó, hoặc đáp án đang bị đặt sai.</p>
          <div className="space-y-2">
            {qStats.map(({ q, pct, wrong }) => (
              <div key={q.id} className="flex items-center gap-3 text-sm">
                <span className="w-14 shrink-0 font-semibold">Câu {q.number}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div className={`h-full ${pct < 30 ? "bg-danger" : pct < 60 ? "bg-warn" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-12 text-right">{Math.round(pct)}%</span>
                <span className="hidden w-40 text-xs text-muted sm:inline">{wrong ? `Sai nhiều: ${wrong[0]} (${wrong[1]})` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <button className="text-sm text-primary-dark hover:underline" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? "Ẩn" : "Xem"} lịch sử bài đã reset ({archived.length})
          </button>
          {showHistory && (
            <div className="card mt-2 divide-y divide-gray-100">
              {archived.map((a) => (
                <div key={a.id} className="flex justify-between px-4 py-2 text-sm">
                  <span>{a.student_name}</span>
                  <span className="text-muted">{a.score != null ? `${a.score}/${a.total}` : "chưa nộp"} · {fmtDate(a.submitted_at ?? a.started_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="card p-4 text-center">
      <div className="text-2xl font-extrabold text-primary-dark">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
