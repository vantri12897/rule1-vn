import type { Option } from "./types";

/**
 * Xáo thứ tự đáp án A/B/C/D theo từng học viên.
 * - Hoán vị cố định theo (token học viên, id câu) → tải lại trang vẫn thấy cùng thứ tự.
 * - Học viên thấy chữ cái mới (A, B, C…); khi nộp bài server đổi về chữ cái gốc để chấm,
 *   nên giáo viên luôn thấy đáp án theo đề gốc.
 */
const LETTERS = "ABCDEF";

// Không xáo những câu mà thứ tự đáp án có nghĩa ("All of the above", "Both A and B"…)
const ORDER_MATTERS = /\b(all|none|both|neither)\s+of\s+(the\s+)?(above|these|them|the\s+options)\b|\b[A-F]\s*(and|&|or)\s*[A-F]\b/i;

export function canShuffle(options: Option[]) {
  return !options.some((o) => ORDER_MATTERS.test(o.text.replace(/<[^>]+>/g, "")));
}

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** perm[i] = vị trí gốc của phương án hiển thị thứ i */
export function optionPerm(token: string, questionId: string, n: number): number[] {
  const rand = seeded(`${token}:${questionId}:opts`);
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function identityPerm(n: number) {
  return Array.from({ length: n }, (_, i) => i);
}

export function displayOptions(options: Option[], perm: number[]): Option[] {
  return perm.map((orig, i) => ({ label: LETTERS[i], text: options[orig].text }));
}

/** Chữ cái học viên chọn → chữ cái gốc trong đề */
export function toOriginal(displayLabel: string, options: Option[], perm: number[]): string | null {
  const i = LETTERS.indexOf(displayLabel.toUpperCase());
  return i >= 0 && i < perm.length ? options[perm[i]].label : null;
}

/** Chữ cái gốc → chữ cái học viên đã thấy */
export function toDisplay(originalLabel: string | null, options: Option[], perm: number[]): string | null {
  if (!originalLabel) return null;
  const orig = options.findIndex((o) => o.label === originalLabel);
  const i = perm.indexOf(orig);
  return i >= 0 ? LETTERS[i] : null;
}
