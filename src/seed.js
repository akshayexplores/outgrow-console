/* =====================================================================
   SEED DATA
   ---------------------------------------------------------------------
   Realistic Acsia-shaped starting data so the app is explorable before
   anyone has entered anything. Replace it with the real account base via
   Setup → Import, or edit here before first deploy.

   The dates are relative to load time so the app never looks stale.
   ===================================================================== */

const D = n => new Date(Date.now() - n*864e5).toISOString().slice(0,10);
const M = d => { const x = new Date(d); x.setDate(x.getDate()-((x.getDay()+6)%7));
                 return x.toISOString().slice(0,10); };
const WK = M(new Date());

export const SEED = {
  config:{
    org:"Acsia Technologies",
    sponsor:"Jiji",
    dykFocus:"LiLA",
    interviewTarget:8,
    commentary:"Priya's referral into Continental's commercial-vehicle team is exactly what this is for. Karthik — three weeks unbroken.",
    currency:"₹"
  },

  people:[
    { id:"p1", name:"Priya Menon",    role:"Delivery Lead",     target:6,  manager:true  },
    { id:"p2", name:"Karthik Suresh", role:"Delivery Engineer", target:3,  manager:false },
    { id:"p3", name:"Anjali Rao",     role:"ATG Architect",     target:3,  manager:false },
    { id:"p4", name:"Deepak Varma",   role:"Account Executive", target:16, manager:false },
    { id:"p5", name:"Sven Lindqvist", role:"Project Manager",   target:4,  manager:true  },
    { id:"p6", name:"Yuki Tanaka",    role:"Delivery Engineer", target:3,  manager:false },
    { id:"p7", name:"Ravi Krishnan",  role:"Pre-sales Lead",    target:8,  manager:false }
  ],

  accounts:[
    { id:"a1", name:"Continental", segment:"Tier-1", geo:"Germany", owner:"p1",
      buys:["Digital Cockpit & Display / IVI","Embedded"], competitors:["KPIT","LTTS"],
      engBudget:42000000, billing:2100000, lastTouch:D(4), lists:["quotes","large"],
      note:"ADAS V&V proposal sent 24 June, no decision. Klaus is supportive but procurement is slow. Two further programmes in Regensburg we have never touched." },
    { id:"a2", name:"Bajaj Auto", segment:"Two & Three Wheeler", geo:"India", owner:"p2",
      buys:["Embedded","Telematics"], competitors:["Tata Elxsi"],
      engBudget:9000000, billing:1400000, lastTouch:D(47), lists:["smallmed","prequote"],
      note:"Quiet since the EV platform review. Rajesh moved to a new programme — our scope followed the old one." },
    { id:"a3", name:"Denso", segment:"Tier-1", geo:"Japan", owner:"p6",
      buys:["V&V and Test"], competitors:["KPIT","Capgemini"],
      engBudget:55000000, billing:900000, lastTouch:D(11), lists:["large","autopilot"],
      note:"Single-threaded through Yuki-san. Heavy V&V load — strongest LiLA candidate in the base. Cybersecurity roadmap unknown." },
    { id:"a4", name:"Tata Motors", segment:"OEM Commercial Vehicle", geo:"India", owner:"p4",
      buys:["AUTOSAR","Functional Safety (ISO 26262)"], competitors:["LTTS","Tata Elxsi"],
      engBudget:31000000, billing:3800000, lastTouch:D(2), lists:["large","decline"],
      note:"Billing down 18% YoY as Classic AUTOSAR scope wound down. Adaptive migration being scoped — we are not in that conversation yet." },
    { id:"a5", name:"Mahindra", segment:"OEM Passenger Car", geo:"India", owner:"p5",
      buys:["EV & e-Mobility"], competitors:["GlobalLogic"],
      engBudget:14000000, billing:600000, lastTouch:D(210), lists:["warm"],
      note:"Evaluated us for FuSa in Q1, went elsewhere on price. Sunita was explicit it was not a capability question." },
    { id:"a6", name:"Rohde & Schwarz", segment:"Semiconductor / Test", geo:"Germany", owner:"p3",
      buys:["Embedded"], competitors:[],
      engBudget:8000000, billing:450000, lastTouch:D(19), lists:["quotes","smallmed"],
      note:"Telematics validation proposal outstanding since 30 July. Small but fast-moving; good reference potential." },
    { id:"a7", name:"Ashok Leyland", segment:"OEM Commercial Vehicle", geo:"India", owner:"p4",
      buys:[], competitors:["KPIT"],
      engBudget:11000000, billing:0, lastTouch:D(140), lists:["stopped"],
      note:"Delivered telematics integration through 2024, then it tailed off when their programme lead changed. No formal end — it just stopped. Worth one honest call." }
  ],

  contacts:[
    { id:"c1", accountId:"a1", name:"Klaus Berger", title:"Head of Software Architecture", fn:"Engineering",
      role:"Technical", influence:"High", rel:"Good", email:"k.berger@example.com", phone:"+49 …", lastTouch:D(4),
      note:"Sceptical of tool vendors, warm to engineers. Two kids, skis in February. Owns the ADAS V&V decision technically but not the budget." },
    { id:"c2", accountId:"a1", name:"Marta Reinhardt", title:"Procurement Lead — Engineering Services", fn:"Procurement",
      role:"Economic", influence:"High", rel:"Not initiated", email:"m.reinhardt@example.com", phone:"", lastTouch:"",
      note:"Never contacted. Holds the budget on the outstanding proposal. Klaus can introduce." },
    { id:"c3", accountId:"a2", name:"Rajesh Menon", title:"GM — Electrical & Electronics", fn:"Engineering",
      role:"Economic", influence:"High", rel:"Moderate", email:"rajesh.m@example.com", phone:"+91 …", lastTouch:D(47),
      note:"Moved from ICE to EV in April. Our scope followed the old programme — that's why it went quiet." },
    { id:"c4", accountId:"a3", name:"Yuki Tanaka", title:"Manager, Validation Engineering", fn:"Quality",
      role:"User", influence:"Medium", rel:"Good", email:"y.tanaka@example.com", phone:"", lastTouch:D(11),
      note:"Prefers scheduled video over calls. Very responsive inside the existing cadence, does not answer cold. Mentioned traceability pain twice." },
    { id:"c5", accountId:"a4", name:"Sanjay Iyer", title:"Chief Engineer — E/E Architecture", fn:"Engineering",
      role:"Technical", influence:"High", rel:"Strong", email:"s.iyer@example.com", phone:"+91 …", lastTouch:D(2),
      note:"Our strongest advocate anywhere in the base. Would take a referral ask today." },
    { id:"c6", accountId:"a5", name:"Sunita Deshpande", title:"Head of Functional Safety", fn:"Quality",
      role:"Technical", influence:"High", rel:"Moderate", email:"s.deshpande@example.com", phone:"", lastTouch:D(93),
      note:"Said explicitly it was a price decision, not capability. Next platform gate is Q1 2027 — that's the window." },
    { id:"c7", accountId:"a6", name:"Andreas Wolf", title:"Test Systems Manager", fn:"Engineering",
      role:"User", influence:"Medium", rel:"Progressing", email:"a.wolf@example.com", phone:"", lastTouch:D(19),
      note:"Proposal with him since 30 July. Chased once by email — needs a call." }
  ],

  actions:[
    { id:"x1", date:D(2),  person:"p1", loggedBy:"p1", account:"a1", contact:"c1", code:"OG1.2",
      service:"Cybersecurity (ISO 21434)", value:1500000, channel:"Call", opp:true,
      note:"Asked what's going to other vendors — 21434 gap assessment is with KPIT, unhappy with pace." },
    { id:"x2", date:D(2),  person:"p1", loggedBy:"p1", account:"a1", contact:"c1", code:"OG4.1",
      service:"", value:0, channel:"Call", opp:true, note:"Asked who runs commercial vehicle software — got a Regensburg name." },
    { id:"x3", date:D(3),  person:"p2", loggedBy:"p1", account:"a2", contact:"c3", code:"OG1.1",
      service:"LiLA", value:0, channel:"WhatsApp", opp:false, note:"Mentioned LiLA. Curious, asked for a one-pager. (Logged by manager from Karthik's text.)" },
    { id:"x4", date:D(5),  person:"p6", loggedBy:"p6", account:"a3", contact:"c4", code:"OG1.1",
      service:"LiLA", value:2200000, channel:"Video call", opp:true, note:"Raised LiLA against the traceability pain he mentioned. Wants a demo." },
    { id:"x5", date:D(6),  person:"p4", loggedBy:"p4", account:"a4", contact:"c5", code:"OG3.1",
      service:"", value:0, channel:"Call", opp:false, note:"Share of external engineering spend: he guessed ~12%. We assumed far more." },
    { id:"x6", date:D(9),  person:"p3", loggedBy:"p3", account:"a6", contact:"c7", code:"OG2.2",
      service:"Telematics", value:400000, channel:"Call", opp:false, note:"Booked a review for the outstanding proposal." },
    { id:"x7", date:D(12), person:"p1", loggedBy:"p1", account:"a1", contact:"c1", code:"OG1.1",
      service:"V&V and Test", value:0, channel:"In person", opp:false, note:"" },
    { id:"x8", date:D(13), person:"p2", loggedBy:"p2", account:"a2", contact:"c3", code:"OG1.2",
      service:"", value:0, channel:"Voicemail + text", opp:false, note:"No reply yet." },
    { id:"x9", date:D(16), person:"p4", loggedBy:"p4", account:"a4", contact:"c5", code:"OG1.1",
      service:"LiLA", value:0, channel:"Call", opp:false, note:"" },
    { id:"x10",date:D(17), person:"p7", loggedBy:"p7", account:"a3", contact:"c4", code:"OG1.1",
      service:"ASPICE Consulting", value:0, channel:"Teams", opp:false, note:"" },
    { id:"x11",date:D(20), person:"p1", loggedBy:"p1", account:"a1", contact:"c1", code:"OG2.1",
      service:"ADAS/AD", value:0, channel:"Call", opp:false, note:"Pushed for a decision date on the June proposal." },
    { id:"x12",date:D(23), person:"p5", loggedBy:"p5", account:"a5", contact:"c6", code:"OG2.2",
      service:"", value:0, channel:"Voicemail + text", opp:false, note:"No answer." }
  ],

  assignments:[
    { id:"g1", week:WK, person:"p1", account:"a1", contact:"c1", code:"OG2.1", done:true,
      note:"ADAS V&V proposal, sent 24 June. Push for a decision date." },
    { id:"g2", week:WK, person:"p1", account:"a1", contact:"c2", code:"OG4.1", done:false,
      note:"Ask Klaus to introduce Marta — she holds the budget and we have never spoken to her." },
    { id:"g3", week:WK, person:"p2", account:"a2", contact:"c3", code:"OG1.2", done:false,
      note:"47 days silent. No agenda — find out what he's working on now he's moved to EV." },
    { id:"g4", week:WK, person:"p6", account:"a3", contact:"c4", code:"OG1.1", done:false,
      note:"LiLA demo follow-through. He raised traceability pain unprompted — strongest LiLA fit in the base." },
    { id:"g5", week:WK, person:"p4", account:"a4", contact:"c5", code:"OG4.1", done:false,
      note:"Sanjay is our strongest advocate. Ask who owns the Adaptive AUTOSAR migration." },
    { id:"g6", week:WK, person:"p3", account:"a6", contact:"c7", code:"OG2.1", done:false,
      note:"Telematics proposal outstanding since 30 July. Chased by email once — call this time." },
    { id:"g7", week:WK, person:"p5", account:"a5", contact:"c6", code:"OG2.2", done:false,
      note:"93 days silent. Next platform gate Q1 2027. Aim only to book the next conversation." }
  ],

  interviews:[
    { id:"i1", account:"a4", contact:"c5", who:"Sanjay Iyer", interviewer:"Jiji",
      date:D(21), done:true, recording:"",
      quotes:["They're the only vendor who understood our toolchain without three months of ramp-up.",
              "Honestly I didn't know you did functional safety. We gave that to LTTS."] },
    { id:"i2", account:"a1", contact:"c1", who:"Klaus Berger", interviewer:"Jiji",
      date:D(14), done:true, recording:"",
      quotes:["The engineers actually read the spec. That sounds small. It isn't."] },
    { id:"i3", account:"a3", contact:"c4", who:"Yuki Tanaka", interviewer:"Akshay",
      date:"", done:false, recording:"", quotes:[] }
  ],

  testimonials:[
    { id:"t1", quote:"They're the only vendor who understood our toolchain without three months of ramp-up.",
      who:"Chief Engineer, E/E Architecture", account:"a4", theme:"AUTOSAR", used:2 },
    { id:"t2", quote:"The engineers actually read the spec. That sounds small. It isn't.",
      who:"Head of Software Architecture", account:"a1", theme:"Embedded", used:0 },
    { id:"t3", quote:"Honestly I didn't know you did functional safety. We gave that to LTTS.",
      who:"Chief Engineer, E/E Architecture", account:"a4", theme:"Functional Safety (ISO 26262)", used:1 }
  ],

  stories:[
    { id:"s1", date:D(2), person:"p1",
      text:"Asked Klaus at Continental one reverse-DYK question and found out their ISO 21434 gap assessment is with KPIT and they're unhappy with the pace. We were never asked to quote because they didn't know we did it." },
    { id:"s2", date:D(5), person:"p6",
      text:"Yuki-san at Denso mentioned traceability pain twice in a status call. Raised LiLA — he asked for a demo before I finished the sentence." },
    { id:"s3", date:D(6), person:"p4",
      text:"Asked Sanjay what share of Tata's external engineering spend comes to us. He guessed 12%. We had been telling ourselves we owned that account." }
  ]
};
