"use client";
import { supabaseBrowser } from "./supabase/client";
import type { Quiz, QuestionRow } from "./types";

export type ExportData = { quiz: Quiz; questions: QuestionRow[] };

export async function loadExportData(quizId: string): Promise<ExportData> {
  const sb = supabaseBrowser();
  const [{ data: quiz }, { data: questions }] = await Promise.all([
    sb.from("quizzes").select("*").eq("id", quizId).single(),
    sb.from("questions").select("*").eq("quiz_id", quizId).order("position"),
  ]);
  if (!quiz) throw new Error("Không tìm thấy đề");
  return { quiz: quiz as Quiz, questions: (questions ?? []) as QuestionRow[] };
}

/** Tách nội dung có <u>, <b>, <i>, <br> thành các đoạn chữ có định dạng */
export type Seg = { text: string; u?: boolean; b?: boolean; i?: boolean; br?: boolean };
export function parseInline(src: string | null | undefined): Seg[] {
  const out: Seg[] = [];
  const st = { u: false, b: false, i: false };
  for (const part of (src ?? "").split(/(<\/?(?:u|b|i)>|<br\s*\/?>|\n)/i)) {
    if (!part) continue;
    const tag = /^<(\/?)(u|b|i)>$/i.exec(part);
    if (tag) {
      st[tag[2].toLowerCase() as "u" | "b" | "i"] = tag[1] !== "/";
      continue;
    }
    if (/^(<br\s*\/?>|\n)$/i.test(part)) {
      out.push({ text: "", br: true });
      continue;
    }
    out.push({ text: part.replace(/<[^>]+>/g, ""), ...st });
  }
  return out;
}

/** Cách xếp phương án: 1 dòng (4 cột), 2 dòng (2 cột) hoặc mỗi phương án 1 dòng */
export function optionLayout(options: { text: string }[]): 1 | 2 | 4 {
  const max = Math.max(...options.map((o) => o.text.replace(/<[^>]+>/g, "").length));
  if (options.length <= 4 && max <= 18) return 4;
  if (max <= 40) return 2;
  return 1;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; type: "jpg" | "png" } {
  const [head, b64] = dataUrl.split(",");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: /png/i.test(head) ? "png" : "jpg" };
}

async function imageSize(dataUrl: string) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { w: img.naturalWidth, h: img.naturalHeight };
}

function safeName(s: string) {
  return s.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "").slice(0, 60) || "de";
}

