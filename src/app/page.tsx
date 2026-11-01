import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-primary-soft to-white">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Logo />
        <Link href="/login" className="btn-outline">Đăng nhập</Link>
      </header>
      <section className="mx-auto max-w-5xl px-4 pb-16 pt-10 text-center sm:pt-20">
        <h1 className="text-3xl font-extrabold leading-tight sm:text-5xl">
          Từ file PDF đến bài kiểm tra online<br />
          <span className="text-primary">trong vài phút</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted">
          Upload đề trắc nghiệm tiếng Anh, YD-English tự tách câu hỏi và tìm đáp án. Gửi link cho học viên làm bài trên điện thoại,
          điểm được chấm tự động và hiện ngay cho giáo viên.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login?mode=signup" className="btn-primary px-6 py-3 text-base">Bắt đầu miễn phí</Link>
        </div>
        <div className="mx-auto mt-14 grid max-w-4xl gap-4 text-left sm:grid-cols-3">
          {[
            ["1. Upload PDF", "Đề có sẵn đáp án hay không đều được. AI đọc cả file scan."],
            ["2. Duyệt & xuất bản", "Kiểm tra lại đáp án, câu nghi ngờ được đánh dấu sẵn."],
            ["3. Chia sẻ link", "Học viên làm bài, nộp và xem kết quả ngay. Giáo viên theo dõi trực tiếp."],
          ].map(([t, d]) => (
            <div key={t} className="card p-5">
              <div className="font-bold text-primary-dark">{t}</div>
              <div className="mt-1 text-sm text-muted">{d}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
