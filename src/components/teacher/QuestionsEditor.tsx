"use client";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { parseAnswerKey } from "@/lib/parse";
import { fileToImageDataUrl, loadPdfLocal } from "@/lib/pdf-client";
import { regradeQuiz } from "@/lib/quiz-db";
import { Html } from "@/components/QuestionText";
import type { DraftQuestion, Quiz, QuestionRow, Section } from "@/lib/types";
import { confirmDialog, toast } from "@/components/ui/feedback";
import { useT } from "@/lib/i18n/client";

type EditQ = DraftQuestion & { key: string };

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

export function QuestionsEditor({
  quiz,
  questions,
  submittedCount,
  onSaved,
  onDirtyChange,
}: {
  quiz: Quiz;
  questions: QuestionRow[];
  submittedCount: number;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useT();
  const [items, setItems] = useState<EditQ[]>([]);
  const [sections, setSections] = useState<Section[]>(quiz.sections ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [bulk, setBulk] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [filter, setFilter] = useState<"all" | "review" | "missing">("all");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfAvailable, setPdfAvailable] = useState(false);

  useEffect(() => {
    setItems(questions.map((q) => ({ ...q, key: newKey() })));
    setSections(quiz.sections ?? []);
    setDirty(false);
  }, [questions, quiz.sections]);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    if (!quiz.source_file_hash) return;
    loadPdfLocal(quiz.source_file_hash).then((b) => setPdfAvailable(!!b));
  }, [quiz.source_file_hash]);

  const stats = useMemo(
    () => ({
      review: items.filter((q) => q.needs_review).length,
      missing: items.filter((q) => !q.correct_label).length,
    }),
    [items]
  );

  function update(key: string, patch: Partial<EditQ>) {
    setItems((arr) => arr.map((q) => (q.key === key ? { ...q, ...patch } : q)));
    setDirty(true);
  }

  async function openPdf() {
    if (!quiz.source_file_hash) return;
    const blob = await loadPdfLocal(quiz.source_file_hash);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    if (window.innerWidth < 1024) window.open(url, "_blank");
    else setPdfUrl(pdfUrl ? null : url);
  }

  function applyBulk() {
    const map = parseAnswerKey(bulk);
    let n = 0;
    setItems((arr) =>
      arr.map((q) => {
        const l = map[q.number];
        if (!l || !q.options.some((o) => o.label === l)) return q;
        n++;
        return { ...q, correct_label: l, answer_source: "manual", needs_review: false };
      })
    );
    setDirty(true);
    setMsg(t("Đã áp {n} đáp án từ bảng.", { n: Object.keys(map).length }));
    setShowBulk(false);
    setBulk("");
    void n;
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const sb = supabaseBrowser();
    try {
      const keepIds = new Set(items.filter((q) => q.id).map((q) => q.id!));
      const removed = questions.filter((q) => !keepIds.has(q.id)).map((q) => q.id);
      const answerChanged = items.some((q) => {
        const old = questions.find((o) => o.id === q.id);
        return !old || old.correct_label !== q.correct_label;
      }) || removed.length > 0;

      if (removed.length) {
        const { error } = await sb.from("questions").delete().in("id", removed);
        if (error) throw error;
      }
      const rows = items.map((q, i) => ({
        ...(q.id ? { id: q.id } : {}),
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
      }));
      const existing = rows.filter((r) => "id" in r);
      const fresh = rows.filter((r) => !("id" in r));
      if (existing.length) {
        const { error } = await sb.from("questions").upsert(existing);
        if (error) throw error;
      }
      if (fresh.length) {
        const { error } = await sb.from("questions").insert(fresh);
        if (error) throw error;
      }
      const { error: e3 } = await sb.from("quizzes").update({ sections }).eq("id", quiz.id);
      if (e3) throw e3;

      setDirty(false);
      if (answerChanged && submittedCount > 0 && (await confirmDialog({ title: t("Chấm lại bài đã nộp?"), message: t("Đáp án đã thay đổi. Chấm lại {n} bài đã nộp theo đáp án mới?", { n: submittedCount }), confirmText: t("Chấm lại"), cancelText: t("Để sau") }))) {
        const n = await regradeQuiz(quiz.id);
        setMsg(t("Đã lưu và chấm lại {n} bài.", { n }));
      } else setMsg(t("Đã lưu thay đổi."));
      toast(t("Đã lưu thay đổi"));
      onSaved();
    } catch (e) {
      setMsg(t("Lỗi khi lưu: ") + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  function addQuestion() {
    const maxNo = items.reduce((m, q) => Math.max(m, q.number), 0);
    setItems((arr) => [
      ...arr,
      {
        key: newKey(),
        number: maxNo + 1,
        section_index: null,
        stem: "",
        options: ["A", "B", "C", "D"].map((l) => ({ label: l, text: "" })),
        correct_label: null,
        answer_source: "manual",
        confidence: null,
        needs_review: false,
        explanation: null,
      },
    ]);
    setDirty(true);
  }

  const visible = items.filter((q) => (filter === "review" ? q.needs_review : filter === "missing" ? !q.correct_label : true));
  const shownSections = new Set<number>();

  return (
    <div className={pdfUrl ? "grid gap-4 lg:grid-cols-2" : ""}>
      {pdfUrl && (
        <div className="hidden lg:block">
          <iframe src={pdfUrl} className="sticky top-20 h-[calc(100vh-6rem)] w-full rounded-2xl border border-gray-200" title={t("PDF gốc")} />
        </div>
      )}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterBtn on={filter === "all"} onClick={() => setFilter("all")}>{t("Tất cả ({n})", { n: items.length })}</FilterBtn>
          <FilterBtn on={filter === "review"} onClick={() => setFilter("review")}>⚠️ {t("Cần kiểm tra ({n})", { n: stats.review })}</FilterBtn>
          <FilterBtn on={filter === "missing"} onClick={() => setFilter("missing")}>{t("Thiếu đáp án ({n})", { n: stats.missing })}</FilterBtn>
          <div className="ml-auto flex gap-2">
            {pdfAvailable && <button className="btn-ghost border border-gray-200" onClick={openPdf}>{pdfUrl ? t("Ẩn PDF") : t("Xem PDF gốc")}</button>}
            <button className="btn-ghost border border-gray-200" onClick={() => setShowBulk(!showBulk)}>{t("Dán bảng đáp án")}</button>
          </div>
        </div>

        {showBulk && (
          <div className="card mb-3 p-4">
            <textarea className="input min-h-24 font-mono text-sm" placeholder={t("1A 2C 3B 4D … hoặc 1-A, 2-C …")} value={bulk} onChange={(e) => setBulk(e.target.value)} />
            <div className="mt-2 flex items-center justify-between text-sm text-muted">
              <span>{t("Đọc được {n} đáp án", { n: Object.keys(parseAnswerKey(bulk)).length })}</span>
              <button className="btn-primary" onClick={applyBulk} disabled={!bulk.trim()}>{t("Áp dụng")}</button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {visible.map((q) => {
            const sec = q.section_index != null ? sections[q.section_index] : null;
            const showSec = sec && q.section_index != null && !shownSections.has(q.section_index) && filter === "all";
            if (showSec) shownSections.add(q.section_index!);
            return (
              <div key={q.key}>
                {showSec && (
                  <div className="card mb-3 border-primary-line bg-primary-soft p-4">
                    <input
                      className="input mb-2 bg-white text-sm font-semibold"
                      value={sec!.instruction ?? ""}
                      placeholder={t("Hướng dẫn phần")}
                      onChange={(e) => {
                        const s = [...sections];
                        s[q.section_index!] = { ...sec!, instruction: e.target.value };
                        setSections(s);
                        setDirty(true);
                      }}
                    />
                    {sec!.passage != null && (
                      <textarea
                        className="input min-h-28 bg-white text-sm"
                        value={sec!.passage ?? ""}
                        onChange={(e) => {
                          const s = [...sections];
                          s[q.section_index!] = { ...sec!, passage: e.target.value };
                          setSections(s);
                          setDirty(true);
                        }}
                      />
                    )}
                  </div>
                )}
                <QuestionCard q={q} onChange={(p) => update(q.key, p)} onDelete={() => { setItems((a) => a.filter((x) => x.key !== q.key)); setDirty(true); }} />
              </div>
            );
          })}
          {visible.length === 0 && <p className="card p-6 text-center text-muted">{t("Không có câu nào trong bộ lọc này.")}</p>}
        </div>

        <button className="btn-outline mt-4 w-full" onClick={addQuestion}>{t("+ Thêm câu hỏi")}</button>

        <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="flex-1 text-sm text-muted">{msg ?? (dirty ? t("Có thay đổi chưa lưu") : t("Đã lưu"))}</span>
            <button className="btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? t("Đang lưu…") : t("Lưu thay đổi")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${on ? "border-primary bg-primary text-white" : "border-gray-200 bg-white"}`}>
      {children}
    </button>
  );
}

function QuestionCard({ q, onChange, onDelete }: { q: EditQ; onChange: (p: Partial<EditQ>) => void; onDelete: () => void }) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  return (
    <div className={`card p-4 ${q.needs_review ? "border-orange-300 ring-1 ring-orange-200" : !q.correct_label ? "border-red-300" : ""}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-bold">{t("Câu {n}", { n: q.number })}</span>
        {q.answer_source === "from_pdf" && <span className="badge bg-primary-soft text-primary-dark">{t("Từ PDF")}</span>}
        {q.answer_source === "ai_solved" && (
          <span className="badge bg-blue-50 text-blue-700">{t("AI giải")}{q.confidence != null ? ` · ${Math.round(q.confidence * 100)}%` : ""}</span>
        )}
        {q.answer_source === "manual" && q.correct_label && <span className="badge bg-gray-100 text-gray-700">{t("Nhập tay")}</span>}
        {q.needs_review && (
          <button className="badge bg-orange-100 text-warn" onClick={() => onChange({ needs_review: false })} title={t("Bấm để xác nhận đã kiểm tra")}>
            {t("⚠️ Cần kiểm tra · bấm để xác nhận")}
          </button>
        )}
        {!q.correct_label && <span className="badge bg-red-50 text-danger">{t("Thiếu đáp án")}</span>}
        <div className="ml-auto flex gap-1">
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(!editing)}>{editing ? "Xong" : t("Sửa")}</button>
          <button className="btn-ghost px-2 py-1 text-xs text-danger" onClick={async () => (await confirmDialog({ title: t("Xoá câu hỏi"), message: t("Xoá câu {n}? (Bấm “Lưu thay đổi” sau đó mới xoá hẳn.)", { n: q.number }), confirmText: t("Xoá"), danger: true })) && onDelete()}>{t("Xoá")}</button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input type="number" className="input w-24" value={q.number} onChange={(e) => onChange({ number: Number(e.target.value) || q.number })} />
            <textarea className="input min-h-16 flex-1" value={q.stem} onChange={(e) => onChange({ stem: e.target.value })} placeholder={t("Nội dung câu hỏi (dùng <u>…</u> để gạch chân)")} />
          </div>
          {q.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 font-bold">{o.label}.</span>
              <input
                className="input flex-1"
                value={o.text}
                onChange={(e) => onChange({ options: q.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
              />
            </div>
          ))}
          <div className="flex gap-2">
            {q.options.length < 6 && (
              <button
                className="btn-ghost border border-gray-200 text-xs"
                onClick={() => onChange({ options: [...q.options, { label: String.fromCharCode(65 + q.options.length), text: "" }] })}
              >
                {t("+ Phương án")}
              </button>
            )}
            {q.options.length > 2 && (
              <button
                className="btn-ghost border border-gray-200 text-xs"
                onClick={() => {
                  const last = q.options[q.options.length - 1].label;
                  onChange({ options: q.options.slice(0, -1), correct_label: q.correct_label === last ? null : q.correct_label });
                }}
              >
                {t("− Bớt phương án")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="mb-2 leading-relaxed"><Html text={q.stem} /></p>
      )}

      {q.image && (
        <div className="mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={q.image} alt={t("Hình câu {n}", { n: q.number })} className="max-h-72 max-w-full rounded-xl border border-gray-200 object-contain" />
        </div>
      )}
      {editing && (
        <div className="mb-2 flex flex-wrap gap-2">
          <label className="btn-ghost cursor-pointer border border-gray-200 text-xs">
            {q.image ? t("🖼️ Thay hình") : t("🖼️ Thêm hình")}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  onChange({ image: await fileToImageDataUrl(f) });
                } catch {
                  toast(t("Không đọc được file ảnh này."), "error");
                }
              }}
            />
          </label>
          {q.image && (
            <button className="btn-ghost border border-gray-200 text-xs text-danger" onClick={() => onChange({ image: null })}>
              {t("Xoá hình")}
            </button>
          )}
        </div>
      )}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {q.options.map((o) => {
          const on = q.correct_label === o.label;
          return (
            <button
              key={o.label}
              onClick={() => onChange({ correct_label: o.label, answer_source: q.correct_label === o.label ? q.answer_source : "manual", needs_review: false })}
              className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm ${on ? "border-primary bg-primary-soft font-semibold" : "border-gray-200 hover:border-primary-line"}`}
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${on ? "border-primary bg-primary text-white" : "border-gray-300"}`}>
                {on ? "✓" : o.label}
              </span>
              <span><b>{o.label}.</b> <Html text={o.text} /></span>
            </button>
          );
        })}
      </div>
      {q.explanation && <p className="mt-2 text-xs text-muted">💡 {q.explanation}</p>}
    </div>
  );
}
