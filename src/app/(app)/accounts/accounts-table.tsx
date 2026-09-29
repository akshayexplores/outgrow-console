"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountRow } from "@/lib/data/accounts";
import { money } from "@/lib/format";

export function AccountsTable({ rows, showMoney }: { rows: AccountRow[]; showMoney: boolean }) {
  const router = useRouter();
  if (rows.length === 0) return <div className="empty">No accounts yet. The admin can import them from Admin → Data import.</div>;
  return (
    <div className="card" style={{ padding: "4px 14px" }}>
      <div className="tblw">
        <table>
          <thead><tr><th>Account</th><th>Tier</th><th>Service lines bought</th><th>Buying group we know</th><th className="n">Days since a proactive touch</th>{showMoney && <th className="n">Won (all time)</th>}</tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.account_id} className="click" onClick={() => router.push(`/accounts/${a.account_id}`)}>
                <td>
                  <Link href={`/accounts/${a.account_id}`} onClick={(e) => e.stopPropagation()}><b>{a.name}</b></Link>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{[a.region, a.owner_name ? `Outgrow owner ${a.owner_name}` : null].filter(Boolean).join(" · ")}</div>
                </td>
                <td>{a.tier ? <span className={`chip${a.tier === "A" ? " a" : ""}`}>{a.tier}</span> : "–"}</td>
                <td>{a.service_lines_bought ?? 0} / 15</td>
                <td>{a.coverage_pct === null ? "–" : <span className={`chip ${a.coverage_pct < 10 ? "bad" : "ok"}`}>{a.coverage_pct}%</span>}</td>
                <td className="n">{a.days_since_touch ?? "never"}</td>
                {showMoney && <td className="n">{money(a.won_usd)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
