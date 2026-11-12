# Kitty: Product Requirements Document

**Version 1.46 · 12 Nov 2026 · Status: SUBMITTED. The app is complete and live at https://kitty-web.onrender.com (all phases built and tested).**
Owner: Ansh Varshney (solo) · Hackathon: *Build What's Next with PayPal and AI* (Devpost) · Deadline: Thu 12 Nov 2026, 12:00 PM PT (Fri 13 Nov, 1:30 AM IST)

> This PRD is the **single source of truth** for the build. Requirement IDs (`FR-…`, `NFR-…`, `AT-…`) are the build spec. To change the spec: edit `prd-source/Kitty-PRD.md`, bump the version in `prd-source/build.py`, add a row to the change log (§E3), and rebuild the PDF with `python prd-source/build.py`.
> Every step still has nuances to settle. Before each feature is built, we do a short **detail pass** (edge cases, screens, states) and record the result here as a minor version (v1.2, v1.3…).

---

## §0 How to read this document

> **Single source of truth for the build.** Requirement IDs (`FR-…`, `NFR-…`, `AT-…`) are the spec. Every step still has nuances to settle: before each feature is built, we do a short **detail pass** (edge cases, screens, states) and record it here as a minor version (v1.2, v1.3…). The source is `prd-source/Kitty-PRD.md`; rebuild with `python prd-source/build.py`.

| Part | What's in it | Read time |
|---|---|---|
| **Part A: The big picture** | Problem, hackathon fit, the solution on one page, users, goals, core concepts, the engine, architecture, trust model | ~15 min |
| **Part B: Features** | One section per feature, each with the same layout | Reference |
| **Part C: Platform mapping** | PayPal integration, AI and agents, data model, stack, repo layout | Reference |
| **Part D: Delivery** | Build plan, judging map, risks, decisions, acceptance tests | ~5 min |
| **Appendix E** | Glossary, references, change log | Reference |

**The layout of every feature section in Part B**

| Block | What it gives you |
|---|---|
| **In plain words** | The idea with no jargon |
| **Why it exists** | The pain it removes |
| **Flow** | The steps, as a numbered list or diagram |
| **Rules and edge cases** | The nuances the build must handle |
| **Under the hood** | Data, PayPal calls, AI and code split |
| **Requirements** | Numbered, testable requirements. `MUST` = required for v1. `SHOULD` = build if time allows. `MAY` = optional. |

**Naming rule used throughout:** every cat-themed name appears with plain words next to it, e.g. "**Yarn** (who owes whom)". The app UI follows the same rule (FR-UX-2).

---

# Part A: The big picture

## A1 The problem

### In plain words
Friends spend a lot of money together, and it's handled badly at both ends.
1. **Doing things together is financially messy.** Someone fronts the money, someone flakes, someone never pays back, and the money talk is so awkward that people avoid it.
2. **Your own spending with friends is out of control.** Plans add up quietly, nobody wants to be the one who says "too expensive", and no tool shows you what your friendships actually cost you each month.

Today's tools only tidy up afterwards: they record who owes what once someone has already paid. Kitty works **before, during and after** a plan, and it watches your own budget while you do it.

### The group side: planning and paying together

| Moment | What happens today |
|---|---|
| "We should do something!" | Nobody proposes, because nobody wants to be left on read |
| "I'm in!" | Costs nothing to say, so people flake |
| "Who's booking?" | One person fronts big money on soft yeses |
| "That's too much for me" | Nobody says it; they overpay quietly or drop out |
| "You still owe me…" | Nobody says it; they mute the chat instead |
| "I'm short this month" | Too embarrassing to ask; friends never find out they could have helped |

### The personal side: overspending with friends
- People overspend to keep up with friends, because nobody wants to be the one who says no.
- People can't see their "social spending" as one number, so it quietly eats their savings.
- Saving for fun with friends happens by accident, if at all.

### The evidence

| Data | Source |
|---|---|
| **42%** of young Americans overspend on outings with friends a few months a year; they spend about **$250 a month** on social outings | Ally Financial survey, Jun 2025 |
| **Nearly half** skip events because of cost; **17%** feel they can't be honest with friends about money | Ally Financial survey, Jun 2025 |
| **82%** of group travellers would pay *more* than their fair share to avoid money arguments | CIT Bank survey, Jun 2026 |
| **76%** of Gen Z who fronted money for a shared expense were never fully repaid; nearly **half** went into debt covering others | Zelle survey, 2025 |
| **1 in 5** muted a chat or cancelled plans to dodge a pay-back conversation | Zelle survey, 2025 |
| **1 in 5** Gen Z and millennials have ended a friendship over money | Experian survey |
| **37%** of US adults can't cover a $400 emergency with cash | Federal Reserve SHED (2025 data, May 2026) |

### Why existing tools don't fix it

