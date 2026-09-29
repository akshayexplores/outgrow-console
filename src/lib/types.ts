import { z } from "zod";
import { appRoleSchema } from "@/lib/roles";

/** Shape returned by the get_me() RPC. Roles are read from the DB on every request, never from JWT claims. */
export const meSchema = z.object({
  person_id: z.string().uuid().nullable(),
  full_name: z.string(),
  email: z.string().nullable(),
  app_role: appRoleSchema.nullable(),
  manager_id: z.string().uuid().nullable(),
  weekly_target: z.number(),
  welcomed_at: z.string().nullable(),
  show_on_ranked_scorecard: z.boolean(),
  is_admin: z.boolean(),
  can_see_money: z.boolean(),
  on_roster: z.boolean(),
});
export type Me = z.infer<typeof meSchema>;

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-15");

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
export const okResult = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const errResult = (error: string): ActionResult<never> => ({ ok: false, error });

/** Turn a Postgres/PostgREST error from one of our RPCs ("CODE: message") into text a person can read. */
export function friendlyDbError(message: string | undefined | null): string {
  if (!message) return "Something went wrong. Try again.";
  const m = /^([A-Z0-9_]{3,}):\s*(.+)$/s.exec(message);
  if (m?.[2]) return m[2].trim();
  if (/permission denied|row-level security/i.test(message)) return "You don't have access to do that.";
  if (/duplicate key|already exists/i.test(message)) return "That already exists.";
  if (/violates check constraint/i.test(message)) return "One of the values isn't allowed. Check the form.";
  if (/violates foreign key/i.test(message)) return "That refers to something that no longer exists.";
  return message.length > 200 ? "Something went wrong. Try again." : message;
}
