import { describe, expect, it } from "vitest";
import { CRON_JOBS, CRON_LABEL, bearerMatches, isCronJob, periodKey, summariseRun } from "@/lib/jobs/schedule";

describe("job names", () => {
  it("knows exactly four jobs and labels each", () => {
    expect([...CRON_JOBS]).toEqual(["daily", "monday", "friday", "monthly"]);
    for (const j of CRON_JOBS) expect(CRON_LABEL[j].title.length).toBeGreaterThan(3);
  });
  it("accepts only those names", () => {
    expect(isCronJob("daily")).toBe(true);
    for (const bad of ["", "Daily", "weekly", "../daily", "daily ", "constructor", "__proto__"]) expect(isCronJob(bad), bad).toBe(false);
  });
});

describe("periodKey uses Asia/Kolkata days and Monday-start weeks", () => {
  const at = (iso: string) => new Date(iso);
  it("keeps late-evening UTC on the next Indian day", () => {
    const now = at("2026-09-28T20:00:00Z"); // Tue 29 Sep 01:30 IST
    expect(periodKey("daily", now)).toBe("2026-09-29");
    expect(periodKey("monday", now)).toBe("2026-09-28");
    expect(periodKey("friday", now)).toBe("2026-09-28");
    expect(periodKey("monthly", now)).toBe("2026-09");
  });
  it("starts a new week at Monday 00:00 IST, not Monday 00:00 UTC", () => {
    expect(periodKey("monday", at("2026-10-04T18:00:00Z"))).toBe("2026-09-28"); // Sun 23:30 IST
    expect(periodKey("monday", at("2026-10-04T19:00:00Z"))).toBe("2026-10-05"); // Mon 00:30 IST
  });
  it("rolls the month at midnight IST", () => {
    expect(periodKey("monthly", at("2026-09-30T18:00:00Z"))).toBe("2026-09"); // 30 Sep, 23:30 IST
    expect(periodKey("monthly", at("2026-09-30T19:00:00Z"))).toBe("2026-10"); // 1 Oct 00:30 IST
  });
  it("gives the same key for any moment on the same day, so a run is never claimed twice", () => {
    expect(periodKey("daily", at("2026-09-29T00:00:00Z"))).toBe(periodKey("daily", at("2026-09-29T17:59:59Z")));
  });
});

describe("summariseRun", () => {
  it("shows errors, truncated", () => {
    expect(summariseRun("daily", "error", { message: "x".repeat(300) }).length).toBe("Failed: ".length + 140);
    expect(summariseRun("daily", "error", null)).toBe("Failed: unknown error");
  });
  it("explains a running or skipped job", () => {
    expect(summariseRun("monday", "running", null)).toMatch(/15 minutes/);
    expect(summariseRun("monthly", "skipped", { message: "Skipped until programme week 12." })).toBe("Skipped until programme week 12.");
    expect(summariseRun("monthly", "skipped", null)).toBe("Skipped: nothing to do.");
  });
  it("summarises each job's result in one line", () => {
    expect(summariseRun("daily", "ok", { derived: { accounts_updated: 12, contacts_updated: 80 }, lists: { added: 5, exited: 2, open: 40 } })).toBe("12 accounts and 80 contacts refreshed. Lists: 5 added, 2 left, 40 open.");
    expect(summariseRun("monday", "ok", { drafted: 1, from_ai: 1, from_rules: 0 })).toBe("1 draft assignment (1 by the AI, 0 by the plain rules).");
    expect(summariseRun("monday", "ok", { drafted: 9, from_ai: 4, from_rules: 5, note: "No AI key." })).toBe("9 draft assignments (4 by the AI, 5 by the plain rules). No AI key.");
    expect(summariseRun("friday", "ok", { source: "ai" })).toBe("Scorecard draft ready (AI-written).");
    expect(summariseRun("friday", "ok", { source: "rules", note: "Fewer than two people to name." })).toBe("Scorecard draft ready (written from the numbers). Fewer than two people to name.");
    expect(summariseRun("monthly", "ok", { programme_week: 13 })).toBe("Review ready for programme week 13.");
  });
  it("copes with missing detail", () => {
    expect(summariseRun("daily", "ok", null)).toBe("0 accounts and 0 contacts refreshed. Lists: 0 added, 0 left, 0 open.");
  });
});

describe("bearerMatches guards the cron endpoint", () => {
  it("accepts the exact secret", () => {
    expect(bearerMatches("Bearer s3cret-value", "s3cret-value")).toBe(true);
    expect(bearerMatches("bearer s3cret-value", "s3cret-value")).toBe(true);
  });
  it("rejects a wrong secret of the same or different length, or none at all", () => {
    expect(bearerMatches("Bearer s3cret-valuX", "s3cret-value")).toBe(false);
    expect(bearerMatches("Bearer short", "s3cret-value")).toBe(false);
    expect(bearerMatches("Bearer s3cret-value-and-more", "s3cret-value")).toBe(false);
    expect(bearerMatches(null, "s3cret-value")).toBe(false);
    expect(bearerMatches("", "s3cret-value")).toBe(false);
    expect(bearerMatches("s3cret-value ", "s3cret-value")).toBe(false);
  });
  it("never matches when the secret is not set, even against an empty header", () => {
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("", "")).toBe(false);
    expect(bearerMatches(null, "")).toBe(false);
  });
});
