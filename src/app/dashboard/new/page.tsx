"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PdfFlow, TextFlow } from "@/components/teacher/NewQuizFlows";
import { useT } from "@/lib/i18n/client";
export default function NewQuizPage() {
  const { t } = useT();
  const router = useRouter();
  const [tab, setTab] = useState<"pdf" | "text">("pdf");
  const [running, setRunning] = useState(false);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/dashboard" prefetch className="text-sm text-primary-dark hover:underline">{t("← Về danh sách đề")}</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold">{t("Tạo đề mới")}</h1>
      <div className="mb-4 inline-flex rounded-xl border border-gray-200 bg-white p-1">
        {(
          [
            ["pdf", t("Từ file PDF (AI)")],
            ["text", t("Dán nội dung (không cần AI)")],
          ] as const
        ).map(([k, l]) => (
          <button key={k} disabled={running} onClick={() => setTab(k)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === k ? "bg-primary text-white" : "text-ink"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "pdf" ? <PdfFlow onDone={(id) => router.push(`/dashboard/quiz/${id}`)} onRunningChange={setRunning} /> : <TextFlow onDone={(id) => router.push(`/dashboard/quiz/${id}`)} />}
    </div>
  );
}

