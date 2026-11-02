import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { getT } from "@/lib/i18n/server";

export default async function Home() {
  const { t } = await getT();
  return (
    <main className="bg-hero relative min-h-screen overflow-hidden">
      <div className="stripe h-1" />
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <Link href="/login" className="btn-outline">{t("Đăng nhập")}</Link>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-4 pb-16 pt-10 text-center sm:pt-20">
        <h1 className="text-3xl font-extrabold leading-tight sm:text-5xl">
          {t("Từ file PDF đến bài kiểm tra online")}<br />
          <span className="text-gradient">{t("trong vài phút")}</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted">
          {t("Upload đề trắc nghiệm tiếng Anh, YD-English tự tách câu hỏi và tìm đáp án. Gửi link cho học viên làm bài trên điện thoại, điểm được chấm tự động và hiện ngay cho giáo viên.")}
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login?mode=signup" className="btn-primary px-6 py-3 text-base">{t("Bắt đầu miễn phí")}</Link>
        </div>
        <div className="mx-auto mt-14 grid max-w-4xl gap-4 text-left sm:grid-cols-3">
          {(
            [
              ["📄", "1. Upload PDF", t("Đề có sẵn đáp án hay không đều được. AI đọc cả file scan."), "border-t-primary", "bg-primary-soft", "text-primary-dark"],
              ["✅", t("2. Duyệt & xuất bản"), t("Kiểm tra lại đáp án, câu nghi ngờ được đánh dấu sẵn."), "border-t-sun", "bg-sun-soft", "text-sun-ink"],
              ["🔗", t("3. Chia sẻ link"), t("Học viên làm bài, nộp và xem kết quả ngay. Giáo viên theo dõi trực tiếp."), "border-t-sky", "bg-sky-soft", "text-sky-ink"],
            ] as const
          ).map(([icon, t, d, border, soft, ink]) => (
            <div key={t} className={`card border-t-4 p-5 transition hover:-translate-y-0.5 hover:shadow-md ${border}`}>
              <div className={`grid h-11 w-11 place-items-center rounded-xl text-xl ${soft}`} aria-hidden>{icon}</div>
              <div className={`mt-3 font-bold ${ink}`}>{t}</div>
              <div className="mt-1 text-sm text-muted">{d}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
