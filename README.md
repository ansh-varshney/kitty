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
