/** Pure scorecard helpers, shared by the browser (live name check) and tests. The database's people_named_in() is the authority; this mirrors it. */

/** Roster people named in the commentary: first name of 3+ letters/digits as a whole word, case-insensitive (same rule as people_named_in()). */
export function namedPeople(text: string, fullNames: string[]): string[] {
  const out: string[] = [];
  for (const full of fullNames) {
    const first = (full.trim().split(/\s+/)[0] ?? "").replace(/[^\p{L}\p{N}]/gu, "");
    if (first.length < 3) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu");
    if (re.test(text)) out.push(full);
  }
  return out;
}

export const MIN_NAMED = 2;
export const MIN_COMMENTARY_CHARS = 20;

export function publishBlockers(text: string, fullNames: string[], canPublishRole: boolean): string[] {
  const out: string[] = [];
  if (!canPublishRole) out.push("Only the CEO or the Outgrow Leader can publish.");
  if (text.trim().length < MIN_COMMENTARY_CHARS) out.push("Write two sentences of commentary.");
  const n = namedPeople(text, fullNames).length;
  if (n < MIN_NAMED) out.push(`Name at least ${MIN_NAMED} people from the roster (${n} so far).`);
  return out;
}
