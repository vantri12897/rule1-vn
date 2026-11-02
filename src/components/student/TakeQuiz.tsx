"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html } from "@/components/QuestionText";
import { safeHtml } from "@/lib/sanitize";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { PublicQuestion, Section } from "@/lib/types";
import { confirmDialog } from "@/components/ui/feedback";
import { StudentSkeleton } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n/client";

export type QuizInfo = { title: string; status: "open" | "closed"; sections: Section[]; time_limit_min: number | null; question_count: number };
type Result = {
  score: number;
  total: number;
  submitted_at: string | null;
  show_answers: boolean;
  details: { question_id: string; number: number; selected: string | null; correct: string | null; is_correct: boolean }[];
};
type View = "loading" | "notfound" | "closed" | "name" | "taking" | "result";

function getToken(): string {
  let t = localStorage.getItem("yd-token");
  if (!t) {
    t = crypto.randomUUID();
    localStorage.setItem("yd-token", t);
  }
  return t;
}

export function TakeQuiz({ slug, initialQuiz }: { slug: string; initialQuiz: QuizInfo | null }) {
  const { t } = useT();
  // Đề đang mở → hiện ngay form nhập tên từ máy chủ (không phải chờ tải); học viên quay lại sẽ được chuyển sang bài đang làm/kết quả
  const [view, setView] = useState<View>(initialQuiz ? (initialQuiz.status === "open" ? "name" : "loading") : "notfound");
  // Thông tin đề được máy chủ gửi sẵn → tên đề hiện ngay, không phải chờ tải
  const [quiz, setQuiz] = useState<QuizInfo | null>(initialQuiz);
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [studentName, setStudentName] = useState("");
  const [deadline, setDeadline] = useState<number | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tokenRef = useRef<string>("");
  const ansKey = `yd-ans-${slug}`;

  const applyTaking = useCallback(
    (data: { attempt: { student_name: string; deadline: string | null; answers?: Record<string, string> }; questions: PublicQuestion[]; server_time?: string }) => {
      setQuestions(data.questions);
      setStudentName(data.attempt.student_name);
      if (data.server_time) setClockOffset(new Date(data.server_time).getTime() - Date.now());
      setDeadline(data.attempt.deadline ? new Date(data.attempt.deadline).getTime() : null);
      const local = JSON.parse(localStorage.getItem(ansKey) || "{}");
      setAnswers({ ...(data.attempt.answers ?? {}), ...local });
      setView("taking");
    },
    [ansKey]
  );

  const startedKey = `yd-started-${slug}`;

  useEffect(() => {
    tokenRef.current = getToken();
    // Thiết bị chưa từng bắt đầu đề này và đề đang mở → giữ form nhập tên, không cần hỏi máy chủ
    if (initialQuiz?.status === "open" && !localStorage.getItem(startedKey)) return;
    setView("loading");
    fetch(`/api/public/quiz/${slug}?token=${tokenRef.current}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return setView("notfound");
        const data = await r.json();
        setQuiz(data.quiz);
        if (data.result) {
          setQuestions(data.questions);
          setResult(data.result);
          setStudentName(data.attempt.student_name);
          setView("result");
        } else if (data.attempt) applyTaking(data);
        else setView(data.quiz.status === "open" ? "name" : "closed");
      })
      .catch(() => setView("notfound"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, applyTaking]);

  useEffect(() => {
    if (view === "taking") localStorage.setItem(ansKey, JSON.stringify(answers));
  }, [answers, view, ansKey]);

  async function start(name: string, cls: string) {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/public/quiz/${slug}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenRef.current, name, student_class: cls || null }),
    });
    const data = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(data.error || t("Không bắt đầu được, thử lại."));
    localStorage.setItem(startedKey, "1");
    if (data.result) {
      // Thiết bị này đã nộp bài đề này từ trước → hiện lại kết quả
      setQuestions(data.questions);
      setResult(data.result);
      setStudentName(data.attempt.student_name);
      setView("result");
      return;
    }
    applyTaking(data);
  }

  const submit = useCallback(
    async (auto = false) => {
      if (busy) return;
      const unanswered = questions.length - Object.keys(answers).filter((k) => questions.some((q) => q.id === k)).length;
      if (!auto && unanswered > 0 && !(await confirmDialog({ title: t("Còn câu chưa làm"), message: t("Bạn còn {n} câu chưa làm. Vẫn nộp bài?", { n: unanswered }), confirmText: t("Vẫn nộp"), cancelText: t("Làm tiếp") }))) return;
      if (!auto && unanswered === 0 && !(await confirmDialog({ title: t("Nộp bài"), message: t("Nộp bài? Sau khi nộp sẽ không sửa được."), confirmText: t("Nộp bài"), cancelText: t("Xem lại") }))) return;
      setBusy(true);
      setError(null);
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(`/api/public/quiz/${slug}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: tokenRef.current, answers }),
          });
          const data = await r.json();
          if (r.ok) {
            localStorage.removeItem(ansKey);
            setResult(data.result);
            setView("result");
            window.scrollTo({ top: 0 });
            setBusy(false);
            return;
          }
          setError(data.error || t("Nộp bài thất bại"));
          break;
        } catch {
          await new Promise((res) => setTimeout(res, 2000));
        }
      }
      setError((e) => e ?? t("Mất kết nối. Bài làm vẫn được giữ trên máy — kiểm tra mạng rồi bấm Nộp bài lại."));
      setBusy(false);
    },
    [answers, busy, questions, slug, ansKey]
  );

  return (
    <main className="bg-dots min-h-screen">
      <header className="sticky top-0 z-30 border-b border-primary-line bg-white/95 backdrop-blur">
        <div className="stripe h-1" />
        <div className={`mx-auto flex items-center gap-3 px-4 py-3 ${view === "taking" ? "max-w-7xl" : "max-w-2xl"}`}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-xs font-extrabold text-white">YD</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{quiz?.title ?? "YD-English"}</div>
            {studentName && <div className="truncate text-xs text-muted">{studentName}</div>}
          </div>
          {view === "taking" && deadline && <Countdown deadline={deadline} offset={clockOffset} onEnd={() => submit(true)} />}
          <LanguageSwitcher compact />
        </div>
        {view === "taking" && <Progress done={questions.filter((q) => answers[q.id]).length} total={questions.length} />}
      </header>

      <div className={`mx-auto px-4 py-5 ${view === "taking" ? "max-w-7xl" : "max-w-2xl"}`}>
        {view === "loading" &&
          (quiz ? (
            <div className="card mt-4 p-6 text-center">
              <h1 className="text-xl font-bold">{quiz.title}</h1>
              <p className="mt-1 text-sm text-muted">
                {t("{n} câu", { n: quiz.question_count })}{quiz.time_limit_min ? ` · ${t("{n} phút", { n: quiz.time_limit_min })}` : ""}
              </p>
              <div className="mx-auto mt-5 h-1.5 w-24 overflow-hidden rounded-full bg-primary-line">
                <div className="h-full w-1/2 animate-pulse bg-primary" />
              </div>
            </div>
          ) : (
            <StudentSkeleton />
          ))}
        {view === "notfound" && <Message title={t("Không tìm thấy bài kiểm tra")} text={t("Link không đúng hoặc đề chưa được giáo viên xuất bản.")} />}
        {view === "closed" && <Message title={t("Đề đã đóng")} text={t("Giáo viên đã ngừng nhận bài cho đề này.")} />}
        {view === "name" && quiz && <NameForm quiz={quiz} busy={busy} error={error} onStart={start} />}
        {view === "taking" && quiz && (
          <TakingView quiz={quiz} questions={questions} answers={answers} setAnswers={setAnswers} busy={busy} error={error} onSubmit={() => submit(false)} />
        )}
        {view === "result" && result && <ResultView result={result} questions={questions} sections={quiz?.sections ?? []} />}
      </div>
      <footer className="pb-8 text-center text-xs text-muted">YD-English</footer>
    </main>
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="card mt-10 p-8 text-center">
      <div className="text-4xl">📝</div>
      <h1 className="mt-3 text-xl font-bold">{title}</h1>
      <p className="mt-1 text-muted">{text}</p>
    </div>
  );
}

