export type Option = { label: string; text: string };

export type AnswerSource = "from_pdf" | "ai_solved" | "manual";

export type Section = { instruction: string | null; passage: string | null };

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
};

/** Câu hỏi gửi cho học viên — KHÔNG có đáp án */
export type PublicQuestion = {
  id: string;
  number: number;
  section_index: number | null;
  stem: string;
  options: Option[];
  image?: string | null;
};
