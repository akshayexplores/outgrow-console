/* =====================================================================
   STORAGE ADAPTER
   ---------------------------------------------------------------------
   Two backends, one interface. The app never knows which is in use.

   LOCAL  (default) — browser localStorage. Works with zero setup, but
                      it is per-browser, so the team scorecard is only
                      meaningful for the person looking at it.

   SUPABASE         — shared. Set the two values in config.js (or via
                      window.OUTGROW_CONFIG) and this switches over
                      automatically. Run supabase/schema.sql first.

   Why a single JSON document rather than normalised tables: at Acsia's
   scale (tens of accounts, a few hundred actions a month) a document is
   simpler, atomic, and trivial to export. If concurrent editing ever
   becomes a real problem, split `actions` into its own table first —
   that's the only collection with meaningful write contention.
   ===================================================================== */

import { SEED } from "./seed.js";

const KEY = "outgrow-acsia-v1";
const cfg = (typeof window !== "undefined" && window.OUTGROW_CONFIG) || {};
const SB_URL  = cfg.supabaseUrl  || "";
const SB_KEY  = cfg.supabaseAnonKey || "";
const SB_ROW  = cfg.workspaceId || "acsia";

export const MODE = (SB_URL && SB_KEY) ? "supabase" : "local";

/* ---------------- local ---------------- */
const local = {
  async load(){
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : structuredClone(SEED);
    } catch { return structuredClone(SEED); }
  },
  async save(state){
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch { return false; }
  }
};

/* ---------------- supabase (REST, no SDK) ---------------- */
const headers = {
  "apikey": SB_KEY,
  "Authorization": `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "resolution=merge-duplicates,return=minimal"
};
const supa = {
  async load(){
    const r = await fetch(
      `${SB_URL}/rest/v1/outgrow_state?id=eq.${encodeURIComponent(SB_ROW)}&select=doc`,
      { headers });
    if (!r.ok) throw new Error(`Supabase load failed (${r.status})`);
    const rows = await r.json();
    if (rows.length && rows[0].doc) return rows[0].doc;
    await this.save(SEED);              // first run — plant the seed
    return structuredClone(SEED);
  },
  async save(state){
    const r = await fetch(`${SB_URL}/rest/v1/outgrow_state`, {
      method:"POST", headers,
      body: JSON.stringify({ id: SB_ROW, doc: state, updated_at: new Date().toISOString() })
    });
    if (!r.ok) throw new Error(`Supabase save failed (${r.status})`);
    return true;
  }
};

const backend = MODE === "supabase" ? supa : local;

export const Store = {
  mode: MODE,
  lastError: null,
  async load(){
    try { return await backend.load(); }
    catch (e) { this.lastError = e.message; return structuredClone(SEED); }
  },
  async save(state){
    try { this.lastError = null; return await backend.save(state); }
    catch (e) { this.lastError = e.message; return false; }
  },
  async reset(){
    if (MODE === "local") localStorage.removeItem(KEY);
    else await supa.save(SEED);
    return structuredClone(SEED);
  }
};
