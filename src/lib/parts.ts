/**
 * Gom câu hỏi theo DẠNG BÀI (phát âm, trọng âm, điền chỗ trống, đồng nghĩa, đọc hiểu…)
 * để hiện thành các "Phần" trên thanh điều hướng của học viên.
 *
 * - Website tự nhận dạng từ câu hướng dẫn của nhóm câu (section), đoạn văn và nội dung câu hỏi.
 * - Giáo viên có thể đổi dạng của 1 nhóm câu (section.kind) hoặc 1 câu lẻ (question.kind),
 *   và đặt tên tuỳ ý cho từng phần (quizzes.part_titles = { [kind]: "tên" }).
 */

export const PART_KINDS = [
  "pronunciation",
  "stress",
  "fill",
  "synonym",
  "antonym",
  "error",
  "rewrite",
  "combine",
  "dialogue",
  "ordering",
  "cloze",
  "reading",
  "sign",
  "other",
] as const;
export type PartKind = (typeof PART_KINDS)[number];

/** Tên mặc định (tiếng Việt = khoá dịch, bản tiếng Anh nằm trong i18n/en.ts) */
export const PART_NAMES: Record<PartKind, string> = {
  pronunciation: "Phát âm",
  stress: "Trọng âm",
  fill: "Điền vào chỗ trống",
  synonym: "Từ đồng nghĩa",
  antonym: "Từ trái nghĩa",
  error: "Tìm lỗi sai",
  rewrite: "Viết lại câu",
  combine: "Kết hợp câu",
  dialogue: "Giao tiếp",
  ordering: "Sắp xếp câu",
  cloze: "Điền từ vào đoạn văn",
  reading: "Đọc hiểu",
  sign: "Biển báo – Thông báo",
  other: "Câu hỏi khác",
};

export const isPartKind = (k: unknown): k is PartKind => typeof k === "string" && (PART_KINDS as readonly string[]).includes(k);

type SectionLike = { instruction: string | null; passage: string | null; kind?: string | null } | null | undefined;
type QuestionLike = {
  number: number;
  section_index: number | null;
  stem: string;
  options: { label: string; text: string }[];
  image?: string | null;
  kind?: string | null;
};

