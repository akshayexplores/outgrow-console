/* =====================================================================
   THE PLAYBOOK — every script, template and guide in one place.
   ---------------------------------------------------------------------
   This file is deliberately plain data so anyone on the team can edit
   it without touching application code. Change the words here and they
   change everywhere in the app — including the script that appears next
   to someone at the moment they are about to make the call.

   That contextual surfacing is the point. A playbook nobody opens is
   a document; a playbook that appears inside the log screen is a tool.
   ===================================================================== */

export const SERVICES = [
  "Aria", "Testing & QA", "Compliance Advisory",
  "Security Assessment", "Systems Integration", "Advanced Analytics", "Platform Engineering",
  "Sustainability Consulting", "Connected Services", "UX & Interface Design",
  "Process Consulting"
];

export const COMPETITORS = ["Vertex Partners","Meridian Consulting","Northgate Advisory","Solara Group","Bluepeak Systems","Ferrowave","Anchorpoint Labs"];
export const BUYING_ROLES = ["Economic","Technical","User","Coach"];
export const REL_LEVELS   = ["Not initiated","Progressing","Moderate","Good","Strong"];
export const CHANNELS     = ["Call","Voicemail + text","In person","Teams","WhatsApp","KakaoTalk","Video call"];

/* ---------- the eight proactive actions ---------- */
export const ACTIONS = [
  { code:"OG1.1", label:"Did You Know", short:"DYK",
    purpose:"Tell them about one thing they can buy from us that they don't know about.",
    scripts:[
      "Did you know we also do {service}?",
      "We've been doing a lot of {service} work lately — is that on your roadmap at all?",
      "Something you might not know about us: we do {service}. Worth a conversation?"
    ],
    note:"One service per ask. Two becomes a pitch. Aria is the standing DYK for every account — the existing base mostly doesn't know it exists."
  },
  { code:"OG1.2", label:"Reverse Did You Know", short:"rDYK",
    purpose:"Let the customer name what they need and currently buy elsewhere.",
    scripts:[
      "What else are you working on that we might be able to help with?",
      "What's going to other vendors right now that we could take off your plate?",
      "Who else are you using for testing on this programme?",
      "If you could hand one thing off to us tomorrow, what would it be?"
    ],
    note:"The highest-value action in the system — the customer names the opportunity themselves, so there is no guessing and no pitching. Check the competitors listed on the account before you ask."
  },
  { code:"OG2.1", label:"Pivot to Sale", short:"Pivot",
    purpose:"Close what's being discussed right now.",
    scripts:[
      "Shall we scope that and get you a proposal this week?",
      "When would you want us to start?",
      "Want me to add that to the current SOW?",
      "What would you need from us to make a decision on this?"
    ],
    note:"Ask directly. The most common failure is discussing something valuable and then ending the call without proposing a next step."
  },
  { code:"OG2.2", label:"Pivot to Next Conversation", short:"Next",
    purpose:"When there's nothing to close, secure the next contact.",
    scripts:[
      "Can I come see you when I'm in {city} in {month}?",
      "Should we set something up after your platform decision?",
      "When's the right time to pick this up again?",
      "Can I check back in after the programme review?"
    ],
    note:"Critical when cycles run long. With most conversations having nothing to close, this action is what keeps a long pursuit alive instead of letting it drift."
  },
  { code:"OG3.1", label:"Percentage of Business", short:"% Biz",
    purpose:"Ask for more while learning your actual share.",
    scripts:[
      "Roughly what share of your external engineering spend comes to us?",
      "Of the testing work you outsource, how much is ours?",
      "What would it take for us to be doing more of this for you?"
    ],
    note:"Expect the answer to be far lower than the account owner assumes. That gap is the single most effective thing for breaking the 'we already own this account' belief."
  },
  { code:"OG4.1", label:"Internal Referral Request", short:"Ref-In",
    purpose:"Reach more buyers inside the same customer.",
    scripts:[
      "Which other programmes here have the same problem?",
      "Who runs {service} for the other division?",
      "Is there an equivalent team in your {country} engineering centre?",
      "Who else sits on the toolchain decision besides you?"
    ],
    note:"Disproportionately valuable in enterprise accounts that span multiple divisions — buying committees on a qualified account often run into the dozens."
  },
  { code:"OG4.2", label:"External Referral Request", short:"Ref-Ex",
    purpose:"Introductions to people outside the account.",
    scripts:[
      "Who else do you know dealing with the same {service} headache?",
      "Anyone in your network I should be helping the way I help you?"
    ],
    note:"SCOPE: this is the one action that produces a new logo. Log the action, then hand the referral to the AE and the outbound engine — don't work it inside Outgrow."
  },
  { code:"OG5.1", label:"Testimonial Shared", short:"Story",
    purpose:"Let a happy customer do the persuading.",
    scripts:[
      "We just wrapped something similar at another enterprise account — their architecture lead said {quote}. Thought of you because you're facing the same thing.",
      "A customer told us last month: {quote}. That's exactly the problem you described."
    ],
    note:"Pull from the Testimonials library. Works by phone or message."
  }
];
export const acode = c => ACTIONS.find(a => a.code === c) || { label:c, short:c, scripts:[], purpose:"" };

