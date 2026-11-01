"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html } from "@/components/QuestionText";
import type { PublicQuestion, Section } from "@/lib/types";

type QuizInfo = { title: string; status: "open" | "closed"; sections: Section[]; time_limit_min: number | null; question_count: number };
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

export default function TakeQuiz({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [view, setView] = useState<View>("loading");
  const [quiz, setQuiz] = useState<QuizInfo | null>(null);
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

  useEffect(() => {
    tokenRef.current = getToken();
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
    if (!r.ok) return setError(data.error || "Không bắt đầu được, thử lại.");
    applyTaking(data);
  }

  const submit = useCallback(
    async (auto = false) => {
      if (busy) return;
      const unanswered = questions.length - Object.keys(answers).filter((k) => questions.some((q) => q.id === k)).length;
      if (!auto && unanswered > 0 && !confirm(`Bạn còn ${unanswered} câu chưa làm. Vẫn nộp bài?`)) return;
      if (!auto && unanswered === 0 && !confirm("Nộp bài? Sau khi nộp sẽ không sửa được.")) return;
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
          setError(data.error || "Nộp bài thất bại");
          break;
        } catch {
          await new Promise((res) => setTimeout(res, 2000));
        }
      }
      setError((e) => e ?? "Mất kết nối. Bài làm vẫn được giữ trên máy — kiểm tra mạng rồi bấm Nộp bài lại.");
      setBusy(false);
    },
    [answers, busy, questions, slug, ansKey]
  );

  return (
    <main className="min-h-screen bg-primary-soft">
      <header className="sticky top-0 z-30 border-b border-primary-line bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-xs font-extrabold text-white">YD</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{quiz?.title ?? "YD-English"}</div>
            {studentName && <div className="truncate text-xs text-muted">{studentName}</div>}
          </div>
          {view === "taking" && deadline && <Countdown deadline={deadline} offset={clockOffset} onEnd={() => submit(true)} />}
        </div>
        {view === "taking" && <Progress done={questions.filter((q) => answers[q.id]).length} total={questions.length} />}
      </header>

      <div className="mx-auto max-w-2xl px-4 py-5">
        {view === "loading" && <p className="py-20 text-center text-muted">Đang tải đề…</p>}
        {view === "notfound" && <Message title="Không tìm thấy bài kiểm tra" text="Link không đúng hoặc đề chưa được giáo viên xuất bản." />}
        {view === "closed" && <Message title="Đề đã đóng" text="Giáo viên đã ngừng nhận bài cho đề này." />}
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
  const [name, setName] = useState("");
  const [cls, setCls] = useState("");
  return (
    <form
      className="card mt-4 space-y-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onStart(name.trim(), cls.trim());
      }}
    >
      <div className="text-center">
        <h1 className="text-xl font-bold">{quiz.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {quiz.question_count} câu{quiz.time_limit_min ? ` · ${quiz.time_limit_min} phút` : " · không giới hạn thời gian"}
        </p>
      </div>
      <div>
        <label className="label">Họ và tên *</label>
        <input className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" autoFocus />
      </div>
      <div>
        <label className="label">Lớp / Mã học viên</label>
        <input className="input" maxLength={60} value={cls} onChange={(e) => setCls(e.target.value)} placeholder="Không bắt buộc" />
      </div>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full py-3 text-base" disabled={busy || !name.trim()}>{busy ? "Đang vào…" : "Bắt đầu làm bài"}</button>
      {quiz.time_limit_min && <p className="text-center text-xs text-muted">Đồng hồ bắt đầu chạy ngay khi bạn bấm nút. Hết giờ bài tự nộp.</p>}
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
  return (
    <span className={`rounded-lg px-2.5 py-1 font-mono text-sm font-bold ${s < 60 ? "bg-red-50 text-danger" : "bg-primary-soft text-primary-dark"}`}>
      ⏱ {String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}
    </span>
  );
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
  const [showNav, setShowNav] = useState(false);
  const done = questions.filter((q) => answers[q.id]).length;
  let lastSection: number | null = null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-muted">
          Đã làm <b className="text-primary-dark">{done}</b>/{questions.length} câu
        </span>
        <button className="btn-ghost border border-primary-line bg-white px-3 py-1.5 text-sm" onClick={() => setShowNav(!showNav)}>
          {showNav ? "Ẩn" : "Danh sách câu"}
        </button>
      </div>
      {showNav && (
        <div className="card mb-4 grid grid-cols-8 gap-1.5 p-3 sm:grid-cols-10">
          {questions.map((q, i) => (
            <a
              key={q.id}
              href={`#q-${q.id}`}
              onClick={() => setShowNav(false)}
              className={`grid h-9 place-items-center rounded-lg text-sm font-semibold ${answers[q.id] ? "bg-primary text-white" : "border border-gray-300 bg-white text-ink"}`}
            >
              {i + 1}
            </a>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {questions.map((q, i) => {
          const sec = q.section_index != null ? quiz.sections[q.section_index] : null;
          const showSec = sec && q.section_index !== lastSection;
          lastSection = q.section_index;
          return (
            <div key={q.id}>
              {showSec && (sec!.instruction || sec!.passage) && (
                <div className="card mb-4 border-primary-line p-4">
                  {sec!.instruction && <p className="font-semibold italic"><Html text={sec!.instruction} /></p>}
                  {sec!.passage && <p className="mt-2 whitespace-pre-line leading-relaxed"><Html text={sec!.passage} /></p>}
                </div>
              )}
              <fieldset id={`q-${q.id}`} className="card scroll-mt-24 p-4">
                <legend className="sr-only">Câu {i + 1}</legend>
                <p className="mb-3 leading-relaxed">
                  <b className="text-primary-dark">Câu {i + 1}.</b> <Html text={q.stem} />
                </p>
                <div className="space-y-2">
                  {q.options.map((o) => {
                    const on = answers[q.id] === o.label;
                    return (
                      <label
                        key={o.label}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 px-3 py-3 transition ${on ? "border-primary bg-primary-soft" : "border-gray-200 bg-white active:bg-gray-50"}`}
                      >
                        <input
                          type="radio"
                          name={q.id}
                          className="mt-0.5 h-5 w-5 shrink-0 accent-[#16a34a]"
                          checked={on}
                          onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.label }))}
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

      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-danger">{error}</p>}
      <button className="btn-primary mt-6 w-full py-3.5 text-base" disabled={busy} onClick={onSubmit}>
        {busy ? "Đang nộp…" : `Nộp bài (${done}/${questions.length})`}
      </button>
    </div>
  );
}

function ResultView({ result, questions, sections }: { result: Result; questions: PublicQuestion[]; sections: Section[] }) {
  const pct = result.total ? Math.round((result.score / result.total) * 100) : 0;
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  void sections;
  // Hiển thị theo đúng thứ tự học viên đã thấy khi làm bài (kể cả khi đề xáo trộn)
  const detailById = new Map(result.details.map((d) => [d.question_id, d]));
  const ordered = questions.length
    ? questions.map((q, i) => ({ ...detailById.get(q.id)!, idx: i + 1 })).filter((d) => d.question_id)
    : result.details.map((d, i) => ({ ...d, idx: i + 1 }));
  return (
    <div>
      <div className="card p-6 text-center">
        <div className="text-sm font-semibold uppercase tracking-wide text-muted">Kết quả của bạn</div>
        <div className="mt-2 text-5xl font-extrabold text-primary-dark">
          {result.score}
          <span className="text-2xl text-muted">/{result.total}</span>
        </div>
        <div className="mt-1 text-lg font-semibold">Đúng {result.score} / {result.total} câu · {pct}%</div>
        <div className="mx-auto mt-4 h-3 max-w-xs overflow-hidden rounded-full bg-gray-100">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-sm text-muted">Kết quả đã được gửi tới giáo viên.</p>
      </div>

      <h2 className="mb-3 mt-6 font-bold">Chi tiết từng câu</h2>
      <div className="space-y-3">
        {ordered.map((d) => {
          const q = byId.get(d.question_id);
          return (
            <div key={d.question_id} className={`card border-l-4 p-4 ${d.is_correct ? "border-l-primary" : "border-l-danger"}`}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`badge ${d.is_correct ? "bg-primary-soft text-primary-dark" : "bg-red-50 text-danger"}`}>
                  {d.is_correct ? "✓ Đúng" : "✗ Sai"}
                </span>
                <span className="text-sm font-semibold">Câu {d.idx}</span>
              </div>
              {q && <p className="mb-2 text-sm leading-relaxed"><Html text={q.stem} /></p>}
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
                        <span><b>{o.label}.</b> <Html text={o.text} />{mine && <i className="ml-1 text-xs">(bạn chọn)</i>}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {!d.selected && <p className="mt-1 text-xs text-danger">Bạn bỏ trống câu này.</p>}
            </div>
          );
        })}
      </div>
      {!result.show_answers && <p className="mt-4 text-center text-sm text-muted">Giáo viên không cho hiển thị đáp án đúng của đề này.</p>}
    </div>
  );
}
