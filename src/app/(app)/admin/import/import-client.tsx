"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Download, Trash2, Upload } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useShell } from "@/components/shell/shell-context";
import { ACCOUNT_FIELDS, CONTACT_FIELDS, guessMapping, type FieldDef, type Mapping } from "@/lib/import";
import { EMPLOYEE_CSV_COLUMNS } from "@/lib/admin-schemas";
import { importEmployees, runLibrarySeed, validateEmployeeCsv, type CsvRowCheck } from "../actions";
import { commitAccountsImport, commitContactsImport, previewAccountsImport, previewContactsImport, removeExamples, type PreviewResult } from "../import-actions";

type Owner = { person_id: string; full_name: string; app_role: string };

function parseCsv(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim(),
      complete: (r) => resolve({ headers: r.meta.fields ?? [], rows: r.data }),
      error: (e) => reject(e),
    });
  });
}

function downloadCsv(name: string, header: string[]) {
  const url = URL.createObjectURL(new Blob([header.join(",") + "\n"], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export function ImportClient({ library, examples, owners }: { library: Record<string, number>; examples: Record<string, number>; owners: Owner[] }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <LibrarySection counts={library} />
      <EmployeesSection />
      <CsvSection kind="accounts" title="Accounts (CSV)" fields={ACCOUNT_FIELDS} owners={owners} />
      <CsvSection kind="contacts" title="Contacts (CSV)" fields={CONTACT_FIELDS} owners={owners} />
      <ExamplesSection examples={examples} />
    </div>
  );
}

/* ---------------------------------------------------------------- library seeds */

function LibrarySection({ counts }: { counts: Record<string, number> }) {
  const router = useRouter();
  const { toast } = useShell();
  const [pending, start] = useTransition();
  const [confirmReset, setConfirmReset] = useState(false);
  const empty = Object.values(counts).every((n) => n === 0);

  const run = (mode: "missing" | "reset") => start(async () => {
    const r = await runLibrarySeed(mode);
    setConfirmReset(false);
    toast(r.ok ? `Library ${mode === "reset" ? "reset" : "loaded"}: ${r.data.report.reduce((a, x) => a + x.written, 0)} rows written.` : r.error);
    router.refresh();
  });

  return (
    <section className="card">
      <h3>Reference library</h3>
      <p className="thin" style={{ margin: "0 0 10px" }}>Service lines, plays, lists, the focus calendar, AI routes and picklists. These are the only data loaded into production automatically.</p>
      <div className="chips" style={{ marginBottom: 12 }}>
        {Object.entries(counts).map(([t, n]) => <span key={t} className={`chip ${n ? "ok" : "warn"}`}>{t.replace(/_/g, " ")}: {n}</span>)}
      </div>
      <div className="toolbar" style={{ margin: 0 }}>
        <button className="btn acc" disabled={pending} onClick={() => run("missing")}>{empty ? "Load library" : "Add anything missing"}</button>
        <button className="btn" disabled={pending} onClick={() => setConfirmReset(true)}>Reset to shipped defaults…</button>
      </div>
      {confirmReset && (
        <Modal open onOpenChange={(o) => !o && setConfirmReset(false)} title="Reset the library?"
          footer={<><span style={{ flex: 1 }} /><button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button><button className="btn danger" disabled={pending} onClick={() => run("reset")}>Overwrite my edits</button></>}>
          <p style={{ margin: 0 }}>This overwrites every library row with the shipped version, including any edits leaders made to plays, lists and service lines. Accounts, people and logged conversations are not touched.</p>
        </Modal>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- employees csv */

function EmployeesSection() {
  const router = useRouter();
  const { toast } = useShell();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [checks, setChecks] = useState<CsvRowCheck[] | null>(null);
  const [invite, setInvite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f: File | undefined) => {
    setError(null); setChecks(null); setRows(null);
    if (!f) return;
    try {
      const { headers, rows: parsed } = await parseCsv(f);
      const missing = ["full_name", "email", "app_role"].filter((h) => !headers.includes(h));
      if (missing.length) { setError(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template for the exact headers.`); return; }
      setRows(parsed);
      start(async () => {
        const r = await validateEmployeeCsv(parsed);
        if (r.ok) setChecks(r.data.checks); else setError(r.error);
      });
    } catch { setError("That file couldn't be read as CSV."); }
  };

  const ok = checks?.filter((c) => c.ok).length ?? 0;
  const bad = (checks?.length ?? 0) - ok;
  const commit = () => start(async () => {
    if (!rows) return;
    const r = await importEmployees(rows, invite);
    if (!r.ok) { setError(r.error); return; }
    const d = r.data;
    toast(`${d.added} added${d.skipped ? `, ${d.skipped} skipped` : ""}${invite ? `, ${d.invited} invited${d.inviteFailures ? `, ${d.inviteFailures} invites failed (use “Copy sign-in link”)` : ""}` : ""}.`);
    setRows(null); setChecks(null); if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  });

  return (
    <section className="card">
      <h3>Employees (CSV)</h3>
      <p className="thin" style={{ margin: "0 0 10px" }}>Bulk-add the roster. Managers are matched by email and can be anywhere in the file.</p>
      <div className="filecard">
        <div className="toolbar" style={{ margin: 0 }}>
          <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="Employees CSV file" onChange={(e) => void onFile(e.target.files?.[0])} />
          <span className="sp" />
          <button className="btn sm" onClick={() => downloadCsv("employees-template.csv", [...EMPLOYEE_CSV_COLUMNS])}><Download aria-hidden />Template</button>
        </div>
        {error && <div className="errbox" role="alert">{error}</div>}
        {checks && (
          <>
            <div><b>{ok}</b> ready to add{bad ? <>, <b>{bad}</b> with problems (skipped)</> : null}.</div>
            {bad > 0 && (
              <div className="scrollbox"><table><thead><tr><th>Line</th><th>Person</th><th>Problem</th></tr></thead><tbody>
                {checks.filter((c) => !c.ok).map((c) => <tr key={c.line}><td className="n">{c.line}</td><td>{c.full_name || c.email || "—"}</td><td className="thin">{c.errors.join(" ")}</td></tr>)}
              </tbody></table></div>
            )}
            <div className="toolbar" style={{ margin: 0 }}>
              <label className="check"><input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />Send invitation emails</label>
              <span className="sp" />
              <button className="btn acc" disabled={pending || ok === 0} onClick={commit}><Upload aria-hidden />{pending ? "Working…" : `Add ${ok} ${ok === 1 ? "person" : "people"}`}</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- accounts / contacts csv */

function CsvSection({ kind, title, fields, owners }: { kind: "accounts" | "contacts"; title: string; fields: FieldDef[]; owners: Owner[] }) {
  const router = useRouter();
  const { toast } = useShell();
  const [pending, start] = useTransition();
  const [data, setData] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [owner, setOwner] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setData(null); setPreview(null); setMapping({}); setError(null); if (fileRef.current) fileRef.current.value = ""; };

  const onFile = async (f: File | undefined) => {
    reset();
    if (!f) return;
    try {
      const parsed = await parseCsv(f);
      if (parsed.rows.length === 0) { setError("The file has no rows."); return; }
      setData(parsed); setMapping(guessMapping(parsed.headers, fields));
    } catch { setError("That file couldn't be read as CSV."); }
  };

  const missingRequired = fields.filter((f) => f.required && !mapping[f.key]);
  const payload = () => ({ rows: data!.rows, mapping });

  const doPreview = () => start(async () => {
    setError(null);
    const r = kind === "accounts" ? await previewAccountsImport(payload()) : await previewContactsImport(payload());
    if (r.ok) setPreview(r.data); else { setPreview(null); setError(r.error); }
  });

  const doCommit = () => start(async () => {
    setError(null);
    const r = kind === "accounts" ? await commitAccountsImport(payload(), owner) : await commitContactsImport(payload());
    if (!r.ok) { setError(r.error); return; }
    toast(`${r.data.added} added${r.data.skipped ? `, ${r.data.skipped} skipped` : ""}${r.data.failed ? `, ${r.data.failed} failed` : ""}.`);
    reset(); router.refresh();
  });

  const needsOwner = kind === "accounts" && !mapping["owner_email"];

  return (
    <section className="card">
      <h3>{title}</h3>
      <p className="thin" style={{ margin: "0 0 10px" }}>
        {kind === "accounts" ? "Load the customer accounts you already track. Rows that match an existing account name and country are skipped, never overwritten." : "Contacts attach to accounts by name. Import accounts first."}
      </p>
      <div className="filecard">
        <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label={`${title} file`} onChange={(e) => void onFile(e.target.files?.[0])} />
        {error && <div className="errbox" role="alert">{error}</div>}
        {data && (
          <>
            <div className="thin">{data.rows.length} rows found. Match each field to a column in your file.</div>
            <div className="grid2">
              {fields.map((f) => (
                <label key={f.key} className="lbl">{f.label}{f.required && " *"}
                  <select className="in" value={mapping[f.key] ?? ""} onChange={(e) => { setMapping({ ...mapping, [f.key]: e.target.value }); setPreview(null); }}>
                    <option value="">{f.required ? "Choose a column" : "Not in my file"}</option>
                    {data.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                  {f.hint && <span className="field-hint">{f.hint}</span>}
                </label>
              ))}
            </div>
            {needsOwner && (
              <label className="lbl">Default account owner *
                <select className="in" value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">Choose who owns these accounts</option>
                  {owners.map((o) => <option key={o.person_id} value={o.person_id}>{o.full_name}</option>)}
                </select>
              </label>
            )}
            <div className="toolbar" style={{ margin: 0 }}>
              <button className="btn" disabled={pending || missingRequired.length > 0} onClick={doPreview}>{pending && !preview ? "Checking…" : "Check the file"}</button>
              {missingRequired.length > 0 && <span className="thin">Map: {missingRequired.map((f) => f.label).join(", ")}</span>}
              <span className="sp" />
              <button className="btn ghost" onClick={reset}>Clear</button>
            </div>
          </>
        )}
        {preview && (
          <>
            <div><b>{preview.counts.new}</b> new · <b>{preview.counts.exists}</b> already there · <b>{preview.counts.error}</b> with problems</div>
            {(preview.counts.error > 0 || preview.rows.some((r) => r.messages.length > 0)) && (
              <div className="scrollbox"><table><thead><tr><th>Line</th><th>Row</th><th>Result</th></tr></thead><tbody>
                {preview.rows.filter((r) => r.status !== "new" || r.messages.length).slice(0, 200).map((r) => (
                  <tr key={r.line}><td className="n">{r.line}</td><td>{r.label}</td><td className="thin"><span className="rowstatus">{r.status}</span> {r.messages.join(" ")}</td></tr>
                ))}
              </tbody></table></div>
            )}
            <div className="toolbar" style={{ margin: 0 }}>
              <span className="sp" />
              <button className="btn acc" disabled={pending || preview.counts.new === 0 || (needsOwner && !owner)} onClick={doCommit}>
                <Upload aria-hidden />{pending ? "Importing…" : `Import ${preview.counts.new} new`}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- examples */

function ExamplesSection({ examples }: { examples: Record<string, number> }) {
  const router = useRouter();
  const { toast } = useShell();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const total = Object.values(examples).reduce((a, b) => a + b, 0);

  const remove = () => start(async () => {
    const r = await removeExamples();
    setConfirm(false);
    toast(r.ok ? "Example data removed." : r.error);
    router.refresh();
  });

  return (
    <section className="card">
      <h3>Demo data</h3>
      <p className="thin" style={{ margin: "0 0 10px" }}>Example accounts, people and conversations for showing the app. Everything is flagged as an example, so one click removes it and everything logged against it.</p>
      {total === 0 ? (
        <p style={{ margin: 0 }}>No example data is loaded.</p>
      ) : (
        <>
          <div className="chips" style={{ marginBottom: 12 }}>{Object.entries(examples).map(([t, n]) => <span key={t} className="chip warn">{t.replace(/_/g, " ")}: {n}</span>)}</div>
          <button className="btn danger" disabled={pending} onClick={() => setConfirm(true)}><Trash2 aria-hidden />Remove examples…</button>
        </>
      )}
      {confirm && (
        <Modal open onOpenChange={(o) => !o && setConfirm(false)} title="Remove all example data?"
          footer={<><span style={{ flex: 1 }} /><button className="btn" onClick={() => setConfirm(false)}>Cancel</button><button className="btn danger" disabled={pending} onClick={remove}>{pending ? "Removing…" : `Remove ${total} example rows`}</button></>}>
          <p style={{ margin: 0 }}>This permanently deletes {total} example rows and anything anyone logged against them during a demo, including example people's sign-ins. Real accounts and people are not touched. It can't be undone.</p>
        </Modal>
      )}
    </section>
  );
}
