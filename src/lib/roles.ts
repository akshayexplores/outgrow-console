import { z } from "zod";

export const APP_ROLES = ["engineer", "pm", "delivery_lead", "ae", "sdr", "presales", "marketing", "leader", "ceo"] as const;
export type AppRole = (typeof APP_ROLES)[number];
export const appRoleSchema = z.enum(APP_ROLES);

export const ROLE_LABEL: Record<AppRole, string> = {
  engineer: "Delivery engineer / architect",
  pm: "Project manager",
  delivery_lead: "Delivery lead",
  ae: "Account executive",
  sdr: "SDR",
  presales: "Pre-sales",
  marketing: "Marketing",
  leader: "Outgrow Leader",
  ceo: "CEO (programme owner)",
};

/** Default weekly target when an employee is added (docs/03). Marketing has no target in the docs: 0 = not on the roster. */
export const DEFAULT_TARGET: Record<AppRole, number> = {
  engineer: 2, pm: 5, delivery_lead: 5, ae: 15, sdr: 10, presales: 5, marketing: 0, leader: 5, ceo: 0,
};

/** Job-role labels allowed by the data model (chk_acsia_people_job_role) and a sensible default per app role. */
export const JOB_ROLES = ["Delivery engineer", "ATG architect", "Project manager", "Delivery lead", "Account executive", "SDR", "Pre-sales", "Marketing", "Customer success", "Leadership"] as const;
export const DEFAULT_JOB_ROLE: Record<AppRole, (typeof JOB_ROLES)[number]> = {
  engineer: "Delivery engineer", pm: "Project manager", delivery_lead: "Delivery lead", ae: "Account executive", sdr: "SDR",
  presales: "Pre-sales", marketing: "Marketing", leader: "Leadership", ceo: "Leadership",
};
export const OUTGROW_ROLES = ["Owner (CEO)", "Outgrow Leader", "Administrator", "Team manager", "Frontline", "Supporting"] as const;
export const DEFAULT_OUTGROW_ROLE: Record<AppRole, (typeof OUTGROW_ROLES)[number]> = {
  engineer: "Frontline", pm: "Frontline", delivery_lead: "Team manager", ae: "Frontline", sdr: "Frontline",
  presales: "Supporting", marketing: "Supporting", leader: "Outgrow Leader", ceo: "Owner (CEO)",
};
export const LOGGING_MODES = ["Self", "Manager proxy", "Both"] as const;

export type NavKey = "today" | "accounts" | "team" | "scorecard" | "library" | "operator" | "admin";
export interface NavItem { key: NavKey; label: string; href: string }

const NAV_LABEL: Record<NavKey, string> = {
  today: "Today", accounts: "Accounts", team: "Team", scorecard: "Scorecard", library: "Library", operator: "Operator", admin: "Admin",
};
const ROLE_NAV: Record<AppRole, NavKey[]> = {
  engineer: ["today"],
  pm: ["today", "accounts"],
  delivery_lead: ["today", "team", "accounts"],
  ae: ["today", "accounts"],
  sdr: ["today", "accounts"],
  presales: ["accounts", "library"],
  marketing: ["accounts", "library"],
  leader: ["team", "scorecard", "library", "operator", "accounts"],
  ceo: ["scorecard", "accounts"],
};
const ORDER: NavKey[] = ["today", "team", "scorecard", "library", "operator", "accounts", "admin"];

export interface RoleView { app_role: AppRole | null; is_admin: boolean }

/** Navigation. The admin gets the Outgrow Leader's screens on top of their own role, plus /admin. */
export function navFor(v: RoleView): NavItem[] {
  const keys = new Set<NavKey>(v.app_role ? ROLE_NAV[v.app_role] : []);
  if (v.is_admin) {
    ROLE_NAV.leader.forEach((k) => keys.add(k));
    keys.add("admin");
  }
  return ORDER.filter((k) => keys.has(k)).map((key) => ({ key, label: NAV_LABEL[key], href: `/${key}` }));
}

export function homeFor(v: RoleView): string {
  if (v.app_role === "ceo") return "/scorecard";
  if (v.app_role === "leader") return "/team";
  if (v.app_role === "presales" || v.app_role === "marketing") return "/accounts";
  if (v.app_role) return "/today";
  return v.is_admin ? "/admin" : "/login";
}

/** UI mirror of can_log(): everyone except the CEO and delivery engineers sees the floating Log button. */
export function canLog(v: RoleView): boolean {
  if (v.app_role === null) return v.is_admin;
  return v.app_role !== "ceo" && v.app_role !== "engineer";
}
export const isManagerRole = (r: AppRole | null) => r === "delivery_lead";
export const isExecRole = (v: RoleView) => v.is_admin || v.app_role === "leader" || v.app_role === "ceo";
export const isLeaderRole = (v: RoleView) => v.is_admin || v.app_role === "leader";
export const seesRapport = (v: RoleView) => v.is_admin || (v.app_role !== null && ["pm", "delivery_lead", "ae", "sdr", "leader"].includes(v.app_role));
