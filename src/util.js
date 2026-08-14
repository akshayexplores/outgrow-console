/* Small helpers. Kept boring on purpose. */

export const $ = (sel, root=document) => root.querySelector(sel);
export const val = id => (document.getElementById(id)?.value ?? "").toString();
export const checked = id => !!document.getElementById(id)?.checked;

export const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

export const uid = p => p + Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-3);

export const iso = d => new Date(d).toISOString().slice(0,10);
export const todayISO = () => iso(new Date());

export function mondayOf(d){
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return iso(x);
}
export function addWeeks(isoDate, n){
  const x = new Date(isoDate); x.setDate(x.getDate() + n*7); return iso(x);
}
export function daysSince(d){
  if (!d) return null;
  return Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 864e5));
}
export function prettyWeek(w){
  const a = new Date(w);
  return a.toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" });
}

/* Indian numbering — Acsia bills in INR, so lakhs and crores read faster
   than thousands and millions to everyone who will use this. */
export function money(n){
  n = Number(n) || 0;
  if (n >= 1e7) return (n/1e7).toFixed(n % 1e7 ? 1 : 0) + " Cr";
  if (n >= 1e5) return (n/1e5).toFixed(n % 1e5 ? 1 : 0) + " L";
  if (n >= 1000) return (n/1000).toFixed(0) + "k";
  return String(n);
}

export function copy(text){
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const t = document.createElement("textarea");
  t.value = text; document.body.appendChild(t); t.select();
  document.execCommand("copy"); t.remove();
  return Promise.resolve();
}

export function download(filename, text, type="application/json"){
  const b = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
