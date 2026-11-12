# Kitty

**Friends talk. Kittens handle the money.**

Kitty helps friends plan, pay and save together without anyone fronting money, chasing debts or overspending. Every user adopts a kitten: a personal AI agent that speaks for them in their friend groups, keeps their budget private, and moves money on PayPal only within the rules they set.

Built for the *Build What's Next with PayPal and AI* hackathon (Devpost).

| | |
|---|---|
| Live app | https://kitty-web.onrender.com (PayPal sandbox) |
| Spec | [`Kitty-PRD-v1.45.pdf`](Kitty-PRD-v1.45.pdf) (source in `prd-source/`) |
| License | [MIT](LICENSE) |

## Try it

1. Open https://kitty-web.onrender.com on a phone, or on a laptop (it shows in a phone frame).
2. Tap **Log in with PayPal** and sign in with a **PayPal sandbox personal account**.
3. Adopt your kitten: pick its look, name and personality, set your fun budget and free hand, and top up your Treat Jar (sandbox money).
4. Float a whim from the **+** button, answer one in **Meows**, or just tell your kitten what you want in the kitten chat.

Everything is real on the sandbox: real accounts, real PayPal orders and payouts, nothing simulated.

## How it works

| Step | What happens |
|---|---|
| 1. Whim | Someone floats an idea: what, where, when, price, who, "need at least". The AI reads it from text, a screenshot or a link |
| 2. Kittens answer | Each friend's kitten prepares Yes, No or Negotiate from their calendar and private budget, with a one-line reason. One tap confirms |
| 3. Yes is paying | Saying yes sets your share aside from your Treat Jar in the same tap. If the jar is short, you refill first (FR-JAR-8) |
| 4. Plan | Once enough say yes, it's a plan. Shares are exact to the cent, and anything over goes straight back |
| 5. Pounce | The host locks it. The pot moves to the booker's Treat Jar in one step |
| 6. Book | The booker pays from their Treat Jar (a PayPal Payout to the seller) or marks "I paid another way", then adds the receipt |
| 7. After | Leftovers go back to everyone, extra costs are split, and late friends can tag along (the host says yes, and everyone gets the difference back) |

Also in the app: **Yarn** (who owes whom, "I paid" cards, Untangle with the fewest payments, nudges), **Kitty Party** (a squad saving together each month), **The Bowl** (a shared subscription, paid monthly from each jar), **Nine Lives** (help a friend in a tight spot), **Catnip** (a group birthday gift), **My Month** (fun budget, Treat Jar, settle up, spent, saved), and the **kitten chat**, where you can do all of it by asking.

## How Kitty meets the judging criteria

### 1. Technological implementation
*How thoroughly and skillfully it uses the PayPal Developer Platform and AI, and whether it's a working, non-trivial build.*

**PayPal, end to end on the sandbox**

| What | How Kitty uses it | Where |
|---|---|---|
| Log in with PayPal | The only way in. Each account is a real PayPal sandbox identity | `web/lib/paypal/login.ts` |
| Orders (PayPal Server SDK) | Every Treat Jar top-up and refill: create, approve, capture. The capture carries a tag saying what the money was for, so the step it was paying for finishes by itself | `web/lib/paypal/holds.ts` |
| Payouts | The booker pays the seller, people withdraw from their jar, and money goes back out | `web/lib/paypal/payouts.ts` |
| Webhooks | Every PayPal event is signature-verified and recorded | `web/app/api/paypal/webhook/route.ts` |
| Safe retries | Every PayPal call carries its own request ID, so a retry can never charge twice. Retries are switched on explicitly, because the SDK's defaults retry nothing | `web/lib/paypal/sdk.ts` |
| APIMatic Context Plugin | Used with Claude Code to write the SDK integration (see below) | |

**AI: a personal agent for every user**

| What the kitten does | How |
|---|---|
| Reads a plan from text, a screenshot or a link | Groq vision model for images, text model for words, with dates and amounts checked by code |
| Prepares each friend's answer | Yes, No or Negotiate, from that person's own calendar and private budget, with a one-line reason |
| Negotiates with the host's kitten | Another time or price, without ever saying why. Strict limits stop endless loops: one try each, at most two changes, never more than 25% off |
| Does everything from chat | "Tag along on go-karting", "untangle my squad", "what do I owe?" all become real actions |
| Reads receipts | The total is read from a photo, then checked by the booker |
| Checks personal rules | A guardrail turns a rule into something safe to follow, or refuses it |
| Never touches money | AI writes words. A plain-code **referee** decides every amount, and it's the only part that sees everyone's limits |
| Never stops | Groq first, then Gemini, then plain code, each with a time budget |

