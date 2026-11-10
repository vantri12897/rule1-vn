import "server-only";
import { supabaseAdmin } from "./supabase/admin";

/** Gói Supabase Free: cơ sở dữ liệu tối đa 500 MB (đổi bằng biến DB_LIMIT_MB nếu nâng gói) */
export const DB_LIMIT = Number(process.env.DB_LIMIT_MB || 500) * 1024 * 1024;

export type DbUsage = { total: number; questions: number; images: number; image_count: number; attempts: number; quizzes: number; logs: number; limit: number };

export async function dbUsage(): Promise<DbUsage | null> {
  const { data, error } = await supabaseAdmin().rpc("db_usage");
  if (error || !data) return null;
  return { ...(data as Omit<DbUsage, "limit">), limit: DB_LIMIT };
}

/** Gói Supabase Free: kho file (hình ảnh) tối đa 1 GB (đổi bằng biến STORAGE_LIMIT_MB nếu nâng gói) */
export const STORAGE_LIMIT = Number(process.env.STORAGE_LIMIT_MB || 1024) * 1024 * 1024;
