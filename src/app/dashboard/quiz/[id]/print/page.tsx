"use client";
import { Suspense, use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loadExportData, optionLayout, type ExportData } from "@/lib/export-doc";
import { Html } from "@/components/QuestionText";

function PrintView({ id }: { id: string }) {
  const withAnswers = useSearchParams().get("key") === "1";
  const [data, setData] = useState<ExportData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadExportData(id).then(setData).catch((e) => setErr(e.message));
  }, [id]);

  // Tự mở hộp thoại in khi đã tải xong hình
  useEffect(() => {
    if (!data) return;
    document.title = `${data.quiz.title}${withAnswers ? " (có đáp án)" : ""}`;
    const imgs = [...document.images];
    Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : i.decode().catch(() => {})))).then(() => setTimeout(() => window.print(), 400));
  }, [data, withAnswers]);

  if (err) return <p className="text-danger">{err}</p>;
  if (!data) return <p className="text-muted">Đang chuẩn bị bản in…</p>;
  const { quiz, questions } = data;
  let lastSec: number | null = null;

  return (
    <div className="print-doc mx-auto max-w-[210mm] bg-white p-[15mm] text-[12pt] leading-snug text-black shadow print:max-w-none print:p-0 print:shadow-none">
      <style>{`
        @page { size: A4; margin: 15mm; }
        .print-doc { font-family: "Times New Roman", Times, serif; }
        .q { break-inside: avoid; }
        @media print { body { background: #fff !important; } }
      `}</style>
      <div className="mb-4 rounded-xl bg-primary-soft p-3 text-sm text-primary-dark print:hidden" style={{ fontFamily: "inherit" }}>
        Hộp thoại in sẽ tự mở. Muốn lưu PDF: chọn máy in <b>“Lưu dưới dạng PDF” / “Save as PDF”</b>.{" "}
        <button className="btn-primary ml-2 px-3 py-1" onClick={() => window.print()}>In / Lưu PDF</button>
      </div>

      <h1 className="text-center text-[16pt] font-bold uppercase">{quiz.title}</h1>
      {withAnswers && <p className="text-center italic text-green-700">(Bản có đáp án – dành cho giáo viên)</p>}
      <p className="text-center">
        Số câu: {questions.length}
        {quiz.time_limit_min ? ` · Thời gian: ${quiz.time_limit_min} phút` : ""}
      </p>
      <p className="mb-4 mt-3">Họ và tên: ......................................................................... Lớp: ....................</p>

      {questions.map((q) => {
        const sec = q.section_index != null ? quiz.sections?.[q.section_index] : null;
        const showSec = sec && q.section_index !== lastSec;
        lastSec = q.section_index;
        const cols = optionLayout(q.options);
        return (
          <div key={q.id}>
            {showSec && (
              <div className="mb-1 mt-4">
                {sec!.instruction && <p className="font-bold"><Html text={sec!.instruction} /></p>}
                {sec!.passage && <p className="mt-1 whitespace-pre-line text-justify"><Html text={sec!.passage} /></p>}
              </div>
            )}
            <div className="q mt-3">
              <p>
                <b>Câu {q.number}.</b> <Html text={q.stem} />
              </p>
              {q.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={q.image} alt="" className="my-1 max-h-[60mm] max-w-[100mm] object-contain" />
              )}
              <div className={`ml-5 grid gap-x-4 ${cols === 4 ? "grid-cols-4" : cols === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                {q.options.map((o) => {
                  const ok = withAnswers && o.label === q.correct_label;
                  return (
                    <div key={o.label} className={ok ? "font-bold text-green-700 underline" : ""}>
                      <b>{o.label}.</b> <Html text={o.text} />
                    </div>
                  );
                })}
              </div>
              {withAnswers && q.explanation && <p className="ml-5 text-[10pt] italic text-gray-600">Giải thích: {q.explanation}</p>}
            </div>
          </div>
        );
      })}

      {withAnswers && (
        <div style={{ breakBefore: "page" }} className="mt-8">
          <h2 className="mb-3 text-center text-[14pt] font-bold">BẢNG ĐÁP ÁN</h2>
          <div className="grid grid-cols-10 border-l border-t border-black">
            {questions.map((q) => (
              <div key={q.id} className="border-b border-r border-black py-1 text-center font-bold">
                {q.number}-{q.correct_label ?? "?"}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <PrintView id={id} />
    </Suspense>
  );
}
