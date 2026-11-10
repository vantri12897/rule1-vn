import "server-only";
import { supabaseAdmin } from "./supabase/admin";
import { esc, sendMail } from "./mailer";
import { isStoredUrl } from "./images";
import { fetchAsDataUrl } from "./image-store";

type Row = Record<string, unknown>;
const GMAIL_LIMIT = 20 * 1024 * 1024; // Gmail nhận tệp đính kèm tối đa ~25 MB → chừa khoảng an toàn

async function fetchAll(table: string, col: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin().from(table).select("*").in(col, chunk).range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

/** Bản sao lưu của 1 giáo viên — cùng định dạng với nút "Tải file sao lưu" nên khôi phục được như thường */
export async function buildBackup(ownerId: string) {
  const { data: quizzes, error } = await supabaseAdmin().from("quizzes").select("*").eq("owner_id", ownerId);
  if (error) throw new Error(`quizzes: ${error.message}`);
  const ids = (quizzes ?? []).map((q) => q.id as string);
  const [questions, attempts] = ids.length ? await Promise.all([fetchAll("questions", "quiz_id", ids), fetchAll("attempts", "quiz_id", ids)]) : [[], []];
  return { app: "YD-English" as const, version: 1 as const, exported_at: new Date().toISOString(), quizzes: (quizzes ?? []) as Row[], questions, attempts };
}

const L = {
  vi: {
    subject: (d: string) => `💾 Bản sao lưu YD-English — ${d}`,
    hi: "Đây là bản sao lưu tự động hằng tuần của bạn.",
    counts: (a: number, b: number, c: number) => `<b>${a}</b> đề · <b>${b}</b> câu hỏi · <b>${c}</b> bài làm của học viên`,
    how: "Muốn khôi phục: vào <b>Tài khoản &amp; sao lưu</b> → <b>Khôi phục từ file</b> → chọn tệp đính kèm trong email này.",
    noImg: "⚠️ Dữ liệu có nhiều hình nên một số hình trong tệp đính kèm chỉ là <b>đường link tới kho hình</b> (Gmail giới hạn ~25 MB) — vẫn khôi phục được khi kho hình còn. Bản đầy đủ gồm mọi hình: bấm <b>Tải file sao lưu</b> trong trang Tài khoản.",
    tooBig: "⚠️ Dữ liệu quá lớn để gửi qua Gmail. Hãy vào trang Tài khoản và bấm <b>Tải file sao lưu</b> để lưu về máy.",
    off: "Muốn tắt email này: trang <b>Tài khoản &amp; sao lưu</b> → bỏ chọn <b>Tự gửi bản sao lưu vào email mỗi Chủ nhật</b>.",
    keep: "Tệp có tên và bài làm của học viên — hãy giữ hộp thư này an toàn.",
  },
  en: {
    subject: (d: string) => `💾 YD-English backup — ${d}`,
    hi: "Here is your automatic weekly backup.",
    counts: (a: number, b: number, c: number) => `<b>${a}</b> test${a === 1 ? "" : "s"} · <b>${b}</b> question${b === 1 ? "" : "s"} · <b>${c}</b> student attempt${c === 1 ? "" : "s"}`,
    how: "To restore: go to <b>Account &amp; backup</b> → <b>Restore from file</b> → choose the attachment of this email.",
    noImg: "⚠️ Your data has many images, so some images in the attachment are only <b>links to the image storage</b> (Gmail limit ~25 MB) — they still restore while the storage exists. Full copy with every image: click <b>Download backup</b> on the Account page.",
    tooBig: "⚠️ Your data is too large to send by Gmail. Go to the Account page and click <b>Download backup</b> to save it.",
    off: "To stop this email: <b>Account &amp; backup</b> → untick <b>Email me a backup every Sunday</b>.",
    keep: "The file contains student names and answers — keep this mailbox secure.",
  },
};

/** Tạo bản sao lưu và gửi vào email của giáo viên. Trả về mô tả ngắn để lưu lại. */
export async function emailBackup(ownerId: string, to: string, lang: "vi" | "en" = "vi") {
  const b = await buildBackup(ownerId);
  const T = L[lang];
  const vn = new Date(Date.now() + 7 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${p(vn.getUTCDate())}/${p(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()}`;
  const file = `YD-English-saoluu-${vn.getUTCFullYear()}-${p(vn.getUTCMonth() + 1)}-${p(vn.getUTCDate())}.json`;

  // Hình ở kho file → tải về gộp vào tệp (tự đủ để khôi phục), tới khi chạm giới hạn của Gmail thì giữ dạng link
  let budget = GMAIL_LIMIT - JSON.stringify(b).length;
  let linked = 0;
  const questions: Row[] = [];
  for (const q of b.questions) {
    const img = q.image as string | null;
    if (isStoredUrl(img)) {
      const d = budget > 0 ? await fetchAsDataUrl(img) : null;
      if (d && d.length <= budget) {
        budget -= d.length;
        questions.push({ ...q, image: d });
        continue;
      }
      linked++;
    }
    questions.push(q);
  }
  let json = JSON.stringify({ ...b, questions });
  let note = linked ? T.noImg : "";
  let attach = true;
  if (json.length > GMAIL_LIMIT) {
    json = JSON.stringify(b);
    note = T.noImg;
    if (json.length > GMAIL_LIMIT) (attach = false), (note = T.tooBig);
  }
  const counts = T.counts(b.quizzes.length, b.questions.length, b.attempts.length);
  await sendMail({
    to,
    subject: T.subject(day),
    text: `${T.hi}\n${b.quizzes.length} / ${b.questions.length} / ${b.attempts.length}\n${T.how.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")}`,
    html: `<p>${esc(T.hi)}</p><p style="font-size:15px">${counts}</p>${note ? `<p style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 12px">${note}</p>` : ""}
<p>${T.how}</p><p style="color:#556070;font-size:13px">${T.keep}<br>${T.off}</p>`,
    attachments: attach ? [{ filename: file, content: json, contentType: "application/json" }] : undefined,
  });
  const mb = (json.length / 1024 / 1024).toFixed(2);
  return `${b.quizzes.length}/${b.questions.length}/${b.attempts.length} · ${attach ? `${mb} MB` : "no attachment"}${note && attach ? " · some images as links" : ""}`;
}
