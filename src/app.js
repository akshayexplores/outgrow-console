import { Store, MODE } from "./store.js";
import {
  SERVICES, COMPETITORS, BUYING_ROLES, REL_LEVELS, CHANNELS, ACTIONS, acode,
  LISTS, listById, EXCLUDED_LIST, CALL_STRUCTURE, VOICEMAIL, CHANNEL_MATRIX, CHANNEL_RULES,
  DYK_MAP, dykFor, OBJECTIONS_INTERNAL, OBJECTIONS_CUSTOMER, INTERVIEW,
  PROMPT_CARD, CADENCE, CEO_DUTIES, DOCTRINE, fill
} from "./content.js";
import {
  esc, uid, iso, todayISO, mondayOf, addWeeks, daysSince, prettyWeek,
  money, copy, download, val, checked
} from "./util.js";

/* ===================== state ===================== */
let S = null;
let view = "week";
let me = "p1";
let week = mondayOf(new Date());
let sel = { account:null, list:LISTS[0].id, pbTab:"scripts" };
let modal = null;

/* ===================== lookups ===================== */
const person   = id => S.people.find(p => p.id === id) || { name:"—", role:"" };
const account  = id => S.accounts.find(a => a.id === id) || null;
const contact  = id => S.contacts.find(c => c.id === id) || null;
const acctContacts = aid => S.contacts.filter(c => c.accountId === aid);
const acctActions  = aid => S.actions.filter(a => a.account === aid).sort((x,y)=>y.date.localeCompare(x.date));
const weekActions  = (w=week) => S.actions.filter(a => mondayOf(a.date) === w);
const weekAssign   = (w=week) => S.assignments.filter(g => g.week === w);
const myAssign     = (p=me, w=week) => weekAssign(w).filter(g => g.person === p);
const gapPct = a => a.engBudget ? Math.round(a.billing / a.engBudget * 100) : null;
const interviewsDone = () => S.interviews.filter(i => i.done).length;
const gateOpen = () => interviewsDone() >= (S.config.interviewTarget || 8);

function streak(pid){
  const w = new Set(S.actions.filter(a => a.person === pid).map(a => mondayOf(a.date)));
  let n = 0, cur = week;
  while (w.has(cur)) { n++; cur = addWeeks(cur, -1); }
  return n;
}
function participation(w=week){
  const acted = new Set(weekActions(w).map(a => a.person));
  return S.people.length ? Math.round(acted.size / S.people.length * 100) : 0;
}
/* Derived list membership. The two decay lists compute themselves from
   last touch — a list somebody has to maintain by hand decays within a
   month, and a decayed list is worse than no list because people stop
   trusting it. The rest are set on the account. */
function onList(a, lid){
  const d = daysSince(a.lastTouch) ?? 9999;
  if (lid === "zerodark") return (d > 30 && d <= 180) || a.lists.includes("zerodark");
  if (lid === "silent6")  return d > 180 || a.lists.includes("silent6");
  return a.lists.includes(lid);
}
const listAccounts = lid => S.accounts.filter(a => onList(a, lid));

/* Short tab labels — the full list names are too long for a tab bar. */
const SHORT = { quotes:"Quotes out", prequote:"Pre-quote", large:"Large", smallmed:"Small/Med",
  autopilot:"Autopilot", zerodark:"Zero Dark 30", silent6:"Silent 6mo+",
  decline:"Decreasing", stopped:"Stopped", warm:"Warm" };

/* Signals — the cross-account views that are otherwise invisible. */
function signals(){
  const neverContacted = [];
  S.accounts.forEach(a => acctContacts(a.id).forEach(c => {
    if (c.rel === "Not initiated") neverContacted.push({ a, c });
  }));
  return {
    neverContacted: neverContacted.sort((x,y) =>
      (y.c.role === "Economic") - (x.c.role === "Economic")),
    singleThreaded: S.accounts.filter(a => acctContacts(a.id).length < 3),
    noEconomic: S.accounts.filter(a => !acctContacts(a.id).some(c => c.role === "Economic")),
    lowShare: [...S.accounts].filter(a => gapPct(a) !== null)
      .sort((x,y) => gapPct(x) - gapPct(y))
  };
}

/* ===================== plumbing ===================== */
async function mutate(fn){ fn(S); await Store.save(S); render(); }
function toast(msg){
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const d = document.createElement("div");
  d.className = "toast"; d.textContent = msg;
  document.body.appendChild(d); setTimeout(() => d.remove(), 2600);
}
/* Placeholders stay visible as [name] when there is no contact in
   context, so a script reads as a template rather than as broken prose.
   Once you open Prep on a real assignment they fill in properly. */
