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

/**
 * Model nào đang hết lượt thì tạm nghỉ đến lúc nào (ms). Mỗi model có hạn mức miễn phí RIÊNG,
 * nên khi model chính hết lượt, chuyển sang model khác vẫn dùng tiếp được.
 *  - hết lượt theo phút: nghỉ đúng số giây Google yêu cầu
 *  - hết lượt trong ngày: nghỉ 1 giờ rồi thử lại (Google tính lại lượt lúc nửa đêm giờ Thái Bình Dương)
 */
const cooldown = new Map<string, { until: number; daily: boolean }>();
const reportedGone = new Set<string>();

/** Model đang dùng gần nhất (để hiển thị / kiểm tra) */
export const lastModel = () => cachedModel;

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

async function note(kind: string, message: string) {
  try {
    const { logError } = await import("./errlog");
    await logError({ source: "server", kind, message });
  } catch {}
}

/** Gọi Gemini, ép trả về JSON theo schema. Tự chuyển model khi model không tồn tại hoặc đã hết lượt. */
export async function geminiJson<T>(
  parts: Part[],
  schema: unknown,
  systemInstruction: string,
  thinkingBudget = 512
): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Thiếu GEMINI_API_KEY trong biến môi trường");
  // GEMINI_BASE_URL: chỉ dùng khi kiểm thử (máy chủ giả lập Google)
  const ai = new GoogleGenAI({ apiKey, ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}) });
  const all = cachedModel ? [cachedModel, ...models().filter((m) => m !== cachedModel)] : models();
  const now = Date.now();
  const ready = all.filter((m) => (cooldown.get(m)?.until ?? 0) <= now);
  if (!ready.length) throw limitError(now);

  let lastErr: unknown = null;
  let limited = false;
  for (const model of ready) {
    let useThinking = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseJsonSchema: schema,
            temperature: 0.1,
            // Giới hạn thời gian "suy nghĩ" để trả lời nhanh hơn (model không hỗ trợ thì bỏ)
            ...(useThinking ? { thinkingConfig: { thinkingBudget } } : {}),
          },
        });
        const text = res.text ?? "";
        const out = JSON.parse(text) as T;
        cachedModel = model;
        cooldown.delete(model);
        return out;
      } catch (e) {
        lastErr = e;
        if (e instanceof ApiError) {
          if (e.status === 429) {
            const m = /retry in ([\d.]+)s/i.exec(e.message) || /"retryDelay":\s*"(\d+)s"/i.exec(e.message);
            const daily = /per[\s_-]?day|PerDay|daily/i.test(e.message);
            const wait = daily ? 3600 : m ? Math.ceil(Number(m[1])) + 1 : 30;
            cooldown.set(model, { until: Date.now() + wait * 1000, daily });
            limited = true;
            break; // thử model kế tiếp (hạn mức riêng)
          }
          if (e.status === 400 && useThinking && /thinking/i.test(e.message)) {
            useThinking = false;
            continue;
          }
          if (e.status === 404 || (e.status === 400 && /not found|not supported|unknown name/i.test(e.message))) {
            // Google đã đổi tên / ngừng model này → ghi nhật ký 1 lần để biết mà cập nhật
            if (!reportedGone.has(model)) {
              reportedGone.add(model);
              void note("ai-model-gone", `${model}: ${e.message.slice(0, 200)}`);
            }
            cooldown.set(model, { until: Date.now() + 6 * 3600_000, daily: false });
            break; // thử model kế tiếp
          }
          if (e.status >= 500) continue; // lỗi tạm thời: thử lại
          throw e;
        }
        if (e instanceof SyntaxError) continue; // JSON hỏng: thử lại
        throw e;
      }
    }
  }
  if (limited) throw limitError(Date.now());
  throw lastErr instanceof Error ? lastErr : new Error("Không gọi được Gemini");
}

/** Mọi model đều đang hết lượt → báo thời gian chờ ngắn nhất */
function limitError(now: number) {
  const waits = models().map((m) => cooldown.get(m)).filter((c): c is { until: number; daily: boolean } => !!c && c.until > now);
  const minWait = waits.length ? Math.max(5, Math.ceil((Math.min(...waits.map((w) => w.until)) - now) / 1000)) : 30;
  const allDaily = waits.length > 0 && waits.every((w) => w.daily);
  return new RateLimitError(minWait, allDaily);
}
