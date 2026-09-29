/** Pure helpers for the accounts/contacts CSV import (column mapping → normalised, validated rows). No I/O, unit-tested. */

export type CsvRow = Record<string, string>;
export type Mapping = Record<string, string>; // target field → CSV column ("" = not mapped)

export interface FieldDef { key: string; label: string; required?: boolean; hint?: string }

export const ACCOUNT_FIELDS: FieldDef[] = [
  { key: "name", label: "Account name", required: true },
  { key: "country", label: "Country", required: true, hint: "ISO code (IN, DE, US…) or the country name" },
  { key: "parent_account", label: "Parent / group (name)" },
  { key: "tier", label: "Tier", hint: "A, B, C or D" },
  { key: "region", label: "Region", hint: "Derived from the country if empty" },
  { key: "segment", label: "Segment", hint: "OEM, Tier-1, Tier-2… (default Other)" },
  { key: "relationship_type", label: "Relationship type", hint: "Default Direct customer" },
  { key: "account_level", label: "Account level", hint: "Group, Legal entity, Site (default Legal entity)" },
  { key: "track", label: "Track", hint: "EXPAND, LAND or MIXED (default EXPAND)" },
  { key: "customer_status", label: "Customer status" },
  { key: "city_site", label: "City / site" },
  { key: "web_domain", label: "Web domain" },
  { key: "owner_email", label: "Account owner (roster email)", hint: "Uses the default owner if empty" },
];

export const CONTACT_FIELDS: FieldDef[] = [
  { key: "account", label: "Account name", required: true },
  { key: "first_name", label: "First name", hint: "Or map a full name below" },
  { key: "last_name", label: "Last name" },
  { key: "full_name", label: "Full name (split on the last space)" },
  { key: "job_title", label: "Job title" },
  { key: "account_country", label: "Account country", hint: "Only needed when two accounts share a name" },
  { key: "email", label: "Email" },
  { key: "phone_office", label: "Office phone" },
  { key: "phone_mobile", label: "Mobile phone" },
  { key: "country", label: "Contact country" },
  { key: "seniority", label: "Seniority" },
  { key: "buying_role", label: "Buying role" },
  { key: "relationship_strength", label: "Relationship strength (1–5)" },
  { key: "linkedin_url", label: "LinkedIn URL" },
];

export const ENUMS = {
  tier: ["A - top 5", "B - established", "C - foothold", "D - pipeline only"],
  region: ["India", "Germany", "Rest of EU", "US", "Japan", "South Korea", "China", "Other"],
  segment: ["OEM", "Tier-1", "Tier-2", "Engineering services intermediary", "Tool provider", "Silicon", "Other"],
  relationship_type: ["Direct customer", "End customer via partner", "Former customer", "Pipeline only", "Partner", "Prospect (LAND)"],
  account_level: ["Group", "Legal entity", "Site / engineering centre"],
  track: ["EXPAND", "LAND", "MIXED"],
  customer_status: ["Active", "Dormant", "Former", "Pipeline only"],
  seniority: ["C-level", "VP", "Director", "Head of", "Manager", "Lead", "Engineer"],
  buying_role: ["Economic buyer", "Technical buyer", "User buyer", "Coach", "Gatekeeper", "Unknown"],
} as const;

const COUNTRY_NAMES: Record<string, string> = {
  india: "IN", germany: "DE", deutschland: "DE", "united states": "US", usa: "US", "u.s.": "US", america: "US", japan: "JP", "south korea": "KR", korea: "KR", china: "CN",
  france: "FR", italy: "IT", sweden: "SE", "united kingdom": "GB", uk: "GB", england: "GB", netherlands: "NL", switzerland: "CH", austria: "AT", czechia: "CZ", "czech republic": "CZ", portugal: "PT",
};
const REGION_OF: Record<string, string> = { IN: "India", DE: "Germany", US: "US", JP: "Japan", KR: "South Korea", CN: "China", FR: "Rest of EU", IT: "Rest of EU", SE: "Rest of EU", NL: "Rest of EU", AT: "Rest of EU", CZ: "Rest of EU", PT: "Rest of EU" };

export const normCountry = (v: string): string | null => {
  const t = v.trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return COUNTRY_NAMES[t.toLowerCase()] ?? null;
};
export const regionOfCountry = (code: string): string => REGION_OF[code] ?? "Other";

/** Case-insensitive match to an allowed value; for tiers also accepts just the letter. */
export function normEnum(value: string, allowed: readonly string[]): string | null {
  const t = value.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const exact = allowed.find((a) => a.toLowerCase() === lower);
  if (exact) return exact;
  if (allowed === ENUMS.tier && /^[a-d]$/i.test(t)) return allowed.find((a) => a.startsWith(t.toUpperCase() + " ")) ?? null;
  const starts = allowed.filter((a) => a.toLowerCase().startsWith(lower));
  return starts.length === 1 ? starts[0]! : null;
}

export function applyMapping(row: CsvRow, mapping: Mapping): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, col] of Object.entries(mapping)) if (col) out[field] = (row[col] ?? "").trim();
  return out;
}

