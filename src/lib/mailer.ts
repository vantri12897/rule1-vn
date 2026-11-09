import "server-only";
import nodemailer from "nodemailer";

/** Đã cài Gmail để gửi mail chưa (biến GMAIL_USER + GMAIL_APP_PASSWORD trên Vercel) */
export function mailEnabled() {
  return !!(process.env.SMTP_HOST || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD));
}

function transport() {
  if (process.env.SMTP_HOST) {
    // Dùng khi kiểm thử hoặc khi muốn đổi sang nhà cung cấp email khác
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "1",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "") },
  });
}

export async function sendResetCodeMail(to: string, code: string, siteUrl: string, lang: "vi" | "en" = "en") {
  const from = process.env.GMAIL_USER || process.env.SMTP_FROM || "no-reply@yd-english.local";
  const spaced = code.split("").join(" ");
  const L =
    lang === "en"
      ? {
          subject: `YD-English password reset code: ${code}`,
          text: `Your YD-English password reset code is: ${code}\n\nThe code is valid for 15 minutes. Enter it at: ${siteUrl}/forgot-password\n\nIf you did not request a password reset, ignore this email — your password stays the same.`,
          intro: "Your password reset code:",
          valid: `The code is valid for <b>15 minutes</b>. Enter it on the <a href="${siteUrl}/forgot-password" style="color:#15803d">Forgot password</a> page.`,
          ignore: "If you did not request a password reset, ignore this email — your password stays the same.",
        }
      : {
          subject: `Mã đặt lại mật khẩu YD-English: ${code}`,
          text: `Mã đặt lại mật khẩu YD-English của bạn là: ${code}\n\nMã có hiệu lực trong 15 phút. Nhập mã tại: ${siteUrl}/forgot-password\n\nNếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này — mật khẩu của bạn vẫn giữ nguyên.`,
          intro: "Mã đặt lại mật khẩu của bạn:",
          valid: `Mã có hiệu lực trong <b>15 phút</b>. Nhập mã tại trang <a href="${siteUrl}/forgot-password" style="color:#15803d">Quên mật khẩu</a>.`,
          ignore: "Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này — mật khẩu của bạn vẫn giữ nguyên.",
        };
  await transport().sendMail({
    from: `"YD-English" <${from}>`,
    to,
    subject: L.subject,
    text: L.text,
    html: `<!doctype html><html><body style="margin:0;background:#f0fdf4;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" style="max-width:460px;background:#ffffff;border-radius:16px;border:1px solid #bbf7d0" cellpadding="0" cellspacing="0">
<tr><td style="padding:24px 28px 8px"><span style="display:inline-block;background:#15803d;color:#fff;font-weight:800;border-radius:10px;padding:6px 9px">YD</span>
<span style="font-weight:800;font-size:18px;margin-left:6px">YD-<span style="color:#15803d">English</span></span></td></tr>
<tr><td style="padding:8px 28px 0;font-size:15px;line-height:1.6">${L.intro}</td></tr>
<tr><td align="center" style="padding:14px 28px"><div style="font-size:34px;font-weight:800;letter-spacing:6px;color:#166534;background:#f0fdf4;border:2px dashed #15803d;border-radius:12px;padding:12px 8px">${spaced}</div></td></tr>
<tr><td style="padding:0 28px 8px;font-size:14px;line-height:1.6;color:#556070">${L.valid}</td></tr>
<tr><td style="padding:8px 28px 24px;font-size:13px;line-height:1.6;color:#556070">${L.ignore}</td></tr>
</table></td></tr></table></body></html>`,
  });
}

/** Khung email chung (logo + nội dung) */
function shell(inner: string) {
  return `<!doctype html><html><body style="margin:0;background:#f0fdf4;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" style="max-width:620px;background:#ffffff;border-radius:16px;border:1px solid #bbf7d0" cellpadding="0" cellspacing="0">
<tr><td style="padding:22px 26px 6px"><span style="display:inline-block;background:#15803d;color:#fff;font-weight:800;border-radius:10px;padding:6px 9px">YD</span>
<span style="font-weight:800;font-size:18px;margin-left:6px">YD-<span style="color:#15803d">English</span></span></td></tr>
<tr><td style="padding:6px 26px 24px;font-size:14px;line-height:1.6">${inner}</td></tr>
</table></td></tr></table></body></html>`;
}

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function sendMail(opts: { to: string; subject: string; html: string; text: string; attachments?: { filename: string; content: string | Buffer; contentType?: string }[] }) {
  const from = process.env.GMAIL_USER || process.env.SMTP_FROM || "no-reply@yd-english.local";
  await transport().sendMail({ from: `"YD-English" <${from}>`, ...opts, html: shell(opts.html) });
}

/** Người nhận email cảnh báo lỗi: ALERT_EMAIL (nếu có) hoặc chính Gmail dùng để gửi */
export function alertRecipient() {
  return process.env.ALERT_EMAIL || process.env.GMAIL_USER || "";
}
