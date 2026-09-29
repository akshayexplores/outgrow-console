import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PlayRow { play_id: string; play_type: string; action_code: string | null; title: string; script: string; trigger: string | null; priority: number | null; approval_status: string; requires_signoff: boolean; proof: string | null }
export interface Approval { kind: "Play" | "Testimonial" | "Proof point"; id: string; title: string; detail: string }
export interface LibraryData { plays: PlayRow[]; approvals: Approval[]; types: string[] }

export async function loadLibrary(supabase: SupabaseClient, isLeader: boolean): Promise<LibraryData> {
  const [plays, proofs] = await Promise.all([
    supabase.from("plays").select("play_id, play_type, action_code, title, script, trigger, priority, approval_status, requires_signoff, proof_point_id").order("priority", { ascending: true }).order("play_id").limit(400),
    supabase.from("proof_points_safe").select("proof_id, title, external_statement, approval_status").limit(300),
  ]);
  const proofBy = new Map((proofs.data ?? []).map((p) => [p.proof_id as string, p]));
  const rows: PlayRow[] = (plays.data ?? []).map((p) => ({
    play_id: p.play_id as string, play_type: p.play_type as string, action_code: p.action_code as string | null, title: p.title as string, script: (p.script as string) ?? "",
    trigger: p.trigger as string | null, priority: p.priority as number | null, approval_status: p.approval_status as string, requires_signoff: !!p.requires_signoff,
    proof: p.proof_point_id ? ((proofBy.get(p.proof_point_id as string)?.title as string | undefined) ?? null) : null,
  }));
  const approvals: Approval[] = [];
  if (isLeader) {
    for (const p of rows.filter((r) => r.approval_status === "Draft")) approvals.push({ kind: "Play", id: p.play_id, title: `${p.play_id} · ${p.title}`, detail: p.trigger ?? "" });
    for (const p of proofs.data ?? []) if (p.approval_status === "Draft") approvals.push({ kind: "Proof point", id: p.proof_id as string, title: String(p.title), detail: String(p.external_statement ?? "") });
    const t = await supabase.from("testimonials").select("testimonial_id, quote_short, quote_verbatim, cs_signoff").eq("cs_signoff", false).is("archived_at", null).limit(100);
    for (const x of t.data ?? []) approvals.push({ kind: "Testimonial", id: x.testimonial_id as string, title: String(x.quote_short ?? x.quote_verbatim ?? "Testimonial").slice(0, 120), detail: "Waiting for customer success sign-off" });
  }
  return { plays: rows, approvals, types: [...new Set(rows.map((r) => r.play_type))].sort() };
}
