# PayPal AI Hackathon — Research Brief

Researched 2026-11-05 from the Devpost site (all sponsor pages, FAQ, updates), PayPal developer docs, and GitHub.

## 1. Key facts

| Item | Value |
|---|---|
| Name | Build What's Next with PayPal and AI |
| Site | https://paypalaihackathon.devpost.com |
| Deadline | **Thu Nov 12, 2026, 12:00 PM PT** (= Fri Nov 13, 1:30 AM IST) |
| Early eligibility check | Submit by Thu Nov 5; reviewers flag problems; you can keep editing until the deadline |
| Judging | Dec 1 – Dec 15, 2026 |
| Winners | ~Dec 21, 2026 |
| Registered | 28,857 participants (Nov 5) |
| Gallery | Not published yet, so competing projects can't be seen |
| Tracks | None. Anything that *meaningfully* uses PayPal (sandbox) + AI |
| Team size | No max |
| India | Eligible (excluded: Brazil, Quebec, Russia, Crimea, Cuba, Iran, N. Korea, OFAC) |
| Help | PayPal Discord: https://discord.gg/sJ2G6DyvSK (sponsor teams are there) |

## 2. Submission checklist

- [ ] Working project: PayPal sandbox + AI tool/model
- [ ] Text description: features + functionality
- [ ] Functional demo: hosted URL **or** full run instructions (mockups fail)
- [ ] List the AI tools/models used and how each is used
- [ ] Public GitHub repo, all code/assets, **open-source LICENSE that shows in the About section**
- [ ] Demo video **< 3 min**, public on YouTube, shows it running, no copyrighted music
- [ ] Test credentials / sandbox logins in the README if needed
- [ ] No secrets committed (use env vars)
- [ ] PayPal + AI named in the description, the "Built With" field, and the video

## 3. Judging

- **Stage 1 (pass/fail):** working build, public repo with OSS license, public video under 3 min, meaningful PayPal + AI use.
- **Stage 2:** score 1–5 on 5 **equally weighted** criteria:
  1. Technological Implementation (also the first tie-breaker)
  2. Design: a complete product, not just a proof of concept
  3. Potential Impact: a specific real problem, a real audience, and shown proof
  4. Innovation/Idea
  5. Presentation: video end-to-end, problem → who → why
- Judges are **not required to run the project**, so the video carries the most weight.
- Official video tips: open with the problem and who it's for; show PayPal + AI end to end; cut loading screens; an AI voiceover is OK; upload early (YouTube processing takes hours).
- Judges: 6 PayPal (3 DevRel, SWE, Eng Mgr, Sr PM) + AG Grid, APIMatic, Bryntum, Channel3, Elastic, Postman, Render.

## 4. Prizes ($69,750)

A project can win at most **1 Grand OR 1 Honorable Mention, plus 1 Sponsor prize**. You are considered for every sponsor prize whose tool you use.

| Prize | Amount | Winners |
|---|---|---|
| 1st / 2nd / 3rd | $12k / $8k / $5k | 1 each |
| Most Creative / Most Impactful / Best Demo Delivery / Best Use of PayPal + AI / Best Use of Agentic Commerce | $5k each | 1 each |
| AG Grid 1st / 2nd / 3rd | $5k / $2k / $1k | 1 / 1 / 3 |
| APIMatic | $1k + 6 mo Business | 3 |
| Bryntum | $1k | 3 |
| Channel3 | $1.5k | 1 |
| Render 1st / 2nd / 3rd | $1000 / $750 / $500 credits | 1 each |
| Elastic, KERNEL, Postman, Astropods, Zapier | free tools only, no prize | – |

## 5. Sponsors: what they are, freebies, how to qualify

