import { NextResponse } from "next/server";
import { z } from "zod";
import { geminiJson } from "@/lib/gemini";
import { aiErrorResponse, bumpUsage, requireTeacher } from "@/lib/api-auth";
import { langOf, translate, type Vars } from "@/lib/i18n/core";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Hobby (Fluid compute) cho phép tối đa 300 giây

const Body = z.object({
  pages: z
    .array(
      z.object({
        page: z.number().int().positive(),
        text: z.string().max(60_000).nullable(),
        image: z.string().max(3_500_000).nullable(), // base64 JPEG
      })
    )
    .min(1)
    .max(10),
});

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: ["string", "null"] },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          instruction: { type: ["string", "null"] },
          passage: { type: ["string", "null"] },
        },
        required: ["instruction", "passage"],
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "integer" },
          section_ref: { type: ["integer", "null"] },
          stem: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: { label: { type: "string" }, text: { type: "string" } },
              required: ["label", "text"],
            },
          },
          marked_answer: { type: ["string", "null"] },
          figure_page: { type: "integer" },
          figure_box: { type: "array", items: { type: "number" } },
        },
        required: ["number", "stem", "options", "marked_answer", "section_ref", "figure_page", "figure_box"],
      },
    },
    answer_key: {
      type: "array",
      items: {
        type: "object",
        properties: { number: { type: "integer" }, label: { type: "string" } },
        required: ["number", "label"],
      },
    },
  },
  required: ["title", "sections", "questions", "answer_key"],
};

const SYSTEM = `You extract English multiple-choice tests from exam pages into JSON. Be exact and faithful.
Rules:
- Extract EVERY multiple-choice question that appears on these pages, keeping the original question numbers.
- "stem": the question text exactly as printed (for cloze tests where the question is only a blank number in a passage, use e.g. "(12) ____" or the sentence fragment). Keep underlined parts by wrapping them in <u>...</u> (important for pronunciation/stress/error-identification questions). Do not translate.
- "options": every choice with its letter label (A, B, C, D, ...), text without the leading letter.
- "sections": shared instructions and reading/cloze passages on these pages (full passage text). Each question's "section_ref" is the index in this "sections" array, or null if none.
- "marked_answer": ONLY if the page visibly marks the correct option for that question (circled, ticked, bold/highlighted differently from the other options). Otherwise null. NEVER guess.
- "answer_key": if these pages contain an answer key / "Key" / "Đáp án" table, list every entry. Otherwise [].
- Skip questions that are cut off so badly that the options are missing; partial questions at a page boundary will be recovered from the neighbouring chunk.
- "title": the test title if visible, else null.
- "figure_page" / "figure_box": if the question CANNOT be answered without a picture printed on the page (a sign, notice, label, advertisement image, chart, map, photo, diagram — NOT plain text), give the page number it is on and its bounding box as [ymin, xmin, ymax, xmax] normalized to 0–1000 of that page image, covering the whole picture. Several questions may share the same picture. Otherwise figure_page = 0 and figure_box = [].`;

type Raw = {
  title: string | null;
  sections: { instruction: string | null; passage: string | null }[];
  questions: {
    number: number;
    section_ref: number | null;
    stem: string;
    options: { label: string; text: string }[];
    marked_answer: string | null;
    figure_page?: number;
    figure_box?: number[];
  }[];
  answer_key: { number: number; label: string }[];
};

function figureOf(q: { figure_page?: number; figure_box?: number[] }) {
  const b = q.figure_box;
  if (!q.figure_page || !Array.isArray(b) || b.length !== 4 || b.some((v) => !Number.isFinite(v))) return null;
  const [y0, x0, y1, x1] = b.map((v) => Math.max(0, Math.min(1000, v)));
  const area = ((y1 - y0) * (x1 - x0)) / 1_000_000;
  if (y1 <= y0 || x1 <= x0 || area < 0.002 || area > 0.8) return null; // bỏ khung vô lý
  return { page: q.figure_page, box: [y0, x0, y1, x1] as [number, number, number, number] };
}

export async function POST(req: Request) {
  const T = (k: string, v?: Vars) => translate(langOf(req), k, v);
  const user = await requireTeacher();
  if (!user) return NextResponse.json({ error: T("Chưa đăng nhập") }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: T("Dữ liệu không hợp lệ") }, { status: 400 });

  const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [];
  for (const p of parsed.data.pages) {
    parts.push({ text: `--- PAGE ${p.page} ---` });
    if (p.text && p.text.trim().length > 0) parts.push({ text: p.text });
    if (p.image) parts.push({ inlineData: { mimeType: "image/jpeg", data: p.image } });
  }
  parts.push({ text: "Extract all multiple-choice questions from the pages above as JSON." });

  try {
    await bumpUsage(user.id);
    const raw = await geminiJson<Raw>(parts, SCHEMA, SYSTEM);
    const valid = /^[A-F]$/;
    const questions = (raw.questions ?? [])
      .filter((q) => Array.isArray(q.options) && q.options.length >= 2 && Number.isFinite(q.number))
      .map((q) => {
        const marked = q.marked_answer?.trim().toUpperCase() ?? null;
        const hasMark = !!marked && valid.test(marked) && q.options.some((o) => o.label.toUpperCase() === marked);
        return {
          number: q.number,
          section_ref: q.section_ref ?? null,
          section_index: null,
          stem: q.stem ?? "",
          options: q.options.map((o) => ({ label: o.label.trim().toUpperCase().replace(/[^A-F]/g, "") || "?", text: o.text.trim() })),
          correct_label: hasMark ? marked : null,
          answer_source: hasMark ? ("from_pdf" as const) : ("manual" as const),
          confidence: null,
          needs_review: false,
          explanation: null,
          figure: figureOf(q),
        };
      });
    const answer_key: Record<string, string> = {};
    for (const k of raw.answer_key ?? []) {
      const l = k.label?.trim().toUpperCase();
      if (Number.isFinite(k.number) && l && valid.test(l)) answer_key[String(k.number)] = l;
    }
    return NextResponse.json({ title: raw.title ?? null, sections: raw.sections ?? [], questions, answer_key });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
