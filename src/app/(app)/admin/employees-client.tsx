"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Mail, Pencil, Plus, Power } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useShell } from "@/components/shell/shell-context";
import { APP_ROLES, JOB_ROLES, LOGGING_MODES, ROLE_LABEL, type AppRole } from "@/lib/roles";
import { defaultsForRole, type EmployeeStatus } from "@/lib/admin-schemas";
import type { EmployeeRow } from "@/lib/data/admin";
import { fmtDateTime } from "@/lib/dates";
import { addEmployee, makeSignInLink, resendInvite, setEmployeeActive, updateEmployee } from "./actions";

const STATUS_CLASS: Record<EmployeeStatus, string> = { Active: "ok", Invited: "info", "Not invited": "warn", Deactivated: "" };

export function EmployeesClient({ people, initialRole, initialStatus }: { people: EmployeeRow[]; initialRole: string; initialStatus: string }) {
  const router = useRouter();
  const { toast } = useShell();
  const [role, setRole] = useState(initialRole);
  const [status, setStatus] = useState(initialStatus);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<EmployeeRow | "new" | null>(null);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOf = useMemo(() => new Map(people.map((p) => [p.person_id, p.full_name])), [people]);
  const shown = people.filter((p) =>
    (!role || p.app_role === role) && (!status || p.status === status) &&
    (!q || `${p.full_name} ${p.email}`.toLowerCase().includes(q.toLowerCase())));

  const run = (fn: () => Promise<void>) => startTransition(() => { void fn(); });

  const onResend = (p: EmployeeRow) => run(async () => {
    const r = await resendInvite(p.person_id);
    toast(r.ok ? r.data.message : r.error);
    router.refresh();
  });
  const onLink = (p: EmployeeRow) => run(async () => {
    const r = await makeSignInLink(p.person_id);
    if (!r.ok) { toast(r.error); return; }
    setLink({ name: p.full_name, url: r.data.url });
    router.refresh();
  });
  const onActive = (p: EmployeeRow) => run(async () => {
    const r = await setEmployeeActive(p.person_id, !p.active);
    toast(r.ok ? (p.active ? `${p.full_name} deactivated.` : `${p.full_name} reactivated.`) : r.error);
    router.refresh();
  });

  return (
    <>
      <div className="toolbar">
        <input className="in" style={{ maxWidth: 240 }} placeholder="Search name or email" aria-label="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="in" style={{ maxWidth: 200 }} aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {APP_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <select className="in" style={{ maxWidth: 160 }} aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {(["Active", "Invited", "Not invited", "Deactivated"] as const).map((s) => <option key={s}>{s}</option>)}
        </select>
        <span className="sp" />
        <button className="btn acc" onClick={() => setEditing("new")}><Plus aria-hidden />Add employee</button>
      </div>

      <div className="card" style={{ padding: "4px 14px" }}>
        <div className="tblw">
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Manager</th><th className="n">Target</th><th>Status</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.person_id}>
                  <td><b>{p.full_name}</b>{p.is_example && <span className="chip warn" style={{ marginLeft: 6 }}>example</span>}<div className="thin">{p.email}</div></td>
                  <td>{ROLE_LABEL[p.app_role]}</td>
                  <td>{p.manager_id ? nameOf.get(p.manager_id) ?? "" : <span className="thin">—</span>}</td>
                  <td className="n">{p.weekly_target}</td>
                  <td><span className={`chip ${STATUS_CLASS[p.status]}`}>{p.status}</span></td>
                  <td className="thin nowrap">{p.last_sign_in_at ? fmtDateTime(p.last_sign_in_at) : "—"}</td>
                  <td>
                    <div className="chips" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <button className="btn sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.full_name}`}><Pencil aria-hidden />Edit</button>
                      {p.active && <button className="btn sm" disabled={pending} onClick={() => onResend(p)} aria-label={`Send invite to ${p.full_name}`}><Mail aria-hidden />{p.status === "Active" ? "Send link" : "Invite"}</button>}
                      {p.active && <button className="btn sm" disabled={pending} onClick={() => onLink(p)} aria-label={`Copy sign-in link for ${p.full_name}`}><Copy aria-hidden />Link</button>}
                      <button className={`btn sm ${p.active ? "danger" : ""}`} disabled={pending} onClick={() => onActive(p)} aria-label={`${p.active ? "Deactivate" : "Reactivate"} ${p.full_name}`}><Power aria-hidden />{p.active ? "Deactivate" : "Reactivate"}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={7}><div className="empty">{people.length === 0 ? "No employees yet. Add yourself first (choose the Outgrow Leader role), then your team." : "No one matches these filters."}</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="thin" style={{ marginTop: 10 }}>Roles and targets take effect on the person's next page load. Deactivating switches off their access immediately and keeps their history.</p>

      {editing && (
        <EmployeeDialog
          key={editing === "new" ? "new" : editing.person_id}
          person={editing === "new" ? null : editing}
          people={people}
          onClose={() => setEditing(null)}
          onDone={(message) => { setEditing(null); toast(message); router.refresh(); }}
        />
      )}
      {link && (
        <Modal open onOpenChange={(o) => !o && setLink(null)} title={`Sign-in link for ${link.name}`}
          footer={<><span className="sp" style={{ flex: 1 }} /><button className="btn p" onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => toast("Link copied."), () => toast("Couldn't copy: select the link and copy it.")); }}><Copy aria-hidden />Copy link</button></>}>
          <p style={{ margin: 0 }}>Anyone with this link can sign in as <b>{link.name}</b> once. Hand it over privately (chat or in person), never by a shared channel.</p>
          <pre className="code" tabIndex={0}>{link.url}</pre>
          <p className="thin" style={{ margin: 0 }}>It expires after one use or about an hour, whichever comes first. Creating it is recorded in the audit log.</p>
        </Modal>
      )}
    </>
  );
}

