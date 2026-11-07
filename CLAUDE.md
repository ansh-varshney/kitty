# Kitty: PayPal AI Hackathon ("Build What's Next with PayPal and AI", Devpost)

## Source of truth: ALWAYS the latest PRD
- The **only** current spec is the newest `Kitty-PRD-v*.pdf` in this folder: the highest version number (v1.3 as of 7 Nov 2026).
- Its exact text is `prd-source/Kitty-PRD.md`. **Read that file for any spec question**: it's the same content and easier to search. Check its title line ("Version X.Y") and the change log (§E3) to confirm you have the newest version.
- **Never** use anything in `_superseded/` (old PRDs v1.0–v1.1, early ideation files). They are out of date.
- Requirement IDs (`FR-…`, `NFR-…`, `AT-…`) are the build spec. Reference them in code and commits.
- **To change the spec:**
  1. Edit `prd-source/Kitty-PRD.md`.
  2. Bump `VERSION` in `prd-source/build.py`.
  3. Add a row to the change log (§E3).
  4. Run `python prd-source/build.py` from this folder. It writes the new PDF and moves older PDFs into `_superseded/`.

## Status
- **Phase 0 (setup and spikes) is built** (7 Nov 2026). Its findings are in PRD §D8.
- The next phase starts only when the owner says so. Phases (PRD §D1): 0 setup → 1 backend core → 2 backend non-core → 3 simple 5-tab app → 4 Demo World, video, polish → 5 submit.
- Before building each feature, do a short detail pass and record it in the PRD as a minor version.
- **After every phase:**
  1. Run your own tests.
  2. Give the owner a plain-language report: what was built, how, the architecture.
  3. Give numbered steps for the owner to test it themselves.
  4. Record the key findings in PRD §D8.

## Code
- The repo root is this folder. The app is in `web/` (Next.js 16; read `web/AGENTS.md`: the APIs changed).
- From `web/`:
  - `npm test`: unit tests
  - `npm run spike`: live sandbox checks
  - `npm run dev`: http://localhost:3000; the dev console is at `/dev`
- Local DB = PGlite (`web/.pglite`); production = Render Postgres (`DATABASE_URL`).
- Money is integer cents only (`web/lib/money.ts`). The PayPal Server SDK handles Orders and Payments; REST (`web/lib/paypal/rest.ts`) handles Payouts, Subscriptions, Webhooks and Login.

## Facts
- Deadline: Thu 12 Nov 2026, 12:00 PM PT (= Fri 13 Nov, 01:30 IST). Judging 1–15 Dec; the hosted demo must stay up until 15 Dec.
- `HACKATHON-BRIEF.md`: rules, judging, prizes and sponsor links. Still valid.
- **Secrets:** never commit or print them.
  - `.env`: PayPal sandbox keys and GEMINI_API_KEY
  - `sandbox-accounts-us.csv` and `sandbox-friends-us.csv`: sandbox account passwords
- PayPal and Gemini constraints are in PRD §C1 and §C2:
  - Sandbox only; US platform account; no Vault
  - Holds are good for 3 days (honor) and 29 days (max)
  - Gemini free tier: Flash-Lite first