/* ---------- the three-part call ---------- */
export const CALL_STRUCTURE = [
  { part:"1 · Open — human",
    body:["Hi {name}, I was thinking about you. How's things?",
          "How did the {programme} launch go in the end?",
          "How was the summer break?"],
    why:"\"I was thinking about you\" is doing real work. It signals the call was deliberate and that the person mattered enough to plan for." },
  { part:"2 · Shift to business — DYK / rDYK",
    body:["What are you working on right now that I could help with?",
          "Anything going to other vendors that we could take?",
          "We've been doing a lot of {service} lately — is that on your roadmap?"],
    why:"This is where the value is created. Ask, then stop talking." },
  { part:"3 · Pivot — sale, or next conversation",
    body:["When would you want us to start?",
          "Shall we scope it and send something this week?",
          "Can I come see you in {month}?"],
    why:"Never end without one of these. A conversation with no pivot is a nice chat." }
];

/* ---------- the lists ---------- */
/* All ten of the book's customer lists. The eleventh — prospects never
   contacted (cold) — is deliberately absent: that belongs to your
   existing outbound prospecting process and its own ICP list. Running
   it here would put two systems on the same accounts.

   `derive` computes membership where it can be computed. A list somebody
   has to maintain by hand decays within a month, and a decayed list is
   worse than no list because people stop trusting it.                  */
