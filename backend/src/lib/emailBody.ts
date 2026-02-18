/** Strip HTML tags to plain text (for bodyPreview and text/plain fallback) */
export function stripHtml(html: string): string {
  if (!html?.trim()) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Check if string looks like HTML */
export function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str?.trim() ?? "");
}