/** Tạo file Word (.docx). withAnswers = bản giáo viên (tô đậm đáp án đúng + bảng đáp án). */
export async function downloadDocx({ quiz, questions }: ExportData, withAnswers: boolean) {
  const d = await import("docx");
  const FONT = "Times New Roman";
  const runs = (segs: Seg[], extra: { bold?: boolean; color?: string } = {}) =>
    segs.map((s) =>
      s.br
        ? new d.TextRun({ text: "", break: 1, font: FONT })
        : new d.TextRun({ text: s.text, font: FONT, size: 24, bold: s.b || extra.bold, italics: s.i, underline: s.u ? {} : undefined, color: extra.color })
    );

  const children: InstanceType<typeof d.Paragraph | typeof d.Table>[] = [];
  children.push(
    new d.Paragraph({
      alignment: d.AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new d.TextRun({ text: quiz.title.toUpperCase(), bold: true, size: 30, font: FONT })],
    })
  );
  if (withAnswers) {
    children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: "(BẢN CÓ ĐÁP ÁN – DÀNH CHO GIÁO VIÊN)", italics: true, size: 22, font: FONT, color: "15803D" })] }));
  }
  children.push(
    new d.Paragraph({
      alignment: d.AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new d.TextRun({
          text: `Số câu: ${questions.length}${quiz.time_limit_min ? `   ·   Thời gian: ${quiz.time_limit_min} phút` : ""}`,
          size: 22,
          font: FONT,
        }),
      ],
    }),
    new d.Paragraph({
      spacing: { after: 240 },
      children: [new d.TextRun({ text: "Họ và tên: ..............................................................   Lớp: ....................", size: 24, font: FONT })],
    })
  );

  let lastSec: number | null = null;
  for (const q of questions) {
    const sec = q.section_index != null ? quiz.sections?.[q.section_index] : null;
    if (sec && q.section_index !== lastSec) {
      if (sec.instruction) children.push(new d.Paragraph({ spacing: { before: 240, after: 80 }, children: runs(parseInline(sec.instruction), { bold: true }) }));
      if (sec.passage) {
        for (const para of sec.passage.split(/\n{2,}/)) {
          children.push(new d.Paragraph({ alignment: d.AlignmentType.JUSTIFIED, spacing: { after: 80 }, children: runs(parseInline(para)) }));
        }
      }
    }
    lastSec = q.section_index;

    children.push(
      new d.Paragraph({
        spacing: { before: 160, after: 60 },
        keepNext: true,
        children: [new d.TextRun({ text: `Câu ${q.number}. `, bold: true, size: 24, font: FONT }), ...runs(parseInline(q.stem))],
      })
    );
    if (q.image) {
      try {
        const { bytes, type } = dataUrlToBytes(q.image);
        const { w, h } = await imageSize(q.image);
        const width = Math.min(380, w);
        children.push(
          new d.Paragraph({
            keepNext: true,
            spacing: { after: 60 },
            children: [new d.ImageRun({ type, data: bytes, transformation: { width, height: Math.round((h / w) * width) } })],
          })
        );
      } catch {
        /* bỏ qua hình lỗi */
      }
    }
    const layout = optionLayout(q.options);
    const optRuns = (o: { label: string; text: string }) => {
      const ok = withAnswers && o.label === q.correct_label;
      return [
        new d.TextRun({ text: `${o.label}. `, bold: true, size: 24, font: FONT, color: ok ? "15803D" : undefined }),
        ...runs(parseInline(o.text), ok ? { bold: true, color: "15803D" } : {}),
      ];
    };
    const tabStops = [2400, 4800, 7200].map((p) => ({ type: d.TabStopType.LEFT, position: p }));
    for (let i = 0; i < q.options.length; i += layout) {
      const row = q.options.slice(i, i + layout);
      const parts: InstanceType<typeof d.TextRun>[] = [];
      row.forEach((o, j) => {
        if (j > 0) parts.push(new d.TextRun({ text: "\t", font: FONT }));
        parts.push(...optRuns(o));
      });
      children.push(
        new d.Paragraph({
          indent: { left: 360 },
          tabStops: layout === 4 ? tabStops : layout === 2 ? [{ type: d.TabStopType.LEFT, position: 4800 }] : [],
          children: parts,
        })
      );
    }
    if (withAnswers && q.explanation) {
      children.push(new d.Paragraph({ indent: { left: 360 }, children: [new d.TextRun({ text: `Giải thích: ${q.explanation}`, italics: true, size: 20, font: FONT, color: "6B7280" })] }));
    }
  }

  if (withAnswers) {
    children.push(new d.Paragraph({ pageBreakBefore: true, alignment: d.AlignmentType.CENTER, spacing: { after: 200 }, children: [new d.TextRun({ text: "BẢNG ĐÁP ÁN", bold: true, size: 28, font: FONT })] }));
    const perRow = 10;
    const rows: InstanceType<typeof d.TableRow>[] = [];
    for (let i = 0; i < questions.length; i += perRow) {
      const slice = questions.slice(i, i + perRow);
      while (slice.length < perRow) slice.push(null as unknown as QuestionRow);
      rows.push(
        new d.TableRow({
          children: slice.map(
            (q) =>
              new d.TableCell({
                width: { size: 10, type: d.WidthType.PERCENTAGE },
                children: [
                  new d.Paragraph({
                    alignment: d.AlignmentType.CENTER,
                    children: [new d.TextRun({ text: q ? `${q.number}-${q.correct_label ?? "?"}` : "", size: 22, font: FONT, bold: true })],
                  }),
                ],
              })
          ),
        })
      );
    }
    children.push(new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows }));
  }

  const doc = new d.Document({
    creator: "YD-English",
    title: quiz.title,
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1000 } } }, children }],
  });
  const blob = await d.Packer.toBlob(doc);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safeName(quiz.title)}${withAnswers ? "_co_dap_an" : ""}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
