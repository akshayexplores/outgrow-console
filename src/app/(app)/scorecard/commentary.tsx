"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useShell } from "@/components/shell/shell-context";
import { acceptDraft, draftCommentary, publishScorecard, saveCommentary } from "@/app/actions/scorecard";
import { namedPeople, publishBlockers } from "@/lib/scorecard";
import type { Story } from "@/lib/data/scorecard";
import type { StoredDraft } from "@/lib/operator/score-core";
import { money } from "@/lib/format";

export function CommentaryBox({ week, initial, rosterNames, canPublish, stories, defaultStory, rosterSize, draft }: {
  week: string; initial: string; rosterNames: string[]; canPublish: boolean; stories: Story[]; defaultStory: string | null; rosterSize: number; draft: StoredDraft | null;
}) {
  const { toast } = useShell();
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [story, setStory] = useState<string>(defaultStory ?? stories[0]?.story_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const named = useMemo(() => namedPeople(text, rosterNames), [text, rosterNames]);
  const blockers = publishBlockers(text, rosterNames, canPublish);

  const [drafting, startDraft] = useTransition();
  const takeDraft = () => {
    if (!draft) return;
    setText(draft.commentary); setConfirming(false);
    if (draft.run_id) void acceptDraft({ runId: draft.run_id });
    toast("Draft copied into your commentary. Edit it, then save or publish.");
  };

  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      {canPublish && (
        <div className="op" style={{ margin: 0 }}><span className="dot"><Sparkles aria-hidden /></span><div style={{ minWidth: 0 }}>
          {draft ? (
            <>
              <p><b>Operator's draft</b> <span className={`chip ${draft.source === "ai" ? "a" : ""}`}>{draft.source === "ai" ? "AI-written" : "written from the numbers"}</span></p>
              <p style={{ marginTop: 6 }}>“{draft.commentary}”</p>
              {draft.story && <div className="why">Story line: {draft.story}</div>}
              {draft.note && <div className="why">{draft.note}</div>}
              <div className="why">It only uses this week's counts and first names. Check every name and claim before you publish: the commentary goes out under your name.</div>
            </>
          ) : <p>No draft yet. The operator drafts one on Friday at 14:00, or you can ask for it now.</p>}
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {draft && <button className="btn sm p" onClick={takeDraft}>Use this draft</button>}
            <button className="btn sm" disabled={drafting} onClick={() => startDraft(async () => {
              const r = await draftCommentary({ week });
              if (!r.ok) { setError(r.error); return; }
              setError(null); toast("Draft ready."); router.refresh();
            })}>{drafting ? "Drafting…" : draft ? "Redraft" : "Draft it for me"}</button>
          </div>
        </div></div>
      )}
      {stories.length > 1 && (
        <label className="lbl" htmlFor="story-pick">Story of the week
          <select id="story-pick" className="in" value={story} onChange={(e) => setStory(e.target.value)}>
            {stories.map((s) => <option key={s.story_id} value={s.story_id}>{s.person_name}{s.account_name ? ` · ${s.account_name}` : ""}: {(s.story_text ?? "").slice(0, 70)}</option>)}
          </select>
        </label>
      )}
      <label className="lbl" htmlFor="commentary">Your commentary
        <textarea id="commentary" className="in" style={{ minHeight: 90 }} value={text} maxLength={1500} onChange={(e) => { setText(e.target.value); setConfirming(false); }}
          placeholder="Priya turned a routine sync into a LiLA walkthrough. Arjun chased three aged proposals nobody else would have." />
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" disabled={pending} onClick={() => start(async () => {
          const r = await saveCommentary({ week, text });
          if (!r.ok) setError(r.error); else { setError(null); toast("Draft saved."); router.refresh(); }
        })}>Save draft</button>
        <span className="sp" style={{ flex: 1 }} />
        <span className="demo" aria-live="polite">{named.length}/2 people named{named.length ? `: ${named.join(", ")}` : ""}</span>
        {!confirming
          ? <button className="btn acc" disabled={pending || blockers.length > 0} onClick={() => setConfirming(true)}>Publish scorecard</button>
          : (
            <>
              <button className="btn acc" disabled={pending} onClick={() => start(async () => {
                const r = await publishScorecard({ week, text, storyId: story || null });
                if (!r.ok) { setError(r.error); setConfirming(false); return; }
                toast(`Published. ${r.data.notified} people notified.`); router.refresh();
              })}>Yes, publish to {rosterSize} people</button>
              <button className="btn" onClick={() => setConfirming(false)}>Not yet</button>
            </>
          )}
      </div>
      {blockers.length > 0 && <div className="demo" role="status">{blockers[0]}</div>}
      {confirming && <div className="warnbox" role="status">Publishing freezes this week's numbers and notifies everyone on the roster. It can't be undone.</div>}
      {error && <div className="errbox" role="alert">{error}</div>}
      {stories.some((s) => s.value_usd) && <div className="demo">{stories.length} nominated stor{stories.length === 1 ? "y" : "ies"} this week{stories[0]?.value_usd ? ` · top story value ${money(stories[0].value_usd)}` : ""}</div>}
    </div>
  );
}
