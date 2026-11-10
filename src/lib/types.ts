export type Option = { label: string; text: string };

export type AnswerSource = "from_pdf" | "ai_solved" | "manual";

export type Section = {
  instruction: string | null;
  passage: string | null;
  /** Dạng bài giáo viên chọn cho cả nhóm câu (xem lib/parts.ts); không có = tự nhận */
  kind?: string | null;
};

/** Câu hỏi khi đang soạn (chưa có id trong DB) */
export type DraftQuestion = {
  id?: string;
  number: number;
  section_index: number | null;
  stem: string;
  options: Option[];
  correct_label: string | null;
  answer_source: AnswerSource;
  confidence: number | null;
  needs_review: boolean;
  explanation: string | null;
  /** Hình minh hoạ (biển báo, thông báo, biểu đồ…) dạng data URL JPEG/PNG */
  image?: string | null;
  /** Dạng bài giáo viên chọn riêng cho câu này (null = tự nhận) */
  kind?: string | null;
};

export type Quiz = {
  id: string;
  owner_id: string;
  title: string;
  slug: string;
  status: "draft" | "open" | "closed";
  sections: Section[];
  time_limit_min: number | null;
  shuffle_questions: boolean;
  shuffle_options?: boolean;
  show_answers: boolean;
  /** Tên phần giáo viên đặt trên thanh điều hướng: { [dạng bài]: tên } */
  part_titles?: Record<string, string> | null;
  /** Danh sách lớp (học viên chọn tên trong danh sách); null = tự gõ tên */
  class_id?: string | null;
  source_file_hash: string | null;
  created_at: string;
  updated_at: string;
};

export type QuestionRow = DraftQuestion & { id: string; quiz_id: string; position: number };

export type Attempt = {
  id: string;
  quiz_id: string;
  student_token: string;
  student_name: string;
  student_class: string | null;
  answers: Record<string, string>;
  score: number | null;
  total: number | null;
  status: "in_progress" | "submitted" | "archived";
  started_at: string;
  submitted_at: string | null;
  /** Học viên trong danh sách lớp (id trong classes.students); null = tự gõ tên */
  roster_id?: string | null;
  /** Số lần rời trang làm bài (null = bài nộp trước khi có tính năng này) */
  away_count?: number | null;
  away_seconds?: number | null;
};

/** Câu hỏi gửi cho học viên — KHÔNG có đáp án */
export type PublicQuestion = {
  id: string;
  number: number;
  section_index: number | null;
  stem: string;
  options: Option[];
  image?: string | null;
  kind?: string | null;
};

/** Danh sách lớp của giáo viên */
export type RosterStudent = { id: string; name: string };
export type ClassList = { id: string; owner_id: string; name: string; students: RosterStudent[]; created_at: string; updated_at: string };
