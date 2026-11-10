/**
 * Hình ảnh trong câu hỏi được lưu ở KHO FILE RIÊNG (Supabase Storage, bucket "quiz-images"),
 * trong cơ sở dữ liệu chỉ còn đường link → cơ sở dữ liệu nhẹ, trang làm bài tải nhanh hơn.
 * Đường dẫn file: <id giáo viên>/<mã băm SHA-256 của nội dung>.<đuôi> (cùng 1 hình → cùng 1 file).
 * Dữ liệu cũ dạng "data:image/..." vẫn đọc được và được tự chuyển dần sang kho file.
 */
export const IMAGE_BUCKET = "quiz-images";
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const STORED_RE = /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/quiz-images\/([0-9a-f-]{36})\/([0-9a-f]{64})\.(jpg|png|webp)$/;

export const isDataUrl = (s: string | null | undefined): s is string => typeof s === "string" && s.startsWith("data:image/");
export const isStoredUrl = (s: string | null | undefined): s is string => typeof s === "string" && STORED_RE.test(s);

/** Tên file trong kho (vd "uid/abc….jpg") của 1 link đã lưu */
export function storedPath(url: string): string | null {
  const m = STORED_RE.exec(url);
  return m ? `${m[1]}/${m[2]}.${m[3]}` : null;
}

const EXT: Record<string, "jpg" | "png" | "webp"> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Nhận dạng định dạng ảnh theo vài byte đầu (không tin vào phần khai báo) */
export function sniffImage(b: Uint8Array): { mime: string; ext: "jpg" | "png" | "webp" } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

export function dataUrlBytes(s: string): { bytes: Uint8Array; mime: string } {
  const m = /^data:(image\/[a-z+]+);base64,([\s\S]*)$/.exec(s);
  if (!m) throw new Error("not a base64 image data URL");
  const bin = typeof atob === "function" ? atob(m[2]) : Buffer.from(m[2], "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: m[1] };
}

export const extOf = (mime: string) => EXT[mime] ?? null;