export const LISTS = [
  { id:"quotes", name:"Quotes & Proposals Outstanding", group:"Pipeline",
    blurb:"Sent, no decision. The fastest revenue in the system — competitors rarely chase.",
    approach:"Do not apologise for following up and do not re-sell. Assume it stalled because life got in the way, which it usually did. Your job is to make it easy to move.",
    opener:"Hi {name} — just following up on the {service} proposal we sent on {date}. Wanted to check if you had any questions about it.",
    then:["Is there anything in there that isn't quite right?",
          "Who else needs to see it before a decision?",
          "What's the realistic timeline on your side?"],
    pivot:"What would you need from us to move this forward?",
    voicemail:"{name}, it's {me} from Northwind. Following up on the {service} proposal — no pressure, just wanted to make sure you had everything you need. Give me a call when you get a chance.",
    text:"Hi {name} — left you a voicemail about the {service} proposal. Happy to walk through it whenever suits. — {me}" },

  { id:"prequote", name:"Pre-Quote — Nothing Sent Yet", group:"Pipeline",
    blurb:"An opportunity is open and no proposal has gone out. Stalled before it started.",
    approach:"Something is missing and it is usually information, not interest. Find the one thing blocking the quote and remove it. Do not let a live opportunity age quietly.",
    opener:"Hi {name} — we've been talking about the {service} work and I haven't got you a proposal yet. That's on me. What do I need from you to put something concrete in front of you?",
    then:["What would you want the scope to cover?",
          "Is there a budget range I should be working to?",
          "Who else should shape this before I write it?"],
    pivot:"If I get something to you by {month}, does that work?",
    voicemail:"{name}, {me} from Northwind. Want to get you a proper proposal on the {service} work — need two minutes of your input first. Call me back.",
    text:"Hi {name} — voicemail from me. Two quick questions and I can get your proposal written this week. — {me}" },

  { id:"large", name:"Large Accounts Who Can Buy More", group:"Wallet share",
    blurb:"Our biggest and best. The reverse Did You Know is the highest-yield question here.",
    approach:"You already have the relationship, so do not lead with what we sell — lead with what they need. Check which competitors are listed on the account before you dial.",
    opener:"Hi {name}, I was thinking about you. How's the {programme} going?",
    then:["What else are you working on that we could help with?",
          "What's going to other vendors right now that we could take off your plate?",
          "Roughly what share of your external engineering spend comes to us?"],
    pivot:"Shall we scope that and come back to you this week?",
    voicemail:"{name}, {me} from Northwind. I was thinking about you — had an idea about the {programme} work that might be useful. Call me back when you have two minutes.",
    text:"Hi {name} — voicemail from me just now. Nothing urgent, just an idea on {programme}. — {me}" },

  { id:"smallmed", name:"Small & Medium Accounts Who Can Buy More", group:"Wallet share",
    blurb:"They hear from us least, which is exactly why the ask lands.",
    approach:"These accounts are used to being ignored between deliverables. The call itself is differentiating before you ask anything. Lead with the Did You Know — they genuinely do not know our range.",
    opener:"Hi {name}, I was thinking about you — wanted to check in properly rather than only when there's a deliverable.",
    then:["Did you know we also do {service}?",
          "What else is on your plate this year?",
          "Is there anything you're outsourcing that you'd rather have us do?"],
    pivot:"Want me to put a short scope together so you can see what it'd look like?",
    voicemail:"{name}, {me} from Northwind. Nothing urgent — wanted to check in and mention something we do that might be useful to you. Call me when you get a chance.",
    text:"Hi {name} — left you a voicemail. Wanted to mention something on the {service} side. — {me}" },

  { id:"autopilot", name:"Revenue Autopilot", group:"Wallet share",
    blurb:"Flat, predictable spend every month. Predictability is masking untouched potential.",
    approach:"The hardest list to remember, because nothing looks wrong. Steady billing feels like health and is often just habit — the scope has stopped growing and nobody has asked why. Your job is to disrupt the automation.",
    opener:"Hi {name} — things have been ticking along nicely on {programme}, which is exactly why I wanted to call. When something runs smoothly we stop having conversations, and I don't want to miss something.",
    then:["Is the current scope still the right shape for what you're doing?",
          "What's changed on your roadmap that we haven't adjusted for?",
          "Would it help to have more people on this from next quarter?"],
    pivot:"Shall we look at extending the scope for the next cycle?",
    voicemail:"{name}, {me} from Northwind. Nothing wrong at all — things are running well. That's actually why I'm calling. Give me two minutes when you can.",
    text:"Hi {name} — voicemail from me. Nothing's wrong, promise. Just want to check we're not standing still. — {me}" },

  { id:"zerodark", name:"Zero Dark 30", group:"Decay",
    blurb:"Was buying steadily, then roughly nothing for 30 days. Silent churn, before anyone notices.",
    approach:"Speed matters more than polish. Thirty days is early enough that the cause is usually mundane — a person moved, a programme paused. Find out which before it hardens into a lost account.",
    opener:"Hi {name}, I was thinking about you — things have gone a bit quiet on our side and I wanted to check nothing's up.",
    then:["Has something changed on the programme?",
          "Are you still the right person for this, or has it moved?",
          "Anything we dropped that we should pick back up?"],
    pivot:"Shall we get something in the diary for next week?",
    voicemail:"{name}, it's {me} from Northwind. Things have gone quiet and I wanted to make sure everything's fine on your side. Call me back when you get a moment.",
    text:"Hi {name} — left you a voicemail. Just checking in, nothing's wrong on our end. — {me}" },

  { id:"silent6", name:"Silent 6+ Months", group:"Decay",
    blurb:"No meaningful contact in half a year. A powerful group to call, and easier than it feels.",
    approach:"Bring no agenda at all. If you open with business they will feel chased; if you open with the person they will tell you what changed. Expect it to be the most pleasant call of your week.",
    opener:"Hi {name}, I was thinking about you — it's been far too long. How are things?",
    then:["What are you working on these days?",
          "Has much changed on your side since we last spoke?",
          "Anything we could be helping with that we're not?"],
    pivot:"Can we put something in the diary to catch up properly?",
    voicemail:"{name}, it's {me} from Northwind. It's been a while and I was thinking about you — nothing urgent, just wanted to catch up. Give me a call.",
    text:"Hi {name} — just left you a voicemail. Been a while, wanted to see how things are going. — {me}" },

  { id:"decline", name:"Decreasing Revenue", group:"Decay",
    blurb:"Spending less year over year. A competitor is already inside.",
    approach:"Be direct and non-defensive. You are diagnosing, not defending. Whatever they say, do not argue — write it down and thank them. Early intervention is roughly ten times easier than resurrection.",
    opener:"Hi {name} — wanted to have an honest conversation. We've been doing less with you this year than last and I'd rather understand why than guess.",
    then:["What changed on your side?",
          "Is there something we got wrong?",
          "Who's picking up the work we used to do?"],
    pivot:"What would need to be true for us to be doing more again?",
    voicemail:"{name}, {me} from Northwind. Wanted to have a quick honest conversation about how things are going with us. Nothing wrong — I'd just rather ask than assume. Call me back.",
    text:"Hi {name} — left a voicemail. Would value ten minutes to ask you something directly. — {me}" },

  { id:"stopped", name:"Used to Buy, Stopped", group:"Decay",
    blurb:"Was a customer, isn't now. The business moved somewhere.",
    approach:"Assume nothing about why. Most lapsed accounts did not leave in anger — they drifted, or the person who championed us left. Ask plainly, accept the answer, and establish the next contact regardless.",
    opener:"Hi {name} — we worked together on {programme} and then it tailed off. I'd rather ask you directly than wonder: what happened?",
    then:["Was there something we could have done differently?",
          "Who's doing that work now, and how's it going?",
          "Is the door open if the right thing came along?"],
    pivot:"Can I come back to you when we've got something that fits?",
    voicemail:"{name}, {me} from Northwind. We worked together a while back and I wanted to reconnect — no pitch, I'd just like to understand what happened. Call me back.",
    text:"Hi {name} — voicemail from me. Would value a straight conversation about where things went. — {me}" },

  { id:"warm", name:"Warm — Evaluated, Didn't Buy", group:"Pipeline",
    blurb:"Relationship intact, they went elsewhere. Programme cycles turn.",
    approach:"They said no once. Do not relitigate it. The purpose is to still be there when the next decision window opens — which may be a year or more away. Almost nothing is lost forever; most things are lost by absence.",
    opener:"Hi {name}, I was thinking about you. No agenda — we didn't win that one, but I'd rather stay in touch than disappear.",
    then:["How did it work out in the end?",
          "What are you working on now?",
          "When does the next platform decision come round?"],
    pivot:"Can I check back in around {month}?",
    voicemail:"{name}, {me} from Northwind. No agenda at all — just wanted to stay in touch and see how the programme worked out. Call me when you get a moment.",
    text:"Hi {name} — voicemail from me. Genuinely no agenda, just keeping in touch. — {me}" }
];
export const listById = id => LISTS.find(l => l.id === id);
export const LIST_GROUPS = ["Pipeline","Wallet share","Decay"];