**A real money system, not a mock-up**
- A double-entry ledger in whole cents, which can never go negative.
- Each money step is all or nothing, and money actions run one at a time, so double taps, retries and timers firing twice can't move money twice.
- Agreeing and paying are one step: a yes sets your share aside in the same tap.
- The app runs its own jobs every 15 minutes: deadlines, reminders, monthly savings, retrying payouts.
- Tested on the real sandbox: 197 edge-case tests, 34 end-to-end runs and 104 unit tests.

### 2. Design
*A complete, coherent product, not just a technical proof of concept.*

| What | In Kitty |
|---|---|
| A whole app | Five tabs: Meows (your daily brief), Squads, the + button, My Month and My Kitten |
| A real start | Log in with PayPal, then adopt your kitten: its look, name and personality, your fun budget, and how much it may spend on its own |
| Every flow finishes | From an idea to a plan, the Pounce, paying the booking, the receipt and the leftovers. Plus Yarn, Kitty Party, The Bowl, Nine Lives and Catnip |
| Every step can be undone | Take back a whim, cancel a plan, leave a squad, fix an "I paid" card |
| One tap, or just ask | Cards with the answer already prepared, or tell your kitten in chat |
| A kitten that feels alive | Drawn entirely in code. It blinks, dozes, changes mood and leaps when the host Pounces. Every money action plays a small moment |
| Designed before it was built | Key screens were designed first in a design tool, then built from the same parts |
| Feels like an app | Mobile-first, in a phone frame on a laptop, and installable on a phone's home screen |
| No demo mode | Real accounts and real sandbox money. You use it like anyone else |

### 3. Potential impact
*A credible, specific case for a real problem, and a solution that addresses it.*

**The problem.** Friends spend a lot of money together, and handle it badly. **76%** of Gen Z who fronted money for a group were never fully paid back, and **1 in 5** have muted a chat or cancelled plans to dodge a pay-back conversation (Zelle, 2025). **82%** of group travellers would pay *more* than their share just to avoid a money argument (CIT Bank, 2026).

**The audience.** Friend groups who plan things together: trips, dinners, gifts, subscriptions.

**How Kitty answers each moment**

| The moment today | What Kitty does |
|---|---|
| One person books and fronts everything | The pot reaches the booker **before** they book |
| "I'm in!" costs nothing, so people flake | Saying yes means paying, in the same tap |
| Nobody says "that's too much for me" | Your kitten negotiates for you and never says why. Your budget stays private |
| "You still owe me…" goes unsaid | Yarn tracks it, Untangle settles it in the fewest payments, and kittens do the reminding |
| Nobody sees what friendships cost them | My Month shows it next to your own fun budget |
| Too embarrassing to ask for help | Nine Lives: ask privately, and friends' kittens help within their owners' rules |

Everything above runs in the live app on the PayPal sandbox, with real accounts.

### 4. Innovation and idea
*How creative and novel the concept is, and how it differs from what exists.*

| Idea | Why it's new |
|---|---|
| A personal agent for every friend | Most AI agents deal with businesses for you. Kitty gives each friend an agent that speaks for them, to their friends |
| Commit first, not settle later | Bill-splitting apps record debts after someone has paid. Kitty collects before anyone pays, so there's nothing to chase |
| Private limits, shared decisions | Kittens negotiate and decide who fits without anyone seeing anyone else's budget |
| Pounce with whoever's in | The plan goes ahead with the people who paid; latecomers can tag along and everyone gets the difference back |
| The Treat Jar as a mandate | An allowance your kitten can spend within your rules, and nothing more: a safe pattern for letting an agent pay |
| A tradition, rebuilt | The Kitty Party, friends saving into a shared pot every month, built into the app |

## Where PayPal and AI are used

| | Used for |
|---|---|
| Log in with PayPal | The only way in. No passwords stored by Kitty |
| PayPal Orders (Server SDK) | Every Treat Jar top-up and refill: the only PayPal payment a person ever approves |
| PayPal Payouts | Paying the booker's seller, withdrawing from the Treat Jar, returning money |
| PayPal Webhooks | Every PayPal event is signature-verified and recorded |
| AI (Groq, then Gemini) | Reads whims and receipts from text and screenshots, prepares each kitten's answer and reason, writes the kitten's messages, understands the kitten chat, checks personal rules against a guardrail |
| Code, not AI | Every money decision: shares, rounding, limits, the ledger. The AI only reads and writes words |