| Sponsor | What it is | Freebie | Prize angle |
|---|---|---|---|
| **AG Grid (AG Studio)** | Embeddable dashboards/grids/charts + **Studio Agent Framework** (agents build/query/edit dashboards) | 45-day trial license | Judged on polish: custom widgets, theming, layout. Also on the agent framework: a custom agent talking to Studio's built-in agents, or a swapped-in harness |
| **APIMatic** | Context Plugin that gives coding agents (Claude Code) PayPal API context | 1 month Basic if you used the plugin (claim form); winners get 6 mo Business | Use the plugin while building and say so |
| **Bryntum** | Gantt / Scheduler / Calendar UI components | 45-day trial (`npm install @bryntum/scheduler@npm:@bryntum/scheduler-trial`) | Best timeline / resource booking / agent-driven schedule |
| **Channel3** | One API for 100M+ products from 25k+ retailers (search, prices, buy links); also an MCP server | 20k free credits, promo code `PAYPAL-HACKATHON-2026`, top-ups via Discord | Must actually CALL the API/MCP as a meaningful part (search, enrichment, recommendations) |
| **Render** | Cloud hosting + **Render Workflows** (orchestrate agents/background jobs) | $50 credits | Deploy on Render + use Workflows |
| **Elastic** | Elasticsearch, vector/hybrid search, Agent Builder, Workflows, A2A/MCP | 14-day serverless trial (+30-day extension form), or run locally free | (no prize) multi-step agent + Jina embeddings |
| **KERNEL** | Cloud browsers for AI agents (anti-bot, persistent login, live view) | $50 credits | (no prize) |
| **Postman** | API platform; PayPal API collection | Free plan | (no prize) |
| **Astropods** | "Agent OS": deploy/monitor agents from a declarative spec | Free account | (no prize) |
| **Zapier** | Zapier MCP: AI acts across 9,000+ apps, including PayPal | 14-day Pro trial | (no prize) |

Sponsor idea seeds (from their pages):
- AG Grid: anomaly-alert agent auto-builds widgets for refund spikes; NL finance agent ("revenue by segment this month" → live widget); donation dashboard; invoice "nudge-bot" with a friendly who-owes-what scoreboard.
- Bryntum: agency Gantt where payment tranches are dependencies; rental scheduler that books only after the PayPal payment clears; subscription revenue radar; dispute triage board with deadlines; an agent that reschedules milestones when payments fail or get refunded.

Starter repo: **https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate** (Next.js, PayPal REST via fetch, AG Grid pages per endpoint, AG Studio dashboard with an OpenAI-backed assistant). Also `paypaldev/server-sdk-context-plugin-preview` (experimental, for the APIMatic plugin).

## 6. PayPal tech we can use

The hackathon's docs.paypal.ai links are **dead**. Current pages:
- AI hub: https://developer.paypal.com/ai-tools/get-started
- Agent Toolkit: https://developer.paypal.com/ai-tools/toolkit
- MCP server: https://developer.paypal.com/ai-tools/mcp-server
- Tools reference: https://developer.paypal.com/ai-tools/agent-tools
- Docs index for LLMs: https://developer.paypal.com/llms.txt (append `.md` to any docs path for raw markdown)

**Agent Toolkit**: `npm install @paypal/agent-toolkit` (TS) + Python. Works with OpenAI Agents SDK, Vercel AI SDK, LangChain, CrewAI, Amazon Bedrock, MCP. Sandbox: `context: { sandbox: true }`. Sandbox tokens last 3–8 h, so refresh them.

**MCP server**: local `npx -y @paypal/mcp --tools=all` (env `PAYPAL_ACCESS_TOKEN`, `PAYPAL_ENVIRONMENT=SANDBOX`), or remote sandbox `https://mcp.sandbox.paypal.com` (`/sse` or `/http`).

**Agent tools** (toolkit + MCP):
- Payments: create_order, get_order, pay_order, create_refund, get_refund
- Invoices: create/list/get/send invoice, send reminder, cancel, QR code, recurring series…
- Subscriptions: create plan, list plans, create/show/update/cancel subscription
- Disputes: list_disputes, get_dispute, accept_dispute_claim
- Shipment: create/get/update shipment tracking
- Catalog: create_product, list_product, show_product_details
- Reporting: list_transaction, get_merchant_insights
- Remote MCP only: search_product / create_cart / checkout_cart, but **gift cards only**, and the docs show the production URL. Don't depend on these.