function NameForm({ quiz, busy, error, onStart }: { quiz: QuizInfo; busy: boolean; error: string | null; onStart: (n: string, c: string) => void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [cls, setCls] = useState("");
  return (
    <form
      className="card mt-4 space-y-4 overflow-hidden p-6 pt-0 shadow-md"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onStart(name.trim(), cls.trim());
      }}
    >
      <div className="-mx-6 bg-gradient-to-br from-primary-soft via-teal-soft to-sky-soft px-6 pb-5 pt-6 text-center">
        <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-white text-2xl shadow-sm" aria-hidden>📝</div>
        <h1 className="text-xl font-bold">{quiz.title}</h1>
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-sm">
          <span className="rounded-full bg-white px-3 py-1 font-semibold text-primary-dark shadow-sm">📋 {t("{n} câu", { n: quiz.question_count })}</span>
          <span className="rounded-full bg-white px-3 py-1 font-semibold text-sun-ink shadow-sm">
            ⏱ {quiz.time_limit_min ? t("{n} phút", { n: quiz.time_limit_min }) : t("Không giới hạn")}
          </span>
        </div>
      </div>
      <div>
        <label htmlFor="f41519" className="label">{t("Họ và tên *")}</label>
        <input id="f41519" className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Nguyễn Văn A")} autoFocus />
      </div>
      <div>
        <label htmlFor="f24574" className="label">{t("Lớp / Mã học viên")}</label>
        <input id="f24574" className="input" maxLength={60} value={cls} onChange={(e) => setCls(e.target.value)} placeholder={t("Không bắt buộc")} />
      </div>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full py-3 text-base" disabled={busy || !name.trim()}>{busy ? t("Đang vào…") : t("Bắt đầu làm bài")}</button>
      {quiz.time_limit_min && <p className="text-center text-xs text-muted">{t("Đồng hồ bắt đầu chạy ngay khi bạn bấm nút. Hết giờ bài tự nộp.")}</p>}
    </form>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="h-1.5 bg-primary-line/50">
      <div className="h-full bg-primary transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
    </div>
  );
}

