// Chạy lại mỗi lần chuyển trang (kể cả bấm Back) để trang mới hiện ra mờ dần — chỉ CSS.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="yd-page">{children}</div>;
}