function scriptVars(aid, cid){
  const a = account(aid), c = contact(cid);
  return {
    name: c ? (c.name.split(" ")[0] || "[name]") : "[name]",
    me: person(me).name.split(" ")[0],
    service: S.config.dykFocus,
    programme: a?.buys?.[0] || "[programme]",
    city: a?.geo || "[city]",
    month: "[month]",
    country: a?.geo || "[region]",
    date: "[date sent]",
    quote: (S.testimonials[0]?.quote || "[testimonial]")
  };
}
function scriptBlock(label, lines, vars, copyable=true){
  const filled = lines.map(l => fill(l, vars));
  return `<div class="script">
    ${copyable ? `<span class="cp" onclick="OG.copyText(${JSON.stringify(JSON.stringify(filled.join("\n"))).replace(/"/g,"&quot;")})">copy</span>` : ""}
    <div class="l">${esc(label)}</div>
    ${filled.map(l => `<p>${esc(l)}</p>`).join("")}
  </div>`;
}

/* ===================== views ===================== */
function vWeek(){
  const mine = myAssign(), done = mine.filter(g => g.done).length;
  const acts = weekActions().filter(a => a.person === me);
  const p = person(me);
  return `
  <div class="head">
    <div><h1>My week</h1>
      <p>${esc(p.name)} · week of ${prettyWeek(week)}. ${esc(DOCTRINE.budget)}</p></div>
    <div class="sp"><button class="btn pri" onclick="OG.openLog()">Log an action</button></div>
  </div>

  <div class="tiles">
    <div class="tile"><div class="v">${done}<small>/${mine.length}</small></div><div class="k">Assignments done</div></div>
    <div class="tile"><div class="v">${acts.length}<small>/${p.target||"—"}</small></div><div class="k">Actions logged</div></div>
    <div class="tile"><div class="v">${streak(me)}w</div><div class="k">Your streak</div></div>
    <div class="tile"><div class="v txt">${esc(S.config.dykFocus)}</div><div class="k">This month's Did You Know</div></div>
  </div>

  <div class="split">
    <div>
      <div class="card"><h3>Assigned to you</h3><div class="pad">
        ${mine.length ? mine.map(g => {
          const a = account(g.account), c = contact(g.contact);
          return `<div class="asg ${g.done?"done":""}">
            <input type="checkbox" ${g.done?"checked":""} onchange="OG.toggleAsg('${g.id}')">
            <div style="flex:1;min-width:0">
              <div class="w2"><b>${esc(acode(g.code).short)}</b> · ${esc(c?c.name:"—")}
                <span class="muted">at ${esc(a?a.name:"—")}</span></div>
              <div class="sm muted" style="margin-top:3px">${esc(g.note)}</div>
            </div>
            <button class="btn sm" onclick="OG.openPrep('${g.id}')">Prep</button>
            <button class="btn sm" onclick="OG.openLog('${g.account}','${g.contact||""}','${g.code}','${g.id}')">Log</button>
          </div>`;
        }).join("") : `<div class="empty">Nothing assigned yet. Your manager sets these on Monday.</div>`}
      </div></div>

      <div class="card"><h3>Logged this week</h3>
        ${acts.length ? `<table><tbody>${acts.map(a => `
          <tr><td class="dt">${esc(a.date.slice(5))}</td>
          <td style="width:86px"><span class="pill p-blue">${esc(acode(a.code).short)}</span></td>
          <td>${esc(account(a.account)?.name||"")}${a.note?`<div class="xs muted">${esc(a.note)}</div>`:""}</td>
          <td class="n xs">${a.opp?'<span class="pill p-good">opp</span> ':""}${a.value?money(a.value):""}</td>
          <td class="n"><button class="btn sm" onclick="OG.delAction('${a.id}')">×</button></td></tr>`).join("")}
        </tbody></table>` : `<div class="empty">Nothing logged yet this week.</div>`}
      </div>
    </div>

    <div>
      <div class="card"><h3>The rule</h3><div class="pad sm">
        <p style="margin-bottom:8px"><b>"What else?"</b> <span class="muted">— reverse Did You Know</span></p>
        <p style="margin-bottom:10px"><b>"When?"</b> <span class="muted">— pivot to sale, or to the next conversation</span></p>
        <p class="muted">${esc(DOCTRINE.rule.split(". ").slice(1).join(". "))}</p>
      </div></div>
      <div class="card"><h3>Stack your actions</h3>
        <div class="pad sm muted">${esc(DOCTRINE.stacking)}</div></div>
      <div class="card"><h3>Need the words?</h3><div class="pad sm">
        <p class="muted" style="margin-bottom:9px">Every script, objection response and template is in the Playbook.</p>
        <button class="btn sm" onclick="OG.go('playbook')">Open the Playbook</button>
      </div></div>
    </div>
  </div>`;
}

/* Ten lists don't fit a flat tab bar, so group them the way they're
   actually used: pipeline work, wallet-share work, decay work. */
function listTabs(active){
  const grp = g => LISTS.filter(l => l.group === g).map(l =>
    `<button class="${l.id===active?"on":""}" onclick="OG.setList('${l.id}')">${esc(SHORT[l.id])}
      <span class="faint">${listAccounts(l.id).length}</span></button>`).join("");
  return `<div class="tabs">
    <span class="tabsep">Pipeline</span>${grp("Pipeline")}
    <span class="tabsep">Wallet share</span>${grp("Wallet share")}
    <span class="tabsep">Decay</span>${grp("Decay")}
    <span class="tabsep"></span>
    <button class="${active==="_signals"?"on":""}" onclick="OG.setList('_signals')">⚡ Signals</button>
  </div>`;
}

function vLists(){
  const lid = sel.list;
  if (lid === "_signals") return vSignals();
  const L = listById(lid) || LISTS[0], accts = listAccounts(lid);
  return `
  <div class="head">
    <div><h1>Lists</h1><p>Lists exist so a manager can be prescriptive. "Make some proactive calls"
      produces nothing; "call these four named people" produces swings.</p></div>
    <div class="sp"><button class="btn" onclick="OG.openAccount()">Add account</button></div>
  </div>
  ${listTabs(lid)}
  <p class="sm muted" style="margin:-4px 0 14px"><b>${esc(L.name)}.</b> ${esc(L.blurb)}</p>
  <div class="split">
    <div>
      <div class="card">
        ${accts.length ? `<table><thead><tr><th>Account</th><th>Owner</th><th>Buys today</th>
        <th>Competitors inside</th><th class="n">Our share</th><th class="n">Last touch</th><th class="n">Contacts</th></tr></thead>
        <tbody>${accts.map(a => {
          const g = gapPct(a), d = daysSince(a.lastTouch);
          return `<tr class="hov" onclick="OG.openAcct('${a.id}')">
            <td><b>${esc(a.name)}</b><div class="xs muted">${esc(a.segment)} · ${esc(a.geo)}</div></td>
            <td class="sm">${esc(person(a.owner).name)}</td>
            <td><div class="chips">${a.buys.map(b=>`<span class="pill p-gray">${esc(b)}</span>`).join("")}</div></td>
            <td><div class="chips">${a.competitors.length?a.competitors.map(c=>`<span class="pill p-bad">${esc(c)}</span>`).join(""):'<span class="faint xs">none known</span>'}</div></td>
            <td class="n">${g!==null?`<b>${g}%</b><div class="xs muted">${money(a.billing)}/${money(a.engBudget)}</div>`:"—"}</td>
            <td class="n">${d!==null?`<span class="pill ${d>60?"p-bad":d>30?"p-warn":"p-good"}">${d}d</span>`:"—"}</td>
            <td class="n sm">${acctContacts(a.id).length}</td></tr>`;
        }).join("")}</tbody></table>` : `<div class="empty">No accounts on this list.</div>`}
      </div>
    </div>
    <div>
      <div class="card"><h3>How to run this list</h3><div class="pad">
        <p class="sm muted" style="margin-bottom:11px">${esc(L.approach)}</p>
        ${scriptBlock("Opener", [L.opener], scriptVars())}
        ${scriptBlock("Then ask", L.then, scriptVars())}
        ${scriptBlock("Pivot", [L.pivot], scriptVars())}
        ${scriptBlock("If you get voicemail", [L.voicemail], scriptVars())}
        ${scriptBlock("Text straight after", [L.text], scriptVars())}
      </div></div>
    </div>
  </div>`;
}

function vSignals(){
  const s = signals();
  return `
  <div class="head"><div><h1>Signals</h1>
    <p>Cross-account gaps that are invisible when you're looking at one account at a time.</p></div></div>
  ${listTabs("_signals")}

  <div class="card"><h3>Never contacted <span class="rt">${s.neverContacted.length} people</span></h3>
    ${s.neverContacted.length ? `<table><thead><tr><th>Person</th><th>Account</th><th>Buying role</th>
    <th>Influence</th><th class="n"></th></tr></thead><tbody>
    ${s.neverContacted.map(({a,c}) => `<tr class="hov" onclick="OG.openContact('${c.id}')">
      <td><b>${esc(c.name)}</b><div class="xs muted">${esc(c.title)}</div></td>
      <td class="sm">${esc(a.name)}</td>
      <td><span class="pill ${c.role==="Economic"?"p-bad":"p-blue"}">${esc(c.role)}</span></td>
      <td class="sm">${esc(c.influence)}</td>
      <td class="n"><button class="btn sm" onclick="event.stopPropagation();OG.openAssign('','${a.id}','${c.id}','OG4.1')">Assign</button></td>
    </tr>`).join("")}</tbody></table>` : `<div class="empty">Everyone mapped has been contacted.</div>`}
    <div class="pad xs muted" style="border-top:1px solid var(--rule2)">An Economic buyer nobody has ever
      spoken to is the single biggest gap an account can have — they hold the budget on work we are already quoting for.</div>
  </div>

  <div class="split3">
    <div class="card"><h3>Single-threaded accounts <span class="rt">&lt;3 contacts</span></h3>
      ${s.singleThreaded.length ? `<table><tbody>${s.singleThreaded.map(a=>`
        <tr class="hov" onclick="OG.openAcct('${a.id}')"><td><b>${esc(a.name)}</b>
        <div class="xs muted">${esc(person(a.owner).name)}</div></td>
        <td class="n"><span class="pill p-warn">${acctContacts(a.id).length} mapped</span></td></tr>`).join("")}
      </tbody></table>` : `<div class="empty">None.</div>`}
      <div class="pad xs muted" style="border-top:1px solid var(--rule2)">Acsia's own ICP work found roughly
        thirty buying-committee contacts per qualified account. Two mapped contacts is not coverage — it's exposure.</div>
    </div>

    <div class="card"><h3>Lowest wallet share</h3>
      <table><tbody>${s.lowShare.slice(0,8).map(a=>`
        <tr class="hov" onclick="OG.openAcct('${a.id}')"><td><b>${esc(a.name)}</b>
        <div class="xs muted">${money(a.billing)} of ${money(a.engBudget)}</div></td>
        <td class="n"><b>${gapPct(a)}%</b></td>
        <td style="width:80px"><div class="bar"><i style="width:${Math.min(100,gapPct(a))}%"></i></div></td></tr>`).join("")}
      </tbody></table>
      <div class="pad xs muted" style="border-top:1px solid var(--rule2)">Sorted worst first, which is the
        priority order. This number is the fastest way to break the "we already own this account" belief.</div>
    </div>
  </div>

  <div class="card"><h3>Not run here — ${esc(EXCLUDED_LIST.name)}</h3><div class="pad sm muted">
    ${esc(EXCLUDED_LIST.why)}</div></div>`;
}

function vAccount(){
  const a = account(sel.account);
  if (!a) { view = "lists"; return vLists(); }
  const cs = acctContacts(a.id), acts = acctActions(a.id), g = gapPct(a), d = daysSince(a.lastTouch);
  const dyk = dykFor(a.buys);
  const chan = CHANNEL_MATRIX.find(c => c.geo === a.geo);
  return `
  <div class="head">
    <div><a class="xs" onclick="OG.go('lists')">&larr; Lists</a>
      <h1 style="margin-top:4px">${esc(a.name)}</h1>
      <p>${esc(a.segment)} · ${esc(a.geo)} · owned by ${esc(person(a.owner).name)}</p></div>
    <div class="sp">
      <button class="btn" onclick="OG.openAccount('${a.id}')">Edit</button>
      <button class="btn" onclick="OG.openContact('','${a.id}')">Add contact</button>
      <button class="btn pri" onclick="OG.openLog('${a.id}')">Log an action</button></div>
  </div>

  <div class="tiles">
    <div class="tile"><div class="v">${g!==null?g+"%":"—"}</div><div class="k">Est. share of their spend</div></div>
    <div class="tile"><div class="v">${cs.length}</div><div class="k">Contacts mapped</div></div>
    <div class="tile"><div class="v">${d!==null?d+"d":"—"}</div><div class="k">Since last touch</div></div>
    <div class="tile"><div class="v">${acts.length}</div><div class="k">Actions logged</div></div>
  </div>

  ${cs.length < 3 ? `<div class="note warn"><b>Single-threaded.</b> ${cs.length} contact${cs.length===1?"":"s"} mapped
    against a buying committee that is typically thirty people. One relationship away from being displaced quietly.</div>` : ""}

  <div class="split">
    <div>
      <div class="card"><h3>Contacts</h3>
        ${cs.length ? `<table><thead><tr><th>Name</th><th>Buying role</th><th>Influence</th>
        <th>Relationship</th><th class="n">Last touch</th></tr></thead><tbody>
        ${cs.map(c => { const cd = daysSince(c.lastTouch); return `
          <tr class="hov" onclick="OG.openContact('${c.id}')">
            <td><b>${esc(c.name)}</b><div class="xs muted">${esc(c.title)}</div></td>
            <td><span class="pill ${c.role==="Economic"?"p-warn":"p-blue"}">${esc(c.role)}</span></td>
            <td class="sm">${esc(c.influence)}</td><td class="sm">${esc(c.rel)}</td>
            <td class="n">${cd!==null?cd+"d":'<span class="pill p-bad">never</span>'}</td></tr>`;
        }).join("")}</tbody></table>` : `<div class="empty">No contacts yet.</div>`}
      </div>

      <div class="card"><h3>Action history</h3>
        ${acts.length ? `<table><tbody>${acts.map(x=>`
          <tr><td class="dt">${esc(x.date)}</td>
          <td style="width:88px"><span class="pill p-blue">${esc(acode(x.code).short)}</span></td>
          <td class="sm">${esc(person(x.person).name)}${x.contact?` <span class="muted">→ ${esc(contact(x.contact)?.name||"")}</span>`:""}
            ${x.note?`<div class="xs muted">${esc(x.note)}</div>`:""}</td>
          <td class="n xs">${x.opp?'<span class="pill p-good">opp</span> ':""}${x.value?money(x.value):""}</td></tr>`).join("")}
        </tbody></table>` : `<div class="empty">Nothing logged yet.</div>`}
      </div>
    </div>

    <div>
      <div class="card"><h3>Did You Know candidates</h3><div class="pad">
        ${dyk.length ? `<div class="chips" style="margin-bottom:9px">
          ${dyk.map(s=>`<span class="pill p-blue">${esc(s)}</span>`).join("")}</div>
          <p class="xs muted">Derived from what they buy today. Give the person three, not eleven —
          eleven options produces paralysis.</p>` : `<p class="sm muted">They buy across our range. Focus on volume and more buyers.</p>`}
      </div></div>

      ${a.competitors.length ? `<div class="card"><h3>Whose work you're displacing</h3><div class="pad">
        <div class="chips" style="margin-bottom:8px">${a.competitors.map(c=>`<span class="pill p-bad">${esc(c)}</span>`).join("")}</div>
        <p class="xs muted">Have this in front of you when you ask the reverse Did You Know.</p></div></div>` : ""}

      ${chan ? `<div class="card"><h3>Contacting ${esc(a.geo)}</h3><div class="pad sm">
        <dl class="kv"><dt>Primary</dt><dd>${esc(chan.primary)}</dd>
        <dt>Follow-up</dt><dd>${esc(chan.follow)}</dd>
        ${chan.avoid!=="—"?`<dt>Avoid</dt><dd>${esc(chan.avoid)}</dd>`:""}</dl></div></div>` : ""}

      <div class="card"><h3>On these lists</h3><div class="pad">
        <div class="chips">${a.lists.map(l=>`<span class="pill p-gray">${esc(listById(l)?.name||l)}</span>`).join("")||'<span class="faint xs">none</span>'}</div>
      </div></div>
      <div class="card"><h3>Notes</h3><div class="pad sm">${esc(a.note)||'<span class="faint">—</span>'}</div></div>
    </div>
  </div>`;
}

function vAssign(){
  const suggestions = suggest();
  return `
  <div class="head">
    <div><h1>Assign</h1><p>Specific quantities, specific actions, specific named people.
      An assignment that requires a decision at 9am Monday is a decision to skip.</p></div>
    <div class="sp">
      <button class="btn" onclick="OG.shiftWeek(-1)">‹</button>
      <button class="btn" onclick="OG.shiftWeek(1)">›</button>
      <button class="btn pri" onclick="OG.openAssign()">Add assignment</button></div>
  </div>

  ${!gateOpen() ? `<div class="gate">
    <b>Happy Customer Interviews aren't done yet — ${interviewsDone()} of ${S.config.interviewTarget}.</b>
    <p>The method treats these as a prerequisite, not a nice-to-have. Delivery engineers won't make a
    commercial ask until they've heard a real customer say, unprompted, that they want more from Acsia.
    Skipping this is the most common single cause of failure. You can still assign — but if participation
    stalls in week three, this is why.</p>
    <p style="margin-top:7px"><a onclick="OG.go('interviews')">Go to Interviews →</a></p>
  </div>` : ""}

  <div class="card"><h3>Week of ${prettyWeek(week)}
    <span class="rt">${weekAssign().length} assigned · ${weekActions().length} logged</span></h3>
    <table><thead><tr><th>Person</th><th class="n">Target</th><th class="n">Assigned</th>
    <th class="n">Done</th><th class="n">Logged</th><th>Progress</th><th class="n"></th></tr></thead><tbody>
    ${S.people.map(p => {
      const asg = myAssign(p.id), dn = asg.filter(g=>g.done).length;
      const lg = weekActions().filter(a=>a.person===p.id).length;
      const pct = p.target ? Math.min(100, Math.round(lg/p.target*100)) : 0;
      return `<tr>
        <td><b>${esc(p.name)}</b><div class="xs muted">${esc(p.role)}</div></td>
        <td class="n">${p.target}</td><td class="n">${asg.length}</td><td class="n">${dn}</td>
        <td class="n"><b>${lg}</b></td>
        <td style="width:120px"><div class="bar"><i style="width:${pct}%;background:${pct>=100?"var(--good)":"var(--accent)"}"></i></div></td>
        <td class="n"><button class="btn sm" onclick="OG.openAssign('${p.id}')">Assign</button></td></tr>`;
    }).join("")}</tbody></table>
  </div>

  ${suggestions.length ? `<div class="card"><h3>Suggested this week
    <span class="rt">derived from the lists — edit before sending</span></h3>
    <table><tbody>${suggestions.map((s,i)=>`<tr>
      <td class="sm">${esc(person(s.person).name)}</td>
      <td style="width:88px"><span class="pill p-blue">${esc(acode(s.code).short)}</span></td>
      <td class="sm">${esc(contact(s.contact)?.name || account(s.account)?.name || "")}
        <div class="xs muted">${esc(s.note)}</div></td>
      <td class="n"><button class="btn sm" onclick="OG.acceptSuggestion(${i})">Accept</button></td>
    </tr>`).join("")}</tbody></table>
    <div class="pad"><button class="btn" onclick="OG.acceptAll()">Accept all ${suggestions.length}</button></div>
  </div>` : ""}

  <div class="card"><h3>Assigned</h3>
    ${weekAssign().length ? `<table><thead><tr><th>Person</th><th>Action</th><th>Who</th><th>Why</th><th class="n"></th></tr></thead><tbody>
    ${weekAssign().map(g=>`<tr>
      <td class="sm">${esc(person(g.person).name)}</td>
      <td><span class="pill p-blue">${esc(acode(g.code).short)}</span></td>
      <td class="sm">${esc(contact(g.contact)?.name||"—")}<div class="xs muted">${esc(account(g.account)?.name||"")}</div></td>
      <td class="sm muted">${esc(g.note)}</td>
      <td class="n">${g.done?'<span class="pill p-good">done</span>':'<span class="pill p-gray">open</span>'}
        <button class="btn sm" style="margin-left:6px" onclick="OG.delAssign('${g.id}')">×</button></td>
    </tr>`).join("")}</tbody></table>` : `<div class="empty">Nothing assigned for this week.</div>`}
  </div>`;
}

/* Mechanical suggestion rules. The Outgrow leader edits; the tool does
   the tedious part, because the loop breaks at whichever step costs the
   most effort and hand-typing twenty assignments is that step. */
function suggest(){
  const existing = new Set(weekAssign().map(g => g.account + g.code));
  const out = [];
  const push = (acc, code, note, cid) => {
    if (existing.has(acc.id + code) || out.some(o => o.account===acc.id && o.code===code)) return;
    const c = cid || acctContacts(acc.id)[0]?.id || "";
    out.push({ person:acc.owner, account:acc.id, contact:c, code, note });
  };
  listAccounts("quotes").forEach(a =>
    push(a, "OG2.1", `Proposal outstanding. Push for a decision date.`));
  listAccounts("prequote").forEach(a =>
    push(a, "OG2.2", `Opportunity open, nothing sent. Get what you need to write the proposal.`));
  listAccounts("stopped").forEach(a =>
    push(a, "OG1.2", `Used to buy, stopped. One honest call — what happened?`));
  listAccounts("autopilot").forEach(a =>
    push(a, "OG1.1", `Flat spend for months. Nothing is wrong, which is the problem — disrupt the automation.`));
  S.accounts.filter(a => (daysSince(a.lastTouch) ?? 0) > 30).forEach(a =>
    push(a, "OG1.2", `${daysSince(a.lastTouch)} days silent. No agenda — find out what's changed.`));
  signals().neverContacted.filter(x => x.c.role === "Economic").forEach(({a,c}) =>
    push(a, "OG4.1", `${c.name} holds budget and has never been contacted. Ask for an introduction.`, c.id));
  signals().lowShare.slice(0,3).forEach(a =>
    push(a, "OG3.1", `We hold ~${gapPct(a)}% of their external engineering spend. Ask what it would take to do more.`));
  return out.slice(0, 10);
}