Models: Groq `openai/gpt-oss-20b` (text), `qwen/qwen3.8-27b` (screenshots), `openai/gpt-oss-120b` (backup), then Gemini `gemini-3.1-flash-lite` / `gemini-3.5-flash`, then code templates, so the app never stops if a model is down.

### Built with the APIMatic Context Plugin

Kitty was built with Claude Code, with APIMatic's PayPal Server SDK Context Plugin installed (`npx context-plugins install https://github.com/paypaldev/server-sdk-context-plugin-preview`). Its TypeScript skills guided the PayPal integration:

| Skill | Where it shows in the code |
|---|---|
| Client initialization, configuration and resilience | [`web/lib/paypal/sdk.ts`](web/lib/paypal/sdk.ts): one client, controllers built by us, and retries set explicitly, because the SDK's generated defaults retry nothing and never retry POST |
| Calling endpoints and models | [`web/lib/paypal/holds.ts`](web/lib/paypal/holds.ts): Orders create, capture, authorize, void and refund, each with its own `PayPal-Request-Id` so a retry can't charge twice |
| Error handling | A capture PayPal already completed (`ORDER_ALREADY_CAPTURED`, e.g. coming back from PayPal twice) is treated as the same payment, not a failure; a stalled sandbox call times out and is retried safely |
| Testing | [`web/lib/paypal/holds.test.ts`](web/lib/paypal/holds.test.ts) |

## Architecture

| Path | What |
|---|---|
| `web/` | The app: Next.js 16 (TypeScript, React 19, Tailwind 4) |
| `web/app/(phone)/` | The screens: Meows, Squads, +, My Month, My Kitten |
| `web/components/kitten/` | The kitten, drawn in code, with a moment for every money action |
| `web/lib/core/` | Services: whims, plans, Pounce, Treat Jar, Yarn, Kitty Party, Bowl, reminders, double-entry ledger, event log |
| `web/lib/referee/` | Money rules as pure, unit-tested functions: splits, rounding, House Rules, clashes, time zones |
| `web/lib/kitten/` | The kitten's AI jobs and chat tools |
| `web/lib/paypal/` | PayPal: Orders via the Server SDK; Payouts, Webhooks and Login via REST |
| `web/lib/ai/` | One AI client with a fallback chain, time budgets and rate-limit resting |
| `web/lib/api/` | One route table with access checks, plus a live event stream (SSE) |
| `web/db/migrations/` | Postgres schema (Render Postgres in production, PGlite locally) |
| `render.yaml` | Render Blueprint: web service and Postgres |
| `.github/workflows/kitty-jobs.yml` | Scheduled jobs (deadlines, reminders, monthly cycles, payout retries) |

Money is integer cents in a double-entry ledger that never goes negative. Money actions run one at a time per plan, jar and pot, so double taps and timers running twice never move money twice.

## Run it locally

1. Node 24+. Put sandbox keys in a `.env` file at the repo root (never committed):
   ```
   PAYPAL_CLIENT_ID=...
   PAYPAL_CLIENT_SECRET=...
   PAYPAL_ENVIRONMENT=SANDBOX
   GROQ_API_KEY=...        # free at console.groq.com
   GEMINI_API_KEY=...      # optional fallback
   DEV_CONSOLE_KEY=any-long-random-string
   ```
2. Start it:
   ```
   cd web
   npm install
   npm run dev
   ```
3. Open http://localhost:3000. PayPal won't send a login back to localhost, so locally **Log in with PayPal** opens a stand-in page where you pick a sandbox person (from your own `sandbox-*.csv` files, which are never committed).

## Tests

From `web/`:

| Command | What it checks | Last run |
|---|---|---|
| `npm test` | Unit tests: referee, rounding, rules, AI client, PayPal helpers | 104/104 |
| `npm run test:edges` | Edge cases: undo after others acted, double taps, short jars, timers running twice, money adding up | 197/197 |
| `npm run accept:phase1` | End to end on the real sandbox and AI: whims to Pounce to receipts | 22/22 |
| `npm run accept:phase2` | Yarn, Kitty Party, Bowl, Meows, My Month, chat, export, jobs | 12/12 |

## Path to production

Kitty runs on the PayPal sandbox only. Going live would need:
- PayPal's partner/marketplace model, so friends' money is held and paid out by a licensed party
- Licensed handling of Treat Jar balances
- No interest on friend loans
- A live-mode checklist: live keys, webhook re-registration, compliance review

## License

[MIT](LICENSE)
