/* =====================================================================
   RUNTIME CONFIG
   ---------------------------------------------------------------------
   Leave both Supabase values empty and the app stores data in the
   browser (localStorage). That is fine for a single person evaluating
   it, but the team scorecard is only meaningful once everyone writes to
   the same place.

   To go multi-user:
     1. Create a free project at supabase.com
     2. Run supabase/schema.sql in the SQL editor
     3. Paste the Project URL and the anon/public key below
     4. Redeploy

   The anon key is designed to be public — it is safe in a client bundle
   PROVIDED row-level security is on, which schema.sql sets up. Do not
   put the service_role key here.
   ===================================================================== */

window.OUTGROW_CONFIG = {
  supabaseUrl:     "",
  supabaseAnonKey: "",
  workspaceId:     "acsia"
};