function vScore(){
  const wk = weekActions(), part = participation();
  const opps = wk.filter(a=>a.opp).length, value = wk.reduce((s,a)=>s+(a.value||0),0);
  const byPerson = S.people.map(p => ({ p, n:wk.filter(a=>a.person===p.id).length, s:streak(p.id) }))
    .sort((a,b) => b.n - a.n);
  const mix = {}, svc = {};
  wk.forEach(a => { mix[a.code] = (mix[a.code]||0)+1; if (a.service) svc[a.service] = (svc[a.service]||0)+1; });
  const weeks = [...Array(8)].map((_,i) => {
    const w = addWeeks(week, i-7);
    return { w, n:S.actions.filter(a => mondayOf(a.date) === w).length };
  });
  const peak = Math.max(...weeks.map(x=>x.n), 1);
  const rows = o => {
    const e = Object.entries(o).sort((a,b)=>b[1]-a[1]); const mx = e[0]?.[1] || 1;
    return e.length ? e.map(([k,v]) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">
      <span class="sm" style="flex:0 0 195px">${esc(acode(k).label!==k?acode(k).label:k)}</span>
      <span class="bar" style="flex:1"><i style="width:${v/mx*100}%"></i></span>
      <span class="xs muted" style="flex:0 0 20px;text-align:right">${v}</span></div>`).join("")
      : `<p class="empty">Nothing logged.</p>`;
  };
  /* μ — actions per opportunity, by action type. This is the week-12
     deliverable, and it needs volume before it means anything. */
  const mu = {};
  ACTIONS.forEach(a => {
    const all = S.actions.filter(x => x.code === a.code);
    if (all.length >= 5) mu[a.code] = { n:all.length, o:all.filter(x=>x.opp).length };
  });

  return `
  <div class="head">
    <div><h1>Scorecard</h1><p>${esc(DOCTRINE.patience)}</p></div>
    <div class="sp">
      <button class="btn" onclick="OG.shiftWeek(-1)">‹</button>
      <button class="btn" onclick="OG.shiftWeek(1)">›</button>
      <button class="btn" onclick="window.print()">Print</button></div>
  </div>

  <div class="tiles">
    <div class="tile"><div class="v">${wk.length}</div><div class="k">Proactive actions</div></div>
    <div class="tile"><div class="v">${part}%</div><div class="k">Participation</div></div>
    <div class="tile"><div class="v">${byPerson.filter(x=>x.n).length}<small>/${S.people.length}</small></div><div class="k">People swinging</div></div>
    <div class="tile"><div class="v">${opps}</div><div class="k">Opportunities surfaced</div></div>
    <div class="tile"><div class="v">${money(value)}</div><div class="k">Est. value *</div></div>
  </div>

  ${part < 60 ? `<div class="note warn"><b>Participation is below 60%.</b> Before adding pressure to the team,
    check the leadership signals: has ${esc(S.config.sponsor)} mentioned Outgrow in the last two days, attended
    the last huddle, and written commentary on the last scorecard? The diagnostic says look there first.</div>` : ""}

  ${S.config.commentary ? `<div class="card" style="border-left:3px solid var(--accent)"><div class="pad">
    <div class="xs faint" style="text-transform:uppercase;letter-spacing:.07em;font-weight:600;margin-bottom:4px">From ${esc(S.config.sponsor)}</div>
    <div>${esc(S.config.commentary)}</div></div></div>` : ""}

  <div class="card"><h3>Actions per week</h3><div class="pad">
    <div style="display:flex;align-items:flex-end;gap:8px;height:118px">
      ${weeks.map((x,i)=>`<div style="flex:1;text-align:center">
        <div class="xs muted" style="margin-bottom:4px">${x.n}</div>
        <div style="height:${Math.max(3, x.n/peak*78)}px;background:var(--accent);opacity:${i===7?1:.4};border-radius:3px"></div>
        <div class="xs faint" style="margin-top:5px">${new Date(x.w).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</div>
      </div>`).join("")}
    </div></div></div>

  <div class="split">
    <div class="card"><h3>By person</h3><table><thead><tr><th></th><th>Name</th>
      <th class="n">Actions</th><th class="n">vs target</th><th class="n">Streak</th></tr></thead><tbody>
      ${byPerson.map((x,i)=>`<tr style="${x.n?"":"opacity:.45"}">
        <td class="faint" style="width:24px">${i+1}</td>
        <td><b>${esc(x.p.name)}</b><div class="xs muted">${esc(x.p.role)}</div></td>
        <td class="n"><b>${x.n}</b></td>
        <td class="n sm">${x.p.target?Math.round(x.n/x.p.target*100)+"%":"—"}</td>
        <td class="n sm">${x.s}w</td></tr>`).join("")}
    </tbody></table></div>
    <div>
      <div class="card"><h3>Action mix</h3><div class="pad">${rows(mix)}</div></div>
      <div class="card"><h3>Service discussed</h3><div class="pad">${rows(svc)}</div></div>
    </div>
  </div>

  <div class="card"><h3>Conversion — actions per opportunity
    <span class="rt">needs volume; first read at week 12</span></h3>
    ${Object.keys(mu).length ? `<table><thead><tr><th>Action</th><th class="n">Logged</th>
      <th class="n">Opportunities</th><th class="n">Actions per opp</th></tr></thead><tbody>
      ${Object.entries(mu).map(([c,m])=>`<tr><td class="sm">${esc(acode(c).label)}</td>
      <td class="n">${m.n}</td><td class="n">${m.o}</td>
      <td class="n"><b>${m.o?(m.n/m.o).toFixed(1):"—"}</b></td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">Not enough volume yet. An action type needs five logged
      instances before this shows anything, and the number isn't trustworthy until week 26.</div>`}
    <div class="pad xs muted" style="border-top:1px solid var(--rule2)">These are Acsia's own measured rates.
      Published figures from distribution businesses (20% DYK, 80% rDYK) do not transfer to 9–18 month
      automotive cycles and are deliberately not used anywhere in this tool.</div>
  </div>

  <p class="xs faint">* Estimated value is self-reported by the person logging and is not a forecast.</p>`;
}

/* ---------- Playbook: everything in one place ---------- */
function vPlaybook(){
  const t = sel.pbTab;
  const tabs = [["scripts","Action scripts"],["call","The call"],["lists","By list"],
    ["objections","Objections"],["channels","Channels"],["dyk","Cross-sell map"],
    ["card","Prompt card"],["cadence","Cadence"],["doctrine","Doctrine"]];
  return `
  <div class="head"><div><h1>Playbook</h1>
    <p>Every script, response and template. Also surfaced inside the log and prep screens, so nobody
    has to remember this page exists at the moment they need it.</p></div>
    <div class="sp"><button class="btn" onclick="window.print()">Print</button></div></div>
  <div class="tabs">${tabs.map(([k,l]) =>
    `<button class="${t===k?"on":""}" onclick="OG.setPb('${k}')">${esc(l)}</button>`).join("")}</div>
  ${({
    scripts: () => ACTIONS.map(a => `<div class="card"><h3>${esc(a.label)}
        <span class="rt">${esc(a.code)}</span></h3><div class="pad">
        <p class="sm" style="margin-bottom:10px"><b>Purpose.</b> ${esc(a.purpose)}</p>
        ${scriptBlock("Say", a.scripts, scriptVars())}
        <p class="xs muted" style="margin-top:9px">${esc(a.note)}</p></div></div>`).join(""),

    call: () => `${CALL_STRUCTURE.map(c => `<div class="card"><h3>${esc(c.part)}</h3><div class="pad">
        ${scriptBlock("Say", c.body, scriptVars())}
        <p class="xs muted" style="margin-top:9px">${esc(c.why)}</p></div></div>`).join("")}
      <div class="card"><h3>Voicemail protocol</h3><div class="pad">
        <ul class="tick">${VOICEMAIL.rules.map(r=>`<li>${esc(r)}</li>`).join("")}</ul>
        <p class="xs muted" style="margin-top:10px">${esc(VOICEMAIL.why)}</p></div></div>`,

    lists: () => LISTS.map(l => `<div class="card"><h3>${esc(l.name)}</h3><div class="pad">
        <p class="sm muted" style="margin-bottom:11px">${esc(l.approach)}</p>
        ${scriptBlock("Opener",[l.opener],scriptVars())}
        ${scriptBlock("Then ask",l.then,scriptVars())}
        ${scriptBlock("Pivot",[l.pivot],scriptVars())}
        ${scriptBlock("Voicemail",[l.voicemail],scriptVars())}
        ${scriptBlock("Text straight after",[l.text],scriptVars())}</div></div>`).join(""),

    objections: () => `<div class="split3">
      <div class="card"><h3>From your own team</h3><div class="pad">
        ${OBJECTIONS_INTERNAL.map(o=>`<div class="qa"><b>"${esc(o.q)}"</b><span>${esc(o.a)}</span></div>`).join("")}
      </div></div>
      <div class="card"><h3>From the customer</h3><div class="pad">
        ${OBJECTIONS_CUSTOMER.map(o=>`<div class="qa"><b>"${esc(o.q)}"</b><span>${esc(o.a)}</span></div>`).join("")}
      </div></div></div>`,

    channels: () => `<div class="card"><h3>Channel by geography</h3>
        <table><thead><tr><th>Geography</th><th>Primary</th><th>Follow-up</th><th>Avoid</th></tr></thead><tbody>
        ${CHANNEL_MATRIX.map(c=>`<tr><td><b>${esc(c.geo)}</b></td><td class="sm">${esc(c.primary)}</td>
        <td class="sm">${esc(c.follow)}</td><td class="sm muted">${esc(c.avoid)}</td></tr>`).join("")}
        </tbody></table></div>
      <div class="card"><h3>Two rules regardless of geography</h3><div class="pad">
        <ul class="tick">${CHANNEL_RULES.map(r=>`<li>${esc(r)}</li>`).join("")}</ul></div></div>`,

    dyk: () => `<div class="card"><h3>If they already buy… suggest</h3>
        <table><thead><tr><th>Buys today</th><th>Did You Know candidates</th><th>Why it's adjacent</th></tr></thead><tbody>
        ${DYK_MAP.map(m=>`<tr><td><b>${m.has==="*"?"Anything at all":esc(m.has)}</b></td>
        <td><div class="chips">${m.suggest.map(s=>`<span class="pill p-blue">${esc(s)}</span>`).join("")}</div></td>
        <td class="sm muted">${esc(m.why)}</td></tr>`).join("")}</tbody></table></div>`,

    card: () => `<div class="split3">
      <div class="card"><h3>Pocket card — print and hand out</h3><div class="pad">
        <p style="font-weight:600;margin-bottom:12px">${esc(PROMPT_CARD.title)}</p>
        <p class="sm muted" style="margin-bottom:6px">In any customer conversation, ask ONE:</p>
        ${scriptBlock("Ask", PROMPT_CARD.ask, scriptVars())}
        ${scriptBlock("Before you leave", [PROMPT_CARD.before], scriptVars())}
        <p class="sm" style="margin-top:10px"><b>This month:</b> ${esc(S.config.dykFocus)}</p>
        <p class="xs muted" style="margin-top:9px">${esc(PROMPT_CARD.after)}</p></div></div>
      <div class="card"><h3>Six-month DYK rotation</h3>
        <table><tbody>${PROMPT_CARD.rotation.map(r=>`<tr><td class="sm muted" style="width:64px">${esc(r.m)}</td>
        <td><b>${esc(r.focus)}</b><div class="xs muted">${esc(r.fit)}</div></td></tr>`).join("")}</tbody></table>
        <div class="pad xs muted" style="border-top:1px solid var(--rule2)">Rotate monthly, set at the first
        huddle of the month. Rotating weekly makes it noise; never rotating makes it wallpaper.</div></div>
      </div>`,

    cadence: () => `${CADENCE.map(c=>`<div class="card"><h3>${esc(c.title)}<span class="rt">${esc(c.who)}</span></h3>
        <div class="pad"><ul class="tick">${c.items.map(i=>`<li>${esc(i)}</li>`).join("")}</ul>
        <p class="xs muted" style="margin-top:10px">${esc(c.why)}</p></div></div>`).join("")}
      <div class="card"><h3>What the sponsor actually does</h3>
        <table><tbody>${CEO_DUTIES.map(d=>`<tr><td><b>${esc(d.d)}</b></td>
        <td class="sm muted">${esc(d.n)}</td></tr>`).join("")}</tbody></table>
        <div class="pad xs muted" style="border-top:1px solid var(--rule2)">If the sponsor does these five
        things the programme works. If they endorse it and delegate all five, participation sags by about
        week six — and the diagnosis is not team laziness.</div></div>`,

    doctrine: () => `<div class="card"><h3>The doctrine</h3><div class="pad">
        <dl class="kv">
        <dt>Mantra</dt><dd><b>${esc(DOCTRINE.mantra)}</b></dd>
        <dt>Swings, not hits</dt><dd>${esc(DOCTRINE.swings)}</dd>
        <dt>The rule</dt><dd>${esc(DOCTRINE.rule)}</dd>
        <dt>Time budget</dt><dd>${esc(DOCTRINE.budget)}</dd>
        <dt>Stacking</dt><dd>${esc(DOCTRINE.stacking)}</dd>
        <dt>Patience</dt><dd>${esc(DOCTRINE.patience)}</dd>
        </dl></div></div>`
  }[t] || (()=>""))()}`;
}

function vTestimonials(){
  return `
  <div class="head"><div><h1>Testimonials</h1>
    <p>Harvested from Happy Customer Interviews. These are what the "Testimonial Shared" action draws on —
    a happy customer persuades better than any of us can.</p></div>
    <div class="sp"><button class="btn pri" onclick="OG.openTesti()">Add testimonial</button></div></div>
  ${S.testimonials.length ? S.testimonials.map(t => `
    <div class="card"><div class="pad">
      <div class="quote"><p>"${esc(t.quote)}"</p>
        <div class="src">${esc(t.who)}${t.account?` · ${esc(account(t.account)?.name||"")}`:""}</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        ${t.theme?`<span class="pill p-blue">${esc(t.theme)}</span>`:""}
        <span class="xs muted">used ${t.used||0}×</span>
        <span style="margin-left:auto"></span>
        <button class="btn sm" onclick="OG.copyText(${JSON.stringify(JSON.stringify(t.quote)).replace(/"/g,"&quot;")})">Copy</button>
        <button class="btn sm" onclick="OG.useTesti('${t.id}')">Mark used</button>
        <button class="btn sm" onclick="OG.delTesti('${t.id}')">×</button>
      </div></div></div>`).join("")
    : `<div class="card"><div class="empty">No testimonials yet. They come out of the interviews —
       every "how does that help you?" answer is a candidate.</div></div>`}`;
}

function vInterviews(){
  const done = interviewsDone(), target = S.config.interviewTarget || 8;
  return `
  <div class="head"><div><h1>Happy Customer Interviews</h1>
    <p>${esc(INTERVIEW.purpose)}</p></div>
    <div class="sp"><button class="btn pri" onclick="OG.openInterview()">Add interview</button></div></div>

  <div class="tiles">
    <div class="tile"><div class="v">${done}<small>/${target}</small></div><div class="k">Completed</div></div>
    <div class="tile"><div class="v">${S.testimonials.length}</div><div class="k">Testimonials harvested</div></div>
    <div class="tile"><div class="v txt">${gateOpen()?"Ready":"Not yet"}</div><div class="k">Cleared to start assigning</div></div>
  </div>

  ${!gateOpen() ? `<div class="note bad"><b>${target-done} more before week one.</b>
    This is the step that converts fear into confidence. Delivery engineers won't make a commercial ask
    until they've heard a customer say, unprompted, that they want more from Acsia — and playing them
    a recording does more in eleven seconds than any amount of training.</div>`
    : `<div class="note info"><b>Prerequisite met.</b> Play clips in the Monday huddle, especially any moment
    where a customer says they'd have bought more or didn't know Acsia offered something.</div>`}

  <div class="split">
    <div>
      <div class="card"><h3>Interviews</h3>
        ${S.interviews.length ? `<table><thead><tr><th>Customer</th><th>Interviewer</th>
        <th class="n">Date</th><th class="n">Quotes</th><th class="n"></th></tr></thead><tbody>
        ${S.interviews.map(i=>`<tr>
          <td><b>${esc(i.who)}</b><div class="xs muted">${esc(account(i.account)?.name||"")}</div></td>
          <td class="sm">${esc(i.interviewer)}</td>
          <td class="n sm">${i.date?esc(i.date):'<span class="pill p-gray">not booked</span>'}</td>
          <td class="n sm">${(i.quotes||[]).length}</td>
          <td class="n">${i.done?'<span class="pill p-good">done</span>':'<span class="pill p-warn">open</span>'}
            <button class="btn sm" style="margin-left:6px" onclick="OG.openInterview('${i.id}')">Open</button></td>
        </tr>`).join("")}</tbody></table>` : `<div class="empty">None scheduled yet.</div>`}
      </div>

      <div class="card"><h3>Never ask this</h3><div class="pad">
        <p style="font-weight:600;color:var(--bad);margin-bottom:5px">"${esc(INTERVIEW.never.q)}"</p>
        <p class="sm muted">${esc(INTERVIEW.never.why)}</p></div></div>
    </div>

    <div>
      <div class="card"><h3>The call</h3><div class="pad">
        <p class="sm" style="margin-bottom:10px"><b>The rule.</b> ${esc(INTERVIEW.rule)}</p>
        ${scriptBlock("Booking it",[INTERVIEW.setup],{})}
        ${scriptBlock("Consent",[INTERVIEW.consent],{})}
        <div class="l xs faint" style="text-transform:uppercase;letter-spacing:.07em;font-weight:600;margin:14px 0 7px">Questions, in order</div>
        ${INTERVIEW.questions.map((q,i)=>`<div class="qa">
          <b>${i+1}. ${esc(q.q)}${q.star?" ★":""}</b>
          ${q.note?`<span class="xs muted">${esc(q.note)}</span>`:""}</div>`).join("")}
        ${scriptBlock("Close",[INTERVIEW.close],{})}
      </div></div>

      <div class="card"><h3>Listen for</h3><div class="pad">
        <ul class="tick">${INTERVIEW.listenFor.map(l=>`<li>${esc(l)}</li>`).join("")}</ul></div></div>
      <div class="card"><h3>Same day, five minutes</h3><div class="pad">
        <ul class="tick">${INTERVIEW.after.map(l=>`<li>${esc(l)}</li>`).join("")}</ul></div></div>
    </div>
  </div>`;
}

function vSetup(){
  return `
  <div class="head"><div><h1>Setup</h1><p>Roster, targets, focus and data.</p></div>
    <div class="sp">
      <button class="btn" onclick="OG.exportJSON()">Export</button>
      <button class="btn" onclick="OG.importJSON()">Import</button>
      <button class="btn" onclick="OG.resetAll()">Reset</button></div></div>

  ${MODE === "local" ? `<div class="note warn"><b>Running on browser storage.</b> Data is saved on this
    device only, so the team scorecard reflects one person. Add Supabase credentials in
    <code>config.js</code> and redeploy to make it shared — schema is in <code>supabase/schema.sql</code>.</div>`
   : `<div class="note info"><b>Shared storage active.</b> Everyone writing to this deployment sees the same data.</div>`}

  <div class="split">
    <div class="card"><h3>Roster</h3>
      <table><thead><tr><th>Name</th><th>Role</th><th class="n">Weekly target</th><th class="n"></th></tr></thead><tbody>
      ${S.people.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td class="sm muted">${esc(p.role)}</td>
        <td class="n"><input class="f" style="width:62px;text-align:right;padding:3px 6px" type="number"
          value="${p.target}" onchange="OG.setTarget('${p.id}',this.value)"></td>
        <td class="n"><button class="btn sm" onclick="OG.delPerson('${p.id}')">×</button></td></tr>`).join("")}
      </tbody></table>
      <div class="pad"><button class="btn sm" onclick="OG.openPerson()">Add person</button>
        <p class="xs muted" style="margin-top:9px">Delivery staff 2–4 per week, folded into conversations
        already happening. AE and Pre-sales 8–20, since proactive contact is the job.</p></div>
    </div>

    <div class="card"><h3>This month</h3><div class="pad">
      <div class="fld"><label class="f">Did You Know focus</label>
        <select class="f" onchange="OG.setCfg('dykFocus',this.value)">
          ${SERVICES.map(s=>`<option ${s===S.config.dykFocus?"selected":""}>${esc(s)}</option>`).join("")}</select></div>
      <div class="fld"><label class="f">Executive sponsor</label>
        <input class="f" value="${esc(S.config.sponsor)}" onchange="OG.setCfg('sponsor',this.value)"></div>
      <div class="fld"><label class="f">Interviews required before assigning</label>
        <input class="f" type="number" value="${S.config.interviewTarget}" onchange="OG.setCfg('interviewTarget',Number(this.value))"></div>
      <div class="fld"><label class="f">Sponsor's scorecard commentary</label>
        <textarea class="f" onchange="OG.setCfg('commentary',this.value)">${esc(S.config.commentary)}</textarea>
        <p class="xs muted" style="margin-top:5px">Two sentences. Name two people. This converts a report into a signal.</p></div>
    </div></div>
  </div>`;
}

/* ===================== modals ===================== */
function mLog(){
  const m = modal, cs = m.aid ? acctContacts(m.aid) : [];
  const a = account(m.aid), act = acode(m.code);
  const lid = a?.lists?.[0] || "large";
  const L = listById(lid) || LISTS[0];
  const vars = scriptVars(m.aid, m.cid);
  const chan = a ? CHANNEL_MATRIX.find(c => c.geo === a.geo) : null;
  return `<div class="veil" onclick="if(event.target===this)OG.closeModal()"><div class="modal wide">
    <h2>Log an action</h2>
    <div class="body"><div class="split">
      <div>
        <p class="sm muted" style="margin-bottom:14px">Ninety seconds, three fields. Proactive only —
        an inbound request handled well is good work and not an Outgrow action.</p>
        <div class="row2">
          <div class="fld"><label class="f">Account</label>
            <select class="f" id="l_a" onchange="OG.setLogAcct(this.value)">
              <option value="">Select…</option>
              ${S.accounts.map(x=>`<option value="${x.id}" ${x.id===m.aid?"selected":""}>${esc(x.name)}</option>`).join("")}
            </select></div>
          <div class="fld"><label class="f">Contact</label>
            <select class="f" id="l_c" ${!m.aid?"disabled":""}><option value="">—</option>
              ${cs.map(c=>`<option value="${c.id}" ${c.id===m.cid?"selected":""}>${esc(c.name)}</option>`).join("")}
            </select></div>
        </div>
        <div class="fld"><label class="f">Action taken</label>
          <select class="f" id="l_code" onchange="OG.setLogCode(this.value)">
            ${ACTIONS.map(x=>`<option value="${x.code}" ${x.code===m.code?"selected":""}>${esc(x.label)}</option>`).join("")}
          </select></div>
        <div class="row3">
          <div class="fld"><label class="f">Service discussed</label>
            <select class="f" id="l_svc"><option value="">None / relationship only</option>
              ${SERVICES.map(s=>`<option ${s===S.config.dykFocus?"selected":""}>${esc(s)}</option>`).join("")}</select></div>
          <div class="fld"><label class="f">Est. value</label><input class="f" id="l_val" type="number" placeholder="0"></div>
          <div class="fld"><label class="f">Channel</label>
            <select class="f" id="l_ch">${CHANNELS.map(c=>`<option>${esc(c)}</option>`).join("")}</select></div>
        </div>
        <div class="fld"><label class="f">Note <span class="faint">optional</span></label>
          <textarea class="f" id="l_note" placeholder="What did they say?"></textarea></div>
        <div class="row2">
          <div class="fld"><label class="f">Who did it</label>
            <select class="f" id="l_person">
              ${S.people.map(p=>`<option value="${p.id}" ${p.id===me?"selected":""}>${esc(p.name)}</option>`).join("")}</select>
            <p class="xs muted" style="margin-top:4px">Managers: log on behalf of an engineer who texted you from the car.</p></div>
          <div class="fld" style="padding-top:22px">
            <label class="sm" style="display:flex;gap:7px;align-items:center">
              <input type="checkbox" id="l_opp"> This surfaced a real opportunity</label></div>
        </div>
      </div>

      <div>
        <div class="card"><h3>What to say</h3><div class="pad">
          ${scriptBlock(act.label, act.scripts.length?act.scripts:[act.purpose], vars)}
          ${m.code==="OG5.1" && S.testimonials.length ? `<div class="l xs faint" style="text-transform:uppercase;letter-spacing:.07em;font-weight:600;margin:12px 0 6px">Testimonials</div>
            ${S.testimonials.slice(0,3).map(t=>`<div class="quote"><p>"${esc(t.quote)}"</p>
              <div class="src">${esc(t.who)}</div></div>`).join("")}` : ""}
          <p class="xs muted">${esc(act.note||"")}</p>
        </div></div>
        ${a ? `<div class="card"><h3>${esc(a.name)}</h3><div class="pad sm">
          ${a.competitors.length?`<p style="margin-bottom:7px"><b>Inside the account:</b>
            <span class="chips" style="display:inline-flex">${a.competitors.map(c=>`<span class="pill p-bad">${esc(c)}</span>`).join("")}</span></p>`:""}
          ${chan?`<p class="muted"><b>${esc(a.geo)}:</b> ${esc(chan.primary)}${chan.avoid!=="—"?` · avoid ${esc(chan.avoid.toLowerCase())}`:""}</p>`:""}
          <p class="muted" style="margin-top:7px">${esc(L.approach)}</p>
        </div></div>` : ""}
      </div>
    </div></div>
    <div class="foot"><span class="xs faint" style="margin-right:auto">Logged by ${esc(person(me).name)}</span>
      <button class="btn" onclick="OG.closeModal()">Cancel</button>
      <button class="btn pri" onclick="OG.saveLog()">Log it</button></div>
  </div></div>`;
}

function mPrep(){
  const g = S.assignments.find(x => x.id === modal.gid);
  if (!g) return "";
  const a = account(g.account), c = contact(g.contact), act = acode(g.code);
  const lid = a?.lists?.[0] || "large", L = listById(lid) || LISTS[0];
  const vars = scriptVars(g.account, g.contact);
  const chan = a ? CHANNEL_MATRIX.find(x => x.geo === a.geo) : null;
  return `<div class="veil" onclick="if(event.target===this)OG.closeModal()"><div class="modal wide">
    <h2>Prep · ${esc(c?c.name:"")} at ${esc(a?a.name:"")}</h2>
    <div class="body"><div class="split">
      <div>
        <div class="note info"><b>Why you're calling.</b> ${esc(g.note)}</div>
        ${scriptBlock("1 · Open — human", [L.opener], vars)}
        ${scriptBlock(`2 · ${act.label}`, act.scripts.length?act.scripts:L.then, vars)}
        ${scriptBlock("3 · Pivot", [L.pivot], vars)}
        ${scriptBlock("If it goes to voicemail", [L.voicemail], vars)}
        ${scriptBlock("Text straight after", [L.text], vars)}
      </div>
      <div>
        ${c ? `<div class="card"><h3>What we know about ${esc(c.name.split(" ")[0])}</h3><div class="pad sm">
          <dl class="kv"><dt>Title</dt><dd>${esc(c.title)}</dd>
          <dt>Buying role</dt><dd>${esc(c.role)} · ${esc(c.influence)} influence</dd>
          <dt>Relationship</dt><dd>${esc(c.rel)}</dd>
          <dt>Last touch</dt><dd>${c.lastTouch?daysSince(c.lastTouch)+" days ago":"never"}</dd></dl>
          ${c.note?`<p style="margin-top:10px">${esc(c.note)}</p>`:""}
        </div></div>` : ""}
        ${a ? `<div class="card"><h3>Account</h3><div class="pad sm">
          <dl class="kv"><dt>Buys today</dt><dd>${a.buys.map(esc).join(", ")||"—"}</dd>
          <dt>Competitors</dt><dd>${a.competitors.map(esc).join(", ")||"none known"}</dd>
          <dt>Our share</dt><dd>${gapPct(a)!==null?gapPct(a)+"%":"—"}</dd>
          ${chan?`<dt>Channel</dt><dd>${esc(chan.primary)}</dd>`:""}</dl>
          <p class="xs muted" style="margin-top:9px"><b>DYK candidates:</b> ${dykFor(a.buys).map(esc).join(", ")||"—"}</p>
        </div></div>` : ""}
      </div>
    </div></div>
    <div class="foot"><button class="btn" onclick="OG.closeModal()">Close</button>
      <button class="btn pri" onclick="OG.openLog('${g.account}','${g.contact||""}','${g.code}','${g.id}')">Done — log it</button></div>
  </div></div>`;
}

function mContact(){
  const c = modal.cid ? contact(modal.cid) : null;
  const aid = c ? c.accountId : modal.aid;
  return `<div class="veil" onclick="if(event.target===this)OG.closeModal()"><div class="modal wide">
    <h2>${c?esc(c.name):"New contact"} <span class="muted" style="font-weight:400">· ${esc(account(aid)?.name||"")}</span></h2>
    <div class="body">
      <div class="row2">
        <div class="fld"><label class="f">Name</label><input class="f" id="c_n" value="${esc(c?.name||"")}"></div>
        <div class="fld"><label class="f">Title</label><input class="f" id="c_t" value="${esc(c?.title||"")}"></div></div>
      <div class="row3">
        <div class="fld"><label class="f">Function</label><input class="f" id="c_f" value="${esc(c?.fn||"")}" placeholder="Engineering"></div>
        <div class="fld"><label class="f">Buying role</label><select class="f" id="c_r">
          ${BUYING_ROLES.map(r=>`<option ${r===c?.role?"selected":""}>${esc(r)}</option>`).join("")}</select></div>
        <div class="fld"><label class="f">Influence</label><select class="f" id="c_i">
          ${["High","Medium","Low"].map(r=>`<option ${r===c?.influence?"selected":""}>${esc(r)}</option>`).join("")}</select></div></div>
      <div class="row3">
        <div class="fld"><label class="f">Relationship</label><select class="f" id="c_rl">
          ${REL_LEVELS.map(r=>`<option ${r===c?.rel?"selected":""}>${esc(r)}</option>`).join("")}</select></div>
        <div class="fld"><label class="f">Email</label><input class="f" id="c_e" value="${esc(c?.email||"")}"></div>
        <div class="fld"><label class="f">Phone</label><input class="f" id="c_p" value="${esc(c?.phone||"")}"></div></div>
      <div class="fld"><label class="f">What you know about them as a person</label>
        <textarea class="f" id="c_no" style="min-height:92px"
          placeholder="What they care about, how they prefer to be contacted, what they said last time, what they own vs. influence.">${esc(c?.note||"")}</textarea></div>
      ${c?.rel==="Not initiated" ? `<div class="note warn" style="margin-bottom:0"><b>Never contacted.</b>
        ${c.role==="Economic"?"They hold budget. This is the single biggest gap on the account.":"Worth a first touch."}</div>`:""}
    </div>
    <div class="foot">
      ${c?`<button class="btn" style="margin-right:auto" onclick="OG.delContact('${c.id}')">Delete</button>`:""}
      <button class="btn" onclick="OG.closeModal()">Cancel</button>
      <button class="btn pri" onclick="OG.saveContact('${c?.id||""}','${aid}')">Save</button></div>
  </div></div>`;
}

function mAccount(){
  const a = modal.aid ? account(modal.aid) : null;
  return `<div class="veil" onclick="if(event.target===this)OG.closeModal()"><div class="modal wide">
    <h2>${a?esc(a.name):"New account"}</h2>
    <div class="body">
      <div class="row3">
        <div class="fld"><label class="f">Name</label><input class="f" id="a_n" value="${esc(a?.name||"")}"></div>
        <div class="fld"><label class="f">Segment</label><input class="f" id="a_s" value="${esc(a?.segment||"")}" placeholder="Tier-1"></div>
        <div class="fld"><label class="f">Geography</label><select class="f" id="a_g">
          ${CHANNEL_MATRIX.map(c=>`<option ${c.geo===a?.geo?"selected":""}>${esc(c.geo)}</option>`).join("")}</select></div></div>
      <div class="row3">
        <div class="fld"><label class="f">Owner</label><select class="f" id="a_o">
          ${S.people.map(p=>`<option value="${p.id}" ${p.id===a?.owner?"selected":""}>${esc(p.name)}</option>`).join("")}</select></div>
        <div class="fld"><label class="f">Their eng. services budget</label><input class="f" id="a_b" type="number" value="${a?.engBudget||""}"></div>
        <div class="fld"><label class="f">Our annual billing</label><input class="f" id="a_r" type="number" value="${a?.billing||""}"></div></div>
      <div class="fld"><label class="f">What they buy from us today</label><div class="chips">
        ${SERVICES.map(s=>`<label class="pill ${a?.buys.includes(s)?"p-blue":"p-gray"}" style="cursor:pointer">
          <input type="checkbox" class="a_buy" value="${esc(s)}" ${a?.buys.includes(s)?"checked":""}
            style="margin-right:4px;vertical-align:-1px">${esc(s)}</label>`).join("")}</div></div>
      <div class="fld"><label class="f">Competitors inside the account</label><div class="chips">
        ${COMPETITORS.map(s=>`<label class="pill ${a?.competitors.includes(s)?"p-bad":"p-gray"}" style="cursor:pointer">
          <input type="checkbox" class="a_cmp" value="${esc(s)}" ${a?.competitors.includes(s)?"checked":""}
            style="margin-right:4px;vertical-align:-1px">${esc(s)}</label>`).join("")}</div></div>
      <div class="fld"><label class="f">On which lists</label><div class="chips">
        ${LISTS.map(l=>`<label class="pill ${a?.lists.includes(l.id)?"p-blue":"p-gray"}" style="cursor:pointer">
          <input type="checkbox" class="a_lst" value="${l.id}" ${a?.lists.includes(l.id)?"checked":""}
            style="margin-right:4px;vertical-align:-1px">${esc(l.name)}</label>`).join("")}</div>
        <p class="xs muted" style="margin-top:5px">Zero Dark 30 and Silent 6+ months also compute themselves from last touch — you don't need to tick them.</p></div>
      <div class="fld"><label class="f">Notes</label><textarea class="f" id="a_no">${esc(a?.note||"")}</textarea></div>
    </div>
    <div class="foot"><button class="btn" onclick="OG.closeModal()">Cancel</button>
      <button class="btn pri" onclick="OG.saveAccount('${a?.id||""}')">Save</button></div>
  </div></div>`;
}

function mAssign(){
  const m = modal, cs = m.aid ? acctContacts(m.aid) : [];
  return `<div class="veil" onclick="if(event.target===this)OG.closeModal()"><div class="modal">
    <h2>Assign an action</h2>
    <div class="body">
      <p class="sm muted" style="margin-bottom:14px">Name the person, name the account, say why.
      Specific enough to act on without thinking.</p>
      <div class="row2">
        <div class="fld"><label class="f">Who does it</label><select class="f" id="g_p">
          ${S.people.map(p=>`<option value="${p.id}" ${p.id===m.pid?"selected":""}>${esc(p.name)} — ${esc(p.role)}</option>`).join("")}</select></div>
        <div class="fld"><label class="f">Action</label><select class="f" id="g_code">
          ${ACTIONS.map(a=>`<option value="${a.code}" ${a.code===m.code?"selected":""}>${esc(a.label)}</option>`).join("")}</select></div></div>
      <div class="row2">
        <div class="fld"><label class="f">Account</label>
          <select class="f" id="g_a" onchange="OG.setAssignAcct(this.value)"><option value="">Select…</option>
            ${S.accounts.map(a=>`<option value="${a.id}" ${a.id===m.aid?"selected":""}>${esc(a.name)}</option>`).join("")}</select></div>
        <div class="fld"><label class="f">Contact</label><select class="f" id="g_c" ${!m.aid?"disabled":""}>
          <option value="">—</option>
          ${cs.map(c=>`<option value="${c.id}" ${c.id===m.cid?"selected":""}>${esc(c.name)} — ${esc(c.title)}</option>`).join("")}</select></div></div>
      <div class="fld"><label class="f">Why — the context that makes this actionable</label>
        <textarea class="f" id="g_no">${esc(m.note||"")}</textarea></div>
    </div>
    <div class="foot"><button class="btn" onclick="OG.closeModal()">Cancel</button>
      <button class="btn pri" onclick="OG.saveAssign()">Assign</button></div>
  </div></div>`;
}

function mPerson(){
  return `<div class="veil" onclick="if(event.target===this)OG.closeModal()"><div class="modal">
    <h2>Add person</h2><div class="body">
      <div class="fld"><label class="f">Name</label><input class="f" id="p_n"></div>
      <div class="fld"><label class="f">Role</label><input class="f" id="p_r" placeholder="Delivery Engineer"></div>
      <div class="fld"><label class="f">Weekly action target</label><input class="f" id="p_t" type="number" value="3"></div>
    </div><div class="foot"><button class="btn" onclick="OG.closeModal()">Cancel</button>
      <button class="btn pri" onclick="OG.savePerson()">Add</button></div></div></div>`;
}

function mTesti(){
  return `<div class="veil" onclick="if(event.target===this)OG.closeModal()"><div class="modal">
    <h2>Add testimonial</h2><div class="body">
      <div class="fld"><label class="f">The quote — their words, not yours</label>
        <textarea class="f" id="t_q" style="min-height:80px"></textarea></div>
      <div class="row2">
        <div class="fld"><label class="f">Who said it</label><input class="f" id="t_w" placeholder="Head of Software Architecture"></div>
        <div class="fld"><label class="f">Account</label><select class="f" id="t_a"><option value="">—</option>
          ${S.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div></div>
      <div class="fld"><label class="f">Theme</label><select class="f" id="t_t"><option value="">—</option>
        ${SERVICES.map(s=>`<option>${esc(s)}</option>`).join("")}</select></div>
    </div><div class="foot"><button class="btn" onclick="OG.closeModal()">Cancel</button>
      <button class="btn pri" onclick="OG.saveTesti()">Add</button></div></div></div>`;
}

function mInterview(){
  const i = modal.iid ? S.interviews.find(x=>x.id===modal.iid) : null;
  return `<div class="veil" onclick="if(event.target===this)OG.closeModal()"><div class="modal wide">
    <h2>${i?esc(i.who):"New interview"}</h2>
    <div class="body"><div class="split">
      <div>
        <div class="row2">
          <div class="fld"><label class="f">Customer name</label><input class="f" id="i_w" value="${esc(i?.who||"")}"></div>
          <div class="fld"><label class="f">Account</label><select class="f" id="i_a"><option value="">—</option>
            ${S.accounts.map(a=>`<option value="${a.id}" ${a.id===i?.account?"selected":""}>${esc(a.name)}</option>`).join("")}</select></div></div>
        <div class="row2">
          <div class="fld"><label class="f">Interviewer</label><input class="f" id="i_i" value="${esc(i?.interviewer||S.config.sponsor)}">
            <p class="xs muted" style="margin-top:4px">Not the account owner — they'll unconsciously steer and the customer will be polite rather than candid.</p></div>
          <div class="fld"><label class="f">Date</label><input class="f" id="i_d" type="date" value="${esc(i?.date||"")}"></div></div>
        <div class="fld"><label class="f">Recording link <span class="faint">optional</span></label>
          <input class="f" id="i_r" value="${esc(i?.recording||"")}" placeholder="https://…"></div>
        <div class="fld"><label class="f">Quotes — one per line. These become testimonials.</label>
          <textarea class="f" id="i_q" style="min-height:110px">${esc((i?.quotes||[]).join("\n"))}</textarea></div>
        <label class="sm" style="display:flex;gap:7px;align-items:center">
          <input type="checkbox" id="i_done" ${i?.done?"checked":""}> Interview completed</label>
      </div>
      <div>
        <div class="card"><h3>The rule</h3><div class="pad sm">
          <p><b>${esc(INTERVIEW.rule)}</b></p></div></div>
        <div class="card"><h3>Questions, in order</h3><div class="pad">
          ${INTERVIEW.questions.map((q,n)=>`<div class="qa"><b>${n+1}. ${esc(q.q)}${q.star?" ★":""}</b></div>`).join("")}
        </div></div>
        <div class="card"><h3>Never ask</h3><div class="pad sm">
          <p style="color:var(--bad);font-weight:600">"${esc(INTERVIEW.never.q)}"</p></div></div>
      </div>
    </div></div>
    <div class="foot">
      ${i?`<button class="btn" style="margin-right:auto" onclick="OG.delInterview('${i.id}')">Delete</button>`:""}
      <button class="btn" onclick="OG.closeModal()">Cancel</button>
      <button class="btn pri" onclick="OG.saveInterview('${i?.id||""}')">Save</button></div>
  </div></div>`;
}

/* ===================== handlers ===================== */
const OG = {
  go(v){ view = v; modal = null; render(); },
  setList(l){ sel.list = l; render(); },
  setPb(t){ sel.pbTab = t; render(); },
  openAcct(id){ sel.account = id; view = "account"; render(); },
  setMe(id){ me = id; render(); },
  shiftWeek(n){ week = addWeeks(week, n); render(); },
  closeModal(){ modal = null; render(); },
  copyText(json){ copy(JSON.parse(json)).then(()=>toast("Copied")); },

  openLog(aid,cid,code,gid){ modal = { type:"log", aid:aid||"", cid:cid||"", code:code||"OG1.2", gid:gid||"" }; render(); },
  setLogAcct(v){ modal.aid = v; modal.cid = ""; render(); },
  setLogCode(v){ modal.code = v; render(); },
  async saveLog(){
    const aid = val("l_a"); if (!aid) return toast("Pick an account first");
    const rec = { id:uid("x"), date:todayISO(), person:val("l_person")||me, loggedBy:me,
      account:aid, contact:val("l_c"), code:val("l_code"), service:val("l_svc"),
      value:Number(val("l_val")||0), channel:val("l_ch"), opp:checked("l_opp"), note:val("l_note").trim() };
    const gid = modal.gid, wasOpp = rec.opp;
    modal = null;
    await mutate(s => {
      s.actions.unshift(rec);
      const a = s.accounts.find(x => x.id === aid); if (a) a.lastTouch = rec.date;
      const c = s.contacts.find(x => x.id === rec.contact);
      if (c) { c.lastTouch = rec.date; if (c.rel === "Not initiated") c.rel = "Progressing"; }
      if (gid) { const g = s.assignments.find(x => x.id === gid); if (g) g.done = true; }
    });
    toast("Logged");
    /* Ask for the story while they can still describe it. A week later
       in a separate workflow, it never gets collected. */
    if (wasOpp) setTimeout(() => {
      if (confirm("That surfaced an opportunity — worth sharing as a story in Monday's huddle?"))
        OG.openStoryFrom(rec);
    }, 400);
  },
  openStoryFrom(rec){
    const txt = prompt("What happened? (Named people, specific outcome.)", rec.note || "");
    if (txt) mutate(s => s.stories.unshift({ id:uid("s"), date:todayISO(), person:rec.person, text:txt }))
      .then(()=>toast("Story added"));
  },
  async delAction(id){ await mutate(s => { s.actions = s.actions.filter(a => a.id !== id); }); toast("Deleted"); },

  openPrep(gid){ modal = { type:"prep", gid }; render(); },

  openContact(cid,aid){ modal = { type:"contact", cid:cid||"", aid:aid||"" }; render(); },
  async saveContact(cid,aid){
    const rec = { name:val("c_n").trim(), title:val("c_t").trim(), fn:val("c_f").trim(),
      role:val("c_r"), influence:val("c_i"), rel:val("c_rl"), email:val("c_e").trim(),
      phone:val("c_p").trim(), note:val("c_no").trim() };
    if (!rec.name) return toast("Name is required");
    modal = null;
    await mutate(s => {
      if (cid) Object.assign(s.contacts.find(x => x.id === cid), rec);
      else s.contacts.push({ id:uid("c"), accountId:aid, lastTouch:"", ...rec });
    });
    toast("Saved");
  },
  async delContact(cid){ modal = null; await mutate(s => { s.contacts = s.contacts.filter(c => c.id !== cid); }); toast("Deleted"); },

  openAccount(aid){ modal = { type:"account", aid:aid||"" }; render(); },
  async saveAccount(aid){
    const pick = cls => [...document.querySelectorAll("."+cls)].filter(x => x.checked).map(x => x.value);
    const rec = { name:val("a_n").trim(), segment:val("a_s").trim(), geo:val("a_g"), owner:val("a_o"),
      engBudget:Number(val("a_b")||0), billing:Number(val("a_r")||0),
      buys:pick("a_buy"), competitors:pick("a_cmp"), lists:pick("a_lst"), note:val("a_no").trim() };
    if (!rec.name) return toast("Name is required");
    modal = null;
    await mutate(s => {
      if (aid) Object.assign(s.accounts.find(x => x.id === aid), rec);
      else s.accounts.push({ id:uid("a"), lastTouch:"", ...rec });
    });
    toast("Saved");
  },

  openAssign(pid,aid,cid,code,note){
    modal = { type:"assign", pid:pid||S.people[0].id, aid:aid||"", cid:cid||"", code:code||"OG1.2", note:note||"" };
    render();
  },
  setAssignAcct(v){ modal.aid = v; modal.cid = ""; render(); },
  async saveAssign(){
    const aid = val("g_a"); if (!aid) return toast("Pick an account");
    const rec = { id:uid("g"), week, person:val("g_p"), account:aid, contact:val("g_c"),
      code:val("g_code"), note:val("g_no").trim(), done:false };
    modal = null; await mutate(s => s.assignments.push(rec)); toast("Assigned");
  },
  async delAssign(id){ await mutate(s => { s.assignments = s.assignments.filter(g => g.id !== id); }); },
  async toggleAsg(id){ await mutate(s => { const g = s.assignments.find(x => x.id === id); g.done = !g.done; }); },
  async acceptSuggestion(i){
    const sug = suggest()[i]; if (!sug) return;
    await mutate(s => s.assignments.push({ id:uid("g"), week, done:false, ...sug }));
    toast("Assigned");
  },
  async acceptAll(){
    const all = suggest();
    await mutate(s => all.forEach(sg => s.assignments.push({ id:uid("g"), week, done:false, ...sg })));
    toast(`${all.length} assigned`);
  },

  openPerson(){ modal = { type:"person" }; render(); },
  async savePerson(){
    const n = val("p_n").trim(); if (!n) return toast("Name is required");
    const rec = { id:uid("p"), name:n, role:val("p_r").trim()||"Participant", target:Number(val("p_t")||3) };
    modal = null; await mutate(s => s.people.push(rec)); toast("Added");
  },
  async delPerson(id){ await mutate(s => { s.people = s.people.filter(p => p.id !== id); }); },
  async setTarget(id,v){ await mutate(s => { s.people.find(p => p.id === id).target = Number(v||0); }); },
  async setCfg(k,v){ await mutate(s => { s.config[k] = v; }); },

  openTesti(){ modal = { type:"testi" }; render(); },
  async saveTesti(){
    const q = val("t_q").trim(); if (!q) return toast("The quote is the point");
    const rec = { id:uid("t"), quote:q, who:val("t_w").trim(), account:val("t_a"), theme:val("t_t"), used:0 };
    modal = null; await mutate(s => s.testimonials.unshift(rec)); toast("Added");
  },
  async useTesti(id){ await mutate(s => { const t = s.testimonials.find(x=>x.id===id); t.used = (t.used||0)+1; }); },
  async delTesti(id){ await mutate(s => { s.testimonials = s.testimonials.filter(t => t.id !== id); }); },

  openInterview(iid){ modal = { type:"interview", iid:iid||"" }; render(); },
  async saveInterview(iid){
    const quotes = val("i_q").split("\n").map(x=>x.trim()).filter(Boolean);
    const rec = { who:val("i_w").trim(), account:val("i_a"), interviewer:val("i_i").trim(),
      date:val("i_d"), recording:val("i_r").trim(), done:checked("i_done"), quotes };
    if (!rec.who) return toast("Who are you interviewing?");
    modal = null;
    await mutate(s => {
      let target;
      if (iid) { target = s.interviews.find(x => x.id === iid); Object.assign(target, rec); }
      else { target = { id:uid("i"), ...rec }; s.interviews.push(target); }
      /* Quotes are the whole point of the interview — push new ones
         straight into the testimonial library rather than asking
         someone to retype them later, which nobody does. */
      quotes.forEach(q => {
        if (!s.testimonials.some(t => t.quote === q))
          s.testimonials.unshift({ id:uid("t"), quote:q, who:rec.who,
            account:rec.account, theme:"", used:0 });
      });
    });
    toast(quotes.length ? "Saved — quotes added to Testimonials" : "Saved");
  },
  async delInterview(id){ modal = null; await mutate(s => { s.interviews = s.interviews.filter(i => i.id !== id); }); },

  exportJSON(){ download(`outgrow-acsia-${todayISO()}.json`, JSON.stringify(S,null,2)); toast("Exported"); },
  importJSON(){
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json";
    inp.onchange = async () => {
      try {
        const data = JSON.parse(await inp.files[0].text());
        if (!data.people || !data.accounts) throw new Error("shape");
        await mutate(s => Object.assign(s, data)); toast("Imported");
      } catch { toast("Couldn't read that file"); }
    };
    inp.click();
  },
  async resetAll(){
    if (!confirm("Reset all data back to the seed? This cannot be undone.")) return;
    S = await Store.reset(); render(); toast("Reset");
  }
};
window.OG = OG;

/* ===================== render ===================== */
const NAV = [
  ["Do the work", [["week","◗","My week"],["lists","▤","Lists"],["playbook","❝","Playbook"]]],
  ["Run the system", [["assign","◈","Assign"],["score","▧","Scorecard"]]],
  ["Build the foundation", [["interviews","◍","Interviews"],["testimonials","❞","Testimonials"]]],
  ["Configure", [["setup","⚙","Setup"]]]
];
const VIEWS = { week:vWeek, lists:vLists, account:vAccount, assign:vAssign, score:vScore,
  playbook:vPlaybook, testimonials:vTestimonials, interviews:vInterviews, setup:vSetup };
const MODALS = { log:mLog, prep:mPrep, contact:mContact, account:mAccount,
  assign:mAssign, person:mPerson, testi:mTesti, interview:mInterview };

function badge(k){
  if (k === "week") { const n = myAssign().filter(g=>!g.done).length; return n || null; }
  if (k === "interviews" && !gateOpen()) return `${interviewsDone()}/${S.config.interviewTarget}`;
  return null;
}

function render(){
  document.getElementById("app").innerHTML = `
  <div class="shell">
    <aside class="rail">
      <div class="brand"><b>Outgrow Console</b><span>${esc(S.config.org)}</span></div>
      <nav class="nav">
        ${NAV.map(([grp, items]) => `<h6>${esc(grp)}</h6>` + items.map(([k,i,l]) => {
          const b = badge(k);
          return `<a class="${view===k||(k==="lists"&&view==="account")?"on":""}" onclick="OG.go('${k}')">
            <i>${i}</i>${esc(l)}${b?`<span class="cnt">${b}</span>`:""}</a>`;
        }).join("")).join("")}
      </nav>
      <div class="who"><label>Acting as</label>
        <select onchange="OG.setMe(this.value)">
          ${S.people.map(p=>`<option value="${p.id}" ${p.id===me?"selected":""}>${esc(p.name)}</option>`).join("")}
        </select>
        <div class="mode ${MODE==="supabase"?"live":""}"><i></i>${MODE==="supabase"?"Shared storage":"This browser only"}</div>
      </div>
    </aside>
    <main class="main">${(VIEWS[view] || vWeek)()}</main>
  </div>
  ${modal ? (MODALS[modal.type] || (()=>""))() : ""}`;
}

/* ===================== boot ===================== */
(async () => {
  S = await Store.load();
  if (Store.lastError) console.warn("Storage:", Store.lastError);
  render();
})();