function Countdown({ deadline, offset, onEnd }: { deadline: number; offset: number; onEnd: () => void }) {
  const { t } = useT();
  const [left, setLeft] = useState(() => deadline - (Date.now() + offset));
  const fired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      const l = deadline - (Date.now() + offset);
      setLeft(l);
      if (l <= 0 && !fired.current) {
        fired.current = true;
        onEnd();
      }
    }, 500);
    return () => clearInterval(t);
  }, [deadline, offset, onEnd]);
  const s = Math.max(0, Math.floor(left / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const tone = s < 60 ? "bg-red-600 text-white animate-pulse" : s < 300 ? "bg-orange-100 text-warn border border-orange-300" : "bg-primary-soft text-primary-dark border border-primary-line";
  return (
    <div className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 sm:px-4 sm:py-2 ${tone}`} role="timer" aria-live="off" aria-label={t("Còn {m} phút {s} giây", { m: Math.floor(s / 60), s: s % 60 })}>
      <span className="text-lg sm:text-xl" aria-hidden>⏱</span>
      <span className="font-mono text-xl font-extrabold tabular-nums sm:text-2xl">
        {h > 0 ? `${h}:` : ""}
        {mm}:{ss}
      </span>
    </div>
  );
}

/** "Question 1:" / "Câu 1." chỉ là số câu → không lặp lại sau "Câu 1." */
function cleanStem(stem: string) {
  return /^\s*(question|câu|cau)\s*\d+\s*[:.)]?\s*$/i.test(stem) ? "" : stem;
}

/** Đoạn văn có chỗ trống (1), (2)…: tô sáng chỗ trống của câu đang làm, đánh dấu chỗ đã làm */
function PassageHtml({ text, current, numbers, answered }: { text: string; current: number | null; numbers: Set<number>; answered: Set<number> }) {
  const html = safeHtml(text).replace(/\((\d{1,3})\)/g, (m, d: string) => {
    const n = Number(d);
    if (!numbers.has(n)) return m;
    if (n === current) return `<mark data-cur="1" class="rounded bg-yellow-200 px-1 font-bold text-ink ring-2 ring-yellow-400">(${n})</mark>`;
    return `<span class="rounded px-0.5 font-semibold ${answered.has(n) ? "bg-primary-soft text-primary-dark" : "text-primary-dark"}">(${n})</span>`;
  });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function TakingView({
  quiz,
  questions,
  answers,
  setAnswers,
  busy,
  error,
  onSubmit,
}: {
  quiz: QuizInfo;
  questions: PublicQuestion[];
  answers: Record<string, string>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const { t } = useT();
  const [showNav, setShowNav] = useState(false);
  const [showPassage, setShowPassage] = useState(false);
  const [current, setCurrent] = useState<string | null>(questions[0]?.id ?? null);
  const passageRef = useRef<HTMLDivElement>(null);
  const done = questions.filter((q) => answers[q.id]).length;
  const pick = (qid: string, label: string) => setAnswers((a) => ({ ...a, [qid]: label }));

  const hasPassage = quiz.sections.some((s) => s?.passage && s.passage.trim().length > 0);
  const curQ = questions.find((q) => q.id === current) ?? questions[0];
  const curSec = curQ?.section_index != null ? quiz.sections[curQ.section_index] : null;
  const secQs = curQ?.section_index != null ? questions.filter((q) => q.section_index === curQ.section_index) : [];
  const secNumbers = new Set(secQs.map((q) => q.number));
  const answeredNumbers = new Set(secQs.filter((q) => answers[q.id]).map((q) => q.number));
  const displayIndex = (qid: string) => questions.findIndex((q) => q.id === qid) + 1;

  // Theo dõi câu đang xem để đổi đoạn văn bên trái
  useEffect(() => {
    const els = questions.map((q) => document.getElementById(`q-${q.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0];
        if (vis) setCurrent(vis.target.id.slice(2));
      },
      { rootMargin: "-100px 0px -55% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [questions]);

  // Các nhóm câu theo đoạn văn / hướng dẫn (theo đúng thứ tự trong đề)
  const groups = useMemo(() => {
    const g: { sec: number; qs: PublicQuestion[] }[] = [];
    for (const q of questions) {
      if (q.section_index == null) continue;
      const last = g[g.length - 1];
      if (last && last.sec === q.section_index) last.qs.push(q);
      else g.push({ sec: q.section_index, qs: [q] });
    }
    return g;
  }, [questions]);
  const curGroup = groups.findIndex((g) => g.qs.some((q) => q.id === current));
  const prevGroup = useRef<number>(-1);

  // Cột trái hiện toàn bộ đề; khi sang nhóm câu khác thì tự cuộn tới đoạn đó,
  // còn trong cùng đoạn thì chỉ cuộn khi chỗ trống của câu đang làm bị khuất
  useEffect(() => {
    const box = passageRef.current;
    if (!box) return;
    const mark = box.querySelector<HTMLElement>("mark[data-cur]");
    const block = box.querySelector<HTMLElement>(`[data-group="${curGroup}"]`);
    const rel = (el: HTMLElement) => el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (curGroup !== prevGroup.current) {
      prevGroup.current = curGroup;
      if (mark) box.scrollTo({ top: rel(mark) - box.clientHeight / 3, behavior: "smooth" });
      else if (block) box.scrollTo({ top: rel(block) - 8, behavior: "smooth" });
      return;
    }
    if (mark) {
      const top = rel(mark);
      if (top < box.scrollTop + 40 || top > box.scrollTop + box.clientHeight - 60) box.scrollTo({ top: top - box.clientHeight / 3, behavior: "smooth" });
    }
  }, [current, curGroup]);

  const goTo = (qid: string) => document.getElementById(`q-${qid}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const passagePanel = curSec && (curSec.instruction || curSec.passage) ? (
    <>
      {secQs.length > 0 && (
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
          {t("Dùng cho câu")} {displayIndex(secQs[0].id)}
          {secQs.length > 1 ? `–${displayIndex(secQs[secQs.length - 1].id)}` : ""}
        </div>
      )}
      {curSec.instruction && (
        <p className="font-semibold italic leading-relaxed">
          <Html text={curSec.instruction} />
        </p>
      )}
      {curSec.passage && (
        <p className="mt-3 whitespace-pre-line text-[17px] leading-8">
          <PassageHtml text={curSec.passage} current={curQ?.number ?? null} numbers={secNumbers} answered={answeredNumbers} />
        </p>
      )}
    </>
  ) : null;

  // Toàn bộ đề bài cho cột trái (máy tính)
  const fullPanel = groups.map((g, k) => {
    const sec = quiz.sections[g.sec];
    if (!sec || (!sec.instruction && !sec.passage)) return null;
    const isCur = k === curGroup;
    const nums = new Set(g.qs.map((q) => q.number));
    const ans = new Set(g.qs.filter((q) => answers[q.id]).map((q) => q.number));
    const first = displayIndex(g.qs[0].id);
    const last = displayIndex(g.qs[g.qs.length - 1].id);
    return (
      <section
        key={k}
        data-group={k}
        className={`rounded-xl border-2 p-4 transition ${isCur ? "border-primary/50 bg-primary-soft/50" : "border-transparent"}`}
      >
        <button
          type="button"
          onClick={() => goTo(g.qs[0].id)}
          className={`mb-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${isCur ? "bg-primary text-white" : "bg-gray-100 text-muted hover:bg-primary-soft hover:text-primary-dark"}`}
          title={t("Bấm để tới câu hỏi của đoạn này")}
        >
          {t("Câu")} {first}
          {last !== first ? `–${last}` : ""}
        </button>
        {sec.instruction && (
          <p className="font-semibold italic leading-relaxed">
            <Html text={sec.instruction} />
          </p>
        )}
        {sec.passage && (
          <p className="mt-3 whitespace-pre-line text-[17px] leading-8">
            <PassageHtml text={sec.passage} current={isCur ? curQ?.number ?? null : null} numbers={nums} answered={ans} />
          </p>
        )}
      </section>
    );
  });

  let lastSection: number | null = null;

  return (
    <div className={hasPassage ? "lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-6" : "mx-auto max-w-3xl"}>
      {/* ===== CỘT TRÁI: ĐOẠN VĂN (đứng yên, đổi theo câu đang làm) ===== */}
      {hasPassage && (
        <aside className="hidden lg:sticky lg:top-24 lg:block">
          <div className="mb-2 flex items-baseline justify-between text-sm font-bold uppercase tracking-wide text-muted">
            <span>{t("📖 Đề bài (Question)")}</span>
            <span className="text-xs font-semibold normal-case tracking-normal">{t("Cuộn để xem toàn bộ đề")}</span>
          </div>
          <div ref={passageRef} className="card max-h-[calc(100vh-11.5rem)] space-y-2 overflow-y-auto overscroll-contain p-3">
            {fullPanel}
          </div>
        </aside>
      )}

      {/* ===== CỘT PHẢI: CÂU HỎI & CHỌN ĐÁP ÁN ===== */}
      <div>
        {hasPassage && <div className="mb-2 hidden text-sm font-bold uppercase tracking-wide text-muted lg:block">{t("✏️ Chọn đáp án (Answers)")}</div>}
        <div className="space-y-4">
          {questions.map((q, i) => {
            const sec = q.section_index != null ? quiz.sections[q.section_index] : null;
            const showSec = sec && q.section_index !== lastSection;
            lastSection = q.section_index;
            const isCur = current === q.id;
            const stem = cleanStem(q.stem);
            return (
              <div key={q.id}>
                {/* Trên điện thoại (hoặc đề không có đoạn văn): hướng dẫn/đoạn văn hiện ngay trước nhóm câu */}
                {showSec && (sec!.instruction || sec!.passage) && (
                  <div className={`card mb-4 border-primary-line p-4 ${hasPassage ? "lg:hidden" : ""}`}>
                    {sec!.instruction && <p className="font-semibold italic"><Html text={sec!.instruction} /></p>}
                    {sec!.passage && <p className="mt-2 whitespace-pre-line leading-relaxed"><Html text={sec!.passage} /></p>}
                  </div>
                )}
                {hasPassage && showSec && sec?.instruction && !sec.passage && (
                  <p className="mb-3 hidden text-sm font-semibold italic text-muted lg:block">
                    <Html text={sec.instruction} />
                  </p>
                )}
                <fieldset id={`q-${q.id}`} className={`card scroll-mt-28 p-4 transition ${isCur ? "ring-2 ring-primary/40" : ""}`}>
                  <legend className="sr-only">{t("Câu {n}", { n: i + 1 })}</legend>
                  <p className="mb-3 leading-relaxed">
                    <b className="text-primary-dark">{t("Câu {n}.", { n: i + 1 })}</b> {stem && <Html text={stem} />}
                  </p>
                  {q.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={q.image} alt={t("Hình câu {n}", { n: i + 1 })} className="mb-3 max-h-96 max-w-full rounded-xl border border-gray-200 bg-white object-contain" />
                  )}
                  <div className="space-y-2">
                    {q.options.map((o) => {
                      const on = answers[q.id] === o.label;
                      return (
                        <label
                          key={o.label}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 px-3 py-3 transition duration-150 active:scale-[.99] lg:py-2.5 ${on ? "border-primary bg-primary-soft" : "border-gray-200 bg-white hover:border-primary-line active:bg-gray-50"}`}
                        >
                          <input
                            type="radio"
                            name={q.id}
                            className={`mt-0.5 h-5 w-5 shrink-0 accent-[#15803d] ${on ? "yd-tick" : ""}`}
                            checked={on}
                            onChange={() => pick(q.id, o.label)}
                          />
                          <span>
                            <b>{o.label}.</b> <Html text={o.text} />
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
            );
          })}
        </div>
        <div className="h-28" />
      </div>

      {/* ===== THANH DƯỚI CÙNG: tiến độ, danh sách câu, nộp bài ===== */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-primary-line bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.05)] backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {showNav && (
          <div className="mx-auto max-h-[45vh] max-w-7xl overflow-y-auto border-b border-gray-100 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted">
              <span>{t("Bấm số câu để nhảy tới")}</span>
              <span>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-primary align-middle" />{t("đã làm")}
              </span>
            </div>
            <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12 lg:grid-cols-20">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  onClick={() => {
                    setShowNav(false);
                    goTo(q.id);
                  }}
                  className={`grid h-9 place-items-center rounded-lg text-sm font-semibold ${answers[q.id] ? "bg-primary text-white" : "border border-gray-300 bg-white text-ink"} ${current === q.id ? "ring-2 ring-primary/50" : ""}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}
        {showPassage && passagePanel && (
          <div className="max-h-[50vh] overflow-y-auto border-b border-gray-100 p-4 lg:hidden">{passagePanel}</div>
        )}
        {error && <p className="bg-red-50 px-4 py-2 text-sm text-danger">{error}</p>}
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 lg:px-4">
          <button
            onClick={() => {
              setShowNav(!showNav);
              setShowPassage(false);
            }}
            aria-expanded={showNav}
            className="flex min-w-0 flex-1 flex-col items-start rounded-xl px-2 py-1 text-left hover:bg-gray-50 active:bg-gray-50 lg:max-w-md"
          >
            <span className="text-sm font-semibold">
              <span className="hidden sm:inline">{t("Đã làm")} </span>
              <b className="text-primary-dark">{done}</b>/{t("{n} câu", { n: questions.length })}<span className="hidden sm:inline"> {t("· Danh sách câu")}</span> {showNav ? "▾" : "▴"}
            </span>
            <span className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <span className="block h-full bg-primary transition-all" style={{ width: `${questions.length ? (done / questions.length) * 100 : 0}%` }} />
            </span>
          </button>
          {passagePanel && curSec?.passage && (
            <button
              className="btn-outline shrink-0 px-3 lg:hidden"
              onClick={() => {
                setShowPassage(!showPassage);
                setShowNav(false);
              }}
            >
              📖 {showPassage ? t("Ẩn") : t("Đoạn văn")}
            </button>
          )}
          <button className="btn-primary ml-auto shrink-0 px-6 py-3 text-base" disabled={busy} onClick={onSubmit}>
            {busy ? t("Đang nộp…") : (
              <>
                {t("Nộp bài")}<span className="hidden sm:inline">&nbsp;({done}/{questions.length})</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultView({ result, questions, sections }: { result: Result; questions: PublicQuestion[]; sections: Section[] }) {
  const { t } = useT();
  const pct = result.total ? Math.round((result.score / result.total) * 100) : 0;
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  void sections;
  // Hiển thị theo đúng thứ tự học viên đã thấy khi làm bài (kể cả khi đề xáo trộn)
  const detailById = new Map(result.details.map((d) => [d.question_id, d]));
  const ordered = questions.length
    ? questions.map((q, i) => ({ ...detailById.get(q.id)!, idx: i + 1 })).filter((d) => d.question_id)
    : result.details.map((d, i) => ({ ...d, idx: i + 1 }));
  // Màu và lời nhắn theo mức điểm
  const mood =
    pct >= 80
      ? { icon: "🎉", text: t("Xuất sắc!"), ink: "text-primary-dark", bar: "bg-gradient-to-r from-primary to-teal" }
      : pct >= 50
        ? { icon: "👍", text: t("Khá tốt, cố thêm chút nữa!"), ink: "text-sun-ink", bar: "bg-gradient-to-r from-sun to-orange-400" }
        : { icon: "💪", text: t("Đừng nản, ôn lại và thử lần sau nhé!"), ink: "text-rose-ink", bar: "bg-gradient-to-r from-rose-400 to-sun" };
  return (
    <div>
      <div className={`card overflow-hidden p-6 pt-0 text-center shadow-md`}>
        <div className={`-mx-6 mb-4 h-2 ${mood.bar}`} />
        <div className="text-4xl" aria-hidden>{mood.icon}</div>
        <div className={`mt-1 text-lg font-bold ${mood.ink}`}>{mood.text}</div>
        <div className="mt-2 text-sm font-semibold uppercase tracking-wide text-muted">{t("Kết quả của bạn")}</div>
        <div className={`mt-1 text-5xl font-extrabold ${mood.ink}`}>
          {result.score}
          <span className="text-2xl text-muted">/{result.total}</span>
        </div>
        <div className="mt-1 text-lg font-semibold">{t("Đúng {a} / {b} câu · {p}%", { a: result.score, b: result.total, p: pct })}</div>
        <div className="mx-auto mt-4 h-3 max-w-xs overflow-hidden rounded-full bg-gray-100">
          <div className={`h-full ${mood.bar}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-sm text-muted">{t("Kết quả đã được gửi tới giáo viên.")}</p>
      </div>

      <h2 className="mb-3 mt-6 font-bold">{t("Chi tiết từng câu")}</h2>
      <div className="space-y-3">
        {ordered.map((d) => {
          const q = byId.get(d.question_id);
          return (
            <div key={d.question_id} className={`card border-l-4 p-4 ${d.is_correct ? "border-l-primary" : "border-l-danger"}`}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`badge ${d.is_correct ? "bg-primary-soft text-primary-dark" : "bg-red-50 text-danger"}`}>
                  {d.is_correct ? t("✓ Đúng") : t("✗ Sai")}
                </span>
                <span className="text-sm font-semibold">{t("Câu {n}", { n: d.idx })}</span>
              </div>
              {q && cleanStem(q.stem) && <p className="mb-2 text-sm leading-relaxed"><Html text={q.stem} /></p>}
              {q?.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={q.image} alt={t("Hình câu {n}", { n: d.idx })} className="mb-2 max-h-64 max-w-full rounded-xl border border-gray-200 object-contain" />
              )}
              {q && (
                <div className="space-y-1">
                  {q.options.map((o) => {
                    const mine = d.selected === o.label;
                    const right = d.correct === o.label;
                    return (
                      <div
                        key={o.label}
                        className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${right ? "bg-primary-soft font-semibold text-primary-dark" : mine ? "bg-red-50 text-danger" : ""}`}
                      >
                        <span className="w-4 shrink-0">{right ? "✓" : mine ? "✗" : ""}</span>
                        <span><b>{o.label}.</b> <Html text={o.text} />{mine && <i className="ml-1 text-xs">{t("(bạn chọn)")}</i>}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {!d.selected && <p className="mt-1 text-xs text-danger">{t("Bạn bỏ trống câu này.")}</p>}
            </div>
          );
        })}
      </div>
      {!result.show_answers && <p className="mt-4 text-center text-sm text-muted">{t("Giáo viên không cho hiển thị đáp án đúng của đề này.")}</p>}
    </div>
  );
}
