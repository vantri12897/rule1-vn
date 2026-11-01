import "server-only";
import { GoogleGenAI, ApiError } from "@google/genai";

export class RateLimitError extends Error {
  constructor(public retryAfterSec: number, public daily: boolean) {
    super("RATE_LIMIT");
  }
}

function models(): string[] {
  const env = process.env.GEMINI_MODEL?.trim();
  const list = env ? env.split(",").map((s) => s.trim()).filter(Boolean) : [];
  // Dự phòng khi Google đổi/khai tử model: thử lần lượt
  for (const m of ["gemini-flash-latest", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-flash-lite-latest"]) {
    if (!list.includes(m)) list.push(m);
  }
  return list;
}

let cachedModel: string | null = null;

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/** Gọi Gemini, ép trả về JSON theo schema. Tự chuyển model nếu model không tồn tại. */
export async function geminiJson<T>(parts: Part[], schema: unknown, systemInstruction: string): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Thiếu GEMINI_API_KEY trong biến môi trường");
  const ai = new GoogleGenAI({ apiKey });
  const candidates = cachedModel ? [cachedModel, ...models().filter((m) => m !== cachedModel)] : models();

  let lastErr: unknown = null;
  for (const model of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseJsonSchema: schema,
            temperature: 0.1,
          },
        });
        const text = res.text ?? "";
        cachedModel = model;
        return JSON.parse(text) as T;
      } catch (e) {
        lastErr = e;
        if (e instanceof ApiError) {
          if (e.status === 429) {
            const m = /retry in ([\d.]+)s/i.exec(e.message) || /"retryDelay":\s*"(\d+)s"/i.exec(e.message);
            const daily = /per[\s_-]?day|PerDay|daily/i.test(e.message);
            throw new RateLimitError(m ? Math.ceil(Number(m[1])) + 1 : 30, daily);
          }
          if (e.status === 404 || e.status === 400 && /not found|not supported|unknown name/i.test(e.message)) {
            break; // thử model kế tiếp
          }
          if (e.status >= 500) continue; // lỗi tạm thời: thử lại 1 lần
          throw e;
        }
        if (e instanceof SyntaxError) continue; // JSON hỏng: thử lại
        throw e;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Không gọi được Gemini");
}