| Tool | What it misses |
|---|---|
| Expense-splitting apps (Splitwise, Venmo Groups, PayPal split) | They act **after** someone has paid: they track the debt but don't prevent it. They don't help you plan, and they don't watch your budget. |
| Budgeting apps | They see your card transactions, but not your friend groups or the plans you're about to commit to |
| PayPal Money Pools (retired 2021) and Tilt (shut down 2017) | Group pots on their own, with no planning, no budgets, no agent |
| Personal AI agents (Meta Muse, Instinct, ChatGPT finance, Rocket Money's Rowan) | They deal with **businesses** on your behalf, not with your friends |

### Why Tilt and Money Pools didn't survive, and what that means for Kitty
| Product | What happened | What we take from it |
|---|---|---|
| **Tilt** (Crowdtilt, 2012–2017) | Its "nobody is charged until the group hits the goal" mechanic was loved, and it reached a $375M valuation in 2015. But it drifted from crowdfunding to campus social payments, dropped its 2.5% fee in a fight with free P2P apps, and spent heavily. Airbnb bought it in Feb 2017 (mostly for the team, who went on to build group travel at Airbnb) and shut it down by June 2017. | The mechanic works and people want it; Tilt died of focus and business-model problems. Kitty uses PayPal's rails (no money transmission of our own) and puts the pot inside a daily loop: planning, settling, saving, budgets. That loop brings people back every week, not once a year. |
| **PayPal Money Pools** (retired Nov 2021) | A standalone pot inside PayPal, mostly used for fundraising; PayPal folded it into other products | A pot on its own is a feature, not a reason to come back. Kitty attaches pots to plans and agents. |

### Why now
Personal AI agents arrived in 2026, and PayPal is building the payments layer for agents. Nobody has given **each friend an agent that speaks for them inside their friend groups**: one that knows their budget, availability and limits, keeps those private, and moves money only within rules they set.

## A2 How this answers the hackathon brief

| Brief asks for | Kitty's answer |
|---|---|
| A working project that meaningfully uses **PayPal (sandbox)** + **AI** | Orders bring money into each Treat Jar, Payouts send it out (a booking, a withdrawal, a friend who's owed), and Log in with PayPal and verified webhooks run underneath. A double-entry ledger records whose money is whose. One AI agent per user reads chats and screenshots, prepares answers, negotiates, writes rules and reads receipts. |
| A functional demo | The real hosted app. Judges log in with a PayPal sandbox account we give them and use it like anyone else (§B23) |
| AI tools listed | Gemini Flash-Lite / Flash (kittens), PayPal Agent Toolkit, APIMatic Context Plugin (coding) |

**Prizes we target**

| Prize | Why Kitty fits |
|---|---|
| 1st / 2nd / 3rd | A complete, design-led product |
| Most Creative | Personal cat agents for friend groups; whims; Pounce with whoever's in |
| Best Use of PayPal + AI | AI-prepared decisions end in real PayPal money movement: a refill in, a Payout out to pay for the booking |
| Best Demo Delivery | A visual, story-driven product with animated "money moments" |
| Best Use of Agentic Commerce | Kittens move money on their own within enforced rules and an allowance (medium fit: kittens don't buy from merchants) |
| Sponsor: Render | Hosting, Postgres, Workflows |
| Sponsor: APIMatic | PayPal Server SDK + Context Plugin used during the build |
| Sponsor: Channel3 | Real product search in Catnip |
| Sponsor: AG Grid (SHOULD) | Kitten Diary and My Month tables |

**The five judging criteria in one line each** (detail in §D2)
1. **Technology:** per-user agents that negotiate, a deterministic money referee, and a double-entry ledger between PayPal Orders (money in) and Payouts (money out).
2. **Design:** one polished, illustrated world with animated money moments.
3. **Impact:** money stops hurting friendships, and people stop overspending with friends.
4. **Innovation:** commit-first group money with private limits, kittens that negotiate for you before anything is fixed, agents that speak for you.
5. **Presentation:** a character-driven story with a clear before and after.

## A3 The solution on one page

> **Kitty helps friends plan, pay and save together, without anyone fronting money, chasing debts or overspending. Every user adopts a kitten: a personal AI agent that speaks for them in their friend groups. It knows their budget and limits, keeps them private, and moves money only within the rules they set. A neutral referee (code, not AI) sees everyone's private limits and decides what fits.**

**One engine, used everywhere:**

```
Whim → kittens prepare answers → you say yes, no or "negotiate" → plan → everyone's share comes from their Treat Jar → Pounce! (the host books with everyone's money) → settle → purrs
```

| Module | One line |
|---|---|
| **Plans** | Trips, dinners, tickets: commit first, nobody fronts, the booker is paid before booking |
| **Yarn** (who owes whom) | Everyday "I paid for you" moments, netted and settled; kittens do the reminding |
| **Kitty Party** (save together) | The squad saves a little every month; the savings pay for the next plan |
| **Nine Lives** (help a friend) | A friend in a tight spot; friends' kittens suggest help within their owners' rules |
| **Catnip** (group gifts) | A birthday is near; friends opt in to a secret gift group that disappears afterwards |
| **The Bowl** (shared subscriptions) | Spotify/Netflix/Wi-Fi shares collected monthly |
| **My Month** (your social spending) | What friends cost you this month, against your own fun budget |

**Around them:**
- **House Rules** (your kitten's mandate)
- **Treat Jar** (your kitten's allowance)
- **Meows** (the daily brief)
- **Kitten Diary** (every action, its reason and its PayPal ID)
- **Purrs** (fun reputation)
- **Export** to other assistants

## A4 Who it's for

**Primary market:** friend groups aged 18–35 in the US (PayPal/Venmo land; USD in v1). Secondary: flatmates, families, clubs.
*Note: PayPal ended domestic payments in India in April 2021, so Indian users are out of scope for v1 even though the idea was inspired there.*

| Persona | Situation | What Kitty does for them |
|---|---|---|
| **Priya, the organizer** | Always books and fronts; spends weeks chasing | Collects first, pays her before she books; she never chases again |
| **Sam, the quiet one** | Tighter budget; never says "too expensive" | A private limit; the plan fits or Sam sits out, and nobody is shown why |
| **Arjun, the overspender** | Says yes to everything; broke by the 20th | A fun budget; his kitten warns him privately before he goes over |
| **Rohit, in a tight spot** | $300 short for a car repair | A private, dignified request to the friends he picks |
| **Maya, the birthday girl** | Friends want to surprise her | Her kitten quietly tells her friends' kittens; whoever wants joins a secret gift group |
| **The flat** (4 flatmates) | Wi-Fi, Netflix, groceries, takeout | The Bowl for subscriptions, Yarn for groceries, a Kitty Party for the house party |

**Jobs to be done**
1. "Help us actually make plans happen, without me being the one who chases."
2. "Let me say no or 'too expensive' without saying it."
3. "Make sure I'm never out of pocket for the group."
4. "Stop me from overspending with friends, without making me look cheap."
5. "Help us save together for the things we'll do together."
6. "When a friend's in trouble, make helping easy, and asking less painful."

## A5 Goals, non-goals and success measures

**Product goals**
- G1: No one fronts money for a group plan.
- G2: No one has to ask a friend for money directly.
- G3: Everyone knows, privately, what their friends cost them each month, and stays within their own budget.
- G4: Privacy: nobody's budget, balance or reasons are ever shown to others.
- G5: The kitten acts on its own only within rules the user set, and always explains itself.
- G6: It feels like a game with friends, not a finance app.

**Hackathon goals**
- H1: Pass Stage 1: working hosted build, public repo with an OSS LICENSE, public video under 3 min, meaningful PayPal + AI use.
- H2: Score high on all 5 criteria (§D2).
- H3: Stay testable for free (to judges) until **15 Dec 2026**.

**Non-goals (v1)**
- Real money / PayPal live mode; non-USD currencies
- Native mobile apps (we ship a mobile-first web app)
- Push notifications and email (in-app only)
- Languages other than English
- A WhatsApp or iMessage bot (Meta's policy and APIs don't allow it; we import screenshots and pasted text instead)
- Integration with delivery or booking apps (Airbnb, Ticketmaster); users paste links or screenshots
- Reading bank or card accounts (My Month uses Kitty's own ledger)
- Credit-bureau reporting; interest-bearing loans; public fundraising; gambling
- **Cut in v1.1:**
  - Scaredy Cat (dares)
  - Prowl (overlap matching)
  - Kitten growth stages
  - Race pounce rule
  - Seat swap
  - Squad Jar
  - Push, email, i18n

**Success measures**

| Measure | Target |
|---|---|
| Plans where someone fronted money | 0 |
| Direct human-to-human money requests | 0 (kittens do the reminding) |
| Taps from whim to pounced plan, per member | ≤ 2 (confirm, approve a refill if the jar is short) |
| Users who stayed within their fun budget in a month | Shown as a percentage in My Month |
| Kitten actions with a visible reason | 100% |
| Money in = money out, per plan | Always (to the cent) |

## A6 Core concepts (quick reference; full glossary in §E1)

| Name | Plain words | Notes |
|---|---|---|
| **Kitten** | Your personal AI agent | Adopted at sign-up; name, look and breed (tone) |
| **Squad** | A friend group | Each squad has an illustrated home, its **rooftop** |
| **Stray** | A friend without an account | Joins from a link; signing up = adopting their kitten |
| **Whim** | An idea for a plan | Four simple fields; private until shared; can fade quietly |
| **Plan** | A whim that's happening | A simple card with a pot |
| **Pot** | A plan's shared money | Fills as each person's share comes from their Treat Jar |
| **Share** | What each person pays for a plan | Taken from their Treat Jar when the plan is made |
| **Negotiate** | Your kitten asks the host's kitten for another time or price | Only while it's a whim |
| **Pounce!** | The moment money moves | Shares charged, the booker paid before booking |
| **Booker** | The friend who books or buys | Gets paid by Kitty first |
| **Tag along** | Join after the Pounce | Others get the difference back |
| **Yarn** / **Untangle** | Who owes whom / settling it with the fewest payments | |
| **Kitty Party** | A squad's shared savings | Each member saves their own amount monthly |
| **Nine Lives** | Help for a friend in a tight spot | |
| **Catnip** | A group birthday gift | Opt-in; disappears after the birthday |
| **The Bowl** | A shared subscription | |
| **House Rules** | Your kitten's mandate | Templates + your own rules; enforced by code |
| **Treat Jar** | Your kitten's allowance | The only money it spends without asking |
| **Meows** | The daily brief | Plus urgent alerts when something can't wait |
| **Kitten Diary** | Everything your kitten did, why, and the PayPal ID | |
| **My Month** | Your money with friends (vs your fun budget) and your calendar | Blocks double booking |
| **Mini-squad** | A group made automatically when you send a whim to chosen friends | Archived after the plan; can be kept |
| **Need at least** | How many people the floater needs for the plan to happen | Set per whim; default half |
| **Purrs** / **collar tags** / **Top Cat** | Points / badges / weekly leaderboard | Behaviour, never money |

## A7 How it works, end to end (the engine)

```mermaid
flowchart TB
  W["Whim<br/>(from text, screenshot or link)"]:::human --> SP["Kittens prepare answers<br/>(interest, availability, budget)"]:::ai
  SP --> C["Each owner confirms<br/>in one tap"]:::human
  C -->|"enough yes"| P["Plan + pot"]:::ai
  C -->|"not enough"| F["Fades quietly"]:::muted
  C -->|"negotiate"| N["Kittens look for a time<br/>or price that fits;<br/>the host accepts or keeps"]:::ai
  N --> C
  P --> PI["Everyone's share<br/>comes from their Treat Jar<br/>(refill if short)"]:::money
  PI --> PO{"Enough people, all paid<br/>by the deadline?"}:::ai
  PO -->|"yes"| PX["The host taps Pounce!<br/>Pot goes to the booker's Treat Jar"]:::money
  PO -->|"no"| R["On ice,<br/>money back"]:::muted
  PX --> S["Book and pay from the jar;<br/>receipt → leftovers back"]:::money
  S --> PU["Purrs, My Month, Diary"]:::human
  classDef human fill:#FFF4E0,stroke:#A8650F;
  classDef ai fill:#EFEDFD,stroke:#5B4FD6;
  classDef money fill:#E3F5EA,stroke:#23794F;
  classDef muted fill:#F1F1F4,stroke:#9A98AE;
```

**The same story in 12 steps (a cabin trip).** Each step gets its own detail pass before it's built.
1. Priya shares a screenshot of the group chat ("cabin trip in Dec??") with her kitten Mochi. Mochi turns it into a **whim**: *Cabin trip · Dec 12–14 · Lake Tahoe · $600 in total · need 4 · Goa Squad*. Priya taps Share.
2. The squad's kittens each prepare an answer from what they know: free that weekend? Within this month's fun budget? Each owner gets one card with **Yes · No · Ask (kitten) to negotiate**.
3. Sam already has a plan that weekend, so Sam taps **Ask Biscuit to negotiate**. Biscuit finds Dec 19–21, which suits the most people, and asks Mochi. Everyone can read it on the whim: "Biscuit (Sam): This time doesn't work for Sam. Sat Dec 19 does."
4. Priya gets one card and taps **Accept**. The whim changes, and everyone is asked again.
5. Four say yes and nobody's negotiating → the whim becomes a **plan**. A plan doesn't change.
6. Each person's exact share, $150, comes from their **Treat Jar**. Tyler's jar is $40 short, so Tyler gets a card to refill it by the deadline.
7. Arjun said no at first, then **joins**: the share drops to $120, and the others get $30 back each.
8. By the deadline, everyone's money is in. Only Priya sees **Pounce**.
9. **Pounce!** Everyone gets a message that the plan is final, and $600 lands in Priya's Treat Jar.
10. Priya pays the cabin straight from her Treat Jar and uploads the receipt.
11. The kitten reads it: $580 in total → $20 left over → $4 back to each person's jar.
12. Collar tags: First Paw to Sam, Clutch to Priya. The squad streak goes to 7, and everyone's **My Month** updates.

## A8 System architecture

```mermaid
flowchart TB
  subgraph Client["Web app (mobile-first)"]
    UI["Screens: Meows, Squads/Rooftops, Whim composer, Nine Lives, My Month, My Kitten"]
  end
  subgraph Server["App server on Render"]
    API["API + Log in with PayPal sessions"]
    KR["Kitten runtime<br/>(one agent per user, Gemini)"]
    NE["Referee: money & rules engine<br/>(pure code)"]
    PP["PayPal service<br/>(Server SDK + REST + Agent Toolkit)"]
    WH["Webhook receiver"]
    EV["Event log + live updates (SSE)"]
    MCP["Export: MCP server, calendar, CSV"]
  end
  DB[("Render Postgres")]
  JOBS["Render Workflows / Cron:<br/>Meows, deadlines, reminders,<br/>Kitty Party cycles"]
  PAYPAL["PayPal Sandbox"]
  GEM["Gemini API"]
  C3["Channel3 API"]
  UI <--> API
  API --> KR --> NE
  KR --> GEM
  NE --> PP --> PAYPAL
  PAYPAL --> WH --> EV
  API <--> DB
  EV --> DB
  EV -. live updates .-> UI
  JOBS --> KR
  KR --> C3
  MCP --> DB
```

| Component | Responsibility | Trust |
|---|---|---|
| Web app | All screens; the PayPal JS SDK buttons for approvals | Untrusted client |
| API + sessions | Log in with PayPal, sessions, strays (signed links) | Trusted |
| **Kitten runtime** | One LLM agent per user: reads chats, screenshots and receipts, prepares answers, writes copy, calls **internal tools** | Untrusted output; every tool call is validated |
| **Referee** (money & rules engine) | The only component that sees everyone's private limits. Computes fits, shares, Pounces, untangles; enforces House Rules, the fun budget and the Treat Jar. | Trusted, deterministic, unit-tested |
| PayPal service | Every PayPal call, idempotent, with retries | Trusted |
| Webhook receiver | Verifies PayPal signatures; updates state | Trusted |
| Event log | Append-only record of every action + reason; feeds the live UI, Meows and the Kitten Diary | Trusted |
| Export | Read-mostly MCP server for other assistants; calendar feed; CSV | Trusted; no money moves |
| Jobs | Meows, deadlines, reminders, Kitty Party cycles, Catnip clean-up | Trusted |

## A9 Trust, safety and privacy model

### In plain words
Your kitten works for **you only**. It never shows anyone your numbers or your reasons. It only spends what's in your Treat Jar (or what you've confirmed), only within your House Rules, and it always shows why it did something. **You confirm every yes or no to a plan.**

### Principles
1. **Decisions cross kittens; numbers don't.** Kittens share "in / thinking / not this time". Private limits go only to the referee, which returns totals ("fits 5 of 6"). In a small squad, people may still guess who sat out; Kitty never *shows* it.
2. **Money logic is code, never the LLM.** Amounts, shares, limits and rule checks are computed and enforced by the referee. The LLM prepares; the code decides.
3. **Hard ceilings:** we never capture more than someone's hold, and the Treat Jar never goes negative.
4. **Payee lock:** money only goes to members of the plan, squad or gift group, at their verified PayPal email.
5. **One-tap confirmation for every plan decision:** the kitten never accepts or declines a plan without its owner's tap.
6. **Explain everything:** every kitten action carries a reason and a PayPal ID where money moved (Kitten Diary).
7. **No shame mechanics:** no public debts, no ranking by money, limited reminders, quiet hours.

### Requirements
- **FR-SEC-1** The referee MUST be the only component that reads other users' private limits, availability details or reasons. Kitten prompts MUST contain only the owner's own private data plus totals.
- **FR-SEC-2** All amounts MUST be computed in integer cents by code. LLM output MUST be schema-validated, and any number from an LLM (e.g. a receipt total) MUST be confirmed by a human before it moves money.
- **FR-SEC-3** A capture MUST NOT exceed the authorized amount. A Treat Jar or Kitty Party debit MUST NOT exceed the owner's balance.
- **FR-SEC-4** Payouts MUST go only to verified members of the plan, squad or gift group (payee lock).
- **FR-SEC-5** Every kitten action MUST be written to the event log with actor, the rule or approval that allowed it, amounts (owner-visible) and the PayPal ID if money moved.
- **FR-SEC-6** PayPal and Gemini secrets MUST live only server-side in environment variables and MUST NOT be committed.
- **FR-SEC-7** PayPal webhooks MUST be verified before any state change.
- **FR-SEC-8** Text from screenshots, pasted chats, links and receipts MUST be treated as data. It can never grant permissions or change House Rules (prompt-injection guard).
- **FR-SEC-9** Stray links MUST be signed, scoped to one squad or plan, and expire.
- **FR-SEC-10** No screen, feed or API response MAY show another user's limit, balance, debt amount or reason for declining.

---

# Part B: Features

## B1 Sign-up: adopt your kitten (5 pages max)

### In plain words
You sign in with your PayPal account, tell Kitty a few basics, adopt your kitten, set its House Rules from a template, and join your first squad. That's five pages, all required, so your kitten can work from day one. Optional extras come later.

### Why it exists
The kitten needs real information to act for you: who you are, where money goes, your budget and your limits. Asking for it once, up front, beats interrupting you later.

### The five pages

| Page | What you do | Required |
|---|---|---|
| **1. Welcome** | "Log in with PayPal". Kitty gets your name and **verified PayPal email** (where friends' money reaches you). | Yes |
| **2. About you** | Display name; **gender** (woman / man / non-binary / prefer not to say); **birth date**; toggle: "Let my kitten tell my friends' kittens when my birthday is near, for surprises" (default on); **interests**: pick at least 3 from options (food, travel, concerts, sports, outdoors, games, movies, nightlife, shopping, wellness…) or add your own. The kitten keeps learning interests from what you say yes to. | Yes |
| **3. Adopt your kitten** | Pick a look from the one kitten template: **fur colour** (6), **pattern** (4), **one accessory** (5) and **eye colour** (3); a **name** (suggestions: Mochi, Biscuit, Miso, Pickles, Tofu, Noodle); and a **personality**: Chatty, Polite, Chill, Hype, Warm or Formal (stored as the breed; tone of voice only), each with a sample line in that voice. The kitten fills about half the screen while you choose, with its neutral face so the eye colour is visible. The owner never picks a mood or pose: those follow what the kitten does (§B22). | Yes |
| **4. House Rules** | A filled-in template (§B3): monthly **fun budget** and **help amount**. Privacy defaults are shown. Tap a number to type it, or use − and +. | Yes (defaults pre-filled) |
| **5. Treat Jar + squad** | The **Treat Jar** and **free hand** together, because one is the money and the other is the limit on it. Treat Jar: pocket money for the kitten, starting amount $0 / $10 / $25 / $50 / custom (PayPal approval if above $0). Free hand: the biggest single payment the kitten can make from the jar without asking. A live example shows what those two numbers mean. Optionally, start a squad or join one with an invite link or code; they're two clear choices, and it can wait until later. | Yes, except the squad |

Then you land on **Meows** (home), where your kitten's first message welcomes you.

**Later (optional):** usual availability (weekday evenings, weekends), busy times (My Month → Calendar), dietary notes, quiet hours, per-squad rules.

**Breeds (tone only):**
- Siamese: chatty
- Persian: polite
- Tabby: chill
- Bengal: hype
- Ragdoll: warm
- British Shorthair: formal

### Strays (friends without an account)
1. A stray opens a squad or plan link and sees the plan.
2. To paw in, they approve a PayPal hold in the PayPal popup; refunds go back to the same PayPal payment.
3. Full sign-up (the 5 pages) is offered after their first paw-in. Their history moves to the new account.

### Requirements
- **FR-ONB-1** Sign-in MUST use **Log in with PayPal** (OpenID Connect) and store the verified PayPal email as the user's payout address. Fallback if sandbox login fails on day 1: email + password.
- **FR-ONB-2** Sign-up MUST be at most 5 pages and MUST collect: name, PayPal email (from login), gender, birth date, birthday-sharing choice, at least 3 interests (from options or custom), kitten look/name/breed, House Rules template values, and Treat Jar starting amount. A first squad MAY be added but MUST NOT be required.
- **FR-ONB-3** All sign-up fields except the first squad MUST be required; the House Rules template MUST come pre-filled with sensible defaults.
- **FR-ONB-4** Breed MUST change only the kitten's tone, never rules or money behaviour.
- **FR-ONB-5** Optional profile fields MUST live in My Kitten and MUST NOT block sign-up.
- **FR-ONB-6** A stray MUST be able to view a shared plan and paw in with a PayPal approval, without signing up; signing up later MUST attach their history.

---

## B2 Your kitten

### In plain words
Your kitten is a little character that works only for you. It speaks in its breed's tone, remembers what you like, prepares answers for you, and acts on its own only within your House Rules. There are no levels to unlock: **how much it does alone is set by your rules**, from sign-up onwards.

### What your kitten does vs what you do

| Situation | Kitten | You |
|---|---|---|
| A friend floats a whim | Prepares your answer (interest, availability, budget) with a one-line reason | Confirm, change or skip, in **one tap** |
| Join or decline a plan | Recommends | **Always confirm** (it never says yes or no for you) |
| Paw in after you said yes | Uses Kitty Party savings and the Treat Jar; if the jar is short, asks you to refill it for the difference | Approve the refill in PayPal if needed |
| Paw up (share went up) | Asks you privately; pays from the Treat Jar if within free hand | One tap |
| Pay off Yarn | Pays automatically if within free hand; otherwise prepares it | One tap above free hand |
| A friend needs help (Nine Lives) | Suggests an amount from your help rule | One tap |
| Kitty Party monthly saving | Moves from your Treat Jar on the day you picked | Informed in Meows; asked to top up if the jar is short |
| Bowl monthly shares | Move from your Treat Jar each month | Informed in Meows; added to Settle up if the jar is short |
| Anything above your free hand, or not from the Treat Jar | Never acts alone | Always asked |
| A plan that clashes in time with one you're already in | Prepares "busy" and won't paw you into both | You choose which one to keep |
| Would push you over your fun budget | Warns you privately with the numbers | Decide |
| A friend's kitten asks something it isn't sure about | Asks you in your kitten chat | Reply |

Unanswered requests expire as "no answer", never as an automatic yes.

### A friend's kitten
- You can message a friend's kitten: "Is Sam free Saturday?", "Is Sam coming to the cabin?"
- It answers only what Sam shares: availability, plan attendance, likes. It never shares money, limits or reasons.
- **If it isn't sure, it asks Sam** in Sam's private kitten chat ("Priya's kitten asked if you're free Saturday. You have nothing planned. Say yes?") and replies once Sam answers.
- **In your own kitten's chat**, your kitten tells you what it heard, in its own words and with no kitten names: "I asked Sam's kitten, and they said Sam looks free then." In your chat with Sam, Sam's kitten speaks for itself.

### Memory
- The kitten remembers friends' nicknames, favourite places, usual budgets, past plans and what you tend to say yes to.
- Memories are viewable and deletable in My Kitten.

### Voice
- First person, short, concrete. "I asked Biscuit if Sam's free Saturday. She's in."
- Never guilt-trips, never pushy.

### Requirements
- **FR-KIT-1** Each user MUST have exactly one kitten with a look, name and breed.
- **FR-KIT-2** The kitten's autonomy MUST come only from House Rules and the Treat Jar, enforced by the referee; there are no growth stages.
- **FR-KIT-3** The kitten MUST NOT accept or decline any plan, Catnip or Nine Lives request without its owner's confirmation.
- **FR-KIT-4** Prepared answers MUST include a one-line reason and be confirmable in one tap; several pending answers SHOULD be confirmable together.
- **FR-KIT-5** A friend's kitten MUST answer only from the friend's shared fields; when unsure, it MUST ask its owner in their kitten chat before answering.
- **FR-KIT-6** Kitten memory MUST be viewable and deletable.
- **FR-KIT-7** All kitten copy MUST be first person, follow the breed's tone, and never shame or pressure.

---

## B3 House Rules (your kitten's mandate)

### In plain words
House Rules tell your kitten what it may do alone, and what to ask you first. The page has three parts:
1. **Basics:** a short template you fill in once.
2. **My own rules:** type a rule in your own words.
3. **Squads:** one section per squad, for that squad only.

Every rule is enforced by code.

### Rule types (v1)

| ID | Rule | Where | Example | What the code enforces |
|---|---|---|---|---|
| R1 | **Fun budget** | Basics | "$300 a month on friends" | Totals everything you spend with friends each month, however it's paid; warns before you go over; anything over budget needs your tap |
| R2 | **Free hand** | Basics (squads can lower it) | "Up to $20 at a time" | The most the kitten pays **on its own, from the Treat Jar**, in one action. Anything bigger: it asks you. |
| R3 | **Help amount** | Basics (squads can change it) | "Suggest up to $25" | The amount the kitten suggests for Nine Lives |
| R4 | **What I share** | Basics | Availability: yes · Attendance: yes · Interests: yes · Money: never | What friends' kittens may say about you |
| R5 | **Usually in** | Squad | "Goa Squad plans under $40" | Kitten pre-fills "yes" for matching whims; you still confirm |
| R6 | **Save monthly** | Squad | "$10 a month to Goa fund" | Kitty Party contribution, from the Treat Jar on the day you picked |
| R7 | **Use savings first** | Retired in v1.33 | n/a | The host now chooses Kitty Party money or Treat Jar money when floating a whim (FR-WHIM-10) |

### Treat Jar, free hand and fun budget: how they differ
They sound alike, but each answers a different question.

| Setting | Answers | Is it money? | Example |
|---|---|---|---|
| **Treat Jar** | *Where* does the kitten's own money come from? | **Yes**: a real balance you loaded from PayPal | $25 in the jar |
| **Free hand** (R2) | *How much* may it spend alone, in one go? | No: a permission limit on the Treat Jar | Up to $20 at a time |
| **Fun budget** (R1) | *How much* do I want to spend on friends this month, in total? | No: a monthly target, tracked in My Month | $300 a month |

Example: your kitten may pay $18 for bowling from the Treat Jar on its own (within free hand). A $140 cabin share needs your tap, and then it comes from the Treat Jar too. **Both** count toward your $300 fun budget. With $0 in the Treat Jar, the free hand does nothing, and the kitten asks you for every payment.

**Not rules (inferred or defaulted):**
- Quiet hours (22:00–08:00, editable in settings)
- How your kitten reminds others (by breed, with fixed limits)
- Your interests (learned from what you confirm)

### Adding your own rule
1. Type it: "Never put me in plans on Sunday mornings", "Don't let me spend more than $50 on any one dinner".
2. Gemini tries to **fit it into an existing rule type** (e.g. "$50 per dinner" → a per-category cap under R1) and shows the result in plain words.
3. If no type fits, and the rule makes sense and **doesn't contradict** another rule, it becomes a **personal rule**.
4. **Guardrail for personal rules:** they can only make the kitten **more careful** (ask you, or prepare a "no"). They can never let it spend more or act on its own. When a personal rule might apply, the kitten asks you.
5. Contradictions are shown before saving ("This conflicts with: Usually in Goa Squad plans").

### Squad rules
- Added from the squad chat menu ("Add a rule for this squad") or in House Rules → the squad's section.
- They're **personal**: your squad rules are yours alone. Others can't see or edit them.
- They're shown in the squad's **My settings** tab.

### Requirements
- **FR-RULE-1** House Rules MUST offer the Basics template (R1–R4), My own rules, and one section per squad (R5–R7).
- **FR-RULE-2** Every rule MUST be stored as a typed structure and shown back in plain words before it's saved.
- **FR-RULE-3** The referee MUST evaluate typed rules deterministically; the LLM MUST NOT decide whether an action is allowed.
- **FR-RULE-4** Custom rules MUST first be mapped to an existing type; only if none fits, and the rule is coherent and non-contradictory, MAY it become a personal rule.
- **FR-RULE-5** Personal rules MUST only restrict (ask or prepare a no) and MUST NEVER widen what the kitten may spend or do alone.
- **FR-RULE-6** Conflicting rules MUST be flagged before saving.
- **FR-RULE-7** Squad rules MUST be editable only by their owner, from the squad chat menu, the squad's My settings tab, or House Rules.
- **FR-RULE-8** "Money: never shared" MUST be permanently on.

---

## B4 Treat Jar (your kitten's allowance)

### In plain words
The **Treat Jar** is a small balance you load from PayPal. It's the only money your kitten can spend without asking, within your free hand. You can top it up or withdraw it anytime.

### Honest mechanics
- Topping up is a real PayPal payment into Kitty's account.
- Jar spends are entries in Kitty's ledger. Real PayPal money moves when the pot pays the booker (a Payout), when friends are paid back (a Payout), or when you withdraw (a Payout).
- A paw-in, a Kitty Party saving or settling up from the jar is **not** a new PayPal payment. PayPal has no per-person wallets for a platform like this, so the money stays in Kitty's PayPal account and the ledger records whose it is.
- When you tap, the jar pays, whatever the amount. The free hand only limits what the kitten does without asking.
- **Every payment in Kitty comes from the Treat Jar.** If it's short, you're asked to refill it for the difference, and then it all comes from the jar. A refill is the only PayPal payment a person ever approves.
- **One complete record.** PayPal shows only money entering Kitty (refills) and leaving it (payouts, withdrawals), because PayPal only records real money moving and no app can add lines to someone's PayPal activity. The full record is in Kitty: the Diary, My Month and the download, with the PayPal ID on every line that went through PayPal.
- The **Kitten Diary** shows which actions moved real PayPal money, with the PayPal ID.

### Flow
1. **Top up:** choose an amount → PayPal checkout → balance up.
2. **Spend:** the kitten reserves jar money when it paws in, uses it at the Pounce, or releases it if the plan doesn't happen.
3. **Withdraw:** choose an amount → Payout to your PayPal email.

### Requirements
- **FR-JAR-1** Users MUST be able to top up via PayPal checkout (intent CAPTURE).
- **FR-JAR-2** Users MUST be able to withdraw their available balance via PayPal Payouts.
- **FR-JAR-3** The referee MUST keep a double-entry ledger (top-up, reserve, release, spend, refund, withdraw); the balance MUST never go negative.
- **FR-JAR-4** Reserved money MUST be released when a plan doesn't pounce, or the user isn't in the final group.
- **FR-JAR-5** The jar screen MUST show balance, reserved amount and recent entries, each with its reason.
- **FR-JAR-7** Every payment a person makes in Kitty MUST come from their Treat Jar. If it's short, the app MUST ask to refill it for the difference, and then take it all from the jar. A refill MUST be the only PayPal payment a person ever approves.
- **FR-JAR-8** Agreeing to pay and paying MUST be one step (owner, 11 Nov). Floating a whim, saying Yes to one, joining a plan or asking to tag along MUST set that person's share aside from their Treat Jar right then (their own savings first if the host chose Kitty Party money). If the jar is short, they MUST be asked to refill first, before anything is sent, and the step MUST finish by itself once, when the refill lands. Nobody MUST get a refill card later for something they already agreed to. A set-aside share MUST go back the moment it can't be used: the whim is taken back, fades or changes, they change their answer to No, the host says No, or the plan starts before the host answers. The only later refill card left is when someone drops out and everyone's share goes up (FR-PLAN-10).

---

## B5 Squads and rooftops

### In plain words
A **squad** is a friend group: "Goa Squad", "Flat 4B", "Office lunch gang". Each squad has an illustrated **rooftop** where the members' kittens sit, with the squad's pots and savings jar on the roof, filling and emptying as money moves.

### Squad tabs
| Tab | What's there |
|---|---|
| **Chat** | The squad chat: messages, plan cards, "I paid" cards, kitten updates (private data hidden). The menu holds "Add a rule for this squad". |
| **Plans** | Active and past plans with their pots |
| **Yarn** | Your strands in this squad, plus Untangle |
| **Party** | The squad's Kitty Party (shared savings) |
| **Bowl** | Shared subscriptions |
| **My settings** | **Your** rules for this squad (R5–R7, free hand override, notifications). Only you can see and change them. |

### Rules and edge cases
- Roles: a plan's **host** (whoever started it) and squad **admins** (the creator + anyone promoted).
- **Leaving:** blocked, with the reason, while you owe or are owed in the squad's Yarn, have a card still waiting, have Kitty Party savings there, host or book an unfinished plan, or hold a Bowl's account. Once those are cleared you can leave anytime and come back with the invite link. Anything that turns up later, such as an extra cost on a plan, stays on your Settle up list (§B20).
- Plans can include only some squad members.
- Max squad size in v1: 30.

### A whim to one friend
It goes to your chat with that friend, not a squad. The notification and cards are the same, and the card also shows in the chat. No squad appears in anyone's list. When they say yes it becomes a plan, and the plan belongs to that chat.

### Mini-squads (plans with a few chosen friends)
When you send a whim to individual friends (say 3 people) instead of a squad, Kitty quietly makes a **mini-squad** for it:
- It's named after the plan ("Bowling · Sam, Arjun, Maya") and works like any squad: chat, plan, pot, "I paid" cards, Yarn.
- It sits in your Squads list under "Plans with friends".
- After the plan is settled, it's archived automatically. A **Keep as squad** button turns it into a regular squad.
- You can pick anyone who shares a squad with you; anyone else joins as a stray from a link.

### Requirements
- **FR-SQD-1** Users MUST be able to create squads, invite via share links, and join via links.
- **FR-SQD-2** Each squad MUST have a rooftop view and the tabs Chat, Plans, Yarn, Party, Bowl, My settings.
- **FR-SQD-3** The Chat MUST show kitten activity in real time with private data hidden (e.g. "Biscuit: in, with a budget condition").
- **FR-SQD-4** My settings MUST be per user and visible only to that user.
- **FR-SQD-5** Leaving MUST be blocked, with the reason, while the user has open yarn, Kitty Party savings, an unfinished plan they host or book, or a Bowl account in that squad.
- **FR-SQD-6** A whim sent to chosen friends MUST create a mini-squad for that plan, archived after settlement, with a "Keep as squad" option.

---

## B6 Whims (ideas for plans)

### In plain words
A **whim** is an idea for doing something together, and it's where everything gets decided. You can make one from anything: a sentence, a WhatsApp screenshot, an Instagram post, an Airbnb link. You set the whole thing up when you float it. Each friend says Yes or No, or asks their kitten to negotiate a better time or price. It becomes a plan by itself once enough say yes and nobody's negotiating. After that, the plan doesn't change.

### Where you create one
1. **The centre "+" button** (on every screen): type, paste, or attach a screenshot or link.
2. **The "+" in a squad chat:** the squad is already chosen.
3. **Share to Kitty** from another app (WhatsApp, Instagram, browser): share a screenshot or link straight to Kitty (installed web app share target).
4. **In your kitten chat:** "Cabin trip in Dec with Goa Squad?"

### The fields (all the user ever fills)
| Field | Example | Required |
|---|---|---|
| **What** | "Cabin trip" | Yes |
| **Where** | "Lake Tahoe" | Yes |
| **When** | A date and time | Yes |
| **Price** | Total or each. "$600 in total" shows "If 3 go: $200 each · 6 go: $100 each" | Yes |
| **Who** | A squad, or chosen friends from your squads (a mini-squad is made for them, §B5) | Yes |
| **Need at least** | A small stepper: "go if 3 are in". Only when sending to a squad; with chosen friends the first yes is enough | Pre-set to half the squad; the floater changes it if they like |
| **Pay from** | Treat Jar · Kitty Party money. Only shown when the squad has a Kitty Party | Pre-set to Treat Jar |
| **Who books it** | The floater or anyone invited | Pre-set to the floater |
| **Answer and pay by** | A date and time before it happens | Pre-set to 48 hours, or the day before it happens if that's sooner |

"Need at least" is the floater's own number. It decides when the whim becomes a plan, and it's the plan's minimum for the Pounce (§B9).

The kitten fills these from screenshots and links (place, price, dates, image), and you correct anything with a tap.
These always apply:
- Visible only to the people chosen
- The floater stays anonymous until "need at least" is reached, or until a kitten negotiates (the kittens' chat names the host)
- Ends at its "answer and pay by" time

### How friends' kittens answer
For each friend, their kitten prepares an answer from three things:

| Check | From |
|---|---|
| **Interest** | Interests from sign-up, past plans, the "usually in" rule (R5) |
| **Availability** | Their Kitty calendar (plans they're in + busy times) and availability settings. A clash with a plan they're already in is a hard "busy" (§B20). |
| **Money** | Fun budget left this month, House Rules |

The friend sees one card, e.g. "Cabin trip in Dec. I think yes: you're free Dec 12–14 and it fits your budget." They tap **Yes · No · Ask (kitten) to negotiate**. There's no Maybe. If the time clashes with something or it's over their budget, the kitten puts Negotiate first. Pending cards are batched, so one tap can confirm several. A Yes is refused if it clashes with a plan they're already in. Unanswered cards expire as "no answer", never as a no. A Yes is a yes to paying: the share is set aside from their Treat Jar in the same tap (the floater's when they float it). If the jar is short, they're asked to refill first, and the Yes is sent the moment the money lands (FR-JAR-8).

### Fading quietly
If not enough friends say yes before the deadline, or so many say no that it can't happen, it fades right then. Only the person who floated it is told ("Not this time. Want me to try again next month?").

### Changing a whim
Only a negotiation changes a whim (§B7). A plan never changes.

### Requirements
- **FR-WHIM-1** Whims MUST be creatable from the centre button, a squad chat, and the kitten chat; share-to-Kitty from other apps SHOULD be supported.
- **FR-WHIM-2** Whims MUST be creatable from text, screenshots and links; the kitten MUST extract fields and show them for confirmation.
- **FR-WHIM-3** The form MUST let the floater set What, Where, When, Price (total or each), Who, Need at least, Pay from, Who books it and Answer and pay by. Where, When and Price MUST be set before a whim is floated. Who books it MUST default to the floater. Reaching the threshold with nobody negotiating MUST turn the whim into a plan by itself.
- **FR-WHIM-4** Each recipient's kitten MUST prepare an answer (yes, negotiate or no) from interest, availability and money, with a one-line reason, for one-tap confirmation. The choices MUST be Yes, No and Ask (kitten) to negotiate.
- **FR-WHIM-5** Answers MUST be private; only the count is visible, and only to the floater.
- **FR-WHIM-6** A whim that misses its threshold MUST fade, notifying only the floater.
- **FR-WHIM-7** A whim MUST change only through an accepted negotiation. Everyone MUST then be asked again.
- **FR-WHIM-8** The kitten MUST NOT create a whim from chat content without asking its owner first.
- **FR-WHIM-9** Reading a typed whim MUST NOT depend on the AI being available: code reads price (total or each), dates and times, and fills anything the AI misses; the whim is ready within the NFR-1 budget either way. Each friend's prepared answer shows their expected share.
- **FR-WHIM-10** The floater MUST choose at creation whether shares come from each person's own Kitty Party savings first or from the Treat Jar only. The whim is where things are decided; the plan MUST start with exactly what the whim ended with.

---

## B7 Kittens and the referee

### In plain words
Each kitten **speaks for its owner**: it knows their limits and availability, prepares their answers, and passes their decisions on. A neutral **referee** (code, not AI) sees private limits and works out what fits. Nobody else ever sees them.

The kittens negotiate at the whim stage only. It's one simple set of rules, and a person always makes the final call.

### What each part does
| Part | Does |
|---|---|
| **Kitten (AI)** | Reads chats, screenshots, links and receipts; prepares answers; explains results in friendly words; asks its owner when unsure |
| **Referee (code)** | Holds private limits; picks dates and options; computes shares; runs Pounces and untangles; enforces rules |

### Negotiating a whim
| Step | What happens |
|---|---|
| 1 | A friend taps **Ask (kitten) to negotiate**, or tells their kitten in chat ("can we do Sunday?") |
| 2 | Their kitten checks what's wrong: the **calendar** (a plan or busy time clashes) and the **budget** (their share is more than their fun budget has left). If nothing's wrong and they asked for nothing, it says so |
| 3 | **Time:** the same hour on the nearest day within 14 days either side, never before the deadline, that suits the most people. Later comes first when two days tie |
| 4 | **Price:** the price in whole dollars that fits their budget, at most 25% off |
| 5 | **Host's kitten:** if the host can't do that day, it counters once with the nearest day that works for both |
| 6 | **The host decides:** one card, Accept or Keep it as it is. Nothing changes until they tap |
| 7 | **Accept:** the whim changes and everyone's asked again. **Keep:** it stays as it was, and the person who asked has Yes or No |

### No loops
| Limit | Then |
|---|---|
| One try per person, per whim | "I've already asked once. It's yes or no now." |
| One negotiation at a time | "Another kitten is talking to the host. Ask me again once that's done." |
| Two changes per whim | Nobody can negotiate any more. It's yes or no for everyone |
| No day fits, or more than 25% off is needed | The kitten stops, tells its owner it's their call, and tells the host it couldn't find anything |

While a negotiation is open, the whim doesn't become a plan.

### The kittens' chat
Every negotiation is written on the whim, for everyone invited to read. Nobody can type there. Each line is a kitten speaking, with its owner in brackets:

> **Biscuit (Sam):** This time doesn't work for Sam. Sat Dec 19, 7:00 PM does. It suits 4 of 5 people. Can we move it?
>
> **Mochi (Priya):** Let me ask Priya.
>
> **Mochi (Priya):** Priya said yes. It's now Sat Dec 19, 7:00 PM. Everyone's kittens are checking again.

It shows only what's being asked for. It never shows a budget or a reason.

### Requirements
- **FR-NEG-1** Negotiation MUST run by the rules above, in code. The kittens' chat uses fixed lines.
- **FR-NEG-2** Private constraints MUST go only to the referee and MUST NOT appear in any other user's view, prompt or chat.
- **FR-NEG-3** The referee MUST choose deterministically and explain results only in totals ("suits 4 of 5").
- **FR-NEG-4** Reminders MUST respect quiet hours, with at most 2 per member per plan per week.
- **FR-NEG-5** Each person MAY negotiate once per whim; only one negotiation MAY be open at a time; a whim MAY change at most twice.
- **FR-NEG-6** If the kittens can't find a change, the asker's kitten MUST tell its owner it's their call, and the host MUST be told.
- **FR-NEG-7** Every change MUST be accepted by the host, and every answer MUST be its owner's one-tap decision.
- **FR-NEG-8** Retired in v1.33: a plan can't be edited.
- **FR-NEG-9** Negotiation MUST happen only while it's a whim. A price cut MUST NOT exceed 25%, and a new time MUST be within 14 days and not before the deadline.
- **FR-NEG-10** A whim MUST NOT become a plan while a negotiation is open.
- **FR-NEG-11** The kittens' chat MUST be on the whim, read-only, visible to everyone invited, as "Kitten (Owner)", and MUST NOT contain budgets or reasons.
- **FR-NEG-12** After an accepted change, everyone MUST be asked again on the new version.
- **FR-NEG-13** Negotiating MUST be possible from the card and from the kitten chat.

---

## B8 Plans and pots

### In plain words
A **plan** is a whim that's been decided. It doesn't change. It exists to collect the final amount from everyone's Treat Jar before the deadline, so the host can book it. Its card is short and easy to read. The money sits in the plan's **pot**.

### The plan card (what everyone sees)
| Element | Example |
|---|---|
| Title + image | Cabin B (from the link) |
| When · where | Dec 19–21 · Lake Tahoe |
| Your share | $150 |
| Who's in | Avatars marked in / thinking / not this time |
| Booker | Priya |
| Pay by | Fri 6 pm |
| Pot | Fills as shares come in (count and percentage only, never individual amounts) |
| Link | "See how the kittens decided" (the whim's chat) |
| Buttons | Put in my share (if it's still to come) · Withdraw · Tag along (if you're not in) |

### Who can do what
| Who | Can | What happens |
|---|---|---|
| Someone who said yes | Is in as soon as it's a plan | Their share comes from their jar. Short? They get a card to refill by the deadline |
| Someone who said no or didn't answer, before the Pounce | **Join** | They're simply added. Their share comes from their jar, everyone's share drops, and the others get the difference back |
| Someone who isn't in, after the Pounce | **Tag along** | They ask the host, who says yes or no (§B9) |
| Anyone in, before the Pounce | **Withdraw** | Their money comes back, and everyone else's share rises to cover it. If they were booking, the host books instead |
| Host, before the Pounce | **Cancel** | Everyone's money comes back |

### Requirements
- **FR-PLAN-1** The plan card MUST show only: title/image, when/where, the person's own share, who's in, booker, pay-by, pot fill, and the buttons above.
- **FR-PLAN-2** Retired in v1.33: plans have no settings to change.
- **FR-PLAN-3** Shares MUST be equal, split by largest remainder (custom splits, weights and cover are retired in v1.33).
- **FR-PLAN-4** Retired in v1.33: nobody sets a limit, so there's no ladder.
- **FR-PLAN-5** Visible member status MUST be in / thinking / not this time; no amounts or reasons may be shown to others.
- **FR-PLAN-6** The booker MUST default to the host, and MUST fall back to the host if the booker withdraws.
- **FR-PLAN-7** Every member MUST see their own share: the cost split across the larger of "need at least" and the number of people in. Example: need 3, 2 in, each share is cost / 3. After the Pounce it shows what they paid. Only their own share is shown.
- **FR-PLAN-8** The host MUST always be in: listed as In from the moment the plan exists, counted in who's in, and never asked. They can't withdraw; to back out they cancel the plan. A plan MUST NOT Pounce until the host's share is in. If it isn't by the deadline, the plan goes on ice.
- **FR-PLAN-9** A plan MUST NOT change once it's made. The only exception is a new deadline on a plan that's on ice.
- **FR-PLAN-10** When a plan is made, the share each person set aside when they said yes (FR-JAR-8) MUST become their money in the plan, to the cent, and anything over their share MUST go straight back. If someone drops out later and the shares go up, anyone whose jar is short for the extra MUST get one card to refill it by the deadline, and the extra MUST go in as soon as the refill arrives.
- **FR-PLAN-11** Joining before the Pounce MUST need nobody's approval, and MUST lower everyone's share and return the difference, to the cent.
- **FR-PLAN-12** Withdraw MUST be per person and only before the Pounce. It MUST return that person's money and adjust everyone else's share.

---

## B9 Collecting and the Pounce

### In plain words
Once it's a plan, each person's exact share comes from their Treat Jar. When enough people are in and everyone's money has arrived, **only the host sees Pounce**. **Pounce!** makes the plan final: everyone is told, and the pot goes into the booker's Treat Jar so they can book it.

### Where the money comes from (in this order)
1. **Your own Kitty Party savings** for that squad, only if the host chose Kitty Party money for this plan. Only your own savings are used, never anyone else's (§B13).
2. **Treat Jar**, whatever the amount. The free hand only limits what the kitten does alone.
3. **Short?** You get a card to refill the jar for the difference (one PayPal approval). It then all comes from the jar.

### When the host can Pounce
All of these must be true:
| Condition | |
|---|---|
| Enough people | At least "need at least" are in |
| Everyone has paid | Every share is in the pot, including the host's |
| Before the deadline | The one set on the whim |

### At the deadline
| Situation | What happens |
|---|---|
| Everyone in has paid, and there are enough | The host can Pounce |
| Someone hasn't paid, and there are still enough without them | They're dropped, and everyone else's share adjusts |
| The host hasn't paid, or too few are left | The plan goes **on ice**, and everyone's money comes back. The host can set a new deadline, which collects everyone's share again, or cancel |
| The host never Pounces by the start time | Everyone's money comes back |

### Rounding (money always balances)
- All money is in **integer cents**.
- Shares are split with the **largest-remainder method**: if $680.00 is split 6 ways, two people pay $113.34 and four pay $113.33. Who pays the extra cent is decided by paw-in order, earliest first.
- **Invariant, checked in tests and at runtime:** for every plan, the money collected = what was paid out + what was refunded, to the cent.

### The Pounce (one run, all or nothing)
1. Lock the plan. Only the host's tap can do it.
2. Fix each person's final share.
3. Move the whole pot into the **booker's Treat Jar**.
4. Tell everyone: "(Plan) is final. (Booker) is booking it now with everyone's money."
5. Tell the booker: "Everyone's $X is in your Treat Jar. Book it, then add the receipt."
6. Live update: the pot animates, Pounce!, and Meows updates for everyone.

### Paying for the booking
The booker pays straight from their Treat Jar. They don't withdraw first. They can pay in parts, up to what the plan comes to. Once it's all paid, the plan says "Payment made", the Pay button goes away, and everyone else sees that it's been paid for.

| Where they're paying | How |
|---|---|
| Anyone with a PayPal account (a host, a seller, a friend) | **Pay from my jar**: Kitty sends a PayPal Payout to that email, from the booker's jar |
| A website checkout or a card machine | PayPal can't do this from Kitty's account. The booker pays with their own PayPal or card, taps **I paid another way**, and takes everyone's money out of their Treat Jar |

### Tag along (only after the Pounce)
Before the Pounce, someone new just joins (§B8). After it, the plan is final, so they have to ask.

| Step | What happens |
|---|---|
| 1 | They tap **Tag along** on the plan, or on the card anyone who never answered the whim gets after the Pounce, or tell their kitten. Their share is set aside from their Treat Jar in the same tap. If it's short, they refill first, and the ask goes out when the money lands (FR-JAR-8) |
| 2 | The host gets one card: "(Name) is asking to tag along on (plan). OK?" **Yes · No** |
| 3 | **No:** they're told no, and what they set aside goes straight back. They can't ask again on this plan |
| 4 | **Yes:** the share they set aside goes to the Treat Jar that holds the pot, in the same step. That's the host's, unless someone else is booking |
| 5 | From that same jar, everyone already in gets back the difference. The booker's own difference just stays in their jar |
| 6 | **No answer before it starts:** what they set aside goes back, and they're told |

The money moves in one step, so it can never stop halfway. Everyone on the plan, including the newcomer and the host, then gets a message in their kitten's chat saying what changed. It stays unread until they open the chat.

Tagging along is possible until the plan starts. It's paused while an extra cost is still being collected.

**Example:** $500 go-karting, 4 people paid $125 each, and it's in Tyler's jar. Marcus asks and Tyler says yes. The new share is $100.
| | Change |
|---|---|
| Marcus's jar | −$100 |
| Tyler's jar | +$100 in, −$75 back to the others (+$25 net) |
| Ava, Jordan, Zoe | +$25 each |

If a receipt has been confirmed, the shares are worked out from the receipt's total.

### After the Pounce
Nobody can withdraw and the host can't cancel: the booker is spending the money. The receipt settles any difference (§B10). Anything else between friends goes through Yarn.

### Flow diagram
```mermaid
sequenceDiagram
  participant K as Members' kittens
  participant R as Referee
  participant H as Host
  participant B as Booker's Treat Jar
  participant PP as PayPal
  R->>K: plan made, shares due by Fri 6pm
  K->>R: each share from the Treat Jar
  K-->>PP: a refill, only if a jar is short
  R-->>H: everyone's money is in: Pounce?
  H->>R: Pounce
  R->>B: the whole pot
  R-->>K: the plan is final
  B->>PP: Payout to the place being booked
```

### Requirements
- **FR-POUNCE-1** Every share MUST come from Kitty Party savings (if the host chose them), then the Treat Jar, whatever the amount, with no separate PayPal payment. If the jar is short, the kitten MUST ask to refill it for the difference and then take it all from the jar.
- **FR-POUNCE-2** Only the host's tap MUST Pounce (the everyone-in and at-least-N rules are retired in v1.33).
- **FR-POUNCE-3** Retired in v1.33: nobody sets a limit.
- **FR-POUNCE-4** Retired in v1.33: paw-ups.
- **FR-POUNCE-5** Retired in v1.33: cover.
- **FR-POUNCE-6** All amounts MUST be integer cents, split by largest remainder; the money-balance invariant MUST hold for every plan.
- **FR-POUNCE-7** The Pounce MUST move the pot in one idempotent run.
- **FR-POUNCE-8** At the deadline, unpaid members MUST be dropped; if the host hasn't paid or too few are left, the plan MUST go on ice and all money MUST go back within 15 minutes (the next timer run).
- **FR-POUNCE-9** After the host says yes, tag along MUST take the new share from the newcomer's Treat Jar (and own savings, if the host chose them), put it in the Treat Jar holding the pot, and return the difference to existing members from that jar, balancing to the cent, in one transaction.
- **FR-POUNCE-10** Retired in v1.33: the app doesn't use PayPal holds.
- **FR-POUNCE-11** Pounce MUST be offered to the host only, and only when enough people are in and everyone's money has arrived, before the deadline.
- **FR-POUNCE-12** On Pounce, the pot MUST go to the booker's Treat Jar, and everyone MUST get a simple message that the plan is final.
- **FR-POUNCE-13** The booker MUST be able to pay anyone with a PayPal account straight from their Treat Jar. Only the booker can do this for their plan, never for more than the jar has. It MUST be logged with its PayPal ID, and the money MUST go back to the jar if PayPal fails. The total paid MUST NOT exceed what the plan comes to, and once it's fully paid, the plan MUST show that and MUST NOT offer paying again.
- **FR-POUNCE-14** Tag along MUST only exist after the Pounce. Asking MUST set the share aside (FR-JAR-8); it moves to the pot only on the host's Yes. The host, and only the host, MUST answer Yes or No, from the card, the plan page or the kitten chat.
- **FR-POUNCE-15** A no MUST be passed on, and the set-aside share MUST go straight back. Each person MAY ask once per plan.
- **FR-POUNCE-16** The host's Yes MUST be the only thing left: the newcomer's money and everyone's refunds MUST move in that same step, with nothing more asked of anyone. An ask the host hasn't answered by the time the plan starts MUST end, and the share MUST go back.
- **FR-POUNCE-17** Tag along MUST be refused once the plan has started, while an extra cost is being collected, for someone already in, and on a hard calendar clash.

---

## B10 After the Pounce: receipts and leftovers

### In plain words
The booker pays with the money in their Treat Jar, snaps the receipts, and the kitten reads them. Any leftover goes back automatically, or into the squad's Kitty Party if the squad prefers. If it cost a bit more, each kitten asks its owner for the small extra.

### Flow
1. After the Pounce, the booker's card in Meows and on the plan is **Pay from my Treat Jar** or **I paid another way**. "Another way" counts as paid, and everyone's money stays in their Treat Jar to take out. Only once it's paid does the card become "Add the receipt for Cabin B".
2. The kitten reads the totals; the **booker confirms** the number.
3. **Under budget:** the booker returns the leftover from their Treat Jar (a refill if it's short), and each person gets their part back in proportion to what they paid, **to the same place it came from**: their own savings or Treat Jar. If the squad chose "leftovers to savings", each person's whole leftover goes into **their own** Kitty Party savings instead.
4. **Over budget (up to 15%):** each member's kitten asks for their part, which comes from the Treat Jar and goes to the booker's Treat Jar. Over 15% needs the host's approval first.
5. No receipt in 72 h → the booker gets at most 2 reminders, and the squad sees "receipt pending".
6. After the event: an optional memory card with photos.

### Requirements
- **FR-SETTLE-1** Receipt totals read by the kitten MUST be confirmed by the booker before any refund or charge.
- **FR-SETTLE-2** Leftovers MUST go back to each person in proportion to what they paid, to the source each part came from (own savings or Treat Jar), or into each person's own Kitty Party savings if the squad's setting says so.
- **FR-SETTLE-3** Overruns up to 15% MUST be asked per member; above 15% MUST need host approval.
- **FR-SETTLE-4** Every settlement MUST keep the money-balance invariant.

---

## B11 Yarn and Untangle (who owes whom)

### In plain words
Not everything is a planned trip. At dinner, Priya pays for three people; next week Sam covers the cab. **Yarn** keeps these everyday moments as cards in the squad chat, nets them out, and **untangles** them with the fewest payments. And the kittens do the reminding.

### "I paid" cards
1. In a squad chat: **+ → I paid**. Enter the amount, what it was, and for whom (or snap the receipt).
2. Choose **Split it** (adds to Yarn) or **My treat** (a gift, nothing owed). A split can be **Equally** or **Unequally**: unequally puts an amount against each person, and they have to add up to the total.
3. A card appears in the chat: "Priya paid $48 for dinner for Sam and Arjun". Each person's kitten asks them to confirm in one tap ("Yep" / "That's not right").
4. Confirmed → it's in Yarn. Disputed → paused until fixed.
5. The reverse works too: "Sam paid for me" logs it on Sam's side, and Sam confirms.

### The kittens work it out
A card is settled between the two kittens, one person's part at a time.

1. Jordan logs "I paid $48 for dinner". Jordan's kitten tells Ava's kitten, and Ava's kitten says it'll check.
2. Ava's kitten files the card: who paid, how much, Ava's part. Tapping it opens the whole card. It also shows in Settle up and the squad's Yarn.
3. Ava can say **Yes**, or **Not right** and say why ("$10, I only had a salad"), on the card or just by telling her kitten.
4. Ava's kitten takes that to Jordan's kitten. Jordan gets a card: **Accept $10**, **Keep $16**, or suggest another amount.
5. It goes back and forth until both agree. Only the person whose turn it is can answer.
6. Once agreed, Ava's kitten pays: from the Treat Jar if it's within free hand and there's enough. Otherwise it asks Ava to pay, with one tap.

The kittens' conversation appears in the chat with that friend. Each person's part counts as soon as it's agreed, so one quiet friend doesn't hold up everyone else. Parts left unpaid are still netted by Untangle.

### Untangle
1. Any member taps Untangle, or it runs by itself once a week (owner decision, 8 Nov: nobody should have to start it).
2. The referee computes the fewest payments that settle everyone.
3. Each person who owes gets one card: "Pay $23.50 to untangle Flat 4B". Tapping Pay uses the Treat Jar, with a refill for the difference if it's short. The kitten pays alone only within free hand. Kitty then pays each person owed via Payout.
4. If unpaid after 3 days, the kitten of the person owed reminds the payer's kitten, privately.

### Kittens do the chasing (8 Nov)
Nobody should ever have to ask a friend for money, or nudge them to answer. Kittens send every reminder, privately, on a fixed schedule, and stop on their own.

| What's open | Who hears about it | When | At most |
|---|---|---|---|
| "I paid" card not answered | Whoever hasn't answered | 2 and 5 days after it was logged | 2 |
| Confirmed Yarn nobody has untangled | Everyone on it, as a normal pay card | Untangle runs by itself 7 days after the card was logged | Once per card |
| Untangle payment not paid | The payer | 3 and 7 days after the Untangle | 2 |
| Whim you haven't answered | That person. The floater stays anonymous | 48 and 12 hours before the deadline, once it's 6 hours old | 2 per whim |
| Plan share that isn't in yet | That person | 48 and 12 hours before the deadline | 2 per plan |
| Receipt missing | The booker | 72 hours and 6 days after the booking was paid | 2 |
| Treat Jar short for a Kitty Party saving or a Bowl share | That person | On their day | 1 per 3 days |

A person can also send one early, with Nudge on a friend's chat or in My Month, or by telling their kitten. It's for the first open thing between them: money owed, a card, a share missing on a plan they host, then a whim they floated. It uses up one of the same reminders, so the limits above still apply.

**How every reminder behaves**
- It's a card in Needs you, one tap away, in the friend's kitten's voice: "Biscuit asked me to remind you: $16.00 to Ava is still open."
- It waits until the person's quiet hours end.
- Only the person being reminded sees it. The one thing a squad sees is "receipt pending", with no name.
- The person owed does nothing. Their own kitten tells them it's on it. Notes about cards and plans never say who hasn't answered.
- It stops the moment the thing is done, and never goes past its limit.
- After the last reminder on a card, the person who logged it is told they can fix or remove it. A card still needs everyone's yes (FR-YARN-2).

### Requirements
- **FR-REMIND-1** Reminders MUST follow the schedule and limits above, stop when the item is done, and be sent once even if the timer runs twice.
- **FR-REMIND-2** A reminder MUST wait until the recipient's quiet hours end.
- **FR-REMIND-3** Each reminder MUST appear as a one-tap Needs you card in the sending kitten's voice, private to the recipient.
- **FR-REMIND-4** The person owed (or the host) MUST be told privately that their kitten is on it, and MUST NOT be told who hasn't answered a card or plan.
- **FR-REMIND-5** Untangle MUST run by itself weekly, MUST NOT move money, and MUST NOT run while an Untangle payment is open.
- **FR-REMIND-6** A friend's kitten's question MUST reach the owner as a card with Yes, No and a typed reply, and MUST expire after 72 hours as no answer.
- **FR-YARN-1** Squad chats MUST support "I paid" cards with amount, note, people, split or treat, and an optional receipt photo. A split MUST be equal or unequal; an unequal split MUST have an amount for everyone sharing it, adding up to the total.
- **FR-YARN-2** Each involved person MUST confirm or dispute a card in one tap before it counts.
- **FR-YARN-3** The referee MUST keep per-squad balances and compute an untangle with the fewest transfers.
- **FR-YARN-4** Settlement MUST use the Treat Jar when the person taps Pay, with a refill if it's short (the kitten alone: within free hand), with Payouts to the people owed.
- **FR-YARN-5** Reminders MUST be private, kitten to kitten, and respect quiet hours.
- **FR-YARN-6** Squad views MUST show only "all untangled" or "N open"; amounts appear only in personal views.

---

## B12 Nine Lives (help a friend)

### In plain words
When a friend hits a rough patch (a car repair, a rent gap), they can quietly ask the friends they choose. Each friend's kitten suggests what they could give, from their own help rule. Friends say yes with one tap, and the money reaches the friend fast and privately. Help can be a gift or a no-interest loan.

### Tone
The feature is called Nine Lives, but requests are written plainly and kindly: "Rohit could use a hand with a car repair." No cat puns in requests.

### Flow
1. **Ask:** Rohit tells his kitten "I need $300 for a car repair by Friday". The kitten drafts it: amount, date, a short note (Rohit edits), gift / loan / either, and who to ask.
2. **Send:** it goes privately to the chosen friends. It never appears in squad chats.
3. **Suggest:** each friend's kitten suggests an amount from their help rule; the friend confirms or changes it in one tap.
4. **Pledge:** from the Treat Jar, with a refill for the difference if it's short.
5. **Fill:** at the target or date → capture → one Payout to Rohit. Rohit can accept a partial amount anytime.
6. **Loans** become Yarn with a no-interest plan Rohit picks; the lender can turn a loan into a gift anytime.
7. **Thanks:** Rohit's kitten sends thank-you notes; helpers get the Lifesaver collar tag.

### Rules
- One open request per person; at most 3 per 90 days.
- Only people who share a squad with the requester can be asked.
- Declines are invisible; helpers can stay anonymous to the requester.

### Requirements
- **FR-LIVES-1** Users MUST be able to send a help request with amount, date, note, type and chosen recipients.
- **FR-LIVES-2** Requests MUST be private to the chosen recipients.
- **FR-LIVES-3** Each recipient's kitten MUST suggest an amount from their help rule; giving MUST need the recipient's tap.
- **FR-LIVES-4** Pledges MUST be Treat Jar reservations, captured and paid out to the requester in one Payout; partial acceptance MUST be supported.
- **FR-LIVES-5** Loans MUST become Yarn with no interest; lenders MUST be able to convert a loan to a gift.
- **FR-LIVES-6** Limits: one open request per user; 3 per 90 days. Declines MUST be invisible.

---

## B13 Kitty Party (save together, enjoy together)

### In plain words
A **Kitty Party** is a squad's shared savings. Each member chooses **their own** monthly amount ("my kitten puts $10 a month into Goa fund, from my Treat Jar"), and the savings grow in one shared jar. When the squad makes a plan, each member's own savings pay their share first, so they chip in less or nothing. Friends save together, then enjoy together.

### Why it exists
Most friend spending is unplanned, and that's how people overspend. Saving a little each month for the things you'll do together builds a habit, and makes the big plans painless.

### Flow
1. **Start:** in the squad's Party tab, anyone creates a Kitty Party: a name ("Goa fund") and a goal ($1,200).
2. **Join:** each member picks their monthly amount and the day of the month it moves, from 1 to 28 (a squad rule, R6). Members can join with different amounts or not at all.
3. **Each month:** on each member's day, their kitten moves their amount from their Treat Jar into the jar. Each member's own part is tracked ("your savings in Goa fund: $60"). The jar shows what each person puts in a month. Each saving is logged in My Month and the Diary. It isn't counted as spending, because the money is still theirs.
4. **Use:** when the host floats a whim and chooses Kitty Party money, each member's **own** savings pay their share first. Example: Sam's share is $140, and Sam has $60 saved → $60 comes from savings and only $80 from the Treat Jar.
5. **Leftovers:** plan leftovers can flow back into the party (a squad setting).
6. **Withdraw:** members can take their own savings back anytime (Payout), e.g. when leaving the squad.
7. **Fun:** a goal progress bar on the rooftop; a "Saver" collar tag for 3 months in a row.

### Who saved what: each person's savings are tracked separately
The jar on the rooftop shows one total, but underneath, every member has their own balance. People save different amounts, so the app has to count who put in what.

Example: Goa fund, then the cabin trip ($140 share each, $4 leftover each; this squad sends leftovers to savings).

| Member | Saved (monthly × months) | Used for the cabin | Rest from the Treat Jar | Leftover back to savings | Balance now |
|---|---|---|---|---|---|
| Priya | $20 × 4 = $80 | $80 | $60 | +$4.00 | $4.00 |
| Sam | $15 × 4 = $60 | $60 | $80 | +$4.00 | $4.00 |
| Arjun | $10 × 4 = $40 | not on this trip | – | – | $40.00 |
| Maya | $25 × 4 = $100 | $100 | $40 | +$4.00 | $4.00 |
| **Jar total** | **$280** | **$240** | | **+$12.00** | **$52.00** ($280 − $240 + $12) |

- **Balance** = what you saved + leftovers routed back to you − what your plans used − what you withdrew.
- Savings only ever pay **their owner's** share. They never pay for someone else, unless the owner chooses to cover them (§B9).
- Leftovers return in proportion to what each person paid (§B10).
- Arjun skipped the trip, so his $40 is untouched.

### Rules and edge cases
- Treat Jar short on the day → the saving waits, with no penalty, and the kitten asks for a top-up with a card in its chat and Meows. Once the jar has enough, the saving goes in. A month missed completely isn't made up later.
- To change the day, stop saving and start again. Stopping keeps what you've saved.

### Under the hood
- No PayPal subscription: a saving is a ledger move from the member's Treat Jar to their own savings. Real money enters through Treat Jar top-ups.
- The timer moves every saving that's due, and keeps trying one that was short. A Treat Jar top-up moves it straight away.
- A party can save daily instead of monthly, so judges can see it work.

### Requirements
- **FR-PARTY-1** Members MUST be able to create a Kitty Party with a name and a goal, and join with their own monthly amount, taken from their Treat Jar.
- **FR-PARTY-2** The referee MUST keep each member's savings separately, while the UI shows one shared jar and goal. The jar MUST show what each member puts in a month; balances stay private.
- **FR-PARTY-3** When the host chose Kitty Party money for a plan, each member's own savings MUST pay their share first, then their Treat Jar.
- **FR-PARTY-6** Each member's savings balance MUST be tracked separately (contributions, uses, leftovers, withdrawals), and the jar total MUST always equal the sum of member balances.
- **FR-PARTY-4** Members MUST be able to withdraw their own savings via Payout and change or stop their monthly amount.
- **FR-PARTY-5** Plan leftovers MUST be routable into the party when the squad setting is on.
- **FR-PARTY-7** Each member MUST pick the day of the month their saving moves (1 to 28). On that day the amount MUST move from their Treat Jar to their own savings, and MUST appear in My Month and the Diary without counting as spending.
- **FR-PARTY-8** If the Treat Jar is short on the day, no money MUST move, and the kitten MUST ask for a top-up with a card in its chat and Meows, at most once in 3 days. After a top-up the waiting saving MUST go in straight away.

---

## B14 Catnip (group birthday gifts)

### In plain words
When someone's birthday is coming up, **their own kitten** quietly tells their friends' kittens, without telling the birthday person. Each friend decides whether to join a gift. Nobody is pushed. Those who join get a secret gift group with real gift ideas that fit their combined budget. A few days after the birthday, the group disappears.

### Flow
1. **Radar:** 10 days before Maya's birthday (if she allowed sharing at sign-up), her kitten sends a quiet note to the kittens of her squad members: "Maya's birthday is on Dec 3."
2. **Opt in:** each friend's kitten shows a card: "Join a group gift for Maya?" → **Join** / **Skip**. Skipping is invisible.
3. **Secret group:** everyone who joined gets a temporary gift group. Maya and her kitten can't see it, or any notification about it.
4. **Budget:** each member privately sets their gift limit; the referee totals them.
5. **Ideas:** the kitten searches real products (Channel3) within the total, using Maya's shared likes, age and gender. Members can add their own links.
6. **Vote, paw in, Pounce:** the same engine as plans. The booker buys the gift.
7. **Card:** the kitten drafts a group message; each member can add a line.
8. **Auto-delete:** 3 days after the birthday, the gift group (chat, ideas, votes) is deleted. Money records stay in each member's Kitten Diary.

### Requirements
- **FR-NIP-1** The radar MUST run in the birthday person's kitten, and only if they allowed birthday sharing.
- **FR-NIP-2** Joining MUST be opt-in for every friend; skipping MUST be invisible to others.
- **FR-NIP-3** The birthday person and their kitten MUST NOT see the group, its notifications, or anything about it in Meows.
- **FR-NIP-4** Gift ideas MUST come from a real product search (Channel3) filtered by the combined budget; members MUST be able to add links.
- **FR-NIP-5** Funding MUST reuse the plan engine.
- **FR-NIP-6** The gift group MUST be auto-deleted 3 days after the birthday; money records MUST remain in each member's Kitten Diary.

---

## B15 The Bowl (shared subscriptions)

### In plain words
Spotify family, Netflix, the flat's Wi-Fi: one person pays the provider, and the rest owe a share every month. **The Bowl** works just like Kitty Party: each person picks a day of the month, and on that day their share moves from their Treat Jar into the account holder's Treat Jar. Nobody has to ask "Spotify money?" again.

### Flow
1. **Create:** service, monthly total, who shares it, and which day of the month (1 to 28). The person creating it holds the account and has a share like everyone else.
2. **Join:** each member gets a card, opens the Bowl and picks their day, starting from the holder's. Then Continue.
3. **Each month:** on their day, each share moves from that person's Treat Jar to the account holder's. Both kittens tell them, and the squad sees how many shares are in, never whose.
4. **The holder's own share:** no money moves, because they pay the provider themselves. It's still counted on their day, and shows in their month.
5. **Short jar:** the share waits with no penalty. A card asks them to top up, at most once in 3 days. The moment the money lands, the share goes through.
6. **A seat leaves:** shares are recomputed, the holder is told, and everyone else confirms their new share. Nothing moves for them until they do.
7. **Where it shows:** My Month → Spent always lists every Bowl you're in, with what you've paid and your next date. It's also in the kitten's chat, the Kitten Diary, your rules for that squad, and the Bowl tab.

### The Bowl tab
Laid out like the Party tab. Each subscription has a card with its name, monthly total and what each person pays a month, then a **Yours** card with your share, your day, your next date, and Join, Leave or Close.

### Requirements
- **FR-BOWL-1** Users MUST be able to create a Bowl with service, total, who shares it and a day of the month. The creator MUST be a member with their own share and day.
- **FR-BOWL-2** Each member MUST pick the day of the month their share moves (1 to 28). On that day it MUST move from their Treat Jar to the account holder's Treat Jar, once, and both MUST be told in their kitten's chat.
- **FR-BOWL-3** Seat changes MUST recompute shares with member confirmation, and nothing MUST move for a member until they confirm.
- **FR-BOWL-4** A share the jar can't cover MUST wait, MUST NOT go to Yarn, MUST bring a top-up card, and MUST go through by itself when the money lands.
- **FR-BOWL-5** The holder's own share MUST be counted on their day without moving money. Every Bowl a person is in MUST appear in My Month's Spent with its next date, and each share paid MUST appear there too. Each Bowl MUST be listed in that person's rules for the squad, and the kitten chat MUST be able to say what they're in and start a Join.

---

## B16 Meows (daily brief) and alerts

### In plain words
Every morning your kitten leaves you its **Meows**: what it did, what needs your tap, what's coming up, and how your month is going. Things that can't wait come as **alerts** inside the app.

### Meows sections
| Section | Example |
|---|---|
| **What I did** | "Paid $18 into Saturday bowling from your Treat Jar (your free hand)." |
| **Needs you** | "Confirm: you're in for Cabin B?" "Add receipts for Cabin B." |
| **Coming up** | "Cabin B in 6 days. Goa fund collects Monday." |
| **Your month** | "You've used $210 of your $300 fun budget." |
| **A little something** | A new collar tag, a streak, a cat fact |

### Alerts (urgent)
- Shown for: a Pounce happening, a share still to put in, a help request for you, a failed capture, and decide-by within 2 hours.
- v1 has no push or email: alerts show as in-app banners and badges, and Meows catches anything missed.
- They respect quiet hours.

### Requirements
- **FR-MEOW-1** Each user MUST get Meows at their chosen time (default 09:00 local), built from the event log, in the kitten's voice.
- **FR-MEOW-2** Every "Needs you" item MUST be actionable in one tap.
- **FR-MEOW-3** Alerts MUST be limited to the urgent list above and respect quiet hours.

---

## B17 Purrs, collar tags, Top Cat and streaks

### In plain words
Kitty rewards being good with money **with** friends, never having money. You earn **purrs** and **collar tags** for good habits. Each squad has a playful weekly **Top Cat** and a **streak**.

### Collar tags (v1)
| Tag | Earned by |
|---|---|
| First Paw | First to paw in on a plan |
| Clutch | Being the booker |
| Zero Nudges | 5 times paying or pawing in without a reminder |
| Untangler | 5 times settling Yarn the same day |
| Lifesaver | Helping with a Nine Lives request |
| Catnip Captain | Booking a group gift |
| Saver | 3 months in a row of Kitty Party saving |
| On Budget | A month within your fun budget (private; shown only to you unless you share it) |

### Rules
- Top Cat is weekly, per squad, by purrs earned that week.
- Squad streak: plans in a row with nothing left unsettled after 7 days.
- Year in Purrs: a shareable recap card with no amounts (SHOULD).
- Never rank or show money, debts or declines.

### Requirements
- **FR-PURR-1** The referee MUST award purrs and tags from logged events.
- **FR-PURR-2** Each squad MUST show a weekly Top Cat and a streak.
- **FR-PURR-3** No leaderboard, tag or recap MAY show or rank money amounts, debts or declines.
- **FR-PURR-4** Year in Purrs SHOULD be a shareable card.

---

## B18 Talking to your kitten (chat)

### In plain words
You can do anything by talking to your kitten: "Cabin trip with Goa Squad in Dec?", "I paid $48 for dinner for Sam and Arjun", "What do I owe?", "How's my month?" It answers with cards you can tap, not walls of text.

### Kitten tools (all checked by the referee)
- Whims and plans: `create_whim` · `answer_whim` · `negotiate_whim` · `answer_negotiation` (host) · `plan_in` (join, or ask to tag along) · `answer_tag_request` (host) · `plan_out` (withdraw) · `cancel_plan` · `pounce` (host) · `pay_booking` · `add_receipt`
- Money: `log_i_paid` · `untangle` · `ask_for_help` · `pledge_help` · `join_party` · `set_monthly_saving` · `create_bowl` · `top_up_jar` · `withdraw_jar`
- Rules and info: `set_rule` · `my_month` · `explain` ("why did you do that?") · `ask_friend_kitten`

### Where it lives
Your kitten's chat is pinned at the top of the Squads tab, above every squad, always. "Talk to Mochi" on Meows and My Kitten opens the same chat.

### What you can ask
| You ask | What happens |
|---|---|
| About your own data | "What did I spend on Flat 4B?", "Why did you pay $18?", "Who do I still owe?" It answers from your own diary, payments, plans, Yarn and month, and nobody else's |
| Anything else | Small talk and everyday questions, in your kitten's voice |
| To do something | Anything the app can do: float a whim, answer or negotiate one, log "I paid", tag along, withdraw, cancel, Pounce, pay for the booking, remind a friend, top up. Each one plays the same moment and shows the same card as doing it by hand |

"Remind Tyler about the $16" uses the same schedule limits as the automatic reminders (§B11). If the limit is reached, or it's Tyler's quiet hours, your kitten says so.

### Chats with friends
Under your squads, the Squads tab lists everyone you share a squad with. Each friend has one chat, holding four voices:

| Choose | What happens |
|---|---|
| **The friend's name** | A normal message to them |
| **Ask (their kitten)** | Their kitten answers only what they share, and never anything about money (§B2) |
| **(Your kitten) tells them** | Your kitten passes it on in its own voice. It can't add facts or change a number |
| **Nudge** | Your kitten reminds them about anything open between you, within the limits in §B11 |

Reminders your kittens send each other appear in the same chat.

### Your kitten is the manager
Whatever happens goes to your kitten's chat first. Everything that needs you lands there as a card, and **Meows shows those same cards**. Everything else that happened is told there too.

| Situation | What happens |
|---|---|
| A card needs you | It's in your kitten's chat and in Meows. Same card, same buttons |
| You read a card in Meows | That card is marked seen in the chat, and the Squads list stops counting it |
| Your kitten tells you something that isn't a card | It stays unread in the chat until you open the chat, even if you've opened Meows |
| You deal with it anywhere | It closes everywhere, and the chat shows Done |

**Every decision comes as a card with its real answers:**

| Who | Card | Answers |
|---|---|---|
| Anyone asked on a whim, except the host | "Sunset picnic: about $10 each. I think yes..." | Yes · No · Ask (kitten) to negotiate |
| Host | A kitten asked to change the whim | Accept · Keep it as it is |
| In a plan, jar short | "Your share is $20, and your Treat Jar is $5 short" | Refill |
| Not in a plan, before the Pounce | "Sunset picnic is happening. You can still join" | Join · Not now |
| Host, after the Pounce | "(Name) is asking to tag along. OK?" | Yes · No |
| Told yes, jar short | "Your share is $20, and your Treat Jar is $5 short" | Refill |
| Asked for help | "Ava could use a hand" | Pledge · Choose an amount · Not this time |
| Who asked for help | "2 friends pledged $25" | Accept · Keep waiting · Close and return it |
| Saver | Treat Jar short on their saving day | Top up · Not now |
| Host, when everyone's money is in | "Everyone's money is in. Pounce?" | Pounce · Not yet |
| Host | Plan is on ice | Give it more time · Cancel it · Not now |
| Booker | "I read $60 on the receipt" | Yes · Not right |
| Plan came to more | Your part of the extra | Pay · Not now |
| Friends' cards | "I paid", until both agree (§B11) | Yes · Not right · Accept · Keep |
| Invited | Group gift, Bowl, Kitty Party | Join · Skip · Not now |

### Requirements
- **FR-CHAT-12** Anything waiting on a decision MUST reach that person as a kitten card with its real answers (accept or reject, in or out, join or skip). Information alone is not enough. "Not now" MUST close a card until something about it changes.
- **FR-CHAT-11** Everything that needs the owner MUST be filed as a card in the kitten's chat, and Meows MUST show those same cards. A card read or dealt with anywhere MUST show as read or done everywhere. Anything else the kitten tells the owner MUST stay unread until they open the chat.
- **FR-CHAT-8** Each friend you share a squad with MUST have one private chat with you, listed in the Squads tab, with an unread count.
- **FR-CHAT-9** In that chat you MUST be able to message the friend, ask their kitten, or have your kitten pass something on. Reminders between your kittens MUST appear there.
- **FR-CHAT-10** Nobody MUST be able to message someone they share no squad with.
- **FR-CHAT-5** Your kitten's chat MUST be pinned at the top of the Squads tab.
- **FR-CHAT-6** Your kitten MUST answer questions from your own data only (FR-SEC-1), and MAY answer everyday questions.
- **FR-CHAT-7** A reminder asked for in chat MUST obey the limits in FR-REMIND-1 and FR-REMIND-2.
- **FR-CHAT-1** The chat MUST support every core action through tools validated by the referee.
- **FR-CHAT-2** Money-moving actions MUST end in a confirmation card unless within free hand.
- **FR-CHAT-3** Replies MUST prefer tappable cards over long text.
- **FR-CHAT-4** "Why did you do that?" MUST return the logged reason for any action.

---

## B19 Kitten Diary

### In plain words
The **Kitten Diary** is your kitten's honest log: every action, the rule or tap that allowed it, the amount, and the PayPal transaction ID when real money moved.

### Requirements
- **FR-LOG-1** Every action (human or kitten) MUST be stored in an append-only event log with actor, time, object, amounts (owner-visible), reason and PayPal ID if any.
- **FR-LOG-2** The Kitten Diary MUST list the user's actions in plain words, filterable by squad and type; an AG Grid table SHOULD be used (sponsor).
- **FR-LOG-3** Undo MUST be offered where possible: edits (always), releasing a hold before the Pounce, releasing a Treat Jar reservation; after a capture, "undo" becomes a refund request handled by the plan's rules.

---

## B20 My Month (your money and your calendar)

### In plain words
**My Month** shows, privately, your month with friends in two views:
- **Money:** your fun budget, your Treat Jar, who to settle up with, everything you spent, and what you've saved. Your kitten warns you before a new plan would push you over budget.
- **Calendar:** the plans you're in, plus busy times you add. Your kitten won't let you commit to two plans at the same time.

### Money view
| Block | Contents |
|---|---|
| **Fun budget** | Spent + set aside vs your budget |
| **Treat Jar** | A slider showing how much is left, against the most it held this month. Tap it to add money or take it out |
| **Settle up** | One row per person (below) |
| **Spent** | Every payment this month, each opening where it happened (below) |
| **Saved** | One row per Kitty Party: your savings, your monthly amount, your next date. Tap to open that Kitty Party |

### Settle up (one row per person)
Each row is a person, what's between you, and the group it's in. Only you see it.

| Situation | Buttons | Tapping it |
|---|---|---|
| You owe them | **Untangle** | Pays them from your Treat Jar. If it's short, it asks to refill the difference first |
| They owe you | **Nudge** · **Untangle** | **Nudge** sends what they owe to their kitten, within the reminder limits (§B11). **Untangle** sets up their payment, and their kitten asks them to pay |

The amount is the fewest-payments answer for that group, so it can be a different person from whoever you originally split with. An extra cost on a plan shows as its own row with Pay. Something open in a group you've left stays on your list.

### Spent
| Row | Opens |
|---|---|
| Your share of a plan, or money set aside for one | The plan |
| Your part of an "I paid" card, or your treat | That group's Yarn, or the friend's chat |
| Paid a friend through Settle up | That group's Yarn, or the friend's chat |
| Booked a plan from the Treat Jar | The plan |
| A Bowl share you've paid, and every Bowl you're in with its next date | That Bowl |
| Helped a friend | Nine Lives |

Settle-up payments and bookings are listed so you can see every payment, but aren't added to your fun budget again: the card or plan behind them already counted. A Bowl's next date isn't counted until it's paid.

### The overspending guard
- Before a paw-in that would exceed your budget, your kitten tells you privately: "This puts you $35 over your $300 fun budget. Still in?"
- At month end, Meows sends a recap: "You spent $260 of $300 on friends and saved $40 in Goa fund."

### Calendar view (small, simple)
| Shows | Notes |
|---|---|
| Plans you're in | From every squad and mini-squad, with times |
| Decide-by deadlines | So nothing slips |
| **Busy times** you add | "Exams Dec 1–10", "Work trip". Private labels; friends' kittens only learn "busy". |
| Usual availability | Weekday evenings / weekends, from your settings |

**No double booking**
- If a whim or plan overlaps a plan you're already **in**, your kitten prepares "busy (already in Cabin B with Goa Squad)" and **won't paw you into both**.
- If you really want the new one, you choose which to keep. Leaving the old one follows its refund rules (§B9).
- Overlapping a busy time you added is a soft clash: your kitten warns you, and you decide.
- Clashes are checked when kittens prepare answers, at paw-in, and when a plan's date changes.

### Requirements
- **FR-MONTH-1** My Month MUST show the fun budget, the Treat Jar, Settle up, Spent and Saved, from Kitty's own ledger.
- **FR-MONTH-2** The kitten MUST warn privately and require a tap before any action that would exceed the fun budget.
- **FR-MONTH-3** A month-end recap MUST appear in Meows.
- **FR-MONTH-4** My Month MUST be visible only to its owner.
- **FR-MONTH-5** Settle up MUST list one row per person per group for everything the user owes or is owed, including groups they have left, and any unpaid extra cost on a plan. Every person row MUST offer Untangle, and Nudge only if that person owes the user.
- **FR-MONTH-6** Spent MUST list each payment this month and open where it happened. The rows that count towards the fun budget MUST add up to it. Saved MUST open each Kitty Party.
- **FR-MONTH-7** The Treat Jar MUST live in My Month, with adding and taking out money one tap away, and MUST NOT also appear in My Kitten.
- **FR-CAL-1** My Month MUST include a calendar view of plans the user is in, decide-by deadlines, and user-added busy times.
- **FR-CAL-2** The referee MUST block being "in" two plans that overlap in time; the user MUST choose which to keep.
- **FR-CAL-3** Overlap with a user-added busy time MUST trigger a private warning, not a block.
- **FR-CAL-4** Friends' kittens MUST only learn "busy", never the label of a busy time or the other plan.

---

## B21 Export and connect

### In plain words
Your Kitty info can be read by the other assistants you use. Ask Meta Muse, ChatGPT or Claude "what do I owe this month?" or "when's our cabin trip?", and they answer from Kitty. Your plans can also show up in your calendar, and you can download your Kitten Diary.

### What we offer
| Export | How | Works with |
|---|---|---|
| **Kitty connector (MCP server)** | A remote MCP server with OAuth sign-in. Read tools: my plans, my yarn, my month, upcoming. Safe write tools: create a whim, log "I paid" (both still need confirmation inside Kitty). **No money-moving tools.** | Meta Muse (custom connectors accept remote MCP servers with OAuth; a public listing needs Meta's review), ChatGPT (apps/connectors use MCP), Claude (custom connectors) |
| **Calendar feed** | A private calendar link with plans and decide-by times | Google, Apple, Outlook calendars |
| **CSV download** | Kitten Diary and My Month | Spreadsheets and budgeting apps |

### Requirements
- **FR-EXP-1** A remote MCP server SHOULD expose read tools (plans, yarn, month, upcoming) and safe write tools (create whim, log "I paid"), with OAuth, and MUST NOT expose any money-moving tool.
- **FR-EXP-2** A private calendar feed for plans SHOULD be offered.
- **FR-EXP-3** CSV download of the Kitten Diary and My Month SHOULD be offered.

---

## B22 Design and UX

### Direction
- **No emojis anywhere in the product.** Every icon and character is custom.
- **One in-house SVG kitten**: a single base drawing with fur colours, patterns and one accessory, and a small set of poses (sit, paw up, pounce, read, untangle, sleep, wave). It's drawn as code, so every pose can animate. The look must be clearly different from Town.com's characters.
- **World:** a cut-paper rooftop neighbourhood on a mint morning: mint sky, warm sun, paper clouds, mint rooftops. Each squad is a rooftop; pots and the Kitty Party jar sit on the roof. (The first night-sky version was dropped by the owner on 8 Nov: it didn't match the rest of the theme. Mint morning was their pick of the replacements.)
- **Palette:** mint morning sky, warm amber, cream paper, plum ink for text, stronger mint for "money moved".
- **Type:** a friendly serif for headings, a clean sans for UI.

### Design pass (8 Nov): references, tokens, the kitten system
**References the owner chose** (their visuals, not their features):

| Reference | What Kitty takes from it |
|---|---|
| Town (town.com) | Everyone has their **own** companion; storybook warmth; cream paper; an editorial serif for headlines; calm dark pill buttons; lots of white space. Kitty's kittens stay clearly different: clean round vector, drawn in code, not Town's sketchy textured animals |
| Finch | The pet is the hero of every screen; soft round characters with blush cheeks; two characters interacting for social moments; an illustrated scene band with white cards sliding over it; celebration sheets |
| Ahead | Soft clouds; faces that show emotion with just eyes and brows; pastel tiles; key words highlighted in lavender |
| Duolingo | Chunky pressable buttons (darker bottom edge); thick rounded outlines on choice cards; the character talks in a speech bubble beside the content; progress bars; big-number celebration screens |

**Tokens (starting point for the Paper foundations page):**

| Token | Value |
|---|---|
| Mint sky | Top `#CBEBDB`, bottom `#E9F6EF`, sun `#F5BD62`, rooftops `#B3DEC7` and `#97CFB2`; lavender highlight `#B9AEF5` |
| Lamplight amber | 500 `#F0A43A` (primary buttons), 700 `#C67F1F` (button edge), 100 `#FDEBCB` |
| Cream paper | 50 `#FBF5EA` (app background), 100 `#F3EADB` (bubbles, insets), line `#E6DCCB`, cards white |
| Mint (money moved) | 400 `#5FC4A0`, 700 `#3E9A7C`, 100 `#DDF4EA` |
| Ink | 900 `#2A2245` (text), 500 `#6B6488` (secondary). Rose `#E86A86` for gifts and hearts only, never for debts (UX rule 4) |
| Type | Fraunces (soft serif) for headings: display 32/38, title 24/30. Nunito for UI: section 18/24 extra-bold, body 16/22, small 13/18, label 12/16 caps. Money amounts always in Nunito (Fraunces numerals sit unevenly). Text on amber is always ink, never white |
| Shape | Cards 24 px radius, sheets 28 px top corners, buttons 16 px, chips round; 4-pt spacing; pressable buttons with a 4 px darker bottom edge; card shadow = a 2 px paper edge plus a soft lift |
| Layout | 390 × 844 phone frame; bottom tabs (Meows, Squads, +, My Month, My Kitten); a mint-sky scene band with the kitten at the top of Meows and the rooftop; cream content sheets over it |

**The kitten system (built: `web/components/kitten/Kitten.tsx`, `web/lib/kitten/looks.ts`, `web/lib/kitten/moments.ts`; preview at `/dev/kitten`):**
- **One template, few choices.** 6 furs × 4 patterns × 5 accessories × 3 eye colours = 360 looks, so kittens in a squad are easy to tell apart. Demo friends each have their own look.
- **The owner picks only the look, name and personality.** Mood and pose are set by the app from what the kitten is doing; the default is neutral and sitting.
- **Same kitten everywhere:** head (chat avatar, every message, Meows), bust (greetings), full body (rooftop, money moments). A friend's message shows the friend's kitten.
- **In-between states use the owner's own kitten in a fixed scene**: their kitten holds the magnifying glass while reading a screenshot, leaps onto the pot at the Pounce, and so on. Scenery and props (rooftop, pot, jar, yarn, coins, letters, gift box) are fixed SVG.
- **Moods:** neutral, happy, thinking, alert, sleepy, proud (the face only). **Poses:** sit, wave, hold (with a prop: magnifier, letter, coin, yarn, gift), sleep, pounce.

| What the kitten is doing | Mood · pose |
|---|---|
| Nothing special (default) | neutral · sit |
| Reading a screenshot, link or receipt; re-checking a plan | thinking · hold magnifier |
| Whim sent; plan created | happy · wave |
| Share put in, Treat Jar refill | happy · hold coin |
| Pounce, tag along paid | happy · pounce |
| Settled, all untangled, money received, a new collar tag | proud · sit |
| Something needs your tap (a share to put in, a negotiation, overrun, Yarn to confirm or pay, a friend's question, a delayed payout) | alert · sit |
| Untangle | thinking · hold yarn |
| Kitty Party saving, Nine Lives pledge | happy · hold coin |
| Catnip | happy · hold gift |
| Meows | happy · hold letter |
| Nothing needs you | sleepy · sleep |
| On ice, faded, cancelled, released | neutral · sit (calm, never sad: no shame) |

- **Motion:** gentle tail sway, blink and breathing; off when the user prefers reduced motion.

### Money moments (every process has a visual)
| Moment | Visual |
|---|---|
| Kitten reading a screenshot, link or receipt | Kitten with a magnifying glass, scanning |
| Whim sent to friends | Paper planes flying to the other kittens on the rooftop |
| Waiting for friends | Kittens' ears perk up one by one as answers arrive |
| Paw in | A paw presses coins into the pot; the pot level rises |
| Paw up | The paw stretches up a notch on the pot's measuring line |
| Cover a friend | One kitten slides a coin to another's paw |
| Pounce! | The kitten leaps onto the pot; coins stream to the booker's house |
| Holds released | The pot lid opens, and coins float back to each kitten |
| Receipt leftovers | Coins roll back to each avatar |
| Untangle | A tangled ball of yarn pulls apart into straight strands between friends |
| Settled | The strand glows and fades |
| Kitty Party saving | A coin drops into the big jar; the goal bar fills |
| Help a friend | Several paws reach in, each holding a coin |
| Catnip | A gift box assembling, one ribbon per friend |
| Waiting on PayPal | Kitten tapping its paw |
| Meows | The kitten at your door with a small stack of letters |

### Every kitten is alive
Kitty should feel like a game, not a form. Every kitten is a live character on every screen.

| Where | What it does |
|---|---|
| Always | Blinks, breathes, sways its tail, twitches its ears, looks around now and then |
| Tap a kitten | It reacts: wiggles, purrs, smiles |
| Adoption | Smiles and blinks from the start, and reacts to every choice you make |
| Every action | Never a plain "working" then "done". Each action plays its moment (table above): the kitten moves, things fly, the pot fills |
| Waiting | The kitten is busy doing something, never a spinner |
| Cards and numbers | Cards slide in, bounce and settle. Amounts count up |

### UX rules
1. Cute name + plain words, always ("Yarn · who owes whom").
2. One-tap decisions: every request card has at most 3 choices.
3. Short cards: the plan card and whim form stay minimal (§B6, §B8).
4. No shame: no red debt numbers in shared views.
5. Mobile-first (375 px), works on desktop.
6. Accessible: WCAG 2.2 AA contrast, alt text on all art, keyboard navigation, reduced motion respected.

### App structure (bottom tabs)
| Tab | Contents |
|---|---|
| **Meows** | Home: daily brief, needs-you cards, alerts |
| **Squads** | Your kitten's chat pinned at the top (§B18), then the squad list → rooftop → Chat · Plans · Yarn · Party · Bowl · My settings, then your friends' chats |
| **+** (centre) | New whim · I paid · Ask friends for help |
| **My Month** | Money (fun budget, Treat Jar, Settle up, Spent, Saved) and Calendar (plans, busy times) |
| **My Kitten** | Look, name, breed, House Rules, Kitten Diary, Nine Lives requests, memory, export, Log out |

### It must look and feel like a mobile app, even on a laptop
The demo and the video run on a Windows laptop, but Kitty must read as a **phone app**, not a website.

| How | Detail |
|---|---|
| **App shell** | Full-screen pages, a fixed bottom tab bar on the four main tabs only (it goes away inside a chat, a plan or a sub-page, where the top bar and the message box stay fixed and only the middle scrolls), slide-up sheets instead of new pages, and app-style transitions with no page reloads; safe-area padding; no browser-style links or footers |
| **Installable** | A PWA: manifest, app icon, splash colour, standalone display. Installed from Chrome/Edge on Windows, it opens in its own window with no address bar. |
| **Phone frame on wide screens** | Wider than 600 px (laptop, judges' desktops), the app renders inside a **phone frame** (390 × 844) centred on a branded mint-sky backdrop. Phones get the app full screen. |
| **Demo** | Record the video from the phone-framed app (or the installed app window sized to a phone) |
| **Optional, Phase 4** | Wrap the same app with Capacitor as an Android APK, only if time allows. The phone frame is the main demo path. |

The dev console (`/dev`) is a desktop tool and isn't part of the app shell.

### Flows (designed in Paper, 8 Nov)
Every flow is drawn in the Paper file "Kitty", on four boards: each screen, every button and where it goes, and what happens when something goes wrong. The nine key screens and the Foundations page set the look; the boards set the behaviour. All 98 product API routes are used by at least one flow.

| Board | Flows |
|---|---|
| **1 · Getting in, home, whims** | F1 Sign up · F2 Invite link · F3 Stray · F4 Meows and every "Needs you" card · F5 Alerts · F6 The + button · F7 Talk to your kitten · F8 Ask a friend's kitten · F9 Float a whim · F10 Answer a whim · F11 A whim ends · F12 Mini-squad |
| **2 · Plans and the Pounce** | F13 Plan page, every state · F14 Paw in · F15 Not this time · F16 Host settings and split · F17 Change a plan · F18 Choose between options · F19 Paw up · F20 Cover a friend · F21 Pounce · F22 On ice · F23 Receipts and leftovers · F24 Extra cost · F25 Tag along · F26 Drop out after the Pounce · F27 Cancel a plan |
| **3 · Friends' money** | F28 I paid · F29 Fix or remove a card · F30 Yarn and Untangle · F31 Settle up · F32–F34 Nine Lives (ask, give, accept) · F35 Kitty Party · F36 Catnip · F37 The Bowl |
| **4 · Squads, month, kitten, demo** | F38 Squads list · F39 Rooftop and chat · F40 My settings, leave · F41 Top Cat, tags · F42 My Month: Money · F43 Calendar · F44 My Kitten, look, profile · F45 House Rules · F46 Treat Jar · F47 Kitten Diary · F48 Memory, export, settings, log out · F50 System states |

**In the spec and on the boards, but not in the backend yet** (tagged "Needs backend" on the boards):

| Flow | Missing | Spec |
|---|---|---|
| F3 | Stray: paw in from a signed link with no account; history moves on sign-up | FR-ONB-6, FR-SEC-9 |
| F23 | Booker sends a leftover back with PayPal; host approval above 15% (flagged only, members are still asked) | FR-SETTLE-2, FR-SETTLE-3 |
| F28 | Receipt photo on an "I paid" card | FR-YARN-1 |
| F37 | Members confirm a new share when a seat leaves; an uneven split | FR-BOWL-1, FR-BOWL-3 |
| F39 | Typing a message in the squad chat | §B5 |
| F40 | Per-squad switches: usually in, use savings first, free hand here | FR-RULE-1, FR-RULE-7 |
| F44 | Change the kitten's look, name, personality; edit profile and availability | FR-ONB-5, §B22 |
| F45 | "What I share" switches; delete one of your rules | FR-RULE-1 |
| F48 | View and forget kitten memories | FR-KIT-6 |
| Optional | Memory card photos (F13) · loan repayment plan (F34) · group gift card message (F36) · make an admin (F40) · Year in Purrs (F41) · connect an assistant (F48) | §B10, §B12, §B14, §B5, §B11, FR-PURR-4, FR-EXP-1 |

### Requirements
- **FR-UX-10** Every screen, button and error state MUST follow the approved flow boards (F1–F50). A new screen MUST be added to the boards first.
- **FR-UX-11** Every kitten MUST be animated wherever it appears and react to taps, and every action MUST play an animated in-between moment instead of a static loading state (reduced motion respected, FR-UX-5).
- **FR-UX-1** The app MUST be built mobile-first at 375–390 px, as an app shell (bottom tabs, sheets, client-side transitions, safe areas); it MUST NOT look like a website.
- **FR-UX-7** On viewports wider than 600 px the app MUST render inside a phone frame (390 × 844) centred on a branded backdrop; on phones it MUST be full screen.
- **FR-UX-8** The app MUST be installable as a PWA (manifest, icons, standalone display) so it opens in its own window on Windows.
- **FR-UX-2** Every cat-themed label MUST show plain words.
- **FR-UX-3** The product UI MUST NOT use emojis; all icons and characters MUST be custom.
- **FR-UX-4** Every money moment in the table above MUST have a visual state (polished animation in the UI phase; a simple placeholder before that).
- **FR-UX-5** Animations MUST respect reduced-motion settings; the UI MUST meet WCAG 2.2 AA.
- **FR-UX-6** Request cards MUST offer at most 3 primary choices.
- **FR-UX-9** The owner MUST choose only the kitten's look (fur, pattern, accessory, eye colour), name and personality; the kitten's mood and pose MUST follow what it is doing (default neutral, sitting), per the table above.

---

## B23 Showing Kitty to judges

### In plain words
There is no Demo World (owner decision, 8 Nov). Kitty opens on Log in with PayPal and works the same for everyone, so it never feels like a demo. Judges log in with a PayPal sandbox account we give them. The friends they see are real accounts that signed up through the same door, with real squads, plans and money history.

### Requirements
- **FR-SHOW-1** The app MUST open on Log in with PayPal only, with no demo entry, demo label or simulated control anywhere.
- **FR-SHOW-2** Every flow MUST work for real signed-in users on the PayPal sandbox, including tag along, extra costs and returning leftovers.
- **FR-SHOW-3** Sandbox logins for judges MUST be in the submission notes and README, and those accounts MUST have a squad with an open plan, Yarn and savings ready for judging.

---

# Part C: Platform mapping

## C1 PayPal integration

### Setup (done 5 Nov 2026)
- A sandbox REST app (Merchant), linked to the **US sandbox business account**. That account is Kitty's platform account: it collects and pays out.
- Keys verified: a token was issued with the scopes for Payments, Payouts, Invoicing, Subscriptions, Transaction Search, Disputes and Webhooks.
- A $1 sandbox Payout tested end to end: SUCCESS.
- Keys live in `.env` and are never committed.
- **Still to do on day 1:**
  - Enable "Log in with PayPal" on the app and set its return URL
  - Bulk-upload 6 US sandbox personal accounts (Demo World friends)
  - Register webhooks on the hosted URL
  - Check server-side test-card authorizations (for Demo World)

### Calls by feature

| Action | PayPal call | Notes |
|---|---|---|
| Sign in | Log in with PayPal (OpenID Connect: authorize → `POST /v1/oauth2/token` → userinfo) | Verified email = payout address |
| App token | `POST /v1/oauth2/token` (client credentials) | Cached; refreshed before expiry |
| Holds (authorize, capture, void, reauthorize) | `POST /v2/checkout/orders` (intent `AUTHORIZE`) and the authorization calls | Built and tested in Phase 1. Since v1.33 the app doesn't use them: every payment comes from the Treat Jar (FR-JAR-7) |
| Treat Jar refill: the only PayPal payment a person approves | `POST /v2/checkout/orders` (intent `CAPTURE`) → approve → `POST /v2/checkout/orders/{id}/capture` | |
| Pay for a booking from the Treat Jar; pay people owed; help payout; jar withdraw; savings withdraw; Bowl owner | `POST /v1/payments/payouts` | `sender_batch_id` = idempotency key |
| Payout status | `GET /v1/payments/payouts/{batch_id}` | |
| Kitty Party / Bowl setup | `POST /v1/catalogs/products` (once per type) → `POST /v1/billing/plans` (Kitty Party: $1 unit price, `quantity_supported: true`) | |
| Webhooks | `POST /v1/notifications/webhooks`; verify each with `POST /v1/notifications/verify-webhook-signature` | |
| Automated tests of a refill | `POST /v2/checkout/orders` with `payment_source.card` (PayPal sandbox test card), intent CAPTURE | Test scripts only |

### Webhook events handled
`CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTSBATCH.DENIED`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.FAILED`, `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`, `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`, `PAYMENT.SALE.COMPLETED`.

### Known facts and limits
| Fact | Design impact |
|---|---|
| Holds: guaranteed 3 days, usable up to 29 days | Not used by the app since v1.33 |
| Vault refused for platform apps in sandbox | No saved cards; autonomy via the Treat Jar |
| India sandbox merchants can't send Payouts | The platform account is US |
| Hosted sandbox MCP broken (agent-toolkit issue #119) | REST + Server SDK + local Agent Toolkit |
| Payout fee observed: $0.25 per item | The platform absorbs fees in v1 |
| Payouts to unregistered emails go UNCLAIMED | Payout address = the verified login email |

### Tooling
- **PayPal Server SDK** (`@paypal/paypal-server-sdk`, APIMatic-generated) for Orders, Payments and Subscriptions, written with the **APIMatic Context Plugin** (sponsor; fill in the claim form).
- **Agent Toolkit** (`@paypal/agent-toolkit`) for the kitten's read tools where they fit (orders, refunds, subscriptions, transactions).
- **JS SDK** in the client for approvals: v6 for one-time orders if the day-1 spike works, v5 otherwise and for subscriptions if v6 lacks them.

### Requirements
- **FR-PP-1** Every PayPal POST MUST carry an idempotency key (`PayPal-Request-Id`; `sender_batch_id` for payouts).
- **FR-PP-2** PayPal-driven state changes MUST come from verified webhooks or confirmed responses and be safe to replay.
- **FR-PP-3** PayPal calls MUST be server-side, except the JS SDK approval UI.
- **FR-PP-4** Failed calls MUST retry with backoff (max 3), then be explained to the owner by their kitten in plain words.

## C2 AI and agents

### Speed first
In this product a fast, good-enough answer beats a slow, brilliant one. The default model is the fastest one; the larger model is used only where it's needed.

**Changed 7 Nov (owner decision): Groq first, Gemini as the fallback, no Mistral.** Gemini's free tier stalled for over an hour and Flash is capped at 20 requests a day. Only providers with a key are used; when none answers, code takes over (templates, the code whim reader, keyword chat).

| Use | Chain (first that answers) |
|---|---|
| Prepared answers, rule mapping, chat, all copy (text) | **Groq `openai/gpt-oss-20b`** → Groq `qwen/qwen3.8-27b` → Groq `openai/gpt-oss-120b` → Gemini `gemini-3.1-flash-lite` → `gemini-3.5-flash` → code |
| Reading screenshots, links and receipts (vision) | **Groq `qwen/qwen3.8-27b`** → Gemini → code (title only) |

Measured on the owner's Groq account (7 Nov): the live model list did NOT include the Llama models that third-party articles named, so the chain uses what is actually offered. Qwen 3.8 answers in 0.1–0.5 s and reads a screenshot in ~0.4–2 s; gpt-oss-20b is steady at 0.3–0.6 s; gpt-oss-120b 0.5–0.9 s; Gemini 1.3–5 s. Each Groq model allows 1,000 requests a day and ~7,000 input tokens a minute; one screenshot costs ~1,800 tokens, so text goes to gpt-oss-20b first and Qwen's budget is kept for images. A short per-minute limit ("try again in 3.9 s") is waited out when the budget allows. Typed whims: code wins on dates and money (a model once put "Friday 7pm" on a Wednesday); the AI fills gaps and suggests the title. Phase 3: the phone should shrink screenshots before upload to cut their token cost.

Free-tier facts (5 Nov): Pro models have 0 quota; `gemini-2.5-*` return 404 for new users; Flash sometimes returns 503. (7 Nov) Flash free tier = **20 requests a day per model**; a quota error benches that model until Gemini's retry time.

### What's AI and what's code
| Job | AI | Code |
|---|---|---|
| Understanding chats, screenshots, links, rules | Parse to typed JSON | Validate the schema |
| Preparing answers (interest / availability / budget) | Weigh likes and history; write the reason | Availability and budget math |
| Receipts | Extract totals | The booker confirms; the referee refunds |
| Is an action allowed? | Never | House Rules engine |
| Shares, fits, Pounces, untangles, savings | Never | Referee |
| Moving money | Never | PayPal service |
| Personal (custom) rules | Classify "does this rule apply?" (yes/no only) | If yes → ask the owner; never spend |
| Gift ideas | Rank ideas | Price filter on the combined budget |

### Kitten runtime
- **One agent per user.** The prompt holds persona (name, breed tone), the owner's profile, active rules (summary), relevant memory and the tool list.
- Tool call → referee check → execution → event log → reply card.
- Streaming replies; a short "kitten thinking" animation while it works.

### Hallucination and safety controls
1. Schema validation on every LLM output; one retry, then ask the user.
2. No LLM number moves money without human confirmation.
3. The LLM never sees other users' private data.
4. Untrusted content (screenshots, chats, receipts, links) is wrapped as data and can't grant permissions.
5. Every action is logged with its reason (Kitten Diary).

### Requirements
- **FR-AI-1** The kitten MUST use the fastest available model first (Groq), across providers, for every task including vision.
- **FR-AI-2** Every AI call MUST have a time budget, rest a rate-limited or stalled model, move to the next model, and fall back to code (templates, the code whim reader, keyword chat) when none answers.
- **FR-AI-3** Every structured output MUST be schema-validated.
- **FR-AI-4** Kitten prompts MUST include only the owner's own data plus referee totals.
- **FR-AI-5** AI tools and models used MUST be listed in the README and on Devpost.

## C3 Data model (core entities)

| Entity | Key fields |
|---|---|
| User | id, paypal_payer_id, paypal_email (verified), name, gender, birth_date, share_birthday, timezone, quiet_hours, likes, availability |
| Kitten | user_id, name, look (colour, pattern, accessory), breed, memory |
| Rule | user_id, squad_id (null = basics), type (R1–R7 or personal), params_json, text, active |
| BusyBlock | user_id, start, end, label (private), source (plan / manual) |
| Squad | id, name, cover, admins |
| Membership | squad_id, user_id, role, joined_at |
| Stray | id, name, link_token, scope, expires_at |
| Whim | id, owner, what, when_text, up_to_cents, squad_id, threshold, anonymous, status, expires_at, version |
| Answer | whim_id, user_id, prepared (yes/negotiate/no + reason), confirmed (yes/no), negotiated, version |
| Negotiation | whim_id, user_id, status (with_host/accepted/kept/closed), proposal (time and/or price); whim_talk: whim_id, from_user, text |
| Tag request | plan_id, user_id (one per person per plan), status (asked/approved/declined/done) |
| Plan | id, whim_id, squad_id, host, booker, title, option, when, where, price_cents, price_mode (total/per person), split (equal/custom/weights), min_people, pounce_rule, decide_by, refund_until, status, locked_at |
| PlanMember | plan_id, member, status, limit_cents (referee only), weight, custom_cents, cover_cents |
| Paw | id, plan_id, member, source (savings/jar/paypal), order_id, authorization_id, amount_cents, status, expires_at |
| Pounce | id, plan_id, final_group, shares, captures, releases, payout_batch_id, status |
| Ledger | account (user jar / user savings in party / platform), type, amount_cents, ref, reason |
| YarnEntry | squad_id, payer, people + split, amount_cents, note, kind (split/treat), status (pending/confirmed/disputed/settled) |
| Untangle | squad_id, transfers, status |
| HelpRequest | id, requester, amount_cents, date, note, type, recipients, status, filled_cents |
| Pledge | request_id, giver, amount_cents, paw_ref, anonymous |
| KittyParty | id, squad_id, name, goal_cents, paypal_plan_id |
| PartyMember | party_id, user_id, monthly_cents, save_day, next_save_at, savings_cents |
| Bowl | id, squad_id, owner, service, total_cents, seats, split, paypal_plan_id |
| GiftGroup | id, birthday_user, members, budget_total (referee), ideas, chosen, plan_id, delete_after |
| Purr / Tag | user, squad, type, event_ref |
| Event | id, actor (user/kitten/system), type, object, payload (owner-scoped), reason, paypal_id, created_at |

## C4 Stack and hosting (Render-first)

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js (TypeScript)**, Tailwind, Framer Motion | One codebase for UI + API |
| Hosting | **Render web service**: **free** plan while building; upgraded to **Starter** (paid from sponsor credits; needs a card on file) in Phase 5 | Free instances sleep after 15 min idle; judging runs to 15 Dec |
| Database | **Render Postgres**: **free** while building; upgraded in place to **Basic 256 MB** in Phase 5 | A free Render database expires 30 days after creation (~7 Dec) |
| Live updates | Server-sent events from the app + Postgres LISTEN/NOTIFY | No extra service |
| Jobs | **Render Workflows** (TypeScript SDK, public beta) for durable jobs: deadlines, Meows, Kitty Party checks, Catnip clean-up. Fallback: Render Cron Jobs. | Sponsor prize angle |
| Auth | Log in with PayPal (fallback: email + password) | Verified payout email in one step |
| AI | Groq (OpenAI-compatible API) first; Gemini (`@google/genai`) as the fallback | Free tiers; keys in `.env` (`GROQ_API_KEY`, optional `GEMINI_API_KEY`) |
| PayPal | Server SDK (APIMatic) + REST + Agent Toolkit; JS SDK | §C1 |
| Gifts | Channel3 API | Sponsor; code `PAYPAL-HACKATHON-2026` |
| Diary / My Month tables | AG Grid (SHOULD) | Sponsor prize pool |
| Export | MCP TypeScript SDK; calendar feed; CSV | §B21 |
| Tests | Vitest (referee), Playwright (smoke) | Money logic must be tested |
| Optional | Postman collection, Astropods | No prize; only if time allows |

## C5 Repository layout (as built in Phase 0)

The repo root is the Kitty folder itself: the PRD sits next to the app, and the app lives in `web/` (Render's `rootDir`).

```
Kitty/                      repo root (git)
├─ Kitty-PRD-v*.pdf         the current PRD (older ones are moved to _superseded/, which isn't committed)
├─ prd-source/              PRD source + build.py
├─ render.yaml              Render Blueprint (web service + Postgres)
├─ CLAUDE.md                rules for coding sessions
├─ LICENSE · README.md
├─ .env                     secrets (git-ignored)
└─ web/                     Next.js 16 app
   ├─ app/                  routes: pages + api/ (dev console in Phase 0; meows, squads, plans… from Phase 3)
   ├─ components/           (Phase 3) cards, pots, rooftop, kitten SVG + poses, money-moment animations
   ├─ lib/
   │  ├─ referee/           (Phase 1) shares (rounding), pounce, untangle, rules, budget, party (+ tests)
   │  ├─ kitten/            (Phase 1) runtime, prompts, tools, memory
   │  ├─ paypal/            rest.ts, sdk.ts, holds.ts, payouts.ts, subscriptions.ts, webhooks.ts, login.ts
   │  ├─ ai/                gemini.ts (fast-first + fallback)
   │  ├─ export/            (Phase 2) mcp, calendar, csv
   │  ├─ db/                Postgres / PGlite adapter + migration runner
   │  ├─ money.ts           integer-cents helpers
   │  └─ spike/             Phase 0 integration checks
   ├─ db/migrations/        numbered SQL files
   ├─ workflows/            (Phase 2) deadlines, meows, party, catnip clean-up, demo reseed
   └─ scripts/              spike.ts (and later seed scripts)
```

## C6 Non-functional requirements

- **NFR-1 Speed:** kitten replies SHOULD start streaming within 1.5 s and finish within 3 s at the median; prepared answers MUST be ready within 5 s of a whim being shared.
- **NFR-2 Live updates:** pot fills, statuses and chat cards MUST update within 2 s.
- **NFR-3 Money safety:** money operations MUST be idempotent, replay-safe and in integer cents; the money-balance invariant MUST be checked in tests and at runtime for every plan, untangle and party.
- **NFR-4 Privacy:** logs and analytics MUST NOT contain other users' limits, reasons or balances.
- **NFR-5 Availability:** the hosted app MUST stay up and awake until 15 Dec 2026 (paid Render instance + Postgres).
- **NFR-6 Cost:** run on sponsor credits and free tiers; Gemini usage capped per user, with templates as the fallback.
- **NFR-7 Accessibility:** WCAG 2.2 AA; reduced motion respected.
- **NFR-8 Security:** secrets server-side; signed stray links; verified webhooks; rate limits on auth, AI and PayPal endpoints.

---

# Part D: Delivery

## D1 Build approach and phases

**How we work**
1. **Backend first.** Phases 1 and 2 build the backend feature by feature. Each feature is driven by a bare **dev console** (plain forms and buttons) so it can be tested without real screens.
2. **Then the app, designed first (owner, 8 Nov).** Phases 3 and 4 are **merged** into one UI phase. Every key screen is **designed before it is built**: in Paper (paper.design, a canvas whose layers are real HTML/CSS, connected to Claude through Paper Desktop's local MCP server), iterated with the owner, then implemented. Paper's free plan allows **100 tool calls a week**, so: foundations and the 8 key screens are designed in Paper; the rest are built in code from the same parts and reviewed as browser screenshots (no Paper calls); the owner's own edits in Paper are free; every approved frame is read back once. Claude states the expected call count before each Paper stage. The kitten itself is drawn in code (§B22) and only placed on the canvas.
3. **A detail pass before every feature:** settle its nuances, screens and states, and add them to this PRD (v1.2, v1.3…).
4. **Development starts only when you say so.** (Phase 0 started 7 Nov 2026.)
5. **After every phase, a phase report:**
   - Claude first runs its own tests and reports the results honestly.
   - Then, in plain words: what was built, how, and the architecture.
   - Then numbered steps the owner follows to test it themselves.
   - Each report's key findings are also recorded in §D8.

**The phases (6 Nov is a Friday)**

| Phase | When | Scope | Done when |
|---|---|---|---|
| **0. Setup and spikes** | Fri 6 Nov | Repo (MIT LICENSE), Next.js app on a Render paid instance + Render Postgres, `.env` wiring. PayPal spike on the hosted URL: Log in with PayPal, hold → partial capture → void → refund → payout, webhook verification, a quantity subscription, server-side test-card hold. 6 sandbox friend accounts. Gemini fast/fallback client. APIMatic plugin installed. | Every spike call works from the hosted URL; findings recorded in the PRD |
| **1. Backend core** | Sat 7 – Sun 8 Nov | Referee (shares, rounding, invariant, fits, partial Pounce, paw-up, cover, tag along) with unit tests · sign-up APIs (§B1) · kitten runtime, prepared answers, friend's-kitten ask-owner (§B2) · House Rules R1–R7 + personal-rule guardrail (§B3) · Treat Jar ledger (§B4) · squads, mini-squads, chat events over SSE (§B5) · whims from text/screenshot/link (§B6) · suggestions + 2-round loop guard (§B7) · plans (§B8) · paw in / Pounce from savings, jar and PayPal (§B9) · receipts + leftovers to source (§B10) · fun-budget check + calendar clash check (§B20 rules) · event log for the Kitten Diary (§B19) · core kitten chat tools (§B18) | AT-1 to AT-12, AT-14 to AT-16, AT-19, AT-21 to AT-23 pass via API / dev console |
| **2. Backend non-core** | Mon 9 Nov | "I paid" cards, Yarn, Untangle (§B11) · Nine Lives (§B12) · Kitty Party with per-person savings (§B13) · Catnip with auto-delete (§B14) · The Bowl (§B15) · Meows + alerts (§B16) · purrs, tags, Top Cat, streaks (§B17) · My Month data (§B20) · remaining chat tools (§B18) · Render Workflows jobs: deadlines, Meows, party checks, Catnip clean-up · export: MCP, calendar feed, CSV (§B21) | AT-13, AT-17, AT-18, AT-24 pass; scheduled jobs run on Render |
| **3+4. Design, app and video (merged 8 Nov)** | Sun 8 – Wed 11 Nov | **Design (Paper first):** the kitten in code (done 8 Nov: `/dev/kitten`) → design brief and tokens (§B22 design pass) → a 1–2 call Paper test → foundations page (~8–10 calls) → 8 key screens (~16–24): Meows home; "+" whim composer with the kitten reading and sending; squad rooftop with Plans; plan card + paw-in sheet + Pounce; Yarn + Untangle; My Month; My Kitten (incl. adoption); Demo World entry and the phone frame → iterate (~15–20) → read back approved frames (~8–10). **Build:** the 5-tab app (§B22): Meows · Squads (rooftop, Chat, Plans, Yarn, Party, Bowl, My settings) · "+" (whim, I paid, ask for help) · My Month · My Kitten (rules, Treat Jar, Diary, help requests); sign-up's 5 pages; money-moment animations with the owner's own kitten; **mobile-app shell + phone frame on laptop + installable PWA (FR-UX-1, 7, 8)**. **Then:** Demo World (seed, "let the squad respond", nightly reseed, pre-generated text, §B23), polish on the screens the video shows, video script, recording and upload, README. | Every Phase 1–2 flow works from the real screens, inside the phone frame on a laptop and full screen on a phone; AT-20 passes; the video is uploaded; the README is complete |
| **5. Submit** | Thu 12 Nov | **Upgrade Render first:** the owner adds a card in Render; we switch `render.yaml` (or the dashboard) to web **Starter** + database **Basic 256 MB**, upgraded in place so data is kept; confirm `/api/health` and that the app no longer sleeps. On Starter the app runs its own jobs every 15 minutes (v1.45), so no cron service is needed. Then: buffer for fixes; make the GitHub repo public; Devpost entry (description, built with, AI tools, links); final checks; APIMatic claim form. | Render on paid plans (awake, database won't expire); submitted by evening IST (hard deadline Fri 13 Nov, 01:30 IST) |

**Coverage check:** every feature in Part B has a phase:
- Phase 1: §B1–B10, §B18 core, §B19 log, §B20 checks.
- Phase 2: §B11–B17, §B18 rest, §B20 data, §B21.
- Phase 3+4 (merged): §B22 + all screens, designed in Paper first; then polish, the real test accounts and the video.

**If we fall behind**, cut in this order: Export (§B21) → The Bowl (§B15) → Catnip (§B14) → Year in Purrs and Top Cat (§B17) → animation polish. The core loop, Yarn, My Month, Kitty Party and Nine Lives stay.

## D2 How each judging criterion is met

| Criterion | Evidence |
|---|---|
| **Technological implementation** | Per-user agents + a deterministic referee; kitten-to-kitten negotiation with a loop guard; rounding to the cent; PayPal Orders in → double-entry ledger → Payouts out; Log in with PayPal; verified webhooks; money-balance tests |
| **Design** | One polished illustrated world; animated money moments; one-tap cards |
| **Potential impact** | Friends stop fronting, chasing and overspending (§A1 data); a fun budget, and saving together |
| **Quality of the idea** | Commit-first group money with private limits; Pounce with whoever's in; kittens that speak for you; saving that pays for the next plan |
| **Presentation** | A character-driven story; a real app judges can log in to |

## D3 Demo (to be written once P0 works)
The 3-minute script is written on Mon 9 Nov, once the core loop runs, so the design pass polishes exactly what's on screen. Candidate story: the cabin trip (§A7), with quick cuts to My Month and a Kitty Party paying a share.

## D4 Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scope is still large for one person | P0/P1/P2 tiers; P2 can be cut without breaking the story |
| PayPal popups / Log in with PayPal on the hosted domain | Day-1 spike; fallback email + password |
| Holds expire during judging | Fresh plans made by the real test accounts close to judging |
| Render free instances sleep; the free database expires ~7 Dec | Build on free plans; **upgrade to paid (card + credits) in Phase 5**, before submitting |
| Gemini free-tier limits with several judges | Flash-Lite first, templates as fallback |
| Overclaiming "agents negotiate" | Pitch it honestly: kittens speak for you; a neutral referee decides (§B7) |
| Small squads make sit-outs guessable | Promise "never shown", not "never known" |
| Legal perception (holding funds, savings, loans) | A README "path to production": PayPal partner/marketplace model; licensed money handling; no interest |
| Art consistency | One in-house SVG kitten with variants and poses |

## D5 Locked decisions (6 Nov 2026, v1.2)
1. Kitty = per-user **kittens** that speak for their owners; a code **referee** decides. Friend group = **Squad**.
2. The problem covers both sides: planning and paying together, **and** not overspending with friends.
3. Partial Pounce: everyone-in, at-least-N or host-decides. No race rule, no seat swap.
4. No growth stages: autonomy = House Rules (set at sign-up) + Treat Jar.
5. The kitten never accepts or declines a plan without a one-tap confirmation.
6. Kitty Party = squad savings, per-person amounts, used first for plans.
7. Catnip = opt-in, triggered by the birthday person's kitten, auto-deleted 3 days after the birthday.
8. Daily brief = **Meows**; no push, no email, English only.
9. Cut: Scaredy Cat, Prowl, Habits (folded into settings), Squad Jar, benchmarks.
10. Render-first stack; Log in with PayPal; Gemini Flash-Lite first.
11. Build in phases: 0 setup → 1 backend core → 2 backend non-core → 3 simple 5-tab app → 4 video, polish → 5 submit. Development starts on the owner's go.
12. Money settings: **Treat Jar** (real money) · **free hand** (how much the kitten spends alone, at a time) · **fun budget** (monthly target). "Always ask above" is merged into free hand.
13. The floater sets "need at least" per whim (default half); it also sets the Pounce minimum.
14. Whims to chosen friends create a **mini-squad**.
15. No double booking: being "in" two overlapping plans is blocked; My Month has a small calendar.
16. Kittens suggest changes for at most 2 rounds; owners always make the final tap; host edits apply, members' edits become suggestions.
17. Kitty Party savings are tracked per person; savings only pay their owner's share; leftovers return to their source.

## D6 Choices made for you
| Question | Decision | Why |
|---|---|---|
| Realtime database | Render Postgres + server-sent events | Render-first; no Supabase pause risk |
| Background jobs | Render Workflows (TypeScript SDK, public beta); Render Cron as fallback | Counts toward Render's prize; Cron is the safe fallback |
| Kitten art | In-house SVG kitten (one base + variants + poses) | Free, consistent, and animatable for money moments; no image-quota risk |
| PayPal JS SDK | v6 if the day-1 spike passes for holds; v5 otherwise (and for subscriptions if v6 lacks them) | v6 is PayPal's current SDK, which judges will notice; v5 is the proven fallback |
| Sign-in | Log in with PayPal | Verifies the payout email; nothing to email |

## D7 Acceptance tests (end to end)

| ID | Test | Pass when |
|---|---|---|
| AT-1 | Sign-up | A new user completes 5 pages with Log in with PayPal; the verified email is stored; the Treat Jar shows the top-up |
| AT-2 | Whim from screenshot | A chat screenshot becomes a whim with What/When/Up to filled and confirmed |
| AT-3 | Prepared answers | Each friend gets a prepared answer with a reason; one tap confirms; unanswered → "no answer" |
| AT-4 | Whim fades | "Need at least" not met → fades; only the floater is told |
| AT-5 | Full Pounce | 4 of 4 in; exact shares from Treat Jars; the pot lands in the booker's Treat Jar |
| AT-6 | Partial group | 6 invited, 4 in (at least 3): the host Pounces; the 4 pay; the other 2 are never charged |
| AT-7 | Host's tap | Only the host's tap Pounces, and each person pays exactly their share |
| AT-8 | Rounding + invariant | $680 split 6 ways → 2 × $113.34 + 4 × $113.33; collected = paid out + refunded, to the cent |
| AT-9 | Tag along | After the Pounce the host says yes; the newcomer pays the new share; the refunds add up exactly to the newcomer's payment |
| AT-10 | Kitty Party money | The host chose it; a member with $60 savings and a $140 share → $60 from savings + $80 from the Treat Jar |
| AT-11 | Deadline miss | Whoever hasn't paid is dropped; too few or the host unpaid → on ice, all money back |
| AT-12 | Receipt leftovers | A $20-under receipt → each person's leftover returns in proportion, to the source it came from (own savings, Treat Jar), or to their own savings per the squad setting |
| AT-13 | "I paid" + Untangle | 3 "I paid" cards confirmed → untangle ≤ 3 transfers → balances zero |
| AT-14 | Overspending guard | A whim over the fun budget → the kitten privately suggests negotiating; no money moves |
| AT-15 | Personal rule guardrail | A custom rule can only cause "ask"; it never authorizes spending |
| AT-16 | Never decides alone | No plan is joined or declined without the owner's tap |
| AT-17 | Nine Lives | A $300 request; 3 pledges fill $250; partial accepted; one $250 Payout; declines invisible |
| AT-18 | Catnip | The birthday person sees nothing; opt-in only; the group is gone 3 days after the birthday |
| AT-19 | Privacy | No API response or screen for user B contains user A's limit, reason or balance |
| AT-20 | Real accounts | A judge logs in with a sandbox PayPal account and takes a plan through to the Pounce with friends who are real accounts; nothing in the app says demo |
| AT-21 | No double booking | A user in a plan gets an overlapping whim → the kitten suggests negotiating, and Yes is refused; a busy time only warns |
| AT-22 | Mini-squad | A whim sent to 3 chosen friends creates a mini-squad; after settlement it's archived; "Keep as squad" works |
| AT-23 | Negotiation loop guard | One try each, one at a time, two changes at most, the host decides; the kittens' talk is on the whim |
| AT-24 | Savings tracked per person | Members save different amounts; using savings for a plan draws only each owner's balance; the jar total always equals the sum of member balances |

## D8 Phase log (findings)

### Phase 0: setup and spikes (7 Nov 2026)

**Stack as built**
- Next.js 16.4.5 + React 19.3 (TypeScript, Tailwind 4), Cache Components on. GET handlers that read the database call `connection()` so they run per request.
- PayPal Server SDK 2.5.0 (APIMatic) for Orders and Payments. It also covers Subscriptions, Transaction Search and Vault, but **not** Payouts, Catalog, Webhooks or Identity, so those use a small REST client with token caching, idempotency keys and retries.
- Gemini via `@google/genai` 3.0.
- Database: `pg` for Render Postgres; **PGlite** (embedded Postgres) locally, because the local Postgres server needs a password we don't have. Migrations are numbered SQL files.
- Env: secrets stay in `Kitty/.env` and are read with Node's `process.loadEnvFile` (Next's own env loader caches its first folder and ignored the parent).
- APIMatic's PayPal context plugin is installed for Claude Code: skills only, no hooks.

**Spike results (against the real sandbox)**

| Check | Result | What it means |
|---|---|---|
| App token | PASS | Credentials work |
| **Server-side hold with PayPal's test card** (`4012888888881881`) | **PASS, no popup** | Demo World's simulated friends can make **real** holds (FR-DEMO-4 confirmed) |
| Partial charge with `final_capture` | PASS ($20 held, $12.34 charged, rest released) | The Pounce mechanic works |
| Partial refund | PASS ($2.00 refunded) | Leftovers and tag-alongs work |
| Release (void) | PASS (status VOIDED) | Deadline misses and dropouts work |
| Payout | PASS (batch accepted) | Paying the booker works |
| Hold with a PayPal account | Approval link created (payer-action); approval needs a sandbox buyer login | The owner tests it |
| Subscription with quantity ($1 unit, daily) | Plan ACTIVE; approval link created | Kitty Party contributions work; the owner approves |
| Log in with PayPal | Link created; needs the app setting + return URL | The owner enables it |
| Webhooks | Needs the hosted https URL | Done after the Render deploy |
| Gemini | Flash-Lite ~1.3 s for a short reply; Flash JSON ~2.5 s | Within NFR-1 |

**Decisions**
- Phase 0 uses PayPal's **redirect approval links** (no JS SDK yet). The JS SDK v6 vs v5 choice moves to Phase 3.
- The dev console (`/dev`) is locked with `DEV_CONSOLE_KEY` on the hosted URL.

**Owner steps and live checks: all done (7 Nov 2026). Phase 0 is complete.**

| Item | Result |
|---|---|
| Sandbox friends | Uploaded: Ava, Jordan, Tyler, Zoe, Marcus, Judge (US personal, $5,000 each). The upload file must be **plain UTF-8**; UTF-16 is rejected. |
| Live app | https://kitty-web.onrender.com on Render **free** plans (web + Postgres). `/api/health` ok, `db: postgres`. Upgrade in Phase 5. |
| Webhook | ID (ID in `.env` as `PAYPAL_WEBHOOK_ID`) → `/api/paypal/webhook`. Real events arrive **verified**: authorization created, capture completed, capture refunded, order approved, sale completed, subscription activated. A simulator test event sent before the ID was set showed "not verified", as expected. |
| Log in with PayPal | Enabled with the live return URL and live privacy/terms links. Jordan logged in; email received and verified. PayPal rejects `localhost` return URLs. |
| Hold with a PayPal account (live) | Ava approved; $15.00 hold CREATED, expires after 29 days |
| Subscription with quantity (live) | Ava approved; ACTIVE, quantity 10 |

### Phase 1: detail pass (design decisions before coding, 7 Nov 2026)

**Who is who**
- Real users sign in with **Log in with PayPal**. The app upserts the user by PayPal payer ID and sets a signed session cookie.
- **Demo users** (Ava, Jordan, Tyler, Zoe, Marcus, Judge) are seeded with kittens and a squad. For testing, the dev console can **act as** any demo user (dev key only).
- Demo users' PayPal holds use **server-side test-card authorizations** (no popup). Real users approve holds on PayPal.

**Data (one migration)**
- `users`, `kittens`, `rules`, `squads` (kind: squad / mini), `memberships`
- `whims`, `answers`, `suggestions`
- `plans`, `plan_members` (private limit, weight, custom amount, savings switch), `paws` (initial / paw-up / cover / tag-along; source: savings / jar / PayPal), `pounces`, `captures`, `refunds`, `receipts`
- `busy_blocks`, `ledger` (double-entry), `events`

**Ledger (double-entry, integer cents)**
- Accounts:
  - `world` (outside money on PayPal)
  - `jar:{user}` and `jar_held:{user}`
  - `savings:{party}:{user}` (used in Phase 2)
  - `plan:{plan}`
- Every movement writes entries that sum to zero.
- Invariant: when a plan is settled, `plan:{plan}` is zero, and the cents in equal the cents out.

**Referee (pure functions, unit-tested)**
- `splitCents`: largest-remainder split
- `planShares`: equal, custom amounts, weights, cover
- `solveGroup`: partial Pounce
  - Who fits, who's short and by how much
  - Max 2 paw-up rounds
- `tagAlong`: the new share and exact refunds
- `leftovers`: proportional to what each paid, back to each source
- `decide`: House Rules → auto / ask / deny
  - Personal rules can only return "ask"
- `budget`: fun-budget headroom
- `clash`: plan overlap = hard "busy"; a busy time = a warning
- `pickCandidate`: most members fit → best Borda rank → lower price, with the 2-round no-repeat loop guard

**Lifecycles**
- Whim: floating → plan (when "need at least" say yes) | faded (expired)
- Plan: open → pounced → settled; open → on ice (deadline unmet: everything released) → reopened | cancelled
- Paw: pending approval → held → captured | voided

**Deadlines and timers**
- One `tick` job processes due whims, deadlines and hold windows.
- In Phase 1 it runs from the dev console and a keyed endpoint; Render Workflows calls it on a schedule in Phase 2.

**Live updates**
- Server-sent events. The server polls `events` every ~1.5 s per open stream (simple and works on Render's free plan).

**Kitten AI in Phase 1**
- Whim parsing: text, screenshot (vision), link (page metadata + text)
- Reason lines for prepared answers (facts computed in code)
- Rule mapping to R1–R7 or a personal rule
- Receipt totals
- Chat: Gemini maps a message to one tool from a fixed list (JSON). Code validates it and returns a confirmation card.
- Every AI call is Flash-Lite first, with template fallbacks.

**Not in Phase 1 (Phase 2):**
- Kitty Party (the savings source works in the ledger, but creating parties is Phase 2)
- Yarn, Nine Lives, Catnip, Bowl, Meows, purrs, My Month screens, export

**Phase 1 acceptance:** AT-1 to AT-12, AT-14 to AT-16, AT-19 and AT-21 to AT-23, run as an automated script against the real sandbox. AT-10 (savings first) uses ledger-seeded savings.

### Phase 1: results (backend core, 7 Nov 2026)

**Built**
- 4 migrations (core tables, Pounce details, per-user time zone), double-entry ledger, referee, services for sign-up, rules, squads, Treat Jar, whims, plans, paw in, Pounce, tag along, receipts, timer, kitten AI and chat.
- `/api/v1`: one route table (49 routes) with membership checks on every plan and squad route; host-only Pounce and negotiate; zod-checked bodies; errors written for people.
- `/api/v1/stream`: server-sent events; own events in full, squad events masked.
- Log in with PayPal now creates the user and a signed session (CSRF `state` cookie). Dev "act as" and dev routes need the dev key; on Render with no key they are closed.
- `/dev/play`: a plain test bench to drive the backend as any demo friend (not product UI).

**Tests**
- 42 unit tests (referee, money, PayPal client, Gemini fallback and quota bench, time zones).
- `npm run accept:phase1`: 22 end-to-end checks against the real sandbox and Gemini on a fresh in-memory database, including a forced capture failure and the ledger-sums-to-zero check. **22/22 pass.**
- `npm run timing:nfr1`: whim → prepared answers timing.

**Findings (and what changed)**
- **Gemini free tier: Flash allows only 20 requests a day per model.** It ran out during testing. Every call, including screenshots and receipts, is now Flash-Lite first. A quota error benches that model until Gemini's own retry time instead of retrying it. Per-model limits are only visible in AI Studio (signed in). Linking billing (Tier 1) is the owner's call before judging.
- **Batching:** all friends' reason lines come from ONE call (was one call per friend), and plan re-checks are batched too. A whim with 5 friends was 11–88 s; it is now 1.0–3.6 s (worst seen 5.1 s when calls ran back to back). AT-23 went from 88 s to 3 s. **NFR-1 met.**
- **Reason lines** start with the answer and speak to the owner. A "maybe" now always says why ("I can't tell if it's your kind of thing").
- **Time zones:** "Friday 7pm" was read in the server's zone. Each user now has a time zone (default US Pacific). The model gets the user's local date and time and returns wall-clock times; code converts them. A weekday that already passed moves to next week (code has the last word).
- **Booker's own leftover** was not recorded as a refund, so a later tag-along over-refunded by exactly the booker's part. Fixed. A leftover the booker hands back is no longer counted as their spending.
- **Pounce captures now run in parallel** (AT-5: 28 s → 18 s of sandbox calls). If any capture fails, the ones that went through are refunded, the affected members are released (final captures can't be reused) and asked to paw in again, and the plan reopens. A forced failure is in the acceptance script.
- Tag-along members now store their limit, like everyone else who is "in".

**Still Phase 3 (needs approval screens):** real-user flows that need a PayPal approval after the Pounce (tag along, returning a leftover, paying an overrun). Demo friends use test cards for these today.

### Phase 1: second pass (click-through as a user, 7 Nov 2026)

The whole flow was clicked through in `/dev/play` as Ava, Jordan and Tyler, and every guardrail was tried. Findings and fixes:

- **Payouts need real PayPal balance, not card money.** The platform's sandbox account started with $5,000. Money received by test card counts in its balance but PayPal won't use it for Payouts. Today's tests spent the original $5,000, so bookers can't be paid until the account is funded. **Owner action before the demo:** add balance to the sandbox business account in the developer dashboard. If that isn't possible, create a new sandbox business account with a large balance and a new app on it (new keys, re-register the webhook, re-enable Log in with PayPal). Also cut test payouts: keep Demo World amounts small.
- **A failed payout never strands money.** The Pounce is recorded, the money waits in the plan's pot, the booker is told not to book yet, and the timer retries the payout. Receipts wait until the payout has arrived. The squad only hears "the booker has been paid" once it's true.
- **No double booking, fixed for plans with no end time.** They counted as zero minutes and never clashed. They now count as 3 hours, like everywhere else.
- **A friend's kitten:** "is Jordan free on Saturday?" now uses Jordan's own day in his time zone (a Friday-evening plan looked like Saturday in UTC). "Is he coming to bowling?" is answered from the plan (only plans in a squad the asker shares). Money questions are always refused.
- **Kitty's own words are explained from a glossary in code**, not by the model (it made up a meaning for "paw up").
- **Gemini:** a hard time limit per call (the SDK's own limit didn't cut slow calls). If the last available model is slow, it gets one more try before the template. Chat replies take 0.3–2.5 s typically.
- **Funded (owner, 7 Nov):** the owner added balance to the sandbox business account (`store.owner.av26@business.example.com`). $5 and $80 payouts then worked, and the full acceptance run passed **23/23** on the real sandbox.
- **Typed rules:** words that try to loosen control ("never ask me", "as much as you want", "no limit") are rejected by code before any AI call. If the AI can't read a rule, nothing is saved; the kitten asks you to try again.
- **PayPal stalls:** one sandbox call hung for 30 s and stopped a whole run. The PayPal SDK's generated defaults retry nothing (and never POST). Every PayPal call now has a 15 s limit per attempt and up to 2 retries. Retries reuse the call's PayPal-Request-Id, so they can't double-charge or double-pay (unit-tested). Final run: **23/23**.
- **Chat when the AI is busy:** simple questions (my month, my Treat Jar, my plans, ask a friend's kitten) are routed by keywords in code, so they still work during Gemini quota or timeout spells.
- **Owner test, round 1 (7 Nov):**
  - "Seeing $60 paid, but the bill was $54": the playground's single amount box still held 25 when the receipt was added, so the receipt said $25 and was never confirmed. The receipt now has its own box. How the money works: the Pounce pays the booker the full $60 before booking; after the receipt, the $6 left over goes back by share ($2 each; the booker keeps theirs from the $60 and returns the other $4, which are refunded to the others' original payments).
  - Zoe's "cabin weekend dec 12-14, 1200 total" came back with no price or dates and took 34 s: Gemini was overloaded (503 high demand). Every AI step now has a hard total budget, and code reads typed whims (FR-WHIM-9), so the price and dates are there even with the AI down.
  - New: "need at least" when floating a whim; every member sees their expected share (FR-PLAN-7) on the prepared answer and the plan; the host can set uneven splits (custom amount or weight per person), which the Pounce charges.
- **Dev setup:** the local database lives outside the project (`~/.kitty-dev/pglite`), because the dev server's file watcher reloaded on every database write. A blank setting now counts as "not set". The Kitten Diary shows the PayPal hold ID on paw-in.

### Phase 2: detail pass and results (backend non-core, 7 Nov 2026)

**Decisions (detail pass)**

| Module | How it works in v1 |
|---|---|
| Yarn (§B11) | "I paid" cards split equally among the payer and the people named (or "my treat": nothing owed). Each person on a card confirms or disputes in one tap; a card counts only when everyone has confirmed; a disputed card is paused. Untangle: biggest debtor pays biggest creditor (at most n−1 payments). Paying: the Treat Jar if within the free hand, else PayPal; the money passes through `yarn:{squad}` and goes straight on by Payout. Reminder after 3 days, kitten to kitten. Squads see only "All untangled" or "N open". |
| Nine Lives (§B12) | Private request to chosen friends (who must share a squad). Each kitten suggests an amount from the friend's help rule (R3). Pledges: Treat Jar reservation or PayPal hold, never more than still needed. Accept anytime (partial is fine) → capture all → ONE Payout. At the needed-by date the timer accepts what's pledged. Loans become confirmed Yarn cards (no interest); a lender can turn a loan into a gift. Declines and helper names are never shown to the requester. One open request; 3 per 90 days. |
| Kitty Party (§B13) | One party per squad. A PayPal product + quantity billing plan ($1 × quantity) is created with the party; real members approve a subscription, and each verified `PAYMENT.SALE.COMPLETED` credits that member (idempotent by sale id). Demo friends can't approve subscriptions, so the timer charges their monthly amount to the sandbox test card. Each member's balance is its own ledger account; the jar = the sum. The R6 rule records each member's amount. |
| Catnip (§B14) | The radar runs in the birthday person's data 10 days ahead (only with birthday sharing on) and invites each squad mate privately. The secret gift group is a squad of kind `gift` the birthday person is never in, so nothing can reach them. Budget = the sum of private limits. Ideas: Channel3 search within the budget when `CHANNEL3_API_KEY` is set; otherwise AI-written ideas, and members add links. The chosen idea becomes a plan in the gift group (same engine). 3 days after the birthday: ideas, members, invites and chatter are deleted; money records stay in each Diary. |
| The Bowl (§B15) | Shares split the monthly total across seats (the account holder holds one). Real members: a per-Bowl plan priced $0.01 × quantity = their share in cents (exact). Each cycle collects the shares and pays the account holder in ONE Payout. A seat leaving recomputes shares, which the others confirm; an unpaid share becomes a reminder and a Yarn strand. |
| Meows and alerts (§B16) | Built from the event log in five sections; every "Needs you" item carries the one API call that acts on it. Greeting in the breed's tone (templates). Recap on the 1st. Alerts: Pounce, paw-up, help request, failed capture, decide-by within 2 h; held back during quiet hours (default 22:00–08:00). |
| Purrs (§B17) | A job reads new events and awards purrs and the 8 collar tags; Top Cat = most purrs in a squad in 7 days; streak = recent plans settled or still fresh. No money anywhere. |
| My Month (§B20) | Spending = plans + gifts (net of refunds) + my share of confirmed Yarn cards (a treat counts in full for the payer; loans don't) + help given + Bowl shares. The overspending guard uses the same total. Owed, saved (party + Treat Jar), coming up, calendar. |
| Chat (§B18) | New tools: log "I paid", what do I owe, untangle, Kitty Party, ask for help (a draft until sent), top up (a confirm card; never moves money from chat). |
| Export (§B21) | CSV of the Kitten Diary and My Month (formula-safe), and a private calendar feed (unguessable token). The MCP connector (SHOULD) is deferred: first in the cut order. |
| Jobs | One keyed endpoint runs every job (deadlines, payout retries, Yarn reminders, Nine Lives dates, party and Bowl cycles, Catnip radar and clean-up, purrs, On Budget). Render cron needs a paid plan, so a free GitHub Actions schedule calls it every 15 minutes with `JOBS_KEY` (it can only run jobs); this also keeps the free instance awake. A Render cron can replace it in Phase 5. |

**Results (7 Nov):** `npm run accept:phase2` **12/12** on the real sandbox and Groq: AT-13 (2 transfers settled 4 cards' worth; "All untangled"), AT-24 (balances $40/$30/$20, savings paid only their owners' shares, jar = sum), AT-17 ($250 of $300 accepted, one Payout, a decline invisible, the loan in Yarn), AT-18 (the birthday person sees nothing; opt-in; deleted after), plus Bowl, Meows/alerts, purrs, My Month, chat, export, jobs and the ledger check. 69 unit tests. The Phase 1 suite was re-run as a regression check. Playground: a Phase 2 panel, including a "Needs you" list where every pending item is one "Do it" tap.

**Findings:** Phase 1 had stored quiet hours as whole hours; migration 005 converts them to "HH:MM". When the AI leaves out an "I paid" note, code takes it from the words ("for coffee for Ava"). Channel3 needs a key (free; code `PAYPAL-HACKATHON-2026`); until it's set, Catnip ideas are AI-written and members add real links. Owner setup for the schedule: `JOBS_KEY` on Render and the same value as the GitHub secret `KITTY_JOBS_KEY`.

**Pre-owner test pass (8 Nov):** before the owner's own test, the 25 owner steps were played as each friend through the app's API on a fresh database (real sandbox, Groq), with every response read and the server log watched. First run 61/64 checks (the 3 misses were the script's own field names); reading the responses found five things a user would notice, all fixed:

| Found | Fix |
|---|---|
| Alerts kept showing a Nine Lives ask after you had pledged and the request was filled | A help ask is an alert only while you can still answer it |
| My Yarn said "you owe $8.49" but not to whom or why | My Yarn lists the strands behind the balance ("You owe Tyler $8.49 for Spotify Family share (missed)"); the kitten's "what do I owe?" says them too |
| After Catnip deleted a group, the unbought gift plan stayed in Plans under "Gift group (deleted)" | Clean-up closes a gift plan that was never bought (holds released first); a bought gift keeps its history |
| A Meows line read "Options: extend the deadline…" with no plan name | The on-ice note names the plan |
| Diary CSV times were in the server's local text format, and chat lines showed `chat.message` | ISO 8601 UTC times; chat lines read "You said: …" |

Second run on a fresh database: **69/69**, including a check for each fix. `npm run accept:phase2` re-run after the fixes: 12/12; 69 unit tests. Also confirmed: a Nine Lives pledge comes from the Treat Jar only within the giver's free hand; otherwise it's a PayPal hold (by design).

### Edge-case pass across Phases 1 and 2 (8 Nov)

The owner asked for the awkward cases: someone sends something and then deletes it after others acted, double taps, the wrong person acting, odd amounts, leaving, timers running twice, and money that must never go missing. Every module that changes state was read, about 80 cases were written as `npm run test:edges` (a fresh in-memory database, real sandbox where money moves), and run **before** fixing. **Baseline: 22 of 74 passed.** After the fixes, plus 6 more cases: **80 of 80**.

**Undo after others acted (new actions; the PRD already asked for them, §B7, §B8, FR-LOG-3):**

| New action | What happens to everyone else |
|---|---|
| Withdraw a whim (floater) | Friends' unconfirmed answers drop out; answering later does nothing; once it's a plan, cancel the plan instead |
| Cancel a plan (host, before the Pounce) | Every hold is released (PayPal voided, Treat Jar and savings back), paw-ups and suggestions close, each member is told; after the Pounce: refused, the receipt settles it |
| Remove or fix an "I paid" card (whoever logged it, or the payer) | It leaves everyone's "Needs you"; an unpaid Untangle built on it is cancelled (tap Untangle again); if it was already paid back, the balance shows that honestly (the payer owes it back); a fix goes out for everyone to confirm again; a Nine Lives loan is turned into a gift instead |
| Take back a Nine Lives pledge (before it's accepted) | The hold or jar reservation is released; the requester sees only the total drop |
| Close a Bowl (account holder) | No more months; members' subscriptions are cancelled and they're told |
| Leave a squad | Blocked, with the reason, while you owe or are owed in its Yarn, have Kitty Party savings there, host or book an unfinished plan, or hold a Bowl's account. Otherwise your holds are released, your saving stops, you leave its Bowls (the others' shares are recomputed) and its rules switch off. You can come back with the invite link |

**Money that could have gone wrong (fixed):**

| Found | Fix |
|---|---|
| A Treat Jar or savings balance could go below $0 (FR-JAR-3) | The ledger itself refuses to overdraw a person's own money |
| Double-tap withdraw (Treat Jar or Kitty Party) paid out twice | The money leaves the account before the payout, and comes back if PayPal fails; one at a time per person |
| A booker with no PayPal email: the Pounce charged everyone, then stopped halfway | Treated like a failed payout: everything is recorded, the money waits in the plan's pot, the timer pays it |
| Covering a friend on a plan that had already Pounced (or for someone who said "not this time") left money on hold forever | Covers only on open plans, before the deadline, for someone taking part |
| Double-tap paw in placed two holds; paw in after the deadline (before the timer ran) worked | One at a time per person per plan; deadline checked |
| A second receipt after an overrun settled the plan again; a double tap on "pay my part" charged twice | One confirmed receipt per plan; one settle and one overrun payment at a time |
| Nine Lives: if the payout failed (or no email), money captured from friends wasn't recorded; one failed PayPal hold sank the whole accept | Everything captured is recorded and the timer retries the payout; a failed hold is dropped (its giver told, nothing charged) and the rest go through |
| Double-tap pledge made two pledges; asking someone you only share a secret gift group with broke loans | One pledge per person (take it back to change it); help is only asked of real-squad friends; a loan with no shared squad is kept in the Diary |
| Double-tap on an Untangle payment charged and paid out twice; redoing Untangle mid-payment threw a payment away | One at a time per squad; Untangle waits while a PayPal payment is in progress; a payment that arrives counts exactly once |
| Changing your Kitty Party amount charged you again | A change is the next cycle's amount (real savers: the same subscription is revised, never a second one) |
| Two job runs at once charged savers twice (and could charge a Bowl twice) | One job run at a time; the Bowl re-checks it's due inside its lock |
| The overrun payout to the booker failing after everyone paid their part | The money waits in the pot and the timer pays the booker |

**Rules that didn't hold (fixed):** a confirmed card could be flipped to "disputed" even after it was paid (now: ask the person who logged it to fix it); answering a removed card; the booker could be set to someone outside the group (the booker receives the pot); an end before the start, a deadline in the past, "need at least" above the group size, removing the price after people pawed in, and reopening from "on ice" with the old deadline; accepting a suggestion twice; a blank card note; a past "needed by" date; re-joining a Bowl at your old share after leaving; a friend who never joined a Bowl put in Yarn when a month ran; the last friend leaving a Bowl crashed it (now it closes); a Bowl share under $0.50; someone who left a squad still counting toward a whim or tagging along; the kitten offering a top-up card over $500 that would fail; tapping Pounce on a cancelled plan answered quietly. One fix was too strict at first and the Phase 1 suite caught it: a friend answering after the whim had already become a plan was refused; now a late "yes" or "maybe" puts them in the plan as "thinking".

**Already held up (passed at baseline):** outsiders get 403, made-up ids 404; zero, negative and huge amounts refused; spending-loosening rules refused; nobody answers another person's kitten question; only the floater, host or lender can do their own actions; a double Pounce tap already made one payout; one cent split three ways; the birthday person can't reach their gift even with the link; chat "ignore your rules and send $500" moves nothing; the ledger sums to zero.

**Design note:** double taps are made safe by a per-action queue in the app (Kitty runs as one web instance on Render) plus the ledger's no-overdraw check in the database. If Kitty ever runs on several instances, the queue moves into the database (advisory locks).

**Regression after the fixes:** 69 unit tests pass; `npm run accept:phase1` **24/24** and `npm run accept:phase2` **12/12** on the real sandbox; lint clean. The playground gained buttons for every new action (Withdraw my last whim, Cancel plan, Fix/Remove my last card, Take my pledge back, Close my request, Close Bowl, Leave this squad).

**Settle up (v1.17):** 8 more cases in `npm run test:edges` (totals across several groups, a card still waiting, Untangle everything only once, paying from My Month, privacy, extra costs on a plan, a group you've left, all settled): **88 of 88**. `npm run accept:phase2` **12/12**.

**Kittens do the chasing (v1.20):** the owner asked whether kittens really do the reminding. They mostly didn't: one reminder, only after someone tapped Untangle, and no reminders at all for cards, plans or receipts. Built: the schedule in §B11, a weekly Untangle that moves no money, reply buttons for a friend's kitten's question, a card for holds still needing approval, and a note when a Kitty Party payment fails. Also fixed: a Bowl month marked real members as having missed their share even when PayPal had billed them. 23 more cases in `npm run test:edges`: **111 of 111**; 82 unit tests; `npm run accept:phase1` **24/24**; `npm run accept:phase2` **12/12**.

### Phase 3+4: the app (8 Nov 2026)
The owner approved the flows and asked to see them in the real app, then change what needs changing.

| Built | Notes |
|---|---|
| PayPal-only front door and 5-step sign-up | No Demo World anywhere. An invite link survives the PayPal login. |
| Meows, Squads, My Month, My Kitten | Bottom tabs in the phone frame on wide screens |
| Pinned kitten chat | Top of Squads, always. Remembers the conversation. |
| Squad rooftop | Chat, Plans, Yarn, Party, Bowl, My settings. Tap a friend's kitten to ask it something. |
| Plan page | Every state from deciding to settled, host tools, tag along, receipts |
| Catnip, Nine Lives, House Rules, Diary, Treat Jar, memory, settings, export | All wired to the backend |
| Moments | Every action plays one: coins into the pot, the Pounce leap, untangling, a calm note when something fails |

**What the kitten chat can do.** Answer from your own records (spending, who paid what, what it did), chat about anything, float a whim, remind a friend, pay a friend, say you're in or out, Pounce, add a receipt, send prepared answers, top up or withdraw from the Treat Jar, start saving in a Kitty Party, ask for help, remember something. Anything that moves money or speaks for you comes back as a card to tap (FR-CHAT-2, FR-WHIM-8).

**Real users, not demo friends (FR-SHOW-2).** Tag along, extra costs and returning leftovers now go through PayPal approval and finish when the person comes back. Before this they only worked for demo friends.

**Decisions made while building**
| Situation | What happens |
|---|---|
| "Pounce now" when the plan waits for everyone but enough are in | A sheet: "3 of 6 are in", with **Go with these 3**. It sets the rule to "when I tap" and Pounces. |
| A plan with no price yet | The host sees **Set the price**. Friends see that the host hasn't set it, and no "I'm in" button. |
| An old question in the kitten chat | Only the newest card can be tapped, so an old "Float it" can never fire twice |
| Reminder asked for in chat | Uses up one of the same reminders the schedule would send, so asking can't get round the limits (FR-CHAT-7) |
| The kitten is asked what you spent | It uses your own share, never the group's total, and won't answer about another person's money |

**Owner's edits from testing (9 Nov).** Every kitten blinks on every screen. A smiling kitten keeps its closed happy eyes, then opens them and blinks before smiling again. A dozing kitten peeks now and then. Log out is a button on My Kitten.

**Bug the owner found (9 Nov).** A real $50.00 Treat Jar top-up completed in PayPal but never reached the jar, and the owner was left on an error page. The app read the payment's tag from the wrong place in PayPal's reply. Real users' payments for settling Yarn, tag along, extra costs and leftovers share that code, so they were affected too. Fixed and covered by a test. Coming back from PayPal now always lands in the app, and a refresh can't count a payment twice.

**Owner's changes (9 Nov, after testing).** The price used to be set after a whim became a plan. Now the floater sets it, with every other plan option, when floating. "Up to" is gone from the form. "Around $20 each" read from text becomes a per-person price. Added chats with friends and their kittens.

**The kitten as manager (9 Nov, owner's flow).** Cards used to be yes/no, and a "not right" reached nobody. Now each answer goes kitten to kitten, comes back as a card, and repeats until both agree, and then the kitten pays. Each person's part counts as soon as it's agreed, which also closes the old gap where one silent friend blocked a card.

**Found and fixed while testing**
| Problem | Fix |
|---|---|
| The squad feed told the app who floated an anonymous whim, even though the screen hid it | The server no longer sends it (FR-WHIM-5). The floater still sees "Take it back". |
| The kitten quoted a plan's whole price as what you spent | It now reads your own share |
| The host never saw friends' suggested changes | Fixed the status the screen was looking for |

**Tests on the final code:** typecheck and lint clean; unit 82/82; edge cases 111/111; Phase 1 acceptance 24/24; Phase 2 acceptance 12/12. In the browser: sign-up as a brand-new real account, kitten chat, floating a whim, setting a price, paw in, Pounce and a receipt with leftovers.

**Not yet proven end to end:** a real person approving in PayPal and coming back, for tag along, extra costs and returning leftovers. A Treat Jar top-up has been proven this way (9 Nov). Tag along and paw in were confirmed to reach PayPal's approval page. Log in with PayPal needs the live https site.

### The whim decides, the plan collects (10 Nov, v1.33)
**The owner's flow.** Everything is decided while it's a whim. A plan doesn't change; it collects the final amount. Only the host Pounces, once enough people are in and everyone's money has arrived. The pot goes to the booker's Treat Jar, and they pay from there.

| Question the owner left open | Decided |
|---|---|
| When does a whim become a plan? | Once enough say yes and nobody's negotiating. Anyone else can tag along |
| After an accepted change? | Everyone is asked again |
| How much can a kitten ask for? | One try per person, one negotiation at a time, two changes at most, up to 25% off, the same hour within 14 days, never before the deadline |
| Can the host be anonymous during a negotiation? | No: the chat shows "Kitten (Owner)" |
| What if someone hasn't paid by the deadline? | They're dropped. Too few left, or the host hasn't paid: on ice, money back |
| Withdraw and cancel? | Only before the Pounce |
| Can the booker pay straight from the jar? | Yes, to anyone with a PayPal account (a Payout from the jar). Not at a website checkout or card machine: there they withdraw first |

**Gone from the app:** Maybe, paw-up, limits, cover, custom splits, editing a plan, Pounce rules, the old plan-stage suggestions and rounds.

**Tests (10 Nov).** Unit 104/104 · edge cases 172/172 · Phase 1 22/22 · Phase 2 12/12, on the real sandbox with Groq.

**Found by using the real app and chat, and fixed:**
- Every new whim said "Changed:" and could only change once, because `whims.version` already existed with default 1 (migration 017).
- "Ask my kitten to negotiate" went to the friend's-kitten tool. The word negotiate now always means negotiate.
- "Say yes to Picnic" could confirm a different whim if it was the only one waiting. A name that doesn't match now gets a question instead.
- The booker stopped earning Clutch once the Pounce moved the pot to their jar.

**Not proven:** a person approving a refill on PayPal's own page (the return path was tested with a captured sandbox test-card order); timers firing on their own locally (the jobs were run directly).

### Tag along needs the host (10 Nov, v1.34)
**The bug the owner found.** Marcus tagged along on Go-karting after the Pounce. His $100 left his jar, then the step that adds him and refunds everyone crashed: "no limit" was stored as a number too big for the column. The money sat in the plan, nobody got anything back, and he wasn't added. Taking the money and paying it out were two separate steps. They're one now, and the local $100 was returned.

**Tests (10 Nov).** Unit 104/104 · edge cases 182/182 · Phase 1 22/22 · Phase 2 12/12. Also run through the real app: asked, the host said yes, and all three jars and messages were right.

**The owner's flow** is §B9 "Tag along". Decided along the way: one ask per person per plan; the money goes to the jar holding the pot (the booker's, which is the host's unless someone else is booking); open until the plan starts.

### Agreeing is paying (11 Nov, v1.44)
**The rule (owner).** Agreeing and paying are one step (FR-JAR-8). Floating a whim, a Yes, Join and asking to tag along set the share aside right then; a short jar is asked to refill first, and the step finishes once, when the money lands. The old code only checked the jar when the plan was made, so a Yes could be followed by a refill card.

**How.** Set-aside shares sit in the person's held jar (`whim_holds`, and `held_jar`/`held_savings` on tag asks; migration 022). When the plan is made they become that person's money in it, to the cent, and anything over goes straight back. They go back if the whim is taken back, fades or changes, the answer becomes No, the host says No, or the plan starts unanswered.

**Tests (11 Nov).** Unit 104/104 · edge cases 197/197 · Phase 1 22/22 · Phase 2 12/12. In the app: a Yes with $2 in the jar opened the refill sheet straight away and sent nothing; a Yes with enough set $5 aside and made the plan with every share already in.

### Phase 5: submit (11 Nov)
- **Committed and pushed** (`2f2abf0`): the whole app. Render deployed it; migrations 007–022 ran on Render Postgres; one live jobs run came back clean; local login is refused on the live site.
- **Secrets:** every file and the whole git history were scanned against each `.env` value and sandbox password: none found.
- **Payouts:** the sandbox business account holds $15,733.71; a $5 payout went through.
- **The app runs its own jobs** every 15 minutes on Render (`web/instrumentation.ts` → `lib/core/job-timer.ts`), replacing the planned Render Cron Job: no extra service, cost or secret. GitHub's free schedule turned out to run only every few hours, so once the web service is on Starter (always on), the timer is what keeps deadlines on time.
- **Owner's steps:** add a card in Render and switch the web service to Starter and the database to Basic 256 MB; decide the judges' sandbox login; make the repo public; the Devpost entry (draft in `submission/devpost-entry.md`), the video and the APIMatic claim form.

## D9 README must include
- **FR-DOC-1** Setup, and the sandbox PayPal logins judges use.
- **FR-DOC-2** AI tools and models used, and how.
- **FR-DOC-3** A short "path to production": PayPal partner/marketplace model, licensed handling of balances, no interest on loans, live-mode checklist.
- **FR-DOC-4** The OSS LICENSE (MIT), shown in the repo's About section.

---

# Appendix E

## E1 Glossary

| Term | Plain words |
|---|---|
| Kitten | Your personal AI agent |
| Breed | The kitten's tone of voice |
| Referee | The code that sees private limits and decides what fits |
| Squad / rooftop | A friend group / its illustrated home |
| Stray | A friend without an account, joining from a link |
| Whim | An idea being decided (What, Where, When, Price, Who, Need at least) |
| Mini-squad | An automatic group for a whim sent to chosen friends |
| Need at least | How many people the floater needs for the plan to happen |
| Plan / pot | A decided whim, which doesn't change / its shared money |
| Negotiate | A kitten asks the host's kitten for another time or price, at the whim stage only |
| Share ("paw in" in older sections) | What you pay for a plan, taken from your Treat Jar |
| Pounce! | The host locks the plan: the pot goes to the booker's Treat Jar |
| Booker | The friend who books or buys |
| Join / tag along | Before the Pounce you just join / after it you ask the host, and the others get the difference back |
| Yarn / Untangle | Who owes whom / settling with the fewest payments |
| "I paid" card | Logging that you paid for friends (split or treat) |
| Kitty Party | A squad's shared savings, used first for plans |
| Nine Lives | Help for a friend in a tight spot |
| Catnip | An opt-in group birthday gift |
| The Bowl | A shared subscription |
| House Rules | Your kitten's mandate (basics, your own rules, squad rules) |
| Free hand | The most your kitten pays on its own, at a time, from the Treat Jar (a permission, not money) |
| Fun budget | How much you want to spend on friends each month, however it's paid (a target, not money) |
| Treat Jar | Your kitten's allowance |
| Meows | The daily brief |
| Kitten Diary | Every action, its reason and its PayPal ID |
| My Month | Your money with friends vs your fun budget, plus your calendar |
| Purrs / collar tags / Top Cat | Points / badges / weekly leaderboard |

## E2 References
- Ally Financial "friendship is too expensive" survey (Jun 2025), via Fox: https://www.fox9.com/news/young-americans-say-friendship-is-too-expensive-nearly-half-skip-events-due-costs-study
- CIT Bank "peace tax" survey (Jun 2026): https://newsroom.firstcitizens.com/2026-06-23-82-of-Group-Travelers-Will-Pay-a-Peace-Tax-to-Avoid-Money-Arguments,-CIT-Bank-Survey-Finds
- Zelle Gen Z survey coverage: https://www.10news.com/politics/economy/friends-owe-you-money-gen-z-goes-into-debt-covering-group-expenses-survey-finds
- Experian, money stress of travelling with friends: https://www.experian.com/blogs/ask-experian/survey-financial-stress-of-traveling-with-friends/
- Federal Reserve SHED 2025 report: https://www.federalreserve.gov/newsevents/pressreleases/other20260513a.htm
- Tilt wind-down after the Airbnb deal: https://www.fintechfutures.com/paytech/payments-firm-tilt-wilts ; Failory: https://www.failory.com/cemetery/tilt ; Tilt drops fees (TechCrunch): https://techcrunch.com/?p=1049603 ; Wikipedia: https://en.wikipedia.org/wiki/Tilt.com
- PayPal Money Pools retired: https://www.yourmoney.com/saving-banking/paypal-closing-down-money-pools/
- Venmo Groups: https://techcrunch.com/2023/11/14/venmo-gets-a-new-way-to-split-expenses-among-groups-like-clubs-teams-trip-buddies-and-more
- Meta Muse connectors: https://www.unite.ai/meta-adds-small-business-skills-and-app-connectors-to-muse-ai-agent/ ; https://stacktr.ee/blog/muse-connector-platform
- Model Context Protocol: https://en.wikipedia.org/wiki/Model_Context_Protocol
- Render Workflows: https://render.com/docs/workflows ; Render free-tier limits: https://render.com/docs/free
- Town.com (design inspiration): https://www.town.com/
- PayPal developer docs index: https://developer.paypal.com/llms.txt
- Hackathon brief and rules: `HACKATHON-BRIEF.md`

## E3 Change log

| Version | Date | Change |
|---|---|---|
| 1.0 | 6 Nov 2026 | First locked PRD |
| 1.1 | 6 Nov 2026 | Problem reframed: plan together **and** don't overspend. Added My Month, the overspending guard, "I paid" cards, uneven splits, Export (MCP/calendar/CSV), and a Tilt / Money Pools lessons section. Sign-up is 5 required pages with Log in with PayPal, gender, birth date and a House Rules template. House Rules cut to R1–R8 + guarded personal rules + per-squad rules. No growth stages. Kitten always gets a one-tap confirmation on plans; friend's kitten asks its owner when unsure. Whims cut to 4 fields; plan card simplified. Kitty Party is now squad savings used first for plans. Catnip is opt-in via the birthday person's kitten, auto-deleted after 3 days. Doorstep renamed Meows. Paw-up and cover funding defined; rounding rule + money-balance invariant; tag-along maths fixed. Demo World: one login, simulated squad, nightly reseed. Speed-first models. Render-first stack. **Cut:** Scaredy Cat, Prowl, Habits, growth stages, race rule, seat swap, Squad Jar, benchmarks, push, email, i18n. No emojis in the product UI. |
| 1.2 | 6 Nov 2026 | Treat Jar / free hand / fun budget explained; "always ask above" merged into free hand (rules now R1–R7). Interests (pick 3+) on sign-up page 2. My Month gains a small calendar; no double booking (FR-CAL). Whims to chosen friends create mini-squads. The floater sets "need at least" (default half), also the Pounce minimum. Plan changes: kittens suggest, 2-round loop guard, owners always tap; host edits apply, members' edits become suggestions. Kitty Party savings tracked per person with a worked example; leftovers return to their source. Build plan split into Phases 0–5 with exit criteria and a cut order; development starts on the owner's go. New AT-21 to AT-24. |
| 1.3 | 7 Nov 2026 | Phase 0 built. Added the phase-report rule (§D1 step 5) and the Phase log (§D8) with spike results: server-side test-card holds work with no popup; partial capture, partial refund, void, payouts, quantity subscriptions OK; Gemini Flash-Lite ~1.3 s. Repo layout updated to the as-built tree (§C5): repo root = Kitty folder, app in web/. README requirements renumbered to §D9. |
| 1.4 | 7 Nov 2026 | Render runs on free plans while building (Render needs a card for paid plans). Phase 5 now starts with: owner adds a card, upgrade in place to web Starter + Postgres Basic 256 MB, make the repo public (§D1, §C4, §D4). Phase log notes Log in with PayPal needs the live https URL (§D8). |
| 1.5 | 7 Nov 2026 | Phase 0 complete: live app on Render, webhook verified with real events, Log in with PayPal working on the live URL, live hold and quantity subscription approved, sandbox friends renamed (Ava, Jordan, Tyler, Zoe, Marcus, Judge) and uploaded (§D8). |
| 1.6 | 7 Nov 2026 | Mobile-app rule: app shell, phone frame on laptops, installable PWA (§B22 FR-UX-1/7/8; Phase 3). Phase 1 detail pass in §D8: sessions, demo users with test-card holds, data model, double-entry ledger, referee functions, lifecycles, tick, SSE, kitten AI scope. |
| 1.7 | 7 Nov 2026 | Phase 1 built and tested (§D8 Phase 1 results): /api/v1 with access checks, SSE stream, real login sessions, dev playground; 22 end-to-end checks on the real sandbox. Gemini: Flash-Lite first for every task incl. vision (Flash free tier = 20 a day; §C2, FR-AI-1), batched reason lines. Per-user time zones. Fixes: booker's own leftover, parallel Pounce captures with a clean failure path. |
| 1.8 | 7 Nov 2026 | Phase 1 second pass (§D8): click-through as a user. Payouts need real sandbox balance (card money can't fund them); failed payouts wait in the pot and retry; receipts wait for the payout. Fixes: clashes for plans with no end time, friend's-kitten availability in their time zone and attendance from plans, glossary answers from code, hard Gemini time limit, local DB outside the project. |
| 1.9 | 7 Nov 2026 | Phase 1 complete (§D8): sandbox business account funded by the owner, acceptance 23/23. Rules that loosen control rejected in code; unreadable rules not saved; keyword chat fallback when Gemini is busy; PayPal calls get a 15 s limit and safe retries. |
| 1.10 | 7 Nov 2026 | Owner test round 1 (§D8): FR-PLAN-7 (everyone sees their expected share: split by max(need at least, people in)); FR-WHIM-9 (typed whims read by code too, AI on a time budget); "need at least" on whims; host sets uneven splits; separate receipt box in the playground. |
| 1.11 | 7 Nov 2026 | AI moved off Gemini as the main model (owner decision): Groq first, then Mistral, then Gemini, then code (§C2, FR-AI-1/2, §C4 stack). Gemini's free tier stalled for over an hour on 7 Nov. |
| 1.12 | 7 Nov 2026 | Groq live: the chain uses the models the account actually offers (gpt-oss-20b, Qwen 3.8 for screenshots, gpt-oss-120b), then Gemini; no Mistral. Measured speeds and limits; code wins on dates and money for typed whims (§C2). |
| 1.13 | 7 Nov 2026 | Phase 2 built (§D8 Phase 2): Yarn and Untangle, Nine Lives, Kitty Party, Catnip, The Bowl, Meows and alerts, purrs, My Month data, new chat tools, CSV and calendar export, scheduled jobs (free GitHub Actions schedule; Render cron in Phase 5). Acceptance 12/12 incl. AT-13, AT-17, AT-18, AT-24. MCP connector deferred (cut order). |
| 1.14 | 8 Nov 2026 | Phase 2 pre-owner test pass (§D8): the 25 owner steps played end to end; fixed stale help alerts, My Yarn strands (who and why), closing unbought gift plans on Catnip clean-up, plan name in the on-ice note, CSV times and chat lines. 69/69. |
| 1.15 | 8 Nov 2026 | Edge-case pass (§D8): ~80 awkward cases as `npm run test:edges` (baseline 22/74 → 80/80; Phase 1 24/24, Phase 2 12/12). New undo actions: withdraw a whim, cancel a plan, remove/fix an "I paid" card, take back a pledge, close a Bowl, leave a squad. Money safety: no overdrawn jars or savings, take-then-pay withdrawals, one-at-a-time money actions, nothing captured left unrecorded, single job runs. |
| 1.16 | 8 Nov 2026 | Phases 3 and 4 merged; design-first workflow in Paper (100 calls/week budget, stages and estimates, §D1). §B22 design pass: the owner's references (Town, Finch, Ahead, Duolingo), tokens, and the kitten system (one template: 6 furs, 4 patterns, 5 accessories, 3 eye colours; mood and pose set by what the kitten does, never by the owner; FR-UX-9). §B1 adoption page: look, name, personality (Chatty, Polite, Chill, Hype, Warm, Formal), neutral preview so the eyes show. |
| 1.17 | 8 Nov 2026 | My Month gains Settle up: everything owed or owing across every group, with one next step per group and "Untangle everything" (§B20, FR-MONTH-5; backend built, edge cases 88/88). Design: the night sky is replaced by a mint morning cut-paper sky on every screen, the owner's pick (§B22); money in Nunito, ink on amber. §B5 leaving text and FR-SQD-5 corrected to the rule built in v1.15. |
| 1.18 | 8 Nov 2026 | All 50 flows designed in Paper on four boards: every screen, button and failure case (§B22, FR-UX-10). All 98 product API routes map to a flow. Lists what the spec promises but the backend doesn't do yet. My Month design gains By squad and Coming up. |
| 1.19 | 8 Nov 2026 | Flow boards checked against all 164 requirements. Added the "approve your hold" step for far-off plans (F14) and editing a floating whim (F17), and recorded both as backend gaps with an uneven Bowl split (§B22). |
| 1.20 | 8 Nov 2026 | Flows approved by the owner; the app is being built. Kittens do the chasing: reminder schedule, weekly Untangle, reply buttons (§B11, FR-REMIND-1..6). The kitten chat is pinned at the top of Squads and can do anything in the app (§B18, FR-CHAT-5..7). Every kitten is alive, and every action plays a moment (§B22, FR-UX-11). No Demo World: PayPal login only, real accounts (§B23, FR-SHOW-1..3). |
| 1.21 | 8 Nov 2026 | The app is built: PayPal-only sign-up, all tabs, the pinned kitten chat with every action, squad rooftop, plan page, and moments on every action. Tag along, extra costs and returning leftovers work for real users through PayPal. Findings in §D8. |
| 1.22 | 9 Nov 2026 | Owner's edits from testing: every kitten blinks on every screen, including smiling kittens (closed happy eyes open now and then to blink) and dozing ones. Log out is a button on My Kitten. |
| 1.23 | 9 Nov 2026 | Owner's sign-up edits: a big kitten to adopt, numbers you can type, Treat Jar and free hand together on page 5 in plainer words. Fixed: a completed PayPal payment wasn't recorded for real users. |
| 1.24 | 9 Nov 2026 | Owner's changes: a whim is set up in full when floated, price included, and becomes a plan by itself (§B6, FR-WHIM-3). It can go to chosen friends. One-to-one chats with friends and their kittens (§B18, FR-CHAT-8..10). Inside a chat or sub-page the bottom tabs go away and the top and message box stay fixed. |
| 1.25 | 9 Nov 2026 | Owner's changes: the kitten is the manager, and everything lands in its chat first, with Meows showing the same cards (§B18, FR-CHAT-11). "I paid" cards are worked out between the two kittens until both agree, then the kitten pays (§B11, FR-YARN-7). The Diary says what each thing was and how much, to whom (§B19). |
| 1.26 | 9 Nov 2026 | Owner's change: a first squad is optional at sign-up, with starting and joining as two clear choices (§B1, FR-ONB-2/3). An invite link opened by someone already signed up takes them straight into that squad. |
| 1.27 | 9 Nov 2026 | Owner's change: everything waiting on a decision comes as a kitten card with real answers, and "Not now" puts one aside (§B18, FR-CHAT-12). |
| 1.28 | 9 Nov 2026 | Owner's change: a whim to one friend lives in that friend's chat with no squad created; "Need at least" is only asked for a squad (§B5, §B6). |
| 1.29 | 9 Nov 2026 | Owner's changes: the host of a plan is always in, and a plan can't Pounce without their share (§B8, FR-PLAN-8). Kitty Party: a goal is required and "what for" is gone; savings come from the Treat Jar on a day each person picks, not a PayPal subscription; a short jar brings a top-up card; the jar shows what each person puts in a month; savings are logged in My Month (§B13, FR-PARTY-1/2/7/8). |
| 1.30 | 9 Nov 2026 | Owner's change: in your own kitten's chat, a friend's kitten's answer is reported by your kitten ("I asked Sam's kitten, and they said..."), with no kitten names (§B2). |
| 1.31 | 9 Nov 2026 | Owner's change: a paw-in comes from the Treat Jar whatever the amount, with no separate PayPal payment; a short jar asks to refill the difference, then takes it all from the jar (§B4, §B9, FR-POUNCE-1/4/10). Tapping Pay or Pledge also uses the jar when it has enough (FR-YARN-4). The free hand only limits what the kitten does alone. |
| 1.32 | 10 Nov 2026 | Owner's change: every payment in Kitty comes from the Treat Jar, and a refill is the only PayPal payment anyone approves (FR-JAR-7). Settle up, extra costs, tag along, returning leftovers, pledges and Bowl shares all follow it; a short jar asks to refill the difference, then the payment finishes itself. Bowl shares are no longer PayPal subscriptions (FR-BOWL-2). |
| 1.33 | 10 Nov 2026 | Owner's redesign: the whim is where everything is decided and a plan doesn't change. When and where are required, the booker defaults to the host, and the card is Yes, No or Ask (kitten) to negotiate (§B6, FR-WHIM-3/4/7/10). One simple negotiation with a loop guard, written on the whim as kitten-to-kitten chat (§B7, FR-NEG-9..13). On becoming a plan, exact shares come from Treat Jars; tag along, withdraw and host cancel (§B8, FR-PLAN-8..12). Only the host Pounces, once enough are in and all money has arrived; the pot goes to the booker's Treat Jar, and they pay from it (§B9, FR-POUNCE-11..13). Maybe, limits, paw-up, cover, custom splits, plan edits and Pounce rules are gone. PayPal descriptions now say what the app really uses (§A2, §C1, §D2). |
| 1.34 | 10 Nov 2026 | Owner's change: tag along exists only after the Pounce and needs the host's Yes or No. Before the Pounce, someone new simply joins. On a yes, the newcomer's share goes to the jar holding the pot, and the others get the difference back from it, in one step (§B8, §B9, FR-PLAN-11, FR-POUNCE-9, FR-POUNCE-14..17). |
| 1.35 | 10 Nov 2026 | Owner's change: when someone tags along, everyone on the plan gets an unread message in their kitten's chat. Opening Meows no longer clears those, only the cards shown there (§B9, §B18, FR-CHAT-11). The plan page no longer shows "paid at the Pounce" under the price. |
| 1.36 | 10 Nov 2026 | Owner's change: once the booking is paid, the plan says "Payment made" and can't be paid again. It can be paid in parts, up to what the plan comes to (§B9, FR-POUNCE-13). |
| 1.37 | 10 Nov 2026 | Owner's changes: the Bowl works like Kitty Party, with a day each person picks, shares going to the account holder's Treat Jar and a top-up card if short (§B15, FR-BOWL-2..4). My Month is rebuilt: fun budget, Treat Jar slider, Settle up by person with Untangle and Nudge, Spent with every payment linked, Saved linked to each Kitty Party (§B20, FR-MONTH-1/5/6/7). The Treat Jar moved out of My Kitten. Nudges now cover unanswered whims and missing plan shares (§B11). |
| 1.38 | 10 Nov 2026 | Owner's correction: the Bowl now matches Kitty Party in every flow. The creator picks a day and is a member with a share; the Bowl tab is laid out like the Party tab; every Bowl is always in My Month's Spent with its next date; it's listed in the squad's rules, the squad sees how many shares are in, and the kitten chat knows about it (§B15, FR-BOWL-1, FR-BOWL-5). |
| 1.39 | 10 Nov 2026 | Owner's change: an "I paid" card can be split equally or unequally, with an amount against each person (§B11, FR-YARN-1). |
| 1.40 | 11 Nov 2026 | Fix from owner testing: someone who never answered the whim now gets a Tag along card once the plan has Pounced (before, they got nothing). While it's collecting they still get Join (§B9, FR-POUNCE-14). |
| 1.41 | 11 Nov 2026 | Owner's change: after the Pounce the booker's card is Pay from my Treat Jar (or I paid another way); Add the receipt only comes once it's paid, and receipt reminders count from the payment (§B10, §B11). |
| 1.42 | 11 Nov 2026 | Owner's clarification: I paid another way marks the booking paid (it doesn't open the receipt). Pounce → Pay from my Treat Jar or I paid another way → Add the receipt, on every card and the plan page (§B9, §B10). |
| 1.43 | 11 Nov 2026 | From owner testing: a yes to someone whose jar is short now tells everyone what's happening (the newcomer, the host and everyone in), and the plan shows them as Joining until their money lands (§B9). |
| 1.44 | 11 Nov 2026 | Owner's rule: agreeing and paying are one step (FR-JAR-8). Floating a whim, a Yes, joining and asking to tag along set the share aside right then; a short jar is refilled first, and the step finishes when the money lands. No refill cards after someone has agreed. Set-aside money goes back if it isn't used (§B6, FR-PLAN-10, §B9, FR-POUNCE-14..16). |
| 1.45 | 11 Nov 2026 | Phase 5 started: everything committed and deployed; secrets scan clean; the app runs its own scheduled jobs on Render instead of a cron service; README rewritten for the finished app; Devpost draft written (§D1, §D8). |
| 1.46 | 12 Nov 2026 | Submitted: status updated; the app is complete and live. |
