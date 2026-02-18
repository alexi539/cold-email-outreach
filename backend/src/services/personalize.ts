/**
 * Supports {{name}}, {{First Name}}, {{company-name}} — any key inside double braces.
 * Possessive: {{Name's}} → looks up "Name" and appends 's (e.g. John → John's).
 */
export function personalize(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = key.trim();
    const possessiveMatch = trimmed.match(/^(.+?)'s$/);
    if (possessiveMatch) {
      const baseKey = possessiveMatch[1].trim();
      const val = data[baseKey];
      return val != null ? String(val) + "'s" : "";
    }
    const val = data[trimmed];
    return val != null ? String(val) : "";
  });
}