const plain = (h: string | null | undefined) =>
  (h ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const BLANK_RE = /_{2,}|…{1,}|\.{4,}|\(\s*\)/;

/** Nhận dạng từ câu chữ (hướng dẫn hoặc câu hỏi). Thứ tự kiểm tra quan trọng: dạng cụ thể trước, chung chung sau. */
export function kindFromText(raw: string | null | undefined): PartKind | null {
  const s = plain(raw);
  if (!s) return null;
  if (/\bstress|trọng âm/.test(s)) return "stress";
  if (/pronunciation|pronounced|phát âm/.test(s)) return "pronunciation";
  if (/arrange|arrangement|re-?order|(correct|best|logical|right|meaningful|proper) (order|sequence)|sắp xếp/.test(s)) return "ordering";
  if (/numbered (blank|gap|space)|each of the (numbered )?(blanks|gaps|spaces)|(blanks|gaps) (in|from) the (passage|text)|điền.{0,30}đoạn/.test(s)) return "cloze";
  if (/opposite in meaning|antonym|trái nghĩa/.test(s)) return "antonym";
  if (/synonym|đồng nghĩa|(closest|nearest|similar) in meaning to the underlined|underlined (word|part|phrase)s?.{0,80}(closest|nearest|similar) in meaning/.test(s)) return "synonym";
  if (/needs? correction|correction|incorrect|\berrors?\b|mistake|lỗi sai/.test(s)) return "error";
  if (/combin|kết hợp|nối câu/.test(s)) return "combine";
  if (/(closest|nearest|same|similar) in meaning|rewrit|restat|paraphras|viết lại/.test(s)) return "rewrite";
  if (/exchange|response|respond|conversation|dialogue|repl(y|ies)|giao tiếp|hội thoại/.test(s)) return "dialogue";
  if (/read the (following )?(passage|text|article|paragraph)|reading|đọc hiểu|đọc đoạn/.test(s)) return "reading";
  if (/\bsigns?\b|\bnotices?\b|\blabels?\b|biển báo|thông báo/.test(s)) return "sign";
  if (/complete|fill|\bblank|\bgap|điền/.test(s)) return "fill";
  return null;
}

/** Câu lẻ (không có hướng dẫn chung): xét chính câu hỏi */
export function kindOfQuestion(q: QuestionLike): PartKind | null {
  const opts = q.options.map((o) => plain(o.text));
  // Phương án dạng "a – c – b – d" hoặc "b, a, c" → sắp xếp
  if (opts.length >= 2 && opts.filter((o) => /^[a-e]\s*[-–—,]\s*[a-e](\s*[-–—,]\s*[a-e])+\.?$/.test(o)).length >= opts.length - 1) return "ordering";
  const stem = plain(q.stem);
  // Chỉ đọc "dạng bài" từ câu hỏi khi câu hỏi là một lời yêu cầu (Choose/Mark/Find…),
  // tránh nhận nhầm vì nội dung câu có chữ "stress", "reading", "mistake"…
  if (/^(question \d+\W*)?(choose|mark|find|select|pick|identify|indicate|circle|which|chọn|tìm|xác định|khoanh)\b/.test(stem)) {
    const k = kindFromText(stem);
    if (k) return k;
  }
  if (BLANK_RE.test(q.stem)) return "fill";
  if (q.image) return "sign";
  return null;
}

function majority(kinds: (PartKind | null)[]): PartKind | null {
  const count = new Map<PartKind, number>();
  for (const k of kinds) if (k) count.set(k, (count.get(k) ?? 0) + 1);
  let best: PartKind | null = null;
  let n = 0;
  for (const [k, c] of count) if (c > n) [best, n] = [k, c];
  return best;
}

/** Dạng tự nhận của 1 nhóm câu (section) */
export function autoKindOfSection(sec: SectionLike, qs: QuestionLike[]): PartKind {
  const passage = sec?.passage?.trim() ?? "";
  const instr = kindFromText(sec?.instruction);
  if (passage) {
    const nums = new Set(qs.map((q) => q.number));
    const numbered = [...passage.matchAll(/\((\d{1,3})\)/g)].some((m) => nums.has(Number(m[1])));
    if (instr === "cloze" || numbered || BLANK_RE.test(passage)) return "cloze";
    if (instr === "ordering" || instr === "sign") return instr;
    return "reading";
  }
  if (instr) return instr;
  return majority(qs.map(kindOfQuestion)) ?? "other";
}

/** Dạng thực tế của từng câu (theo đúng thứ tự mảng đưa vào): giáo viên chọn > nhóm câu > tự nhận */
export function resolveKinds(sections: SectionLike[], questions: QuestionLike[]): PartKind[] {
  const bySec = new Map<number, QuestionLike[]>();
  for (const q of questions) if (q.section_index != null) bySec.set(q.section_index, [...(bySec.get(q.section_index) ?? []), q]);
  const secKind = new Map<number, PartKind>();
  for (const [i, qs] of bySec) {
    const s = sections[i];
    secKind.set(i, isPartKind(s?.kind) ? s.kind : autoKindOfSection(s, qs));
  }
  return questions.map((q) => {
    if (isPartKind(q.kind)) return q.kind;
    if (q.section_index != null && secKind.has(q.section_index)) return secKind.get(q.section_index)!;
    return kindOfQuestion(q) ?? "other";
  });
}

export type Part = {
  kind: PartKind;
  /** Tên giáo viên đặt (null = dùng tên mặc định "Phần n: …") */
  custom: string | null;
  /** Chỉ số các câu (theo mảng đưa vào), đã sắp theo thứ tự xuất hiện */
  items: number[];
};

/**
 * Gom câu thành các phần. Thứ tự phần theo số câu gốc nhỏ nhất (giữ nguyên dù đề có xáo câu),
 * câu trong mỗi phần theo thứ tự hiển thị.
 */
export function buildParts(sections: SectionLike[], questions: QuestionLike[], titles?: Record<string, string> | null): Part[] {
  const kinds = resolveKinds(sections, questions);
  const map = new Map<PartKind, { items: number[]; min: number }>();
  kinds.forEach((k, i) => {
    const p = map.get(k) ?? { items: [], min: Infinity };
    p.items.push(i);
    p.min = Math.min(p.min, questions[i].number * 10000 + i);
    map.set(k, p);
  });
  return [...map.entries()]
    .sort((a, b) => a[1].min - b[1].min)
    .map(([kind, p]) => ({ kind, custom: titles?.[kind]?.trim() || null, items: p.items }));
}

/** Tên hiển thị của phần. t = hàm dịch của giao diện. */
export function partTitle(p: Part, index: number, total: number, t: (k: string, v?: Record<string, string | number>) => string) {
  if (p.custom) return p.custom;
  if (total === 1 && p.kind === "other") return t("Tất cả câu hỏi");
  return t("Phần {n}: {name}", { n: index + 1, name: t(PART_NAMES[p.kind]) });
}

/** "1–5, 21–25" từ danh sách số thứ tự */
export function rangeText(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}–${s[j]}` : String(s[i]));
    i = j;
  }
  return out.join(", ");
}
