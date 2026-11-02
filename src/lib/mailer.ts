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

export async function sendResetCodeMail(to: string, code: string, siteUrl: string) {
  const from = process.env.GMAIL_USER || process.env.SMTP_FROM || "no-reply@yd-english.local";
  const spaced = code.split("").join(" ");
  await transport().sendMail({
    from: `"YD-English" <${from}>`,
    to,
    subject: `Mã đặt lại mật khẩu YD-English: ${code}`,
    text: `Mã đặt lại mật khẩu YD-English của bạn là: ${code}\n\nMã có hiệu lực trong 15 phút. Nhập mã tại: ${siteUrl}/forgot-password\n\nNếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này — mật khẩu của bạn vẫn giữ nguyên.`,
    html: `<!doctype html><html><body style="margin:0;background:#f0fdf4;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" style="max-width:460px;background:#ffffff;border-radius:16px;border:1px solid #bbf7d0" cellpadding="0" cellspacing="0">
<tr><td style="padding:24px 28px 8px"><span style="display:inline-block;background:#15803d;color:#fff;font-weight:800;border-radius:10px;padding:6px 9px">YD</span>
<span style="font-weight:800;font-size:18px;margin-left:6px">YD-<span style="color:#15803d">English</span></span></td></tr>
<tr><td style="padding:8px 28px 0;font-size:15px;line-height:1.6">Mã đặt lại mật khẩu của bạn:</td></tr>
<tr><td align="center" style="padding:14px 28px"><div style="font-size:34px;font-weight:800;letter-spacing:6px;color:#166534;background:#f0fdf4;border:2px dashed #15803d;border-radius:12px;padding:12px 8px">${spaced}</div></td></tr>
<tr><td style="padding:0 28px 8px;font-size:14px;line-height:1.6;color:#556070">Mã có hiệu lực trong <b>15 phút</b>. Nhập mã tại trang <a href="${siteUrl}/forgot-password" style="color:#15803d">Quên mật khẩu</a>.</td></tr>
<tr><td style="padding:8px 28px 24px;font-size:13px;line-height:1.6;color:#556070">Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này — mật khẩu của bạn vẫn giữ nguyên.</td></tr>
</table></td></tr></table></body></html>`,
  });
}