/* The one list we deliberately do not run here. */
export const EXCLUDED_LIST = {
  name:"Prospects never contacted (cold)",
  why:"This belongs to your organisation's existing outbound prospecting process — a separate ICP list, sequencer campaigns and an SDR motion. Running it inside Outgrow would put two systems, two cadences and two sets of benchmarks on the same accounts. Outgrow is the installed base."
};

/* ---------- voicemail doctrine ---------- */
export const VOICEMAIL = {
  rules:[
    "Twelve seconds. Longer doesn't get listened to.",
    "Write it to be read as a transcript — that's how most people consume it.",
    "Include \"I was thinking about you.\"",
    "Offer a premise of value — something you saw, something relevant to their programme.",
    "Always follow with a text immediately, referencing the voicemail."
  ],
  why:"Most calls end in voicemail, and that's fine — the voicemail is the action, not a failed attempt at one. It's also why three calls take under five minutes."
};

/* ---------- channel substitution by geography ---------- */
export const CHANNEL_MATRIX = [
  { geo:"India",        primary:"Phone call", follow:"WhatsApp", avoid:"—" },
  { geo:"US",           primary:"Phone call", follow:"SMS", avoid:"—" },
  { geo:"Germany",      primary:"Call to desk/mobile in business hours; Teams if an existing working relationship", follow:"Teams",
    avoid:"Unsolicited SMS to personal mobiles. Be careful with personal data generally." },
  { geo:"Japan",        primary:"Existing meeting cadence — in person or scheduled video; introductions via the known contact", follow:"Formal follow-up message",
    avoid:"Cold calls and unexpected mobile contact" },
  { geo:"South Korea",  primary:"Call within an existing relationship; KakaoTalk where already used", follow:"KakaoTalk", avoid:"Cold mobile contact" },
  { geo:"France",       primary:"Phone call", follow:"Email as follow-up only", avoid:"—" },
  { geo:"Italy",        primary:"Phone call", follow:"Email as follow-up only", avoid:"—" },
  { geo:"Sweden",       primary:"Phone call", follow:"Email as follow-up only", avoid:"—" }
];
export const CHANNEL_RULES = [
  "On-site beats everything. When someone from your team is physically at the customer, that conversation is worth more than any call and costs nothing extra.",
  "Email is never the action itself. It can confirm or follow up. If someone's logged actions are all email, the programme has quietly reverted to what it replaced."
];

