"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { doNotOfferHits } from "@/lib/operator/guardrails";
import { errResult, friendlyDbError, okResult, uuid, type ActionResult } from "@/lib/types";

const isLeader = (s: { me: { is_admin: boolean; app_role: string | null } }) => s.me.is_admin || s.me.app_role === "leader";

const playSchema = z.object({ playId: z.string().trim().min(1).max(40), decision: z.enum(["approve", "retire"]) });
/** Leader decision on a draft play. Approving refuses a play whose script offers something on the do-not-offer list. */
export async function decidePlay(raw: unknown): Promise<ActionResult> {
  const s = await requireActionSession();
  if (!isLeader(s)) return errResult("Only the Outgrow Leader can approve plays.");
  const p = playSchema.safeParse(raw);
  if (!p.success) return errResult("That play isn't valid.");
  const supabase = await createClient();
  if (p.data.decision === "approve") {
    const { data: play } = await supabase.from("plays").select("script, to_capability_id").eq("play_id", p.data.playId).maybeSingle();
    if (!play) return errResult("That play no longer exists.");
    const { data: dno } = await supabase.from("capabilities").select("capability_id, name").eq("do_not_offer", true);
    const blockedIds = new Set((dno ?? []).map((c) => String(c.capability_id)));
    if (play.to_capability_id && blockedIds.has(String(play.to_capability_id))) return errResult("This play leads to something Acsia doesn't offer, so it can't be approved.");
    const hits = doNotOfferHits(String(play.script ?? ""), (dno ?? []).map((c) => String(c.name)));
    if (hits.length) return errResult(`The script mentions ${hits.join(", ")}, which Acsia doesn't offer. Edit it before approving.`);
  }
  const { data: upd, error } = await supabase.from("plays").update(p.data.decision === "approve"
    ? { approval_status: "Approved - internal", approved_by_id: s.me.person_id, approved_at: new Date().toISOString() }
    : { approval_status: "Retired" }).eq("play_id", p.data.playId).eq("approval_status", "Draft").select("play_id");
  if (error) return errResult(friendlyDbError(error.message));
  if (!upd?.length) return errResult("Nothing changed. Someone may already have decided this play.");
  revalidatePath("/library");
  return okResult(undefined);
}

const idSchema = z.object({ id: uuid, decision: z.enum(["approve", "retire"]) });
export async function decideProofPoint(raw: unknown): Promise<ActionResult> {
  const s = await requireActionSession();
  if (!isLeader(s)) return errResult("Only the Outgrow Leader can approve proof points.");
  const p = idSchema.safeParse(raw);
  if (!p.success) return errResult("That proof point isn't valid.");
  const supabase = await createClient();
  const { data: upd, error } = await supabase.from("proof_points").update({ approval_status: p.data.decision === "approve" ? "Approved - internal" : "Retired" }).eq("proof_id", p.data.id).eq("approval_status", "Draft").select("proof_id");
  if (error) return errResult(friendlyDbError(error.message));
  if (!upd?.length) return errResult("Nothing changed. Someone may already have decided this proof point.");
  revalidatePath("/library");
  return okResult(undefined);
}

/** A customer testimonial may only be shared once customer success has signed it off. */
export async function signOffTestimonial(id: string): Promise<ActionResult> {
  const s = await requireActionSession();
  if (!isLeader(s)) return errResult("Only the Outgrow Leader can sign off testimonials.");
  const p = uuid.safeParse(id);
  if (!p.success) return errResult("That testimonial isn't valid.");
  const supabase = await createClient();
  const { data: upd, error } = await supabase.from("testimonials").update({ cs_signoff: true }).eq("testimonial_id", p.data).select("testimonial_id");
  if (error) return errResult(friendlyDbError(error.message));
  if (!upd?.length) return errResult("Nothing changed. It may already be signed off.");
  revalidatePath("/library");
  return okResult(undefined);
}
