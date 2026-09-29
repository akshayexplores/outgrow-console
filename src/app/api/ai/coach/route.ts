import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { coachSystem } from "@/lib/operator/prompts";
import { streamJob } from "@/lib/operator/run";
import { uuid } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(1200) })).min(1).max(16),
  screen: z.enum(["today", "accounts", "team", "scorecard", "library", "operator", "admin"]),
  accountId: uuid.nullable().optional(),
  contactId: uuid.nullable().optional(),
});
const json = (status: number, message: string) => Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });

/** Ask Outgrow: streamed coaching. Context is only the role, the screen and the names on it; no revenue, pipeline or rapport notes go to the model. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return json(401, "You're signed out. Sign in again.");
  if (!req.headers.get("content-type")?.includes("application/json")) return json(415, "Unsupported request.");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, "That question couldn't be read.");
  const { messages, screen, accountId, contactId } = parsed.data;
  if (messages[messages.length - 1]?.role !== "user") return json(400, "Ask a question first.");

  const supabase = await createClient();
  const [a, c] = await Promise.all([
    accountId ? supabase.from("accounts_safe").select("name").eq("account_id", accountId).maybeSingle() : Promise.resolve({ data: null }),
    contactId ? supabase.from("contacts_safe").select("first_name, last_name").eq("contact_id", contactId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const system = coachSystem({
    role: s.me.app_role ?? "admin", screen, account: (a.data?.name as string | undefined) ?? null,
    contact: c.data ? `${c.data.first_name} ${c.data.last_name}` : null
  });
  const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
  const r = await streamJob("coach", [{ role: "system", content: system }, ...history], { personId: s.me.person_id, inputRef: { screen, turns: history.length } });
  if (!r.ok) return json(r.reason === "rate_limited" ? 429 : 503, r.message);
  return new Response(r.stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
