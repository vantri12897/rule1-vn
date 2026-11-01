/**
 * Escape toàn bộ HTML, chỉ cho phép lại <u>, <b>, <i>, <br> (không thuộc tính).
 * Dùng cho mọi nội dung câu hỏi hiển thị bằng dangerouslySetInnerHTML.
 */
export function safeHtml(input: string | null | undefined): string {
  if (!input) return "";
  const escaped = input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return escaped
    .replace(/&lt;(\/?)(u|b|i)&gt;/gi, (_m, slash: string, tag: string) => `<${slash}${tag.toLowerCase()}>`)
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>")
    .replace(/\n/g, "<br>");
}
