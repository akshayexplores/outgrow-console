/**
 * The account page's one recommendation. Deterministic (no model): it reads facts already on the page and names the single
 * most useful next conversation. Pure, so it is unit-tested.
 */
export interface RecoInput {
  daysSinceTouch: number | null;
  coveragePct: number | null;
  contacts: { name: string; days_since_touch: number | null; strength: number | null }[];
  needs: { service: string; status: string }[];      // whitespace: Need likely / Need confirmed - unsourced
  unknownServices: string[];                          // whitespace with no status yet, or not present
  proposalsOverdue: { name: string; age_days: number }[]; // proposals older than 56 days (docs/02)
  singleThreaded: boolean;
}

export function recommend(i: RecoInput): string {
  if (i.proposalsOverdue.length > 0) {
    const p = [...i.proposalsOverdue].sort((a, b) => b.age_days - a.age_days)[0]!;
    return `Follow up on “${p.name}”. The proposal is ${p.age_days} days old, past the 4–8 week window. Ask what's blocking it and book a date.`;
  }
  const stale = [...i.contacts].filter((c) => c.days_since_touch === null || c.days_since_touch > 45).sort((a, b) => (b.days_since_touch ?? 9999) - (a.days_since_touch ?? 9999))[0];
  if (i.daysSinceTouch === null || i.daysSinceTouch > 45) {
    const who = stale?.name ?? i.contacts[0]?.name;
    const gap = i.daysSinceTouch === null ? "Nobody has made a proactive call here yet." : `Nobody has made a proactive call here in ${i.daysSinceTouch} days.`;
    return who ? `${gap} Call ${who} and end with a when.` : `${gap} Add a contact, then make the first call.`;
  }
  const need = i.needs[0];
  if (need) return `${need.service} looks like a live need (${need.status.toLowerCase()}). Ask who runs it today and offer a short walkthrough.`;
  if (i.coveragePct !== null && i.coveragePct < 10) {
    return `We know ${i.coveragePct}% of the buying group. Ask your best contact: “Which other programmes or sites have the same problem?” It's an open question, never yes/no.`;
  }
  if (i.singleThreaded) return "Only one thread into this account. Ask for an introduction to a second person in another function.";
  const gap = i.unknownServices[0];
  return gap ? `Ask each contact what else they're working on. ${gap} is the service line we know least about here.` : "Ask each contact what else they're working on, then book the next conversation before you hang up.";
}
