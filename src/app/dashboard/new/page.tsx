"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PdfFlow, TextFlow } from "@/components/teacher/NewQuizFlows";
export default function NewQuizPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"pdf" | "text">("pdf");

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/dashboard" className="text-sm text-primary-dark hover:underline">← Về danh sách đề</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold">Tạo đề mới</h1>
      <div className="mb-4 inline-flex rounded-xl border border-gray-200 bg-white p-1">
        {(
          [
            ["pdf", "Từ file PDF (AI)"],
            ["text", "Dán nội dung (không cần AI)"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === k ? "bg-primary text-white" : "text-ink"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "pdf" ? <PdfFlow onDone={(id) => router.push(`/dashboard/quiz/${id}`)} /> : <TextFlow onDone={(id) => router.push(`/dashboard/quiz/${id}`)} />}
    </div>
  );
}