/** Best-guess mapping from CSV headers to fields (exact/loose match on label or key). Users can override every choice. */
export function guessMapping(headers: string[], fields: FieldDef[]): Mapping {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const m: Mapping = {};
  for (const f of fields) {
    const candidates = [clean(f.key), clean(f.label)];
    const hit = headers.find((h) => candidates.includes(clean(h))) ?? headers.find((h) => candidates.some((c) => c.length > 3 && clean(h).includes(c)));
    m[f.key] = hit ?? "";
  }
  return m;
}

export interface RowResult<T> { line: number; ok: boolean; errors: string[]; warnings: string[]; value?: T }

export interface AccountImport {
  name: string; country: string; region: string; segment: string; relationship_type: string; account_level: string; track: string;
  tier: string | null; customer_status: string | null; city_site: string | null; web_domain: string | null; parent_account: string | null; owner_email: string | null;
}

export function validateAccountRow(raw: Record<string, string>, line: number): RowResult<AccountImport> {
  const errors: string[] = [], warnings: string[] = [];
  const name = (raw.name ?? "").trim();
  if (!name) errors.push("Account name is empty.");
  const country = normCountry(raw.country ?? "");
  if (!country) errors.push(`Country “${raw.country ?? ""}” isn't recognised (use IN, DE, US… or the country name).`);
  const pick = (key: keyof typeof ENUMS, fallback: string | null) => {
    const v = (raw[key] ?? "").trim();
    if (!v) return fallback;
    const n = normEnum(v, ENUMS[key]);
    if (!n) { errors.push(`${key} “${v}” isn't one of: ${ENUMS[key].join(", ")}.`); return fallback; }
    return n;
  };
  const region = pick("region", country ? regionOfCountry(country) : null);
  const segment = pick("segment", "Other");
  const relationship_type = pick("relationship_type", "Direct customer");
  const account_level = pick("account_level", "Legal entity");
  const track = pick("track", "EXPAND");
  const tier = pick("tier", null);
  const customer_status = pick("customer_status", null);
  if (errors.length) return { line, ok: false, errors, warnings };
  return {
    line, ok: true, errors, warnings,
    value: {
      name, country: country!, region: region!, segment: segment!, relationship_type: relationship_type!, account_level: account_level!, track: track!, tier, customer_status,
      city_site: (raw.city_site ?? "").trim() || null, web_domain: (raw.web_domain ?? "").trim() || null,
      parent_account: (raw.parent_account ?? "").trim() || null, owner_email: (raw.owner_email ?? "").trim().toLowerCase() || null,
    },
  };
}

export interface ContactImport {
  first_name: string; last_name: string; account: string; account_country: string | null; job_title: string | null; email: string | null; phone_office: string | null;
  phone_mobile: string | null; country: string | null; seniority: string | null; buying_role: string | null; relationship_strength: number | null; linkedin_url: string | null;
}

export function splitName(full: string): { first: string; last: string } {
  const t = full.trim().replace(/\s+/g, " ");
  const i = t.lastIndexOf(" ");
  return i < 0 ? { first: t, last: "" } : { first: t.slice(0, i), last: t.slice(i + 1) };
}

export function validateContactRow(raw: Record<string, string>, line: number): RowResult<ContactImport> {
  const errors: string[] = [], warnings: string[] = [];
  let first = (raw.first_name ?? "").trim(), last = (raw.last_name ?? "").trim();
  if ((!first || !last) && raw.full_name) { const s = splitName(raw.full_name); first = first || s.first; last = last || s.last; }
  if (!first || !last) errors.push("First and last name are both needed (map them, or map a full name with two words).");
  const account = (raw.account ?? "").trim();
  if (!account) errors.push("Account name is empty.");
  const email = (raw.email ?? "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`Email “${email}” isn't valid.`);
  const seniority = raw.seniority ? normEnum(raw.seniority, ENUMS.seniority) : null;
  if (raw.seniority && !seniority) warnings.push(`Seniority “${raw.seniority}” ignored (not in the list).`);
  const buying_role = raw.buying_role ? normEnum(raw.buying_role, ENUMS.buying_role) : null;
  if (raw.buying_role && !buying_role) warnings.push(`Buying role “${raw.buying_role}” ignored (not in the list).`);
  let strength: number | null = null;
  if (raw.relationship_strength) {
    const n = Number(raw.relationship_strength);
    if (Number.isInteger(n) && n >= 1 && n <= 5) strength = n; else warnings.push("Relationship strength ignored (use 1 to 5).");
  }
  const country = raw.country ? normCountry(raw.country) : null;
  if (raw.country && !country) warnings.push(`Country “${raw.country}” ignored.`);
  if (errors.length) return { line, ok: false, errors, warnings };
  return {
    line, ok: true, errors, warnings,
    value: {
      first_name: first, last_name: last, account, account_country: raw.account_country ? normCountry(raw.account_country) : null,
      job_title: (raw.job_title ?? "").trim() || null, email: email || null, phone_office: (raw.phone_office ?? "").trim() || null, phone_mobile: (raw.phone_mobile ?? "").trim() || null,
      country, seniority, buying_role, relationship_strength: strength, linkedin_url: (raw.linkedin_url ?? "").trim() || null,
    },
  };
}
