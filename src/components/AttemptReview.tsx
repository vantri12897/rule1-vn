"use client";
import { Fragment } from "react";
import { Html } from "@/components/QuestionText";
import { safeHtml } from "@/lib/sanitize";
import { useT } from "@/lib/i18n/client";
import type { Option, Section } from "@/lib/types";

/** "Question 1:" / "Câu 1." chỉ là số câu → không lặp lại sau "Câu 1." */
export function cleanStem(stem: string) {
  return /^\s*(question|câu|cau)\s*\d+\s*[:.)]?\s*$/i.test(stem) ? "" : stem;
}

/** HTML → chữ thường (để trích câu chứa chỗ trống) */
function plainText(html: string) {
  return html
    .replace(/<br\s*\/?>|<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Câu văn chứa chỗ trống (n) trong đoạn văn — để trang kết quả hiện lại "câu hỏi" của dạng
 * điền từ vào đoạn văn (các câu này không có đề riêng, đề nằm trong đoạn văn).
 */
function blankSnippet(passage: string | null | undefined, n: number) {
  if (!passage) return null;
  const text = plainText(passage);
  const mark = `(${n})`;
  const i = text.indexOf(mark);
  if (i < 0) return null;
  const ends = /[.!?]["”’)]?\s|\n/g;
  let start = 0;
  for (let m; (m = ends.exec(text)) && m.index + m[0].length <= i; ) start = m.index + m[0].length;
  ends.lastIndex = i + mark.length;
  const m2 = ends.exec(text);
  const end = m2 ? m2.index + m2[0].trimEnd().length : text.length;
  let before = text.slice(start, i).trimStart();
  // bỏ dấu gạch "___" / "……" của chỗ trống ngay sau số (đã vẽ chỗ trống riêng)
  let after = text.slice(i + mark.length, end).trimEnd().replace(/^\s*[_.…]{2,}/, "");
  if (before.length > 160) before = "…" + before.slice(-160);
  if (after.length > 160) after = after.slice(0, 160) + "…";
  return { before, after };
}

/** Đoạn văn trên trang kết quả: chỗ trống tô xanh (đúng) / đỏ (sai) */
function PassageReview({ text, results }: { text: string; results: Map<number, boolean> }) {
  const html = safeHtml(text).replace(/\((\d{1,3})\)/g, (m, d: string) => {
    const ok = results.get(Number(d));
    if (ok === undefined) return m;
    return `<span class="rounded px-1 font-bold ${ok ? "bg-primary-soft text-primary-dark" : "bg-red-50 text-danger"}">(${d})${ok ? " ✓" : " ✗"}</span>`;
  });
  return <div className="whitespace-pre-line text-sm leading-[1.8]" dangerouslySetInnerHTML={{ __html: html }} />;
}


export type ReviewItem = {
  id: string;
  /** Số thứ tự hiển thị (Câu 1, Câu 2…) */
  idx: number;
  /** Số câu gốc trong đề — trùng với (n) trong đoạn văn */
  number: number;
  stem: string;
  image?: string | null;
  options: Option[];
  section_index: number | null;
  selected: string | null;
  /** null = giáo viên không cho xem đáp án đúng */
  correct: string | null;
  is_correct: boolean;
};

/**
 * Xem lại toàn bộ bài làm: hướng dẫn + đoạn văn của từng nhóm câu, câu hỏi, các phương án,
 * phương án đã chọn và đáp án đúng. Dùng cho trang kết quả của học viên và trang xem bài của giáo viên.
 */
export function AttemptReview({ items, sections, viewer, onlyWrong = false }: { items: ReviewItem[]; sections: Section[]; viewer: "student" | "teacher"; onlyWrong?: boolean }) {
  const { t } = useT();
  const shown = onlyWrong ? items.filter((d) => !d.is_correct) : items;
  return (
    <div className="space-y-3">
      {shown.map((d, k) => {
        const si = d.section_index;
        const sec = si != null ? sections[si] : null;
        // Đầu mỗi nhóm câu: hiện lại hướng dẫn + đoạn văn (như lúc làm bài)
        const newGroup = !!sec && (sec.instruction || sec.passage) && (k === 0 || shown[k - 1].section_index !== si);
        const snippet = !cleanStem(d.stem) ? blankSnippet(sec?.passage, d.number) : null;
        return (
          <Fragment key={d.id}>
            {newGroup && (
              <div className="review-group card border-primary-line bg-primary-soft/60 p-4">
                {sec!.instruction && (
                  <p className="text-sm font-semibold leading-relaxed text-primary-dark">
                    <Html text={sec!.instruction} />
                  </p>
                )}
                {sec!.passage && (
                  <details open className="mt-2 rounded-xl bg-white p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-primary-dark">{t("📖 Đoạn văn")}</summary>
                    <div className="mt-2">
                      <PassageReview text={sec!.passage} results={new Map(items.filter((x) => x.section_index === si).map((x) => [x.number, x.is_correct]))} />
                    </div>
                  </details>
                )}
              </div>
            )}
            <div className={`review-q card border-l-4 p-4 ${d.is_correct ? "border-l-primary" : "border-l-danger"}`}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`badge ${d.is_correct ? "bg-primary-soft text-primary-dark" : "bg-red-50 text-danger"}`}>{d.is_correct ? t("✓ Đúng") : t("✗ Sai")}</span>
                <span className="text-sm font-semibold">{t("Câu {n}", { n: d.idx })}</span>
              </div>
              {cleanStem(d.stem) && (
                <p className="mb-2 text-sm leading-relaxed">
                  <Html text={d.stem} />
                </p>
              )}
              {snippet && (
                <p className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-sm leading-relaxed">
                  {snippet.before} <mark className="rounded bg-yellow-200 px-1 font-bold text-ink">({d.number}) ____</mark> {snippet.after}
                </p>
              )}
              {d.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.image} loading="lazy" decoding="async" alt={t("Hình câu {n}", { n: d.idx })} className="mb-2 max-h-64 max-w-full rounded-xl border border-gray-200 object-contain" />
              )}
              {d.options.length > 0 && (
                <div className="space-y-1">
                  {d.options.map((o) => {
                    const mine = d.selected === o.label;
                    const right = d.correct === o.label;
                    return (
                      <div key={o.label} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${right ? "bg-primary-soft font-semibold text-primary-dark" : mine ? "bg-red-50 text-danger" : ""}`}>
                        <span className="w-4 shrink-0">{right ? "✓" : mine ? "✗" : ""}</span>
                        <span>
                          <b>{o.label}.</b> <Html text={o.text} />
                          {mine && <i className="ml-1 text-xs">{viewer === "student" ? t("(bạn chọn)") : t("(học viên chọn)")}</i>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {!d.selected && <p className="mt-1 text-xs text-danger">{viewer === "student" ? t("Bạn bỏ trống câu này.") : t("Học viên bỏ trống câu này.")}</p>}
            </div>
          </Fragment>
        );
      })}
      {onlyWrong && shown.length === 0 && <p className="card p-6 text-center text-sm text-muted">{t("Không có câu sai nào 🎉")}</p>}
    </div>
  );
}
