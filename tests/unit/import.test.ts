import { describe, expect, it } from "vitest";
import { applyMapping, ENUMS, guessMapping, normCountry, normEnum, ACCOUNT_FIELDS, regionOfCountry, splitName, validateAccountRow, validateContactRow } from "@/lib/import";

describe("country and enum normalisation", () => {
  it("accepts codes and common names", () => {
    expect(normCountry("de")).toBe("DE");
    expect(normCountry("Germany")).toBe("DE");
    expect(normCountry("Deutschland")).toBe("DE");
    expect(normCountry("U.S.")).toBe("US");
    expect(normCountry("Atlantis")).toBeNull();
    expect(normCountry("")).toBeNull();
  });
  it("maps a country to a region, defaulting to Other", () => {
    expect(regionOfCountry("DE")).toBe("Germany");
    expect(regionOfCountry("BR")).toBe("Other");
  });
  it("matches enums case-insensitively, by unique prefix, and tiers by letter", () => {
    expect(normEnum("oem", ENUMS.segment)).toBe("OEM");
    expect(normEnum("Tier", ENUMS.segment)).toBeNull(); // ambiguous prefix (Tier-1 / Tier-2)
    expect(normEnum("b", ENUMS.tier)).toBe("B - established");
    expect(normEnum("expand", ENUMS.track)).toBe("EXPAND");
    expect(normEnum("nonsense", ENUMS.track)).toBeNull();
  });
});

describe("mapping", () => {
  it("guesses columns from loose headers and leaves the rest unmapped", () => {
    const m = guessMapping(["Account Name", "Country", "Tier", "Whatever"], ACCOUNT_FIELDS);
    expect(m.country).toBe("Country");
    expect(m.tier).toBe("Tier");
  });
  it("applies a mapping and trims values", () => {
    expect(applyMapping({ A: "  Flex ", B: "US" }, { name: "A", country: "B", tier: "" })).toEqual({ name: "Flex", country: "US" });
  });
});

describe("account rows", () => {
  it("accepts a minimal row and fills sensible defaults", () => {
    const r = validateAccountRow({ name: "Flex", country: "us" }, 2);
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ name: "Flex", country: "US", region: "US", segment: "Other", track: "EXPAND", tier: null, owner_email: null });
  });
  it("lower-cases the owner email and keeps the line number", () => {
    const r = validateAccountRow({ name: "Flex", country: "US", owner_email: " AE@Acsia.COM " }, 7);
    expect(r.line).toBe(7);
    expect(r.value?.owner_email).toBe("ae@acsia.com");
  });
  it("reports every problem in plain words", () => {
    const r = validateAccountRow({ name: "", country: "Atlantis", tier: "Z" }, 3);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
    expect(r.errors.join(" ")).toContain("Account name is empty");
  });
});

describe("contact rows", () => {
  it("splits a full name on the last space", () => {
    expect(splitName("Anna Maria Schmidt")).toEqual({ first: "Anna Maria", last: "Schmidt" });
    expect(splitName("Cher")).toEqual({ first: "Cher", last: "" });
  });
  it("accepts a full name and an email", () => {
    const r = validateContactRow({ full_name: "Dana Ruiz", account: "Flex", email: "Dana@Flex.test", relationship_strength: "4" }, 2);
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ first_name: "Dana", last_name: "Ruiz", email: "dana@flex.test", relationship_strength: 4 });
  });
  it("rejects a bad email or missing account, but only warns on optional fields", () => {
    const bad = validateContactRow({ first_name: "A", last_name: "B", account: "", email: "nope" }, 4);
    expect(bad.ok).toBe(false);
    const soft = validateContactRow({ first_name: "A", last_name: "B", account: "Flex", seniority: "Wizard", relationship_strength: "9" }, 5);
    expect(soft.ok).toBe(true);
    expect(soft.warnings.length).toBe(2);
  });
});
