"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { confirmDialog, toast } from "@/components/ui/feedback";
import { useT } from "@/lib/i18n/client";
import { parseRoster } from "@/lib/roster";
import type { ClassList, Quiz } from "@/lib/types";

/**
 * 👥 Danh sách lớp của đề: học viên CHỌN tên trong danh sách thay vì tự gõ
 * → không đặt tên khác được, mỗi học viên chỉ 1 bài, giáo viên biết ai chưa làm.
 * Danh sách lớp dùng chung cho mọi đề của giáo viên.
 */
export function RosterCard({ quiz, onSaved }: { quiz: Quiz; onSaved: () => void }) {
  const { t } = useT();
  const [classes, setClasses] = useState<ClassList[] | null>(null);
  const [current, setCurrent] = useState<string | null>(quiz.class_id ?? null);
  const [edit, setEdit] = useState<{ id: string | null; name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("classes").select("*").order("name");
    setClasses((data as ClassList[]) ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setCurrent(quiz.class_id ?? null), [quiz.class_id]);

  const cur = classes?.find((c) => c.id === current) ?? null;
  const parsed = useMemo(() => (edit ? parseRoster(edit.text, classes?.find((c) => c.id === edit.id)?.students ?? []) : null), [edit, classes]);

  async function choose(id: string | null) {
    const { error } = await supabaseBrowser().from("quizzes").update({ class_id: id }).eq("id", quiz.id);
    if (error) return toast(t("Lỗi: ") + error.message, "error");
    setCurrent(id);
    toast(id ? t("Học viên sẽ chọn tên trong danh sách lớp") : t("Học viên tự gõ tên như trước"));
    onSaved();
  }

  async function save() {
    if (!edit || !parsed) return;
    const name = edit.name.trim();
    if (!name) return toast(t("Nhập tên lớp"), "error");
    if (!parsed.students.length) return toast(t("Danh sách đang trống"), "error");
    setBusy(true);
    const sb = supabaseBrowser();
    let id = edit.id;
    if (id) {
      const { error } = await sb.from("classes").update({ name, students: parsed.students, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) return setBusy(false), toast(t("Lỗi: ") + error.message, "error");
    } else {
      const { data: u } = await sb.auth.getUser();
      const { data, error } = await sb.from("classes").insert({ owner_id: u.user?.id, name, students: parsed.students }).select("id").single();
      if (error || !data) return setBusy(false), toast(t("Lỗi: ") + (error?.message ?? ""), "error");
      id = data.id as string;
    }
    setBusy(false);
    setEdit(null);
    await load();
    toast(t("Đã lưu danh sách lớp {name} ({n} học viên)", { name, n: parsed.students.length }));
    if (id !== current) await choose(id); // lớp mới tạo → dùng luôn cho đề này
  }

  async function remove() {
    if (!edit?.id) return;
    const ok = await confirmDialog({
      title: t("Xoá danh sách lớp"),
      message: t("Xoá danh sách lớp “{name}”? Các đề đang dùng lớp này sẽ quay lại cho học viên tự gõ tên. Bài làm đã nộp không bị ảnh hưởng.", { name: edit.name }),
      confirmText: t("Xoá"),
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabaseBrowser().from("classes").delete().eq("id", edit.id);
    if (error) return toast(t("Lỗi: ") + error.message, "error");
    if (edit.id === current) setCurrent(null);
    setEdit(null);
    await load();
    toast(t("Đã xoá danh sách lớp"));
    onSaved();
  }

  return (
    <div className="card space-y-3 p-5">
      <div>
        <h3 className="font-bold">👥 {t("Danh sách lớp")}</h3>
        <p className="mt-0.5 text-sm text-muted">
          {t("Học viên chọn tên của mình trong danh sách thay vì tự gõ: không đặt tên khác được, mỗi học viên chỉ 1 bài, và tab Kết quả cho biết ai chưa làm.")}
        </p>
      </div>
      {classes === null ? (
        <p className="text-sm text-muted">{t("Đang tải…")}</p>
      ) : (
        <>
          <select className="input" value={current ?? ""} onChange={(e) => choose(e.target.value || null)} aria-label={t("Danh sách lớp")}>
            <option value="">{t("Không dùng — học viên tự gõ tên")}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {t("Lớp {name} ({n} học viên)", { name: c.name, n: c.students.length })}
              </option>
            ))}
          </select>
          {!edit && (
            <div className="flex flex-wrap gap-2">
              {cur && (
                <button className="btn-outline" onClick={() => setEdit({ id: cur.id, name: cur.name, text: cur.students.map((s) => s.name).join("\n") })}>
                  ✏️ {t("Sửa danh sách {name}", { name: cur.name })}
                </button>
              )}
              <button className="btn-outline" onClick={() => setEdit({ id: null, name: "", text: "" })}>
                ＋ {t("Tạo lớp mới")}
              </button>
            </div>
          )}
        </>
      )}

      {edit && parsed && (
        <div className="space-y-3 rounded-xl border border-primary-line bg-primary-soft/40 p-4">
          <div>
            <label htmlFor="cls-name" className="label">{t("Tên lớp")}</label>
            <input id="cls-name" className="input" maxLength={80} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={t("VD: 12A1")} autoFocus />
          </div>
          <div>
            <label htmlFor="cls-list" className="label">{t("Danh sách học viên — mỗi dòng 1 người")}</label>
            <textarea
              id="cls-list"
              className="input min-h-48 font-mono text-sm"
              value={edit.text}
              onChange={(e) => setEdit({ ...edit, text: e.target.value })}
              placeholder={t("Nguyễn Văn An\nTrần Thị Bình\n…\n\nCó thể copy cột Họ tên từ Excel rồi dán vào (số thứ tự, ngày sinh tự bỏ).")}
            />
            <p className="mt-1 text-sm">
              <b className="text-primary-dark">{t("{n} học viên", { n: parsed.students.length })}</b>
              {parsed.students.length > 0 && <span className="text-muted"> · {parsed.students.slice(0, 4).map((s) => s.name).join(", ")}{parsed.students.length > 4 ? "…" : ""}</span>}
            </p>
            {parsed.duplicates.length > 0 && (
              <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-sun-ink">
                ⚠️ {t("Tên bị trùng: {names}. Học viên sẽ khó chọn đúng — nên thêm chữ phân biệt, VD “Nguyễn Văn An (B)”.", { names: parsed.duplicates.join(", ") })}
              </p>
            )}
            {edit.id && <p className="mt-1 text-xs text-muted">{t("Danh sách lớp dùng chung cho mọi đề — sửa ở đây là sửa cho mọi đề đang dùng lớp này.")}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy} onClick={save}>
              {busy ? t("Đang lưu…") : t("Lưu danh sách")}
            </button>
            <button className="btn-ghost" onClick={() => setEdit(null)}>
              {t("Huỷ")}
            </button>
            {edit.id && (
              <button className="btn-ghost ml-auto text-danger" onClick={remove}>
                🗑️ {t("Xoá lớp")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
