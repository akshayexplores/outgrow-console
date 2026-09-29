import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadPrep } from "@/lib/data/prep";
import { briefPrompt } from "@/lib/operator/prompts";
import { streamJob } from "@/lib/operator/run";
import { uuid } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({ contactId: uuid, assignmentId: uuid.nullable().optional() });
const json = (status: number, message: string) => Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });

/** Streams a three-line call brief. The prompt is built here from the caller's own RLS view of the data; nothing comes from the browser but two ids. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return json(401, "You're signed out. Sign in again.");
  if (!req.headers.get("content-type")?.includes("application/json")) return json(415, "Unsupported request.");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, "That contact isn't valid.");

  const supabase = await createClient();
  const prep = await loadPrep(supabase, s.me, parsed.data);
  if (!prep) return json(404, "You don't have access to that contact.");

  const messages = briefPrompt({
    employee: s.me.full_name,
    contact: {
      name: prep.contact.name, title: prep.contact.job_title, account: prep.contact.account_name, relationship_strength: prep.contact.strength,
      interests: prep.contact.interests, current_priorities: prep.contact.priorities, channel_rule: prep.channelRule ?? "no special rule",
    },
    openInsights: prep.insights.map((i) => `${i.insight_type}: ${i.text}`),
    playsAlreadyRaised: prep.contact.already_raised,
    assignment: prep.assignment ? { play: prep.play?.title ?? null, script: prep.play?.script ?? null, why_now: prep.assignment.why_now, instruction: prep.assignment.instruction } : (prep.play ? { play: prep.play.title, script: prep.play.script, why_now: null, instruction: null } : null),
    accountNext: null,
  });
  const r = await streamJob("brief", messages, { personId: s.me.person_id, inputRef: { contact: parsed.data.contactId } });
  if (!r.ok) return json(r.reason === "rate_limited" ? 429 : 503, r.message);
  return new Response(r.stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
