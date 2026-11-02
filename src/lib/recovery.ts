import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bỏ I, O, 0, 1 để khỏi nhầm

/** Mã dạng ABCD-EFGH-JKLM-NPQR (~80 bit ngẫu nhiên) */
export function newRecoveryCode(): string {
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

export function normalizeCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashCode(code: string) {
  return createHash("sha256").update("yd-english:" + normalizeCode(code)).digest("hex");
}

export function sameHash(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
