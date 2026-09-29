/** Models wrap JSON in code fences or add a sentence around it. Take the outermost object; return null if there isn't one. Pure. */
export function parseJsonLoose(text: string): unknown | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}
