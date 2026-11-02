"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { QuestionsEditor } from "@/components/teacher/QuestionsEditor";
import { ResultsPanel } from "@/components/teacher/ResultsPanel";
import { SharePanel } from "@/components/teacher/SharePanel";
import { duplicateQuiz } from "@/lib/quiz-db";
import { downloadDocx, loadExportData } from "@/lib/export-doc";
import { STATUS_LABEL } from "@/lib/ui";
import type { Quiz, QuestionRow } from "@/lib/types";
import { alertDialog, confirmDialog, toast } from "@/components/ui/feedback";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n/client";

type Tab = "questions" | "results" | "settings";

export default function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useT();
  const { id } = use(params);
  const router = useRouter();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [dirty, setDirty] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data: q }, { data: qs }, { count }] = await Promise.all([
      sb.from("quizzes").select("*").eq("id", id).maybeSingle(),
      sb.from("questions").select("*").eq("quiz_id", id).order("position"),
      sb.from("attempts").select("id", { count: "exact", head: true }).eq("quiz_id", id).eq("status", "submitted"),
    ]);
    if (!q) {
      setNotFound(true);
      return;
    }
    setQuiz(q as Quiz);
    setQuestions((qs as QuestionRow[]) ?? []);
    setSubmittedCount(count ?? 0);
    setTab((t) => t ?? ((q as Quiz).status === "draft" ? "questions" : "results"));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  async function setStatus(status: Quiz["status"]) {
    if (!quiz) return;
    if (status === "open" && quiz.status === "draft") {
      if (dirty) return alertDialog(t("Hãy bấm “Lưu thay đổi” trước khi xuất bản."), t("Chưa lưu thay đổi"));
      if (questions.length === 0) return alertDialog(t("Đề chưa có câu hỏi nào."), t("Chưa thể xuất bản"));
      const missing = questions.filter((q) => !q.correct_label);
      if (missing.length) return alertDialog(t("Còn {n} câu chưa có đáp án (câu {list}…). Hãy bổ sung trước khi xuất bản.", { n: missing.length, list: missing.slice(0, 10).map((q) => q.number).join(", ") }));
      const review = questions.filter((q) => q.needs_review).length;
      if (review && !(await confirmDialog({ title: t("Còn câu cần kiểm tra"), message: t("Còn {n} câu được đánh dấu “Cần kiểm tra”. Vẫn xuất bản?", { n: review }), confirmText: t("Vẫn xuất bản"), cancelText: t("Kiểm tra lại") }))) return;
    }
    const { error } = await supabaseBrowser().from("quizzes").update({ status }).eq("id", quiz.id);
    if (error) return toast(error.message, "error");
    toast(status === "open" ? t("Đề đã mở") : status === "closed" ? t("Đã đóng đề") : t("Đã cập nhật"));
    setMsg(status === "open" ? t("Đề đã mở — gửi link cho học viên.") : status === "closed" ? t("Đã đóng đề, không nhận bài mới.") : null);
    load();
  }

  if (notFound) return <p className="card p-6 text-center">{t("Không tìm thấy đề.")} <Link className="text-primary-dark underline" href="/dashboard">{t("Về danh sách")}</Link></p>;
  if (!quiz || !tab) return <PageSkeleton />;

  const st = STATUS_LABEL[quiz.status];

  return (
    <div>
      <Link href="/dashboard" className="text-sm text-primary-dark hover:underline">{t("← Về danh sách đề")}</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{quiz.title}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <span className={`badge ${st.cls}`}>{t(st.text)}</span> {t("{n} câu", { n: questions.length })}
            {quiz.time_limit_min ? ` · ${t("{n} phút", { n: quiz.time_limit_min })}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <ExportMenu quizId={quiz.id} dirty={dirty} />
          {quiz.status === "draft" && <button className="btn-primary" onClick={() => setStatus("open")}>{t("🚀 Xuất bản")}</button>}
          {quiz.status === "open" && <button className="btn-outline" onClick={() => setStatus("closed")}>{t("Đóng đề")}</button>}
          {quiz.status === "closed" && <button className="btn-primary" onClick={() => setStatus("open")}>{t("Mở lại")}</button>}
        </div>
      </div>
      {msg && <p className="mt-3 rounded-xl bg-primary-soft p-3 text-sm text-primary-dark">{msg}</p>}
      {quiz.status === "draft" && (
        <p className="mt-3 rounded-xl bg-orange-50 p-3 text-sm text-warn">
          {t("Đề đang ở trạng thái nháp. Kiểm tra đáp án (đặc biệt các câu “Cần kiểm tra”), bấm Lưu, rồi bấm")} <b>{t("Xuất bản")}</b> {t("để có link cho học viên.")}
        </p>
      )}
      {quiz.status !== "draft" && <div className="mt-4"><SharePanel slug={quiz.slug} /></div>}

      <div className="mt-5 flex gap-1 border-b border-gray-200">
        {(
          [
            ["questions", t("Đề & đáp án")],
            ["results", t("Kết quả ({n})", { n: submittedCount })],
            ["settings", t("Cài đặt")],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={async () => {
              if (dirty && k !== "questions" && !(await confirmDialog({ title: t("Chưa lưu thay đổi"), message: t("Có thay đổi chưa lưu ở tab Đề & đáp án. Rời tab này?"), confirmText: t("Rời tab"), cancelText: t("Ở lại") }))) return;
              setTab(k);
            }}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === k ? "border-primary text-primary-dark" : "border-transparent text-muted"}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "questions" && (
          <QuestionsEditor quiz={quiz} questions={questions} submittedCount={submittedCount} onSaved={load} onDirtyChange={setDirty} />
        )}
        {tab === "results" && <ResultsPanel quiz={quiz} questions={questions} onCountChange={setSubmittedCount} />}
        {tab === "settings" && (
          <Settings
            quiz={quiz}
            onSaved={load}
            onDuplicate={async () => router.push(`/dashboard/quiz/${await duplicateQuiz(quiz.id)}`)}
            onDeleted={() => router.replace("/dashboard")}
          />
        )}
      </div>
    </div>
  );
}

function ExportMenu({ quizId, dirty }: { quizId: string; dirty: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const word = async (withAnswers: boolean) => {
    setOpen(false);
    if (dirty && !(await confirmDialog({ title: t("Chưa lưu thay đổi"), message: t("File xuất sẽ dùng bản đã lưu, chưa gồm thay đổi mới. Tiếp tục?"), confirmText: t("Tiếp tục") }))) return;
    setBusy(true);
    try {
      await downloadDocx(await loadExportData(quizId), withAnswers);
    } catch (e) {
      toast(t("Không xuất được file Word: ") + (e instanceof Error ? e.message : String(e)), "error");
    }
    setBusy(false);
  };
  const pdf = (withAnswers: boolean) => {
    setOpen(false);
    window.open(`/dashboard/quiz/${quizId}/print${withAnswers ? "?key=1" : ""}`, "_blank");
  };
  return (
    <div className="relative">
      <button className="btn-outline" disabled={busy} onClick={() => setOpen(!open)}>
        {busy ? t("Đang tạo file…") : t("🖨️ Xuất đề ▾")}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white text-sm shadow-lg">
            <div className="bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase text-muted">Word (.docx)</div>
            <button className="block w-full px-3 py-2 text-left hover:bg-primary-soft" onClick={() => word(false)}>{t("📄 Đề cho học viên")}</button>
            <button className="block w-full px-3 py-2 text-left hover:bg-primary-soft" onClick={() => word(true)}>{t("📄 Đề có đáp án (giáo viên)")}</button>
            <div className="bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase text-muted">PDF / In</div>
            <button className="block w-full px-3 py-2 text-left hover:bg-primary-soft" onClick={() => pdf(false)}>{t("🖨️ Đề cho học viên")}</button>
            <button className="block w-full px-3 py-2 text-left hover:bg-primary-soft" onClick={() => pdf(true)}>{t("🖨️ Đề có đáp án (giáo viên)")}</button>
          </div>
        </>
      )}
    </div>
  );
}

function Settings({ quiz, onSaved, onDuplicate, onDeleted }: { quiz: Quiz; onSaved: () => void; onDuplicate: () => void; onDeleted: () => void }) {
  const { t } = useT();
  const [title, setTitle] = useState(quiz.title);
  const [limit, setLimit] = useState(quiz.time_limit_min ? String(quiz.time_limit_min) : "");
  const [shuffle, setShuffle] = useState(quiz.shuffle_questions);
  const [shuffleOpts, setShuffleOpts] = useState(!!quiz.shuffle_options);
  const [showAns, setShowAns] = useState(quiz.show_answers);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    const n = parseInt(limit, 10);
    const { error } = await supabaseBrowser()
      .from("quizzes")
      .update({ title: title.trim() || quiz.title, time_limit_min: n > 0 ? n : null, shuffle_questions: shuffle, shuffle_options: shuffleOpts, show_answers: showAns })
      .eq("id", quiz.id);
    setMsg(error ? t("Lỗi: ") + error.message : t("Đã lưu cài đặt."));
    if (!error) toast(t("Đã lưu cài đặt"));
    if (!error) onSaved();
  }

  async function remove() {
    if (!(await confirmDialog({ title: t("Xoá đề vĩnh viễn"), message: t("Xoá vĩnh viễn đề “{title}” và toàn bộ kết quả?\n\nNếu chưa sao lưu, hãy bấm Huỷ rồi vào Tài khoản & sao lưu → Tải file sao lưu trước. Có file sao lưu thì khôi phục lại được.", { title: quiz.title }), confirmText: t("Xoá đề"), danger: true }))) return;
    const { error } = await supabaseBrowser().from("quizzes").delete().eq("id", quiz.id);
    if (error) return toast(error.message, "error");
    toast(t("Đã xoá đề"));
    onDeleted();
  }

  return (
    <div className="max-w-xl space-y-5">
      <div className="card space-y-4 p-5">
        <div>
          <label htmlFor="f96186" className="label">{t("Tên đề")}</label>
          <input id="f96186" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor="f63470" className="label">{t("Giới hạn thời gian (phút)")}</label>
          <input id="f63470" className="input" type="number" min={1} placeholder={t("Để trống = không giới hạn")} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        <Toggle checked={shuffle} onChange={setShuffle} label={t("Xáo trộn thứ tự câu hỏi")} hint={t("Mỗi học viên thấy một thứ tự khác nhau (câu đọc hiểu vẫn đi cùng đoạn văn).")} />
        <Toggle
          checked={shuffleOpts}
          onChange={setShuffleOpts}
          label={t("Xáo thứ tự đáp án A/B/C/D")}
          hint={t("Mỗi học viên thấy đáp án theo thứ tự khác nhau. Câu kiểu “All of the above / Both A and B” được giữ nguyên. Kết quả giáo viên xem vẫn theo chữ cái của đề gốc. Nên bật/tắt khi chưa có học viên đang làm bài.")}
        />
        <Toggle checked={showAns} onChange={setShowAns} label={t("Cho học viên xem đáp án đúng sau khi nộp")} hint={t("Tắt nếu muốn dùng lại đề cho lớp khác.")} />
        {msg && <p className="text-sm text-primary-dark">{msg}</p>}
        <button className="btn-primary w-full" onClick={save}>{t("Lưu cài đặt")}</button>
      </div>
      <div className="card space-y-2 p-5">
        <button className="btn-outline w-full" onClick={onDuplicate}>{t("Nhân bản đề")}</button>
        <button className="btn-danger w-full" onClick={remove}>{t("Xoá đề")}</button>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-5 w-5 accent-[#15803d]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
    </label>
  );
}
