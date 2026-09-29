import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { requireAdmin } from "@/lib/auth/session";
import { listAudit } from "@/lib/data/admin";
import { fmtDateTime } from "@/lib/dates";
import { AdminTabs } from "../admin-tabs";

export const metadata: Metadata = { title: "Admin · Audit" };

const LABEL: Record<string, string> = {
  acsia_people: "Employee", app_settings: "Setting", auth_link: "Sign-in link", picklists: "Picklist", ai_routes: "AI route", import: "Import",
};

export default async function AuditPage() {
  await requireAdmin();
  const rows = await listAudit(200);
  return (
    <Page title="Admin" wide>
      <AdminTabs current="audit" />
      <div className="card" style={{ padding: "4px 14px" }}>
        <div className="tblw">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Field</th><th>Before</th><th>After</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.audit_id}>
                  <td className="thin nowrap">{fmtDateTime(r.changed_at)}</td>
                  <td className="thin">{r.changed_by_email ?? "system"}</td>
                  <td>{LABEL[r.table_name] ?? r.table_name}</td>
                  <td className="thin">{r.field ?? "—"}</td>
                  <td className="thin" style={{ maxWidth: 200, overflowWrap: "anywhere" }}>{r.old_value ?? "—"}</td>
                  <td style={{ maxWidth: 240, overflowWrap: "anywhere" }}>{r.new_value ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6}><div className="empty">Nothing recorded yet. Changes to employees, settings and imports show up here.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="thin" style={{ marginTop: 10 }}>Showing the latest 200 changes. Sign-in links are recorded as a note only, never the link itself.</p>
    </Page>
  );
}