function EmployeeDialog({ person, people, onClose, onDone }: { person: EmployeeRow | null; people: EmployeeRow[]; onClose: () => void; onDone: (m: string) => void }) {
  const editing = person !== null;
  const init = person ?? { full_name: "", email: "", app_role: "pm" as AppRole, manager_id: null as string | null, ...defaultsForRole("pm") };
  const [full_name, setName] = useState(init.full_name);
  const [email, setEmail] = useState(init.email);
  const [app_role, setRole] = useState<AppRole>(init.app_role);
  const [job_role, setJob] = useState<string>(init.job_role ?? defaultsForRole(init.app_role).job_role);
  const [manager_id, setManager] = useState<string>(init.manager_id ?? "");
  const [weekly_target, setTarget] = useState<number>(init.weekly_target);
  const [ranked, setRanked] = useState<boolean>(init.show_on_ranked_scorecard);
  const [logging_mode, setMode] = useState<string>(init.logging_mode ?? defaultsForRole(init.app_role).logging_mode);
  const [invite, setInvite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onRole = (r: AppRole) => {
    setRole(r);
    if (!editing) { const d = defaultsForRole(r); setTarget(d.weekly_target); setJob(d.job_role); setRanked(d.show_on_ranked_scorecard); setMode(d.logging_mode); }
  };
  const managers = people.filter((p) => p.active && p.person_id !== person?.person_id && ["delivery_lead", "leader", "ae", "pm"].includes(p.app_role));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload = { full_name, email, app_role, job_role, manager_id, weekly_target, show_on_ranked_scorecard: ranked, logging_mode };
      if (editing) {
        const r = await updateEmployee(person.person_id, payload);
        if (!r.ok) setError(r.error); else onDone(`${full_name} updated.`);
      } else {
        const r = await addEmployee(payload, invite);
        if (!r.ok) setError(r.error);
        else onDone(r.data.invite ? r.data.invite.message : `${full_name} added. They can sign in once you invite them.`);
      }
    });
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={editing ? `Edit ${person.full_name}` : "Add employee"}
      footer={<>
        {!editing && <label className="check"><input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />Send invitation email now</label>}
        <span className="sp" style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" form="emp-form" className="btn acc" disabled={pending}>{pending ? "Saving…" : editing ? "Save" : "Add"}</button>
      </>}>
      <form id="emp-form" onSubmit={submit} style={{ display: "grid", gap: 12 }} noValidate>
        <label className="lbl">Full name<input className="in" value={full_name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
        <label className="lbl">Email{editing && <span className="field-hint">Sign-in identity: it can't be changed. Deactivate and add a new person instead.</span>}
          <input className="in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={editing} required />
        </label>
        <div className="grid2">
          <label className="lbl">Role<select className="in" value={app_role} onChange={(e) => onRole(e.target.value as AppRole)}>{APP_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          <label className="lbl">Job title<select className="in" value={job_role} onChange={(e) => setJob(e.target.value)}>{JOB_ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
        </div>
        <div className="grid2">
          <label className="lbl">Manager<select className="in" value={manager_id} onChange={(e) => setManager(e.target.value)}><option value="">No manager</option>{managers.map((m) => <option key={m.person_id} value={m.person_id}>{m.full_name}</option>)}</select></label>
          <label className="lbl">Weekly target<input className="in" type="number" min={0} max={100} value={weekly_target} onChange={(e) => setTarget(Number(e.target.value))} /><span className="field-hint">0 = not on the roster (CEO, marketing)</span></label>
        </div>
        <div className="grid2">
          <label className="lbl">Who logs<select className="in" value={logging_mode} onChange={(e) => setMode(e.target.value)}>{LOGGING_MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="check" style={{ alignSelf: "end", minHeight: 38 }}><input type="checkbox" checked={ranked} onChange={(e) => setRanked(e.target.checked)} />Show on the ranked scorecard</label>
        </div>
        {error && <div className="errbox" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}