/* ---------- Did You Know cross-sell map ---------- */
export const DYK_MAP = [
  { has:"UX & Interface Design", suggest:["Testing & QA","Compliance Advisory","Security Assessment","Aria"],
    why:"Interface-heavy programmes generate significant downstream validation load, and that load is usually outsourced separately." },
  { has:"Systems Integration", suggest:["Process Consulting","Compliance Advisory","Testing & QA","Aria"],
    why:"Platform migrations trigger process and compliance work." },
  { has:"Advanced Analytics", suggest:["Compliance Advisory","Testing & QA","Security Assessment","Aria"],
    why:"Analytics rollouts typically require compliance work rarely done in-house." },
  { has:"Sustainability Consulting", suggest:["Compliance Advisory","Platform Engineering","Connected Services"],
    why:"Sustainability initiatives pull compliance and connected-service work behind them." },
  { has:"Connected Services", suggest:["Security Assessment","Platform Engineering","Aria"],
    why:"Connected implies attack surface implies mandated compliance." },
  { has:"Testing & QA", suggest:["Aria","Process Consulting","Compliance Advisory"],
    why:"Aria automates exactly this work — the strongest single pairing in the portfolio. The testing audience inside qualified accounts is roughly twenty times the design audience." },
  { has:"Platform Engineering", suggest:["Compliance Advisory","Systems Integration","Aria"],
    why:"Platform work sits next to compliance and architecture decisions." },
  { has:"*", suggest:["Aria"],
    why:"Workflow automation, compliance, verification and defect management span every programme. Aria is the standing Did You Know for the whole base." }
];
export function dykFor(buys=[]){
  const out = [];
  DYK_MAP.forEach(m => { if (m.has === "*" || buys.includes(m.has)) out.push(...m.suggest); });
  return [...new Set(out)].filter(s => !buys.includes(s)).slice(0,4);
}

