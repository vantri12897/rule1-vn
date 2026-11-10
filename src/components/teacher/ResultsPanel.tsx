"use client";
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { regradeQuiz } from "@/lib/quiz-db";
import { fmtDate, fmtDuration } from "@/lib/ui";
import type { Attempt, Quiz, QuestionRow } from "@/lib/types";
import { confirmDialog, toast } from "@/components/ui/feedback";
import { Skel } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n/client";
import { buildParts, partTitle } from "@/lib/parts";

export const ResultsPanel = memo(function ResultsPanel({
  quiz,
  questions,
  onCountChange,
  active: isActive = true,
}: {
  quiz: Quiz;
  questions: QuestionRow[];
  onCountChange: (n: number) => void;
  active?: boolean;
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

  // Cập nhật gần thời gian thực: hỏi lại mỗi 5 giây khi tab Kết quả đang hiện (ẩn thì nghỉ)
  useEffect(() => {
    if (!isActive) return;
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => clearInterval(t);
  }, [load, isActive]);

  const active = useMemo(() => (attempts ?? []).filter((a) => a.status !== "archived"), [attempts]);
  const submitted = useMemo(() => active.filter((a) => a.status === "submitted"), [active]);
  const archived = useMemo(() => (attempts ?? []).filter((a) => a.status === "archived"), [attempts]);
  useEffect(() => onCountChange(submitted.length), [submitted.length, onCountChange]);

  /**
   * Đánh số lần làm của từng học viên (Lần 1, Lần 2…): cùng máy (mã trình duyệt) hoặc cùng tên + lớp
   * được coi là cùng 1 học viên. Bài cũ (đã cho làm lại) nằm trong "Các lần làm trước".
   */
  const attemptInfo = useMemo(() => {
    const all = attempts ?? [];
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      while (parent.get(x) !== x) x = parent.get(x)!;
      return x;
    };
    const norm = (v: string | null) => (v ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
    for (const a of all) parent.set(find(`t:${a.student_token}`), find(`n:${norm(a.student_name)}|${norm(a.student_class)}`));
    const groups = new Map<string, Attempt[]>();
    for (const a of all) {
      const g = find(`t:${a.student_token}`);
      groups.set(g, [...(groups.get(g) ?? []), a]);
    }
    const info = new Map<string, { no: number; prev: Attempt[] }>();
    for (const list of groups.values()) {
      list.sort((x, y) => Date.parse(x.started_at) - Date.parse(y.started_at));
      list.forEach((a, i) => info.set(a.id, { no: i + 1, prev: list.slice(0, i) }));
    }
    return info;
  }, [attempts]);

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

  // Các phần (gom theo dạng bài) giống thanh điều hướng của học viên
  const parts = useMemo(() => buildParts(quiz.sections ?? [], questions, quiz.part_titles), [quiz.sections, quiz.part_titles, questions]);
  const partTitles = useMemo(() => parts.map((p, k) => partTitle(p, k, parts.length, t)), [parts, t]);
  /** Số câu đúng theo từng phần của 1 bài làm */
  const partRight = useCallback(
    (a: Attempt) =>
      parts.map(
        (p) =>
          p.items.filter((i) => {
            const q = questions[i];
            const s = a.answers?.[q.id];
            return !!s && s === q.correct_label;
          }).length
      ),
    [parts, questions]
  );
  // Cả lớp: tỉ lệ đúng trung bình theo từng phần → biết lớp yếu dạng bài nào
  const partStats = useMemo(() => {
    if (!submitted.length) return [];
    const sums = parts.map(() => 0);
    submitted.forEach((a) => partRight(a).forEach((n, k) => (sums[k] += n)));
    return parts.map((p, k) => ({ title: partTitles[k], n: p.items.length, pct: (sums[k] / (p.items.length * submitted.length)) * 100 }));
  }, [parts, partTitles, partRight, submitted]);

  /** Chi tiết 1 bài làm: điểm từng phần + từng câu (dùng cho bài hiện tại và các lần làm trước) */
  const detail = (a: Attempt) => (
    <>
      {parts.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {partRight(a).map((n, k) => {
            const v = n / parts[k].items.length;
            return (
              <span key={parts[k].kind} className={`rounded-lg border px-2 py-1 text-xs font-semibold ${v >= 0.8 ? "border-primary-line bg-white text-primary-dark" : v >= 0.5 ? "border-amber-200 bg-white text-sun-ink" : "border-red-200 bg-white text-danger"}`}>
                {partTitles[k]}: {n}/{parts[k].items.length}
              </span>
            );
          })}
        </div>
      )}
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
    </>
  );

  async function resetOne(a: Attempt) {
    if (!(await confirmDialog({ title: t("Cho làm lại"), message: t("Cho “{name}” làm lại? Học viên mở lại cùng link để làm bài mới. Bài lần này vẫn được giữ trong “Các lần làm trước” (xem được chi tiết).", { name: a.student_name }), confirmText: t("Cho làm lại") }))) return;
    const sb = supabaseBrowser();
    const { data: u } = await sb.auth.getUser();
    await sb.from("attempts").update({ status: "archived" }).eq("id", a.id);
    await sb.from("reset_logs").insert({ quiz_id: quiz.id, attempt_id: a.id, scope: "single", reset_by: u.user?.id });
    toast(t("Đã cho {name} làm lại — gửi lại link cho học viên", { name: a.student_name }));
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
    if (!(await confirmDialog({ title: t("Cho cả lớp làm lại"), message: t("Cho TẤT CẢ {n} học viên làm lại từ đầu? Bài hiện tại của mọi người được giữ trong “Các lần làm trước”.", { n: active.length }), confirmText: t("Cho cả lớp làm lại"), danger: true }))) return;
    const sb = supabaseBrowser();
    const { data: u } = await sb.auth.getUser();
    await sb.from("attempts").update({ status: "archived" }).eq("quiz_id", quiz.id).neq("status", "archived");
    await sb.from("reset_logs").insert({ quiz_id: quiz.id, scope: "all", reset_by: u.user?.id });
    toast(t("Đã cho cả lớp làm lại"));
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
    const multi = parts.length > 1;
    const header = [
      t("STT"), t("Họ tên"), t("Lớp/Mã"), t("Điểm"), t("Tổng"), "%", t("Bắt đầu"), t("Nộp lúc"), t("Thời gian làm"),
      t("Rời trang (lần)"), t("Rời trang (giây)"),
      ...(multi ? partTitles.map((x, k) => `${x} (/${parts[k].items.length})`) : []),
      ...questions.map((q) => t("Câu {n}", { n: q.number })),
    ];
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
      a.away_count ?? "",
      a.away_seconds ?? "",
      ...(multi ? partRight(a) : []),
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
        <button className="btn-danger ml-auto" onClick={resetAll} disabled={!active.length}>{t("Cho cả lớp làm lại")}</button>
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
                  <th className="px-3 py-2" title={t("Số lần học viên rời khỏi trang làm bài (chuyển tab, mở ứng dụng khác) từ 1 giây trở lên")}>{t("Số lần rời trang")}</th>
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
                        <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                          {a.student_name}
                          <AttemptBadge info={attemptInfo.get(a.id)} />
                        </div>
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
                      <td className="px-3 py-3">
                        <AwayCell a={a} />
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
                          {t("Cho làm lại")}
                        </button>
                      </td>
                    </tr>
                    {open === a.id && a.status === "submitted" && (
                      <tr className="bg-gray-50">
                        <td colSpan={6} className="px-4 py-3">
                          {detail(a)}
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

      {submitted.length > 0 && active.some((a) => (a.away_count ?? 0) > 0) && (
        <p className="-mt-2 text-xs text-muted">
          {t("🚪 “Rời trang” = số lần học viên chuyển tab hoặc mở ứng dụng khác khi đang làm bài. Chỉ là dấu hiệu để lưu ý (có thể do cuộc gọi, thông báo…), không phải bằng chứng gian lận.")}
        </p>
      )}

      {submitted.length > 0 && partStats.length > 1 && (
        <div className="card p-4">
          <h3 className="mb-1 font-bold">{t("📊 Thống kê theo dạng bài")}</h3>
          <p className="mb-3 text-xs text-muted">{t("Tỉ lệ trả lời đúng trung bình của cả lớp ở từng phần — phần thấp nhất là dạng bài lớp cần ôn thêm.")}</p>
          <div className="space-y-2">
            {(() => {
              const min = Math.min(...partStats.map((p) => p.pct));
              return partStats.map((p) => (
                <div key={p.title} className="flex items-center gap-3 text-sm">
                  <span className="w-44 shrink-0 truncate font-semibold sm:w-64" title={p.title}>
                    {p.title} <span className="font-normal text-muted">· {p.n}</span>
                  </span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className={`h-full ${p.pct < 30 ? "bg-danger" : p.pct < 60 ? "bg-warn" : "bg-primary"}`} style={{ width: `${Math.max(p.pct, 1)}%` }} />
                  </div>
                  <span className="w-12 text-right tabular-nums">{Math.round(p.pct)}%</span>
                  <span className="hidden w-24 text-xs font-semibold text-danger sm:inline">{p.pct === min && min < 80 ? t("⚠️ yếu nhất") : ""}</span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {submitted.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-3 font-bold">{t("Thống kê từng câu")}</h3>
          <p className="mb-3 text-xs text-muted">{t("Câu có tỉ lệ đúng rất thấp nên xem lại — có thể câu khó, hoặc đáp án đang bị đặt sai.")}</p>
          <div className="space-y-2">
            {qStats.map(({ q, pct, wrong }) => (
              <div key={q.id} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 whitespace-nowrap font-semibold">{t("Câu {n}", { n: q.number })}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div className={`h-full ${pct < 30 ? "bg-danger" : pct < 60 ? "bg-warn" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-12 text-right">{Math.round(pct)}%</span>
                <span className="hidden w-40 whitespace-nowrap text-xs text-muted sm:inline">{wrong ? t("Sai nhiều: {l} ({n})", { l: wrong[0], n: wrong[1] }) : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <button className="text-sm text-primary-dark hover:underline" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? t("Ẩn các lần làm trước ({n})", { n: archived.length }) : t("🕘 Xem các lần làm trước ({n})", { n: archived.length })}
          </button>
          {showHistory && (
            <div className="card mt-2 overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
                <span className="text-xs text-muted">{t("Bài cũ của học viên trước khi được cho làm lại — bấm vào để xem chi tiết")}</span>
                <button className="btn-danger px-3 py-1.5 text-xs" onClick={() => deleteHistory()}>
                  {t("🗑️ Xoá toàn bộ lịch sử")}
                </button>
              </div>
              <div className="divide-y divide-gray-100">
                {archived.map((a) => (
                  <div key={a.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={open === a.id}
                      onClick={() => setOpen(open === a.id ? null : a.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(open === a.id ? null : a.id))}
                      className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <span className="mr-1 text-muted">{open === a.id ? "▾" : "▸"}</span>
                        {a.student_name}
                        {a.student_class && <span className="text-xs text-muted"> · {a.student_class}</span>}{" "}
                        <AttemptBadge info={attemptInfo.get(a.id)} always />
                      </span>
                      <span className="shrink-0 text-muted">
                        {a.score != null ? <b className="text-ink">{a.score}/{a.total}</b> : t("chưa nộp")} · {fmtDate(a.submitted_at ?? a.started_at)}
                      </span>
                      <button
                        className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-danger hover:bg-red-50"
                        aria-label={t("Xoá bài của {name} khỏi lịch sử", { name: a.student_name })}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteHistory(a);
                        }}
                      >
                        {t("Xoá")}
                      </button>
                    </div>
                    {open === a.id && (
                      <div className="bg-gray-50 px-4 py-3">
                        {a.score != null ? (
                          <>
                            <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                              <span>⏱️ {t("Thời gian làm")}: {fmtDuration(a.started_at, a.submitted_at)}</span>
                              <span>
                                🚪 {t("Số lần rời trang")}: <AwayCell a={a} />
                              </span>
                            </p>
                            {detail(a)}
                          </>
                        ) : (
                          <p className="text-xs text-muted">{t("Bài này chưa nộp khi được cho làm lại nên không có kết quả.")}</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function Stat({ value, label, tone }: { value: React.ReactNode; label: string; tone: "green" | "sky" | "sun" }) {
  const c = { green: "border-t-primary text-primary-dark", sky: "border-t-sky text-sky-ink", sun: "border-t-sun text-sun-ink" }[tone];
  return (
    <div className={`card border-t-4 p-4 text-center ${c}`}>
      <div className="text-2xl font-extrabold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

/** Ô "Rời trang": số lần (tô cam từ 3 lần) + tổng thời gian rời */
function AwayCell({ a }: { a: Attempt }) {
  const { t } = useT();
  if (a.score == null || a.away_count == null) return <span className="text-muted">—</span>;
  const n = a.away_count;
  const secs = a.away_seconds ?? 0;
  const dur = secs >= 60 ? t("{m} phút {s}s", { m: Math.floor(secs / 60), s: secs % 60 }) : `${secs}s`;
  return (
    <span
      title={n ? t("Rời trang {n} lần, tổng {d}", { n, d: dur }) : t("Không rời trang")}
      className={`inline-flex items-baseline gap-1 whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-semibold ${n >= 3 ? "bg-orange-100 text-warn" : n > 0 ? "bg-gray-100 text-ink" : "text-muted"}`}
    >
      {n === 0 ? "0" : t("{n} lần", { n })}
      {n > 0 && <span className="font-normal opacity-80">· {dur}</span>}
    </span>
  );
}

/** Nhãn "Lần 2", "Lần 3"… cạnh tên học viên; rê chuột xem điểm các lần trước */
function AttemptBadge({ info, always }: { info?: { no: number; prev: Attempt[] }; always?: boolean }) {
  const { t } = useT();
  if (!info || (info.no === 1 && !always)) return null;
  const hist = info.prev.map((p, i) => `${t("Lần {n}", { n: i + 1 })}: ${p.score != null ? `${p.score}/${p.total}` : t("chưa nộp")}`).join(" · ");
  return (
    <span
      title={hist || undefined}
      className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[calc(0.6875rem*var(--fs,1))] font-bold ${info.no > 1 ? "bg-sky-soft text-sky-ink" : "bg-gray-100 text-muted"}`}
    >
      {t("Lần {n}", { n: info.no })}
    </span>
  );
}
