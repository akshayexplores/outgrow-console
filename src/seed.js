/* =====================================================================
   SEED DATA
   ---------------------------------------------------------------------
   Obviously-fictional starting data so the app is explorable before
   anyone has entered anything. Replace it with the real account base
   via Setup → Import, or edit here before first deploy.

   The dates are relative to load time so the app never looks stale.
   ===================================================================== */

const D = n => new Date(Date.now() - n*864e5).toISOString().slice(0,10);
const M = d => { const x = new Date(d); x.setDate(x.getDate()-((x.getDay()+6)%7));
                 return x.toISOString().slice(0,10); };
const WK = M(new Date());

export const SEED = {
  config:{
    org:"Northwind Group",
    sponsor:"Sample: Jordan Blake",
    dykFocus:"Aria",
    interviewTarget:8,
    commentary:"Sample: a referral into a new division is exactly what this is for. Sample: three weeks unbroken.",
    currency:"$"
  },

  people:[
    { id:"p1", name:"Sample: Priya Nair",    role:"Delivery Lead",     target:6,  manager:true  },
    { id:"p2", name:"Sample: Karim Suleiman", role:"Delivery Engineer", target:3,  manager:false },
    { id:"p3", name:"Sample: Anna Kowalski",     role:"Solutions Architect",     target:3,  manager:false },
    { id:"p4", name:"Sample: Derek Varma",   role:"Account Executive", target:16, manager:false },
    { id:"p5", name:"Sample: Sven Lindgren", role:"Project Manager",   target:4,  manager:true  },
    { id:"p6", name:"Sample: Yuki Hara",    role:"Delivery Engineer", target:3,  manager:false },
    { id:"p7", name:"Sample: Rita Krishnan",  role:"Pre-sales Lead",    target:8,  manager:false }
  ],

  accounts:[
    { id:"a1", name:"Sample: Northwind Trading", segment:"Enterprise Retail", geo:"Germany", owner:"p1",
      buys:["UX & Interface Design","Platform Engineering"], competitors:["Vertex Partners","Bluepeak Systems"],
      engBudget:4200000, billing:210000, lastTouch:D(4), lists:["quotes","large"],
      note:"Analytics proposal sent 24 June, no decision. Sample contact is supportive but procurement is slow. Two further divisions we have never touched." },
    { id:"a2", name:"Sample: Harbourpoint Group", segment:"Mid-Market Logistics", geo:"India", owner:"p2",
      buys:["Platform Engineering","Connected Services"], competitors:["Meridian Consulting"],
      engBudget:900000, billing:140000, lastTouch:D(47), lists:["smallmed","prequote"],
      note:"Quiet since the platform review. Sample contact moved to a new programme — our scope followed the old one." },
    { id:"a3", name:"Sample: Meridian Freight Co", segment:"Enterprise Logistics", geo:"Japan", owner:"p6",
      buys:["Testing & QA"], competitors:["Vertex Partners","Solara Group"],
      engBudget:5500000, billing:90000, lastTouch:D(11), lists:["large","autopilot"],
      note:"Single-threaded through Sample contact. Heavy testing load — strongest Aria candidate in the base. Security roadmap unknown." },
    { id:"a4", name:"Sample: Solstice Manufacturing", segment:"OEM Industrial", geo:"India", owner:"p4",
      buys:["Systems Integration","Compliance Advisory"], competitors:["Meridian Consulting","Bluepeak Systems"],
      engBudget:3100000, billing:380000, lastTouch:D(2), lists:["large","decline"],
      note:"Billing down 18% YoY as legacy integration scope wound down. Platform migration being scoped — we are not in that conversation yet." },
    { id:"a5", name:"Sample: Cascade Energy", segment:"OEM Utilities", geo:"India", owner:"p5",
      buys:["Sustainability Consulting"], competitors:["Northgate Advisory"],
      engBudget:1400000, billing:60000, lastTouch:D(210), lists:["warm"],
      note:"Evaluated us for compliance advisory in Q1, went elsewhere on price. Sample contact was explicit it was not a capability question." },
    { id:"a6", name:"Sample: Alderbrook Instruments", segment:"Test Equipment", geo:"Germany", owner:"p3",
      buys:["Platform Engineering"], competitors:[],
      engBudget:800000, billing:45000, lastTouch:D(19), lists:["quotes","smallmed"],
      note:"Connected-services validation proposal outstanding since 30 July. Small but fast-moving; good reference potential." },
    { id:"a7", name:"Sample: Fenwick Transit", segment:"OEM Commercial Fleet", geo:"India", owner:"p4",
      buys:[], competitors:["Vertex Partners"],
      engBudget:1100000, billing:0, lastTouch:D(140), lists:["stopped"],
      note:"Delivered connected-services integration through 2024, then it tailed off when their programme lead changed. No formal end — it just stopped. Worth one honest call." }
  ],

  contacts:[
    { id:"c1", accountId:"a1", name:"Sample: Klaus Berger", title:"Head of Software Architecture", fn:"Engineering",
      role:"Technical", influence:"High", rel:"Good", email:"sample.contact1@example.com", phone:"+49 …", lastTouch:D(4),
      note:"Sceptical of tool vendors, warm to engineers. Owns the analytics proposal decision technically but not the budget." },
    { id:"c2", accountId:"a1", name:"Sample: Marta Reinhardt", title:"Procurement Lead — Engineering Services", fn:"Procurement",
      role:"Economic", influence:"High", rel:"Not initiated", email:"sample.contact2@example.com", phone:"", lastTouch:"",
      note:"Never contacted. Holds the budget on the outstanding proposal. Sample contact 1 can introduce." },
    { id:"c3", accountId:"a2", name:"Sample: Rajesh Iyer", title:"GM — Operations", fn:"Engineering",
      role:"Economic", influence:"High", rel:"Moderate", email:"sample.contact3@example.com", phone:"+91 …", lastTouch:D(47),
      note:"Moved to a new division in April. Our scope followed the old programme — that's why it went quiet." },
    { id:"c4", accountId:"a3", name:"Sample: Yuki Hara", title:"Manager, Validation Engineering", fn:"Quality",
      role:"User", influence:"Medium", rel:"Good", email:"sample.contact4@example.com", phone:"", lastTouch:D(11),
      note:"Prefers scheduled video over calls. Very responsive inside the existing cadence, does not answer cold. Mentioned traceability pain twice." },
    { id:"c5", accountId:"a4", name:"Sample: Sanjay Rao", title:"Chief Engineer — Systems", fn:"Engineering",
      role:"Technical", influence:"High", rel:"Strong", email:"sample.contact5@example.com", phone:"+91 …", lastTouch:D(2),
      note:"Our strongest advocate anywhere in the base. Would take a referral ask today." },
    { id:"c6", accountId:"a5", name:"Sample: Sunita Desai", title:"Head of Compliance", fn:"Quality",
      role:"Technical", influence:"High", rel:"Moderate", email:"sample.contact6@example.com", phone:"", lastTouch:D(93),
      note:"Said explicitly it was a price decision, not capability. Next planning gate is Q1 2027 — that's the window." },
    { id:"c7", accountId:"a6", name:"Sample: Andreas Wolf", title:"Test Systems Manager", fn:"Engineering",
      role:"User", influence:"Medium", rel:"Progressing", email:"sample.contact7@example.com", phone:"", lastTouch:D(19),
      note:"Proposal with him since 30 July. Chased once by email — needs a call." }
  ],

  actions:[
    { id:"x1", date:D(2),  person:"p1", loggedBy:"p1", account:"a1", contact:"c1", code:"OG1.2",
      service:"Security Assessment", value:150000, channel:"Call", opp:true,
      note:"Asked what's going to other vendors — security gap assessment is with a competitor, unhappy with pace." },
    { id:"x2", date:D(2),  person:"p1", loggedBy:"p1", account:"a1", contact:"c1", code:"OG4.1",
      service:"", value:0, channel:"Call", opp:true, note:"Asked who runs the other division's software — got a new-region name." },
    { id:"x3", date:D(3),  person:"p2", loggedBy:"p1", account:"a2", contact:"c3", code:"OG1.1",
      service:"Aria", value:0, channel:"WhatsApp", opp:false, note:"Mentioned Aria. Curious, asked for a one-pager. (Logged by manager from a text.)" },
    { id:"x4", date:D(5),  person:"p6", loggedBy:"p6", account:"a3", contact:"c4", code:"OG1.1",
      service:"Aria", value:220000, channel:"Video call", opp:true, note:"Raised Aria against the traceability pain he mentioned. Wants a demo." },
    { id:"x5", date:D(6),  person:"p4", loggedBy:"p4", account:"a4", contact:"c5", code:"OG3.1",
      service:"", value:0, channel:"Call", opp:false, note:"Share of external engineering spend: he guessed ~12%. We assumed far more." },
    { id:"x6", date:D(9),  person:"p3", loggedBy:"p3", account:"a6", contact:"c7", code:"OG2.2",
      service:"Connected Services", value:40000, channel:"Call", opp:false, note:"Booked a review for the outstanding proposal." },
    { id:"x7", date:D(12), person:"p1", loggedBy:"p1", account:"a1", contact:"c1", code:"OG1.1",
      service:"Testing & QA", value:0, channel:"In person", opp:false, note:"" },
    { id:"x8", date:D(13), person:"p2", loggedBy:"p2", account:"a2", contact:"c3", code:"OG1.2",
      service:"", value:0, channel:"Voicemail + text", opp:false, note:"No reply yet." },
    { id:"x9", date:D(16), person:"p4", loggedBy:"p4", account:"a4", contact:"c5", code:"OG1.1",
      service:"Aria", value:0, channel:"Call", opp:false, note:"" },
    { id:"x10",date:D(17), person:"p7", loggedBy:"p7", account:"a3", contact:"c4", code:"OG1.1",
      service:"Process Consulting", value:0, channel:"Teams", opp:false, note:"" },
    { id:"x11",date:D(20), person:"p1", loggedBy:"p1", account:"a1", contact:"c1", code:"OG2.1",
      service:"Advanced Analytics", value:0, channel:"Call", opp:false, note:"Pushed for a decision date on the June proposal." },
    { id:"x12",date:D(23), person:"p5", loggedBy:"p5", account:"a5", contact:"c6", code:"OG2.2",
      service:"", value:0, channel:"Voicemail + text", opp:false, note:"No answer." }
  ],

  assignments:[
    { id:"g1", week:WK, person:"p1", account:"a1", contact:"c1", code:"OG2.1", done:true,
      note:"Analytics proposal, sent 24 June. Push for a decision date." },
    { id:"g2", week:WK, person:"p1", account:"a1", contact:"c2", code:"OG4.1", done:false,
      note:"Ask Sample contact 1 to introduce Sample contact 2 — she holds the budget and we have never spoken to her." },
    { id:"g3", week:WK, person:"p2", account:"a2", contact:"c3", code:"OG1.2", done:false,
      note:"47 days silent. No agenda — find out what he's working on now he's moved divisions." },
    { id:"g4", week:WK, person:"p6", account:"a3", contact:"c4", code:"OG1.1", done:false,
      note:"Aria demo follow-through. He raised traceability pain unprompted — strongest Aria fit in the base." },
    { id:"g5", week:WK, person:"p4", account:"a4", contact:"c5", code:"OG4.1", done:false,
      note:"Sample contact 5 is our strongest advocate. Ask who owns the platform migration." },
    { id:"g6", week:WK, person:"p3", account:"a6", contact:"c7", code:"OG2.1", done:false,
      note:"Connected-services proposal outstanding since 30 July. Chased by email once — call this time." },
    { id:"g7", week:WK, person:"p5", account:"a5", contact:"c6", code:"OG2.2", done:false,
      note:"93 days silent. Next planning gate Q1 2027. Aim only to book the next conversation." }
  ],

  interviews:[
    { id:"i1", account:"a4", contact:"c5", who:"Sample: Sanjay Rao", interviewer:"Sample: Jordan Blake",
      date:D(21), done:true, recording:"",
      quotes:["They're the only vendor who understood our systems without three months of ramp-up.",
              "Honestly I didn't know you did compliance advisory. We gave that to another vendor."] },
    { id:"i2", account:"a1", contact:"c1", who:"Sample: Klaus Berger", interviewer:"Sample: Jordan Blake",
      date:D(14), done:true, recording:"",
      quotes:["The engineers actually read the spec. That sounds small. It isn't."] },
    { id:"i3", account:"a3", contact:"c4", who:"Sample: Yuki Hara", interviewer:"Sample: Jordan Blake",
      date:"", done:false, recording:"", quotes:[] }
  ],

  testimonials:[
    { id:"t1", quote:"They're the only vendor who understood our systems without three months of ramp-up.",
      who:"Chief Engineer, Systems", account:"a4", theme:"Systems Integration", used:2 },
    { id:"t2", quote:"The engineers actually read the spec. That sounds small. It isn't.",
      who:"Head of Software Architecture", account:"a1", theme:"Platform Engineering", used:0 },
    { id:"t3", quote:"Honestly I didn't know you did compliance advisory. We gave that to another vendor.",
      who:"Chief Engineer, Systems", account:"a4", theme:"Compliance Advisory", used:1 }
  ],

  stories:[
    { id:"s1", date:D(2), person:"p1",
      text:"Asked Sample contact 1 one reverse-DYK question and found out their security gap assessment is with a competitor and they're unhappy with the pace. We were never asked to quote because they didn't know we did it." },
    { id:"s2", date:D(5), person:"p6",
      text:"Sample contact 4 mentioned traceability pain twice in a status call. Raised Aria — he asked for a demo before I finished the sentence." },
    { id:"s3", date:D(6), person:"p4",
      text:"Asked Sample contact 5 what share of their external engineering spend comes to us. He guessed 12%. We had been telling ourselves we owned that account." }
  ]
};