**Not in the toolkit, so use REST directly:** Payouts (pay many people at once), Webhooks, Vault (saved payment methods), Pay Later, Donations, JS SDK v6 checkout buttons.

**Agentic commerce products:**
- Agent Ready: ACP (ChatGPT Instant Checkout via Braintree delegated tokens) and UCP (Google AI Mode/Gemini via Google Pay → Orders v2). UCP needs Google enablement, so it's not feasible; ACP via a ChatGPT app + Braintree sandbox *might* be.
- Store Sync / Agentic Commerce Services: needs an access-request form. Not feasible in 7 days.

**Sandbox:** developer.paypal.com → Apps & Credentials → Sandbox → client ID/secret. Default sandbox Business + Personal accounts are auto-created. Enable "Transaction search" on the app for the reporting APIs (data shows up with up to 3 h lag). Negative testing: the `PayPal-Mock-Response` header.

## 6b. Gotchas from the hackathon forum (checked Nov 5)
- The hosted sandbox MCP (`mcp.sandbox.paypal.com`) returns `PAYPAL_API_SETUP_ERROR: Unsupported cache mode` on every call since ~Oct 29, while REST works with the same token (agent-toolkit issue #119). Use the local toolkit or REST.
- The sandbox merchant account's country matters: a Mauritania-based sandbox merchant couldn't receive payments. **Use US sandbox Business + Personal accounts** and link the REST app to the US business account.
- Vault for platform apps gives `NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE`. Fallback: intent AUTHORIZE, then capture later.
- Organizer: judges won't have AI keys. Use a hosted demo with keys server-side; never commit keys. The project must stay testable, free, **until Dec 15, 2026**.
- Sponsor policy: you're considered for every sponsor prize whose tool you use, but can win at most 1 sponsor prize.
- APIMatic plugin install: `npx context-plugins install https://github.com/paypaldev/server-sdk-context-plugin-preview` (then fill the claim form).

## 6c. Sponsor claim links
- Render $50: https://credits-portal-mmdm.onrender.com/claim/paypal-ai-hackathon (apply: https://render.com/docs/credits)
- KERNEL $50: https://dashboard.onkernel.com/hackathon?code=KERNELDEVPOST2026
- Channel3: https://trychannel3.com/developers (code PAYPAL-HACKATHON-2026), MCP: https://trychannel3.com/mcp
- APIMatic claim form: https://docs.google.com/forms/d/e/1FAIpQLScc2oCgAFACm7d6H3R4mgzv-O34DdyVnLIBNiwmUNggr_-hhA/viewform
- AG Grid trial: https://www.ag-grid.com/studio/license-pricing/
- Bryntum trial: https://bryntum.com/download/
- Elastic trial: https://ela.st/elastic-paypal-hackathon (extension: https://www.elastic.co/trialextension)
- Zapier: https://zapier.com/sign-up
- Postman PayPal collection: https://www.postman.com/paypal
- Astropods: https://astropods.com/ , docs http://docs.astropods.com , videos: https://www.youtube.com/watch?v=5pIqjeyIKAc , https://www.youtube.com/watch?v=rIeP9YADEZM , https://www.youtube.com/watch?v=WlKHRIdc3fs , https://www.youtube.com/watch?v=P9DamZDrrFU
- PayPal example code: https://github.com/paypal-examples/docs-examples , v6 web SDK sample: https://github.com/paypal-examples/v6-web-sdk-sample-integration

## 7. Webinars (recordings)
- Oct 6: Start building with PayPal (rules, AI Toolkit, full sandbox setup): https://www.youtube.com/watch?v=FFJfCW9z3Do
- Oct 7: APIMatic Context Plugins: https://youtu.be/zRWixN68tDg
- Oct 12: Payments dashboard without building a dashboard (likely AG Studio): https://www.youtube.com/watch?v=LGfG44i1Fj8
- Oct 13: Start building with PayPal (APAC slot): https://youtu.be/ck_zyB66p_Y
