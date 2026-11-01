// Hỗ trợ cả tên biến cũ (anon/service_role) và mới (publishable/secret) mà tích hợp Supabase trên Vercel tự tạo.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
