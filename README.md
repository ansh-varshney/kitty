# Kitty

**Friends talk. Kittens handle the money.**

Kitty helps friends plan, pay and save together without anyone fronting money, chasing debts or overspending. Every user adopts a kitten: a personal AI agent that speaks for them in their friend groups, keeps their budget private, and moves money on PayPal only within the rules they set.

Built for the *Build What's Next with PayPal and AI* hackathon (Devpost). Status: **Phase 1 (backend core) built and tested**; the app screens come in Phase 3. Live at https://kitty-web.onrender.com. The full spec is the PRD: [`Kitty-PRD-v1.12.pdf`](Kitty-PRD-v1.12.pdf) (source in `prd-source/`).

## Repository layout

| Path | What |
|---|---|
| `web/` | The app: Next.js 16 (TypeScript), API routes, PayPal + Gemini clients |
| `web/lib/paypal/` | PayPal: holds (authorize, capture, void, refund) via the PayPal Server SDK; Payouts, Subscriptions, Webhooks, Log in with PayPal via REST |
| `web/lib/ai/` | The AI client: Groq first, then Gemini, then code fallbacks; time budgets and rate-limit resting |
| `web/lib/referee/` | The money rules as pure, unit-tested functions: splits, partial Pounce, tag along, leftovers, House Rules, clashes, time zones |
| `web/lib/core/` | Services: users, rules, squads, Treat Jar, whims, plans, paw in, Pounce, receipts, timer, double-entry ledger, event log |
| `web/lib/kitten/` | The kitten's AI jobs (reading whims, reason lines, rules, receipts) and chat tools. Code decides; the AI only reads and writes words |
| `web/lib/api/` + `web/app/api/v1/` | The API: one route table with access checks, plus a live event stream (SSE) |
| `web/lib/db/` | Postgres (Render) or PGlite (local, zero setup), plus SQL migrations in `web/db/migrations/` |
| `web/scripts/spike.ts` | Phase 0 spike: runs every integration against the sandbox |
| `web/scripts/phase1-acceptance.ts` | Phase 1 acceptance: end-to-end checks against the real sandbox and Gemini |
| `prd-source/` | PRD source (Markdown) and PDF build script |
| `render.yaml` | Render Blueprint: web service + Postgres |

## Run it locally

1. Node 24+. Put sandbox keys in a `.env` file at the repo root (never committed):
   ```
   PAYPAL_CLIENT_ID=...
   PAYPAL_CLIENT_SECRET=...
   PAYPAL_ENVIRONMENT=SANDBOX
   GROQ_API_KEY=...        # free at console.groq.com (no card)
   GEMINI_API_KEY=...      # optional fallback
   DEV_CONSOLE_KEY=any-long-random-string
   ```
2. Install and start:
   ```
   cd web
   npm install
   npm run dev
   ```
3. Open http://localhost:3000/dev/play (the backend playground). Enter your `DEV_CONSOLE_KEY`, press **Seed demo world**, then act as any demo friend. The Phase 0 integration checks are at http://localhost:3000/dev.

Other commands (from `web/`): `npm test` (unit tests), `npm run accept:phase1` (end-to-end acceptance against the sandbox), `npm run timing:nfr1` (whim speed), `npm run spike` (Phase 0 sandbox checks), `npm run build`.

## AI tools used
- **Groq** (`gpt-oss-20b` for text, Qwen 3.8 for screenshots and receipts, `gpt-oss-120b` as a backup) first, then **Gemini** as a fallback, then code (templates and a code whim reader), so the app never breaks.
- **PayPal Server SDK** (APIMatic-generated), written with the **APIMatic Context Plugin** for PayPal.
- **PayPal Agent Toolkit**: planned for the kittens' PayPal read tools (Phase 2).

## Path to production (short)
Kitty runs on the PayPal sandbox only. Going live would need:
- PayPal's partner/marketplace model, so friends' money is held and paid out by a licensed party
- No interest on friend loans
- A live-mode checklist: live keys, webhook re-registration, compliance review

## License
[MIT](LICENSE)
