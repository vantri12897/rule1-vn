import { safeHtml } from "@/lib/sanitize";

export function Html({ text, className }: { text: string | null | undefined; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: safeHtml(text) }} />;
}
