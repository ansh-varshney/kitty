# Kitty

**Friends talk. Kittens handle the money.**

Kitty helps friends plan, pay and save together without anyone fronting money, chasing debts or overspending. Every user adopts a kitten: a personal AI agent that speaks for them in their friend groups, keeps their budget private, and moves money on PayPal only within the rules they set.

Built for the *Build What's Next with PayPal and AI* hackathon (Devpost). Status: **Phase 0 (setup and spikes)**. The full spec is the PRD: [`Kitty-PRD-v1.4.pdf`](Kitty-PRD-v1.4.pdf) (source in `prd-source/`).

## Repository layout

| Path | What |
|---|---|
| `web/` | The app: Next.js 16 (TypeScript), API routes, PayPal + Gemini clients |
| `web/lib/paypal/` | PayPal: holds (authorize, capture, void, refund) via the PayPal Server SDK; Payouts, Subscriptions, Webhooks, Log in with PayPal via REST |
| `web/lib/ai/` | Gemini client, speed first (Flash-Lite → Flash → template) |
| `web/lib/db/` | Postgres (Render) or PGlite (local, zero setup), plus SQL migrations in `web/db/migrations/` |
| `web/scripts/spike.ts` | Phase 0 spike: runs every integration against the sandbox |
| `prd-source/` | PRD source (Markdown) and PDF build script |
| `render.yaml` | Render Blueprint: web service + Postgres |

## Run it locally

1. Node 24+. Put sandbox keys in a `.env` file at the repo root (never committed):
   ```
   PAYPAL_CLIENT_ID=...
   PAYPAL_CLIENT_SECRET=...
   PAYPAL_ENVIRONMENT=SANDBOX
   GEMINI_API_KEY=...
   DEV_CONSOLE_KEY=any-long-random-string
   ```
2. Install and start:
   ```
   cd web
   npm install
   npm run dev
   ```
3. Open http://localhost:3000/dev (the dev console). Enter your `DEV_CONSOLE_KEY` and run each step.

Other commands (from `web/`): `npm test` (unit tests), `npm run spike` (all automatic sandbox checks), `npm run build`.

## AI tools used
- **Gemini** (`gemini-3.1-flash-lite` first for speed, `gemini-3.5-flash` for reading screenshots and receipts), with retry and a template fallback.
- **PayPal Server SDK** (APIMatic-generated), written with the **APIMatic Context Plugin** for PayPal.
- **PayPal Agent Toolkit** (from Phase 1, for the kittens' money tools).

## Path to production (short)
Kitty runs on the PayPal sandbox only. Going live would need:
- PayPal's partner/marketplace model, so friends' money is held and paid out by a licensed party
- No interest on friend loans
- A live-mode checklist: live keys, webhook re-registration, compliance review

## License
[MIT](LICENSE)