/* ---------- objections ---------- */
export const OBJECTIONS_INTERNAL = [
  { q:"I'm technical, this isn't my job.",
    a:"You're not being asked to sell anything. You know more about this customer's problems than anyone else on the team. All we want is that when you're already talking to them, you ask what else they're struggling with — and tell someone. If the answer is nothing, that's a fine answer." },
  { q:"I don't want to damage the relationship.",
    a:"That's the right instinct, and it's why we ask rather than pitch. \"What else are you working on?\" has never damaged a relationship. What does damage it is a customer finding out two years later that we could have helped and didn't say." },
  { q:"They'd have asked if they needed it.",
    a:"They can't ask for something they don't know exists. Most of our delivery customers don't know Aria exists. That's not their failure — it's ours." },
  { q:"I don't have time.",
    a:"Five minutes a day, and most of it inside conversations you're already having. If it's genuinely taking longer than that, tell me, because something's wrong with how we've set it up." },
  { q:"The customer is in a programme freeze — nothing's happening.",
    a:"That's the best time. Everyone contacts them when there's a decision to make. Almost nobody contacts them when there isn't, which is exactly why it lands." },
  { q:"We tried something like this before and it fizzled.",
    a:"Probably true, and worth taking seriously. What happened? Usually the answer is that nobody senior stayed with it, or the tracking got heavy. Both are things we can point at and show what's different." },
  { q:"Sales should be doing this.",
    a:"Sales is a small team. You're inside the account every week. This isn't about moving work onto you — it's that the conversation you're already in is worth more than any call the AE could make." },
  { q:"What if they ask about price?",
    a:"Perfect outcome. Hand it to the AE. Your job ends at \"that's interesting, let me get the right person to you.\"" }
];

export const OBJECTIONS_CUSTOMER = [
  { q:"We already have a supplier for that.",
    a:"Good — I'm not asking you to switch. What I'd like to understand is what's working and what isn't, so if there's ever a gap you know we can fill it. What are they doing well?" },
  { q:"Send me some information.",
    a:"Happy to. So I send the right thing rather than a brochure — what specifically are you trying to solve?" },
  { q:"We don't have budget.",
    a:"Understood, and I'm not asking for any today. When does the next planning cycle land? I'd rather be in the conversation early than turn up after it's decided." },
  { q:"Now isn't a good time.",
    a:"No problem at all. When is? I'll put it in my diary and come back to you then." },
  { q:"Why are you calling me?",
    a:"Honestly, no reason other than we work together and I'd rather stay in touch than only call you when something's gone wrong." }
];

/* ---------- happy customer interviews ---------- */
export const INTERVIEW = {
  purpose:"Not research. Not NPS. The purpose is recorded evidence, in the customer's own voice, that they value working with us and would happily buy more — then playing it to the people who are afraid to ask.",
  target:8,
  setup:"I'd love twenty minutes of your time — I'm interested in your thoughts and experiences working with us. Would that work?",
  consent:"Is it okay with you if I record this?",
  rule:"You talk 5%. They talk 95%. If you're explaining, defending or clarifying — stop, and ask the next question instead.",
  questions:[
    { q:"What are some of your favourite things about working with us?" },
    { q:"How does that help you?", star:true,
      note:"The most important question on the call. The first answer gives you features; this one gives you value in the customer's own language." },
    { q:"Follow everything with: Why? · How? · What else? · Tell me more. · Why do you say that? · Really? · That's interesting." },
    { q:"How many suppliers, providers or consultants do you work with?" },
    { q:"If you ranked them best to worst on the things we've been talking about — [say their own words back] — where would you rank us?" },
    { q:"Interesting. Is there anything else that puts us there?" },
    { q:"Tell me how you view your relationship with us. What's it like working with us?" },
    { q:"Give me three descriptive words that come to mind when you think about working with us." }
  ],
  never:{ q:"What could we do better?",
    why:"You will want to ask this. It feels responsible. Don't. It turns an appreciation call into a critique call, and a critique recording does the opposite of what this exercise is for. If they volunteer a criticism, acknowledge it briefly, note it, and steer back." },
  listenFor:[
    "\"I didn't know you did that.\"",
    "\"We give that to [competitor].\"",
    "Anything about how it helped, rather than what was delivered",
    "Any three-word description you could put on a slide"
  ],
  close:"Thank you so much — this was really valuable. I appreciate it.",
  after:["Timestamp the two or three best moments",
         "Pull direct quotes into the Testimonials library",
         "Log any \"didn't know you did that\" against the account",
         "Cut a 30–90 second clip for the Monday huddle"]
};

