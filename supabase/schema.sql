-- =====================================================================
-- YD-English — Database schema (chạy 1 lần trong Supabase > SQL Editor)
-- =====================================================================


-- ---------- Đề thi ----------
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Đề trắc nghiệm',
  slug text not null unique,
  status text not null default 'draft' check (status in ('draft','open','closed')),
  sections jsonb not null default '[]'::jsonb,       -- [{instruction, passage}]
  time_limit_min int check (time_limit_min is null or time_limit_min > 0),
  shuffle_questions boolean not null default false,
  show_answers boolean not null default true,
  source_file_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quizzes_owner_idx on public.quizzes(owner_id);

-- ---------- Câu hỏi ----------
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  position int not null,
  number int not null,
  section_index int,                                  -- trỏ tới quizzes.sections[i]
  stem text not null default '',
  options jsonb not null default '[]'::jsonb,         -- [{label:'A', text:'...'}]
  correct_label text,
  answer_source text not null default 'manual' check (answer_source in ('from_pdf','ai_solved','manual')),
  confidence real,
  needs_review boolean not null default false,
  explanation text
);
create index if not exists questions_quiz_idx on public.questions(quiz_id, position);

-- ---------- Bài làm ----------
create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  student_token uuid not null,
  student_name text not null,
  student_class text,
  answers jsonb not null default '{}'::jsonb,         -- {question_id: 'A'}
  score int,
  total int,
  status text not null default 'in_progress' check (status in ('in_progress','submitted','archived')),
  started_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index if not exists attempts_quiz_idx on public.attempts(quiz_id, status);
-- Mỗi thiết bị chỉ có 1 bài "đang hoạt động" cho mỗi đề (bài đã reset = archived không tính)
create unique index if not exists attempts_one_active
  on public.attempts(quiz_id, student_token) where status <> 'archived';

-- ---------- Lịch sử reset ----------
create table if not exists public.reset_logs (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  attempt_id uuid references public.attempts(id) on delete set null,
  scope text not null check (scope in ('single','all')),
  reset_by uuid references auth.users(id) on delete set null,
  reset_at timestamptz not null default now()
);

-- ---------- Đếm lượt gọi AI theo ngày ----------
create table if not exists public.ai_usage (
  day date not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  calls int not null default 0,
  primary key (day, owner_id)
);

create or replace function public.bump_ai_usage(p_owner uuid)
returns int language sql security definer set search_path = public as $$
  insert into public.ai_usage(day, owner_id, calls)
  values ((now() at time zone 'Asia/Ho_Chi_Minh')::date, p_owner, 1)
  on conflict (day, owner_id) do update set calls = ai_usage.calls + 1
  returning calls;
$$;
revoke all on function public.bump_ai_usage(uuid) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid) to service_role;

-- ---------- updated_at ----------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists quizzes_touch on public.quizzes;
create trigger quizzes_touch before update on public.quizzes
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- Row Level Security: giáo viên chỉ thấy dữ liệu của mình.
-- Học viên KHÔNG truy cập trực tiếp bảng — mọi thao tác đi qua API server.
-- =====================================================================
alter table public.quizzes    enable row level security;
alter table public.questions  enable row level security;
alter table public.attempts   enable row level security;
alter table public.reset_logs enable row level security;
alter table public.ai_usage   enable row level security;

drop policy if exists quizzes_owner on public.quizzes;
create policy quizzes_owner on public.quizzes
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists questions_owner on public.questions;
create policy questions_owner on public.questions
  for all to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()))
  with check (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()));

drop policy if exists attempts_owner on public.attempts;
create policy attempts_owner on public.attempts
  for all to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()))
  with check (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()));

drop policy if exists reset_logs_owner on public.reset_logs;
create policy reset_logs_owner on public.reset_logs
  for all to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()))
  with check (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()));

drop policy if exists ai_usage_owner on public.ai_usage;
create policy ai_usage_owner on public.ai_usage
  for select to authenticated using (owner_id = auth.uid());

-- =====================================================================
-- Bổ sung (02/11/2026): hình ảnh trong câu hỏi + mã khôi phục mật khẩu
-- =====================================================================
alter table public.questions add column if not exists image text;
alter table public.questions drop constraint if exists questions_image_check;
alter table public.questions add constraint questions_image_check
  check (image is null or (image like 'data:image/%' and length(image) <= 600000));

-- Mã khôi phục mật khẩu (chỉ lưu bản băm). Không có policy → chỉ server (service role) đọc/ghi được.
create table if not exists public.recovery_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.recovery_codes enable row level security;

-- Bổ sung (02/11/2026): xáo thứ tự đáp án A/B/C/D theo từng học viên
alter table public.quizzes add column if not exists shuffle_options boolean not null default false;

-- Bổ sung (02/11/2026): mã đặt lại mật khẩu gửi qua email (6 số, hết hạn 15 phút, tối đa 5 lần thử)
create table if not exists public.password_reset_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_at timestamptz not null default now()
);
alter table public.password_reset_codes enable row level security;

-- Tra id tài khoản theo email (chỉ server dùng được)
create or replace function public.user_id_by_email(p_email text)
returns uuid language sql security definer set search_path = public, auth stable as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;
revoke all on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;

-- =====================================================================
-- Bổ sung (09/11/2026): sao lưu tự động qua email + nhật ký lỗi
-- Các bảng dưới đây KHÔNG có policy → chỉ máy chủ (service role) đọc/ghi được.
-- =====================================================================
create table if not exists public.teacher_backups (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  last_sent_at timestamptz,
  last_info text
);
alter table public.teacher_backups add column if not exists lang text not null default 'vi';
alter table public.teacher_backups enable row level security;

create table if not exists public.error_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source text not null check (source in ('client', 'server')),
  kind text not null default 'error',
  message text not null,
  detail text,
  path text,
  quiz_slug text,
  user_agent text,
  client_hash text
);
create index if not exists error_logs_created_idx on public.error_logs (created_at desc);
alter table public.error_logs enable row level security;

-- Trạng thái chung nhỏ (vd. lần gửi email tóm tắt lỗi gần nhất)
create table if not exists public.app_state (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;

-- Danh sách tài khoản giáo viên + email (chỉ server dùng được)
create or replace function public.teacher_list()
returns table (id uuid, email text) language sql security definer set search_path = public, auth stable as $$
  select u.id, u.email::text from auth.users u where u.email is not null;
$$;
revoke all on function public.teacher_list() from public, anon, authenticated;
grant execute on function public.teacher_list() to service_role;
