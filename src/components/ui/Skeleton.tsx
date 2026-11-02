"use client";
import { useT } from "@/lib/i18n/client";

/** Khung xương hiển thị trong lúc tải dữ liệu — tránh nháy trang và cảm giác chờ lâu */
export function Skel({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200/80 ${className}`} />;
}

export function CardsSkeleton({ n = 3 }: { n?: number }) {
  const { t } = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label={t("Đang tải")}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card p-5">
          <Skel className="h-5 w-3/4" />
          <Skel className="mt-2 h-3 w-1/3" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Skel className="h-16" />
            <Skel className="h-16" />
          </div>
          <Skel className="mt-4 h-10" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  const { t } = useT();
  return (
    <div aria-busy="true" aria-label={t("Đang tải")}>
      <Skel className="h-4 w-32" />
      <Skel className="mt-3 h-8 w-2/3" />
      <Skel className="mt-2 h-4 w-40" />
      <Skel className="mt-6 h-20" />
      <div className="mt-6 flex gap-2">
        <Skel className="h-9 w-28" />
        <Skel className="h-9 w-28" />
        <Skel className="h-9 w-24" />
      </div>
      <div className="mt-5 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card p-4">
            <Skel className="h-4 w-1/2" />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Skel className="h-10" />
              <Skel className="h-10" />
              <Skel className="h-10" />
              <Skel className="h-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StudentSkeleton() {
  const { t } = useT();
  return (
    <div className="card mt-4 space-y-4 p-6" aria-busy="true" aria-label={t("Đang tải đề")}>
      <Skel className="mx-auto h-6 w-2/3" />
      <Skel className="mx-auto h-4 w-1/3" />
      <Skel className="h-11" />
      <Skel className="h-11" />
      <Skel className="h-12" />
    </div>
  );
}