/* ---------- prompt card ---------- */
export const PROMPT_CARD = {
  title:"You're not selling. You're helping.",
  ask:["What else are you working on that we might be able to help with?",
       "What's going to other vendors right now that we could take off your plate?",
       "Which other programmes here have the same problem?"],
  before:"When should we pick this up again?",
  after:"Heard something? Text your manager on the way to the car. That's it. You're done.",
  rotation:[
    { m:"Month 1", focus:"Aria", fit:"Everyone — especially anywhere we touch testing" },
    { m:"Month 2", focus:"Security Assessment", fit:"Connected and platform programmes" },
    { m:"Month 3", focus:"Testing & QA", fit:"Design-heavy accounts carrying heavy validation load" },
    { m:"Month 4", focus:"Compliance Advisory", fit:"Analytics and sustainability programmes" },
    { m:"Month 5", focus:"Process Consulting", fit:"Accounts mid systems-integration migration" },
    { m:"Month 6", focus:"Aria", fit:"Revisit — awareness decays and the story is stronger by month six" }
  ]
};

/* ---------- cadence ---------- */
export const CADENCE = [
  { id:"daily", title:"Daily · 2 minutes", who:"Managers and leaders",
    items:["Send one recognition note","Suggest one Did You Know to one person"],
    why:"The point is that Outgrow is mentioned every single day by someone with authority." },
  { id:"weekly", title:"Weekly huddle · 15–20 min, Monday", who:"Whole team — the sponsor attends, visibly",
    items:["2 min · key metrics from Friday's scorecard",
           "3 min · one or two success stories, named people",
           "10 min · assign lists and actions; build the call planner",
           "First huddle of the month only: set that month's Did You Know focus"],
    why:"Deliberately light. The system's credibility depends on not becoming a meeting." },
  { id:"monthly", title:"Monthly 1:1 · 10 min each", who:"Manager and each participant",
    items:["Look back — did they swing enough? Hit target actions? What came out of it?",
           "Look forward — top wallet-share opportunity in their accounts",
           "Which of this month's DYK and referral focus applies to them",
           "Ask about long-running pursuits and treat continued effort as the achievement"],
    why:"This is where perseverance gets reinforced or quietly dies." },
  { id:"quarterly", title:"Quarterly planning · 90 min, group", who:"Outgrow leader and the whole team",
    items:["Look back — minimum targets met? Top five and bottom five performers",
           "What did the measured conversion rates turn out to be?",
           "Look forward — wallet-share, DYK, referral, pre-quote and priority-account focus"],
    why:"The only place the forecast model gets its inputs." }
];

/* ---------- CEO obligations ---------- */
export const CEO_DUTIES = [
  { d:"Mention Outgrow twice a day", n:"Unprompted, in ordinary conversation. Not a speech — a sentence. What a CEO mentions is what the organisation believes is real." },
  { d:"Attend the Monday huddle", n:"Every week, visibly. The weeks you miss are the weeks people conclude it's optional." },
  { d:"Write two sentences on the weekly scorecard", n:"Name two people and something specific they did. A scorecard from the admin is a report; one with your words on it is a signal." },
  { d:"Congratulate people publicly, by name", n:"Micro-wins especially. Peer recognition changes behaviour in a way bonuses don't." },
  { d:"Read the success stories and push them back out", n:"Forward one a week with a line of comment." }
];

/* ---------- doctrine shown throughout the app ---------- */
export const DOCTRINE = {
  mantra:"We are helping, not selling.",
  rule:"Every customer interaction gets a \"what else?\" (reverse DYK) and a \"when?\" (pivot). Applies to proactive calls, site visits, programme reviews — and inbound calls too. The support call isn't the action; the ask inside it is.",
  budget:"Five to ten minutes per person per day, including logging — for delivery staff. AE and Pre-sales, for whom proactive contact is the job, get 30–45 minutes.",
  stacking:"One conversation can carry several actions. Two DYKs, an rDYK and a pivot inside a call that was happening anyway is four logged actions for zero extra time.",
  swings:"We measure swings, not hits. You cannot control whether a customer buys; you have total control over whether you reach out.",
  patience:"Judge this on swings for at least two quarters. Enterprise cycles can run many months through procurement gates — measuring hits before the swings convert is the fastest way to kill the programme."
};

/* ---------- templated script filling ---------- */
export function fill(tpl, vars={}){
  return String(tpl).replace(/\{(\w+)\}/g, (m,k) => vars[k] || m);
}
