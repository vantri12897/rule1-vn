import { isStoredUrl } from "./images";

/** Tên hiển thị + ảnh đại diện của giáo viên (lưu trong user_metadata của tài khoản Supabase) */
export type TeacherProfile = { name: string | null; avatar: string | null };

export function profileFromMeta(meta: unknown): TeacherProfile {
  const raw = (meta ?? {}) as Record<string, unknown>;
  // nhận cả dạng đã chuẩn hoá {name, avatar} (middleware chuyển xuống) lẫn user_metadata gốc
  const m = "display_name" in raw || "avatar_url" in raw ? raw : { display_name: raw.name, avatar_url: raw.avatar };
  const name = typeof m.display_name === "string" ? m.display_name.replace(/\s+/g, " ").trim().slice(0, 40) || null : null;
  // Chỉ nhận ảnh nằm trong kho hình của website (không cho trỏ ra trang ngoài)
  const avatar = typeof m.avatar_url === "string" && isStoredUrl(m.avatar_url) ? m.avatar_url : null;
  return { name, avatar };
}
