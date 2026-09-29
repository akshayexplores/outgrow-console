import { describe, expect, it } from "vitest";
import { APP_ROLES, canLog, homeFor, navFor, seesRapport, type AppRole } from "@/lib/roles";
import { defaultsForRole, employeeInputSchema, employeeStatus } from "@/lib/admin-schemas";

const keys = (r: AppRole | null, admin = false) => navFor({ app_role: r, is_admin: admin }).map((n) => n.key);

describe("navigation by role", () => {
  it("delivery engineers only get Today", () => expect(keys("engineer")).toEqual(["today"]));
  it("nobody but the admin sees /admin", () => {
    for (const r of APP_ROLES) expect(keys(r)).not.toContain("admin");
    expect(keys(null, true)).toContain("admin");
  });
  it("the admin gets the leader's screens plus Admin, even with no roster row", () => {
    expect(keys(null, true)).toEqual(["team", "scorecard", "library", "operator", "accounts", "admin"]);
  });
  it("the CEO lands on the scorecard and cannot log", () => {
    expect(homeFor({ app_role: "ceo", is_admin: false })).toBe("/scorecard");
    expect(canLog({ app_role: "ceo", is_admin: false })).toBe(false);
  });
  it("leader lands on Team, presales on Accounts, others on Today", () => {
    expect(homeFor({ app_role: "leader", is_admin: false })).toBe("/team");
    expect(homeFor({ app_role: "presales", is_admin: false })).toBe("/accounts");
    expect(homeFor({ app_role: "pm", is_admin: false })).toBe("/today");
  });
  it("a signed-in user with no role and no admin goes back to login", () => {
    expect(homeFor({ app_role: null, is_admin: false })).toBe("/login");
  });
  it("engineers do not get the log button; everyone else on the roster does, except the CEO", () => {
    expect(canLog({ app_role: "engineer", is_admin: false })).toBe(false);
    for (const r of APP_ROLES.filter((x) => x !== "engineer" && x !== "ceo")) expect(canLog({ app_role: r, is_admin: false })).toBe(true);
  });
  it("engineers and the CEO do not see rapport notes", () => {
    expect(seesRapport({ app_role: "engineer", is_admin: false })).toBe(false);
    expect(seesRapport({ app_role: "ceo", is_admin: false })).toBe(false);
    expect(seesRapport({ app_role: "ae", is_admin: false })).toBe(true);
  });
});

describe("employee defaults and validation", () => {
  it("engineers are counted but not ranked, and text their manager", () => {
    const d = defaultsForRole("engineer");
    expect(d.show_on_ranked_scorecard).toBe(false);
    expect(d.logging_mode).toBe("Manager proxy");
  });
  it("the CEO's target is zero (never a participant)", () => expect(defaultsForRole("ceo").weekly_target).toBe(0));
  it("normalises the email and rejects a bad one", () => {
    const ok = employeeInputSchema.safeParse({ full_name: "New Hire", email: " New@Acsia.COM ", app_role: "sdr", weekly_target: "10", show_on_ranked_scorecard: true });
    expect(ok.success && ok.data.email).toBe("new@acsia.com");
    expect(employeeInputSchema.safeParse({ full_name: "New Hire", email: "nope", app_role: "sdr", weekly_target: 10, show_on_ranked_scorecard: true }).success).toBe(false);
    expect(employeeInputSchema.safeParse({ full_name: "New Hire", email: "a@b.co", app_role: "boss", weekly_target: 10, show_on_ranked_scorecard: true }).success).toBe(false);
  });
  it("employee status ladder", () => {
    expect(employeeStatus({ active: false, invited_at: null, last_sign_in_at: null })).toBe("Deactivated");
    expect(employeeStatus({ active: true, invited_at: null, last_sign_in_at: null })).toBe("Not invited");
    expect(employeeStatus({ active: true, invited_at: "2026-09-01", last_sign_in_at: null })).toBe("Invited");
    expect(employeeStatus({ active: true, invited_at: "2026-09-01", last_sign_in_at: "2026-09-02" })).toBe("Active");
  });
});
