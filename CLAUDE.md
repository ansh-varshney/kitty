# Kitty: PayPal AI Hackathon ("Build What's Next with PayPal and AI", Devpost)

## Source of truth: ALWAYS the latest PRD
- The **only** current spec is the newest `Kitty-PRD-v*.pdf` in this folder: the highest version number (v1.15 as of 8 Nov 2026; note 1.10+ is newer than 1.9).
- Its exact text is `prd-source/Kitty-PRD.md`. **Read that file for any spec question**: it's the same content and easier to search. Check its title line ("Version X.Y") and the change log (§E3) to confirm you have the newest version.
- **Never** use anything in `_superseded/` (old PRDs v1.0–v1.1, early ideation files). They are out of date.
- Requirement IDs (`FR-…`, `NFR-…`, `AT-…`) are the build spec. Reference them in code and commits.
- **To change the spec:**
  1. Edit `prd-source/Kitty-PRD.md`.
  2. Bump `VERSION` in `prd-source/build.py`.
  3. Add a row to the change log (§E3).
  4. Run `python prd-source/build.py` from this folder. It writes the new PDF and moves older PDFs into `_superseded/`.

## Status
- **Phase 0 is complete** (7 Nov 2026). Live app: https://kitty-web.onrender.com (Render free plans). PayPal webhook ID (ID in `.env` as `PAYPAL_WEBHOOK_ID`).
- **Phase 1 (backend core) is complete** (7 Nov 2026): `npm run accept:phase1` 24/24 on the real sandbox with Groq as the AI (after the owner funded the sandbox business account). Findings are in PRD §D8 "Phase 1: results". Not yet pushed to Render unless the owner said so.
- **Phase 2 (backend non-core) is built and tested** (7 Nov 2026): `npm run accept:phase2` 12/12 (AT-13, AT-17, AT-18, AT-24 + Bowl, Meows, purrs, My Month, chat, export, jobs). Scheduled jobs: `POST /api/v1/jobs/run` with `x-jobs-key` (JOBS_KEY), called every 15 min by `.github/workflows/kitty-jobs.yml` (secret KITTY_JOBS_KEY).
- **Edge-case pass (8 Nov 2026):** `npm run test:edges` 80/80 (baseline 22/74). Added undo actions (withdraw whim, cancel plan, remove/fix card, take back pledge, close Bowl, leave squad), no-overdraw ledger, one-at-a-time money actions (`lib/core/locks.ts`, single web instance), migration 006. Findings in PRD §D8. Not yet committed unless the owner said so.
- The next phase starts only when the owner says so. Phases (PRD §D1): 0 setup → 1 backend core → 2 backend non-core → 3 simple 5-tab app → 4 Demo World, video, polish → 5 submit.
- Before building each feature, do a short detail pass and record it in the PRD as a minor version.
- **After every phase:**
  1. Run your own tests.
  2. Give the owner a plain-language report: what was built, how, the architecture.
  3. Give numbered steps for the owner to test it themselves.
  4. Record the key findings in PRD §D8.

## Hosting (Render)
- Render currently runs on **free** plans: the app sleeps after 15 min idle, and the free database **expires ~7 Dec 2026**.
- **Phase 5, before submitting:**
  1. The owner adds a card in Render. Never enter card details yourself.
  2. Upgrade in place to web **Starter** + database **Basic 256 MB**. Usage comes out of Render credits.
  3. Confirm `/api/health`.

## Code
- The repo root is this folder. The app is in `web/` (Next.js 16; read `web/AGENTS.md`: the APIs changed).
- From `web/`:
  - `npm test`: unit tests
  - `npm run spike`: live sandbox checks
  - `npm run dev`: http://localhost:3000; backend playground at `/dev/play`, Phase 0 checks at `/dev`
  - `npm run accept:phase1` / `npm run accept:phase2`: end-to-end acceptance on a fresh in-memory DB (real sandbox + Groq/Gemini, ~5–8 min each)
  - `npm run test:edges`: ~80 edge cases (undo after others acted, double taps, leaving, timers twice, no overdrawn money); ~2 min
  - `npm run timing:nfr1`: whim → prepared answers speed (NFR-1: 5 s)
- Local DB = PGlite in `~/.kitty-dev/pglite` (outside the repo, so the dev watcher ignores it; `PGLITE_DIR` overrides); production = Render Postgres (`DATABASE_URL`).
- Money is integer cents only (`web/lib/money.ts`). The PayPal Server SDK handles Orders and Payments; REST (`web/lib/paypal/rest.ts`) handles Payouts, Subscriptions, Webhooks and Login.

## Facts
- Deadline: Thu 12 Nov 2026, 12:00 PM PT (= Fri 13 Nov, 01:30 IST). Judging 1–15 Dec; the hosted demo must stay up until 15 Dec.
- `HACKATHON-BRIEF.md`: rules, judging, prizes and sponsor links. Still valid.
- **Secrets:** never commit or print them.
  - `.env`: PayPal sandbox keys and the AI keys (GROQ_API_KEY, GEMINI_API_KEY)
  - `sandbox-accounts-us.csv` and `sandbox-friends-us.csv`: sandbox account passwords
- PayPal and Gemini constraints are in PRD §C1 and §C2:
  - Sandbox only; US platform account; no Vault
  - Holds are good for 3 days (honor) and 29 days (max)
  - **Payouts (paying bookers) need real PayPal balance in the sandbox business account; money received by test card can't fund them.** Check with `npx tsx scripts/check-payout.ts 5`. If it fails, the owner must add balance in the developer dashboard (never do it yourself). A failed payout waits in the plan's pot and the timer retries it.
  - AI: Groq first (`GROQ_API_KEY`), then Gemini (owner: no Mistral), then code fallbacks (`web/lib/ai/llm.ts`). Gemini's free tier is unreliable (Flash = 20 requests a day; Flash-Lite stalled for an hour on 7 Nov). Check models with `npx tsx scripts/ai-quota.ts` and `scripts/ai-models.ts`.
  - Times: users have a time zone (default America/Los_Angeles); convert wall-clock times with `zonedToUtc` (lib/referee/time.ts), never `new Date("2026-12-12T19:00")`
