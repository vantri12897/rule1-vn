import { NextResponse } from "next/server";
import { z } from "zod";
import { geminiJson } from "@/lib/gemini";
import { aiErrorResponse, bumpUsage, requireTeacher } from "@/lib/api-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  questions: z
    .array(
      z.object({
        number: z.number().int(),
        instruction: z.string().nullable(),
        passage: z.string().nullable(),
        stem: z.string(),
        options: z.array(z.object({ label: z.string(), text: z.string() })).min(2),
      })
    )
    .min(1)
    .max(30),
});

const SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "integer" },
          label: { type: "string" },
          confidence: { type: "number" },
          explanation: { type: "string" },
        },
        required: ["number", "label", "confidence", "explanation"],
      },
    },
  },
  required: ["answers"],
};

const SYSTEM = `You are an expert English teacher solving a Vietnamese-school-style English multiple-choice test.
For each question choose exactly one option label. Think carefully about grammar, vocabulary, collocation, reading comprehension, pronunciation (<u>underlined</u> letters) and stress patterns.
"confidence" is your probability (0..1) that the answer is correct — be honest; use < 0.8 when the item is ambiguous or more than one option seems acceptable.
"explanation": 1–2 short sentences in Vietnamese explaining why.`;

export async function POST(req: Request) {
  const user = await requireTeacher();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });

  // Gom theo passage để model đọc ngữ cảnh một lần
  const lines: string[] = [];
  let lastCtx = "";
  for (const q of parsed.data.questions) {
    const ctx = `${q.instruction ?? ""}\n${q.passage ?? ""}`.trim();
    if (ctx && ctx !== lastCtx) {
      lines.push(`\n=== CONTEXT ===\n${ctx}\n===============`);
      lastCtx = ctx;
    }
    lines.push(`Question ${q.number}: ${q.stem}\n${q.options.map((o) => `${o.label}. ${o.text}`).join("\n")}`);
  }

  try {
    await bumpUsage(user.id);
    const out = await geminiJson<{ answers: { number: number; label: string; confidence: number; explanation: string }[] }>(
      [{ text: lines.join("\n\n") }],
      SCHEMA,
      SYSTEM
    );
    return NextResponse.json({
      answers: (out.answers ?? []).map((a) => ({
        number: a.number,
        label: (a.label ?? "").trim().toUpperCase().slice(0, 1),
        confidence: Math.max(0, Math.min(1, Number(a.confidence) || 0)),
        explanation: a.explanation ?? "",
      })),
    });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
