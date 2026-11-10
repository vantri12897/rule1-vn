import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase/admin";
import { IMAGE_BUCKET, MAX_IMAGE_BYTES, dataUrlBytes, isStoredUrl, sniffImage, storedPath } from "./images";

let bucketReady: Promise<void> | null = null;
let usageCache: { at: number; v: { bytes: number; count: number } } | null = null;

/** Tạo kho "quiz-images" (công khai để học viên xem được hình) nếu chưa có — chỉ chạy 1 lần mỗi tiến trình */
export function ensureBucket() {
  bucketReady ??= (async () => {
    const st = supabaseAdmin().storage;
    const { error } = await st.getBucket(IMAGE_BUCKET);
    if (!error) return;
    const { error: e2 } = await st.createBucket(IMAGE_BUCKET, {
      public: true,
      fileSizeLimit: MAX_IMAGE_BYTES,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
    if (e2 && !/already exists/i.test(e2.message)) throw new Error(`createBucket: ${e2.message}`);
  })().catch((e) => {
    bucketReady = null; // lần sau thử lại
    throw e;
  });
  return bucketReady;
}

/** Lưu 1 hình vào kho của giáo viên, trả về link công khai. Cùng nội dung → cùng file (không lưu trùng). */
export async function storeImage(ownerId: string, bytes: Uint8Array): Promise<string> {
  if (!/^[0-9a-f-]{36}$/.test(ownerId)) throw new Error("bad owner id");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error(`image size ${bytes.length} out of range`);
  const kind = sniffImage(bytes);
  if (!kind) throw new Error("not a JPEG/PNG/WebP image");
  await ensureBucket();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = `${ownerId}/${hash}.${kind.ext}`;
  const st = supabaseAdmin().storage.from(IMAGE_BUCKET);
  const { error } = await st.upload(path, bytes, { contentType: kind.mime, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`upload: ${error.message}`);
  usageCache = null; // dung lượng kho đã đổi
  return st.getPublicUrl(path).data.publicUrl;
}

export async function storeDataUrl(ownerId: string, dataUrl: string) {
  return storeImage(ownerId, dataUrlBytes(dataUrl).bytes);
}

/**
 * Chuyển hình cũ (lưu thẳng trong cơ sở dữ liệu dạng data:image/…) sang kho file.
 * Làm từng đợt nhỏ trong giới hạn thời gian; gọi lại để làm tiếp. ownerId = chỉ của 1 giáo viên.
 */
export async function migrateImages({ ownerId, budgetMs = 45_000 }: { ownerId?: string; budgetMs?: number } = {}) {
  const sb = supabaseAdmin();
  const until = Date.now() + budgetMs;
  let moved = 0;
  let failed = 0;
  const skip = new Set<string>();
  while (Date.now() < until) {
    let q = sb.from("questions").select("id, image, quizzes!inner(owner_id)").like("image", "data:%").limit(10);
    if (ownerId) q = q.eq("quizzes.owner_id", ownerId);
    if (skip.size) q = q.not("id", "in", `(${[...skip].join(",")})`);
    const { data, error } = await q;
    if (error) throw new Error(`select: ${error.message}`);
    if (!data?.length) break;
    for (const row of data as unknown as { id: string; image: string; quizzes: { owner_id: string } }[]) {
      if (Date.now() >= until) break;
      try {
        const url = await storeDataUrl(row.quizzes.owner_id, row.image);
        const { error: e2 } = await sb.from("questions").update({ image: url }).eq("id", row.id);
        if (e2) throw new Error(e2.message);
        moved++;
      } catch (e) {
        failed++;
        skip.add(row.id);
        console.error("[images] migrate", row.id, e instanceof Error ? e.message : e);
      }
    }
  }
  const remaining = await countDataImages(ownerId);
  return { moved, failed, remaining };
}

export async function countDataImages(ownerId?: string) {
  let q = supabaseAdmin().from("questions").select("id, quizzes!inner(owner_id)", { count: "exact", head: true }).like("image", "data:%");
  if (ownerId) q = q.eq("quizzes.owner_id", ownerId);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Dọn chỗ trống sau khi đã chuyển hình: ghi lại bảng câu hỏi để cơ sở dữ liệu thật sự nhỏ lại
 * (nếu không, chỗ trống chỉ được dùng lại cho dữ liệu mới, con số dung lượng không giảm).
 * Bảng câu hỏi lúc này chỉ còn chữ nên chạy rất nhanh (khoá bảng trong khoảng 1 giây).
 */
export async function compactQuestions(): Promise<boolean> {
  const raw = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!raw) return false;
  const { default: pg } = await import("pg");
  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("supa");
  const client = new pg.Client({ connectionString: url.toString(), ssl: process.env.NO_SSL ? false : { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query("set lock_timeout = '3s'");
    await client.query("vacuum (full, analyze) public.questions");
    return true;
  } catch (e) {
    console.error("[images] vacuum", e instanceof Error ? e.message : e);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

type StorageItem = { name: string; id: string | null; created_at: string | null; metadata: { size?: number } | null };

async function listAll(prefix: string) {
  const st = supabaseAdmin().storage.from(IMAGE_BUCKET);
  const out: StorageItem[] = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const { data, error } = await st.list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list: ${error.message}`);
    out.push(...((data ?? []) as StorageItem[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Xoá hình không còn câu hỏi nào dùng (đề đã xoá, hình đã thay…) của 1 giáo viên.
 * Chỉ xoá file cũ hơn 1 ngày để không đụng hình vừa tải lên mà chưa bấm Lưu.
 */
export async function cleanupImages(ownerId: string) {
  const sb = supabaseAdmin();
  const files = (await listAll(ownerId)).filter((f) => f.id);
  if (!files.length) return 0;
  const used = new Set<string>();
  // Ảnh đại diện của giáo viên cũng nằm trong kho → giữ lại. Không đọc được tài khoản thì bỏ qua lần dọn này cho an toàn.
  const { data: acc, error: accErr } = await sb.auth.admin.getUserById(ownerId);
  if (accErr) return 0;
  const av = acc?.user?.user_metadata?.avatar_url as string | undefined;
  if (isStoredUrl(av)) used.add(storedPath(av)!);
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("questions")
      .select("image, quizzes!inner(owner_id)")
      .eq("quizzes.owner_id", ownerId)
      .like("image", "http%")
      .range(from, from + 999);
    if (error) throw new Error(`select used: ${error.message}`);
    for (const r of data ?? []) {
      const p = isStoredUrl(r.image as string) ? storedPath(r.image as string) : null;
      if (p) used.add(p);
    }
    if (!data || data.length < 1000) break;
  }
  const dayAgo = Date.now() - 86400_000;
  const stale = files.map((f) => ({ path: `${ownerId}/${f.name}`, at: f.created_at ? Date.parse(f.created_at) : 0 })).filter((f) => !used.has(f.path) && f.at < dayAgo);
  let removed = 0;
  for (let i = 0; i < stale.length; i += 500) {
    const { data, error } = await sb.storage.from(IMAGE_BUCKET).remove(stale.slice(i, i + 500).map((f) => f.path));
    if (error) throw new Error(`remove: ${error.message}`);
    removed += data?.length ?? 0;
  }
  if (removed) usageCache = null;
  return removed;
}

/** Dọn hình thừa của mọi giáo viên có thư mục trong kho (kể cả người đã xoá hết đề) */
export async function cleanupAllImages() {
  let removed = 0;
  for (const f of await listAll("")) if (!f.id && /^[0-9a-f-]{36}$/.test(f.name)) removed += await cleanupImages(f.name);
  return removed;
}

/** Tổng dung lượng kho hình (cả project). Gói Free của Supabase: 1 GB. */
export async function storageUsage() {
  if (usageCache && Date.now() - usageCache.at < 60_000) return usageCache.v;
  let bytes = 0;
  let count = 0;
  const roots = await listAll("");
  for (const r of roots) {
    if (r.id) {
      bytes += r.metadata?.size ?? 0;
      count++;
      continue;
    }
    for (const f of await listAll(r.name)) {
      if (!f.id) continue;
      bytes += f.metadata?.size ?? 0;
      count++;
    }
  }
  usageCache = { at: Date.now(), v: { bytes, count } };
  return usageCache.v;
}

/** Tải hình đã lưu về dạng data URL (để sao lưu / xuất Word mang theo hình) */
export async function fetchAsDataUrl(src: string): Promise<string | null> {
  if (!isStoredUrl(src)) return (src as string).startsWith("data:image/") ? src : null;
  try {
    const r = await fetch(src);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const kind = sniffImage(buf);
    if (!kind) return null;
    return `data:${kind.mime};base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    return null;
  }
}
