/** Placeholder body for screens that land in a later milestone. Says plainly what's coming, so nobody thinks it's broken. */
export function ComingSoon({ what, milestone }: { what: string; milestone: string }) {
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h3>Not built yet</h3>
      <p style={{ margin: "6px 0 0" }}>{what}</p>
      <p className="thin" style={{ margin: "8px 0 0" }}>Arrives in {milestone}.</p>
    </div>
  );
}
