"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { quizLink } from "@/lib/ui";
import { useT } from "@/lib/i18n/client";

export function SharePanel({ slug }: { slug: string }) {
  const { t } = useT();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const link = quizLink(slug);

  useEffect(() => {
    QRCode.toDataURL(link, { width: 480, margin: 1, color: { dark: "#14532d", light: "#ffffff" } }).then(setQr).catch(() => {});
  }, [link]);

  return (
    <div className="card p-4">
      <div className="text-sm font-semibold">{t("Link cho học viên")}</div>
      <div className="mt-2 flex gap-2">
        <input readOnly value={link} className="input flex-1 bg-gray-50 text-sm" onFocus={(e) => e.target.select()} />
        <button
          className="btn-primary shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? t("✓ Đã copy") : "Copy"}
        </button>
        <button className="btn-outline shrink-0" onClick={() => setShowQr(!showQr)}>QR</button>
      </div>
      {showQr && qr && (
        <div className="mt-3 flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={t("Mã QR link làm bài")} className="h-56 w-56 rounded-xl border border-primary-line" />
          <a href={qr} download={`YD-English-${slug}.png`} className="text-sm text-primary-dark hover:underline">{t("Tải ảnh QR")}</a>
        </div>
      )}
    </div>
  );
}
