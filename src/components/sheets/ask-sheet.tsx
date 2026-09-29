"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Send } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { streamText } from "@/lib/stream";

type Turn = { role: "user" | "assistant"; content: string; error?: boolean };
type Screen = "today" | "accounts" | "team" | "scorecard" | "library" | "operator" | "admin";

const SUGGESTED: Record<Screen, string[]> = {
  today: ["How do I open with someone I haven't spoken to in months?", "A customer says 'we're happy with our current supplier'. What now?"],
  accounts: ["What's the best next swing on this account?", "Who should I ask for an internal referral here?"],
  team: ["A teammate hasn't logged in three weeks. What do I say?", "How should I split coverage of a shared account?"],
  scorecard: ["Draft a two-sentence commentary for this week.", "Participation dropped. What's the likely cause?"],
  library: ["Write a reverse DYK for an ASPICE customer.", "Is it safe to offer ASIL D development?"],
  operator: ["Which jobs need the most capable model, and why?", "What should the capture parser never do?"],
  admin: ["How do I bring in a whole team at once?"],
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Ask Outgrow: short coaching answers, streamed. The last few turns are sent with each question; nothing is stored. */
export function AskSheet({ opts, onClose }: { opts: { prompt?: string }; onClose: () => void }) {
  const pathname = usePathname();
  const seg = pathname.split("/")[1] ?? "today";
  const screen = (["today", "accounts", "team", "scorecard", "library", "operator", "admin"].includes(seg) ? seg : "today") as Screen;
  const accountId = screen === "accounts" ? pathname.split("/")[2]?.match(UUID)?.[0] ?? null : null;

  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const history: Turn[] = [...turns.filter((t) => !t.error), { role: "user", content: question }];
    setTurns([...history, { role: "assistant", content: "" }]);
    setQ(""); setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    const r = await streamText("/api/ai/coach", { messages: history.slice(-8).map(({ role, content }) => ({ role, content })), screen, accountId }, (soFar) => {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, content: soFar } : x)));
    }, ac.signal);
    setBusy(false);
    if (!r.ok && r.message) setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { role: "assistant", content: r.message, error: true } : x)));
  }

  useEffect(() => {
    if (opts.prompt && !started.current) { started.current = true; void send(opts.prompt); }
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns]);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Ask Outgrow"
      footer={
        <form className="chatin" onSubmit={(e) => { e.preventDefault(); void send(q); }}>
          <label className="sr-only" htmlFor="ask-q">Your question</label>
          <input id="ask-q" className="in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask Outgrow…" autoComplete="off" maxLength={600} />
          <button className="btn p" type="submit" disabled={busy || !q.trim()} aria-label="Send"><Send size={14} aria-hidden /></button>
        </form>
      }>
      {turns.length === 0 && (
        <>
          <p style={{ margin: 0, color: "var(--muted)" }}>Ask about a script, an objection or what to do next. It knows the Outgrow rules and which screen you're on. It doesn't see revenue or pipeline.</p>
          <div className="chips">{SUGGESTED[screen].map((s) => <button key={s} className="chip a" onClick={() => void send(s)}>{s}</button>)}</div>
        </>
      )}
      <div className="msgs" aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className={`msg ${t.role === "user" ? "u" : "a"}`} style={t.error ? { color: "var(--bad, #b3261e)" } : undefined}>
            {t.content || <span className="thinking"><i />Thinking…</span>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </Sheet>
  );
}
