import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loginUrl } from "../paypal/login";
import { baseUrl } from "../env";
import { db } from "../db";
import { OAUTH_COOKIE, requestUserId, sessionCookieHeader, SESSION_COOKIE } from "../session";
import { devAllowed } from "../dev-auth";
import * as users from "../core/users";
import * as whims from "../core/whims";
import * as plans from "../core/plans";
import * as pounce from "../core/pounce";
import * as receipts from "../core/receipts";
import * as jar from "../core/jar";
import { calendar, committedCents, jarBalances, monthSpentCents, savingsBalance } from "../core/month";
import { diary, logEvent, squadFeed } from "../core/events";
import { runTick } from "../core/tick";
import { DEMO_FRIENDS, seedDemoWorld, seedSavings } from "../core/seed";
import { kittenChat, askFriendKitten, answerOwnerAsk } from "../kitten/chat";
import { funBudgetCents } from "../referee/rules";

/**
 * The Kitty API, /api/v1/... (PRD §D8 Phase 1). One table of routes; every handler gets the acting user.
 * Access: plan and squad routes check membership here, so services can trust their callers.
 */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Ctx = { req: Request; url: URL; params: string[]; userId: string | null; body: unknown };
type Handler = (c: Ctx) => Promise<unknown>;
type Route = { method: "GET" | "POST" | "DELETE"; path: string; auth: "user" | "dev" | "none"; handler: Handler };

const routes: Route[] = [];
const on = (method: Route["method"], path: string, auth: Route["auth"], handler: Handler) => routes.push({ method, path, auth, handler });

function me(c: Ctx): string {
  if (!c.userId) throw new HttpError(401, "Log in first.");
  return c.userId;
}
function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}
const cents = z.number().int().positive().max(1_000_000);
const uuid = z.string().uuid();

async function planAccess(planId: string, userId: string) {
  if (!uuid.safeParse(planId).success) throw new HttpError(404, "No such plan.");
  const d = await db();
  const [p] = await d.query<{ squad_id: string; host_id: string; booker_id: string }>(`select squad_id, host_id, booker_id from plans where id=$1`, [planId]);
  if (!p) throw new HttpError(404, "No such plan.");
  const ok = await d.query(
    `select 1 from memberships where squad_id=$1 and user_id=$2 and left_at is null
     union select 1 from plan_members where plan_id=$3 and user_id=$2`,
    [p.squad_id, userId, planId],
  );
  if (!ok.length) throw new HttpError(403, "You can't see this plan.");
  return p;
}
async function squadAccess(squadId: string, userId: string) {
  if (!uuid.safeParse(squadId).success) throw new HttpError(404, "No such squad.");
  const d = await db();
  if (!(await users.isMember(d, squadId, userId))) throw new HttpError(403, "You're not in that squad.");
}

// ---------------------------------------------------------------- me, onboarding, rules

on("GET", "me", "user", async (c) => {
  const uid = me(c);
  const d = await db();
  const user = await users.getUser(d, uid);
  if (!user) throw new HttpError(401, "Log in again.");
  const rules = await users.listRules(d, uid);
  const squads = await users.mySquads(d, uid);
  const savings = await Promise.all(squads.map(async (s) => ({ squadId: s.id, cents: await savingsBalance(d, s.id, uid) })));
  return {
    user,
    kitten: await users.getKitten(d, uid),
    rules,
    squads,
    jar: await jarBalances(d, uid),
    savings,
    month: { spentCents: await monthSpentCents(d, uid), committedCents: await committedCents(d, uid), funBudgetCents: funBudgetCents(rules) },
  };
});

on("POST", "onboarding", "user", async (c) => {
  const d = await db();
  try {
    await users.completeOnboarding(d, me(c), c.body);
  } catch (e) {
    if (e instanceof z.ZodError) throw new HttpError(400, e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    throw e;
  }
  return { ok: true };
});

on("GET", "rules", "user", async (c) => users.listRules(await db(), me(c)));
on("POST", "rules", "user", async (c) => {
  const b = parse(z.object({ text: z.string().min(3).max(300), squadId: uuid.nullish() }), c.body);
  if (b.squadId) await squadAccess(b.squadId, me(c));
  const r = await users.addCustomRule(await db(), me(c), b.text, b.squadId ?? null);
  if (!r.ok) throw new HttpError(422, r.error);
  return r;
});
on("POST", "rules/basic", "user", async (c) => {
  const b = parse(z.object({ funBudgetCents: z.number().int().min(0), freeHandCents: z.number().int().min(0), helpCents: z.number().int().min(0) }), c.body);
  await users.setBasicRules(await db(), me(c), b);
  return { ok: true };
});

// ---------------------------------------------------------------- Treat Jar

on("POST", "jar/topup", "user", async (c) => jar.startTopUp(me(c), parse(z.object({ cents }), c.body).cents));
on("POST", "jar/withdraw", "user", async (c) => jar.withdraw(me(c), parse(z.object({ cents }), c.body).cents));

// ---------------------------------------------------------------- squads

on("GET", "squads", "user", async (c) => users.mySquads(await db(), me(c)));
on("POST", "squads", "user", async (c) => users.createSquad(await db(), me(c), parse(z.object({ name: z.string().min(1).max(40) }), c.body).name));
on("POST", "squads/join", "user", async (c) => users.joinSquad(await db(), me(c), parse(z.object({ code: z.string().min(3).max(40) }), c.body).code));
on("GET", "squads/:id", "user", async (c) => {
  await squadAccess(c.params[0], me(c));
  const d = await db();
  const [s] = await d.query(`select id, name, kind, invite_code, leftovers_to_savings, archived_at from squads where id=$1`, [c.params[0]]);
  return { squad: s, members: await users.squadMembers(d, c.params[0]), savingsCents: await savingsBalance(d, c.params[0], me(c)) };
});
on("GET", "squads/:id/feed", "user", async (c) => {
  await squadAccess(c.params[0], me(c));
  return squadFeed(await db(), c.params[0], Number(c.url.searchParams.get("after") ?? 0) || 0, 100);
});
on("POST", "squads/:id/keep", "user", async (c) => {
  await users.keepAsSquad(await db(), me(c), c.params[0], parse(z.object({ name: z.string().min(1).max(40).optional() }), c.body).name);
  return { ok: true };
});
on("POST", "squads/:id/settings", "user", async (c) => {
  await squadAccess(c.params[0], me(c));
  const b = parse(z.object({ leftoversToSavings: z.boolean() }), c.body);
  const d = await db();
  await d.query(`update squads set leftovers_to_savings=$2 where id=$1`, [c.params[0], b.leftoversToSavings]);
  await logEvent(d, { squadId: c.params[0], actor: "user", actorId: me(c), type: "squad.settings", public: { text: b.leftoversToSavings ? "Leftovers now go to savings." : "Leftovers now go back to each person." } });
  return { ok: true };
});

// ---------------------------------------------------------------- whims and answers

const WhimBody = z.object({
  squadId: uuid.optional(),
  friendIds: z.array(uuid).max(12).optional(),
  text: z.string().max(2000).optional(),
  imageBase64: z.string().max(8_000_000).optional(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]).optional(),
  url: z.string().url().max(500).optional(),
  what: z.string().max(80).optional(),
  whenText: z.string().max(80).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  upToCents: cents.optional(),
  priceCents: cents.optional(),
  needAtLeast: z.number().int().min(2).max(50).optional(),
});
on("POST", "whims", "user", async (c) => whims.createWhim(me(c), parse(WhimBody, c.body)));
on("GET", "answers", "user", async (c) => whims.pendingAnswers(me(c)));
on("POST", "answers/confirm", "user", async (c) => {
  const b = parse(z.object({ items: z.array(z.object({ answerId: uuid, answer: z.enum(["yes", "maybe", "no"]).optional() })).min(1).max(50) }), c.body);
  return whims.confirmAnswers(me(c), b.items);
});

// ---------------------------------------------------------------- plans

on("GET", "plans", "user", async (c) => {
  const d = await db();
  return d.query(
    `select p.id, p.title, p.status, p.starts_at, p.ends_at, p.decide_by, p.price_cents, s.name as squad_name, m.status as my_status
     from plans p join squads s on s.id=p.squad_id
     join memberships ms on ms.squad_id=p.squad_id and ms.user_id=$1
     left join plan_members m on m.plan_id=p.id and m.user_id=$1
     where p.status <> 'cancelled' order by p.decide_by desc limit 100`,
    [me(c)],
  );
});
on("GET", "plans/:id", "user", async (c) => {
  await planAccess(c.params[0], me(c));
  return plans.planView(c.params[0], me(c));
});
on("POST", "plans/:id/edit", "user", async (c) => {
  await planAccess(c.params[0], me(c));
  return plans.editPlan(me(c), c.params[0], c.body);
});
on("POST", "plans/:id/split", "user", async (c) => {
  const p = await planAccess(c.params[0], me(c));
  if (p.host_id !== me(c)) throw new HttpError(403, "Only the host changes the split.");
  const b = parse(
    z.object({
      splitMode: z.enum(["equal", "custom", "weights"]),
      members: z.array(z.object({ userId: uuid, customCents: z.number().int().min(0).max(5_000_000).nullable().optional(), weight: z.number().int().min(1).max(10).optional() })).max(50).optional(),
    }),
    c.body,
  );
  return plans.setSplit(me(c), c.params[0], b);
});
on("POST", "plans/:id/respond", "user", async (c) => {
  await planAccess(c.params[0], me(c));
  return plans.respond(me(c), c.params[0], parse(z.object({ status: z.enum(["thinking", "out"]) }), c.body).status);
});
on("POST", "plans/:id/paw", "user", async (c) => {
  await planAccess(c.params[0], me(c));
  const b = parse(z.object({ limitCents: cents, useSavings: z.boolean().optional(), confirmOverBudget: z.boolean().optional(), confirmBusy: z.boolean().optional() }), c.body);
  return pounce.pawIn(me(c), c.params[0], b);
});
on("POST", "plans/:id/paw-up", "user", async (c) => {
  await planAccess(c.params[0], me(c));
  return pounce.answerPawUp(me(c), c.params[0], parse(z.object({ accept: z.boolean() }), c.body).accept);
});
on("POST", "plans/:id/cover", "user", async (c) => {
  await planAccess(c.params[0], me(c));
  const b = parse(z.object({ toId: uuid, cents }), c.body);
  await planAccess(c.params[0], b.toId);
  return pounce.coverFriend(me(c), c.params[0], b.toId, b.cents);
});
on("POST", "plans/:id/pounce", "user", async (c) => {
  const p = await planAccess(c.params[0], me(c));
  if (p.host_id !== me(c)) throw new HttpError(403, "Only the host taps Pounce.");
  const r = (await pounce.tryPounce(c.params[0], { hostTapped: true })) as { status: string; inCount?: number; invited?: number };
  if (r.status !== "waiting") return r;
  // Say WHY it didn't Pounce (owner test, 7 Nov: a quiet "waiting" looked like it had worked).
  const [pl] = await (await db()).query<{ pounce_rule: string; need_at_least: number }>(`select pounce_rule, need_at_least from plans where id=$1`, [c.params[0]]);
  const inNow = r.inCount ?? 0;
  const why =
    inNow < pl.need_at_least
      ? `Not yet: it needs at least ${pl.need_at_least} people in, and ${inNow} are in.`
      : pl.pounce_rule === "everyone"
        ? `Not yet: this plan's rule is "Pounce when everyone is in", and ${inNow} of ${r.invited} invited are in. To go now, change the rule to "Pounce when I tap", Save, then tap Pounce again.`
        : "Not yet.";
  return { ...r, pounced: false, why };
});
on("POST", "plans/:id/tag-along", "user", async (c) => {
  await planAccess(c.params[0], me(c));
  return pounce.tagAlong(me(c), c.params[0], parse(z.object({ limitCents: cents }), c.body));
});
on("POST", "plans/:id/negotiate", "user", async (c) => {
  const p = await planAccess(c.params[0], me(c));
  if (p.host_id !== me(c)) throw new HttpError(403, "Only the host asks the kittens to look for a better time.");
  return plans.negotiate(c.params[0]);
});
on("POST", "plans/:id/receipt", "user", async (c) => {
  await planAccess(c.params[0], me(c));
  const b = parse(z.object({ imageBase64: z.string().max(8_000_000).optional(), mimeType: z.string().max(40).optional(), cents: cents.optional() }), c.body);
  return receipts.submitReceipt(me(c), c.params[0], b);
});
on("POST", "plans/:id/overrun/pay", "user", async (c) => {
  await planAccess(c.params[0], me(c));
  return receipts.payOverrun(me(c), c.params[0]);
});
on("POST", "receipts/:id/confirm", "user", async (c) => receipts.confirmReceipt(me(c), c.params[0], parse(z.object({ cents: z.number().int().min(0).max(1_000_000) }), c.body).cents));
on("POST", "suggestions/:id/accept", "user", async (c) => plans.acceptSuggestion(me(c), c.params[0]));

// ---------------------------------------------------------------- calendar, diary

on("GET", "calendar", "user", async (c) => {
  const cal = await calendar(await db(), me(c));
  return { plans: cal.plans, busy: cal.busy };
});
on("POST", "busy", "user", async (c) => {
  const b = parse(z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime(), label: z.string().max(40).optional() }), c.body);
  if (new Date(b.endsAt) <= new Date(b.startsAt)) throw new HttpError(400, "End must be after start.");
  const [r] = await (await db()).query<{ id: string }>(`insert into busy_blocks (user_id, starts_at, ends_at, label) values ($1,$2,$3,$4) returning id`, [me(c), b.startsAt, b.endsAt, b.label ?? null]);
  return r;
});
on("DELETE", "busy/:id", "user", async (c) => {
  await (await db()).query(`delete from busy_blocks where id=$1 and user_id=$2`, [c.params[0], me(c)]);
  return { ok: true };
});
on("GET", "diary", "user", async (c) => diary(await db(), me(c), 200));

// ---------------------------------------------------------------- kitten

on("POST", "kitten/chat", "user", async (c) => kittenChat(me(c), parse(z.object({ message: z.string().min(1).max(1000) }), c.body).message));
on("POST", "kitten/ask", "user", async (c) => {
  const b = parse(z.object({ friendId: uuid, question: z.string().min(2).max(300) }), c.body);
  if (!(await users.sharesASquad(await db(), me(c), b.friendId))) throw new HttpError(403, "You can only ask friends' kittens.");
  return askFriendKitten(me(c), b.friendId, b.question);
});
on("POST", "kitten/answer", "user", async (c) => {
  const b = parse(z.object({ eventId: z.number().int().positive(), answer: z.string().min(1).max(200) }), c.body);
  return answerOwnerAsk(me(c), b.eventId, b.answer);
});

// ---------------------------------------------------------------- PayPal returns (the browser lands here after approving)

on("GET", "return/jar", "none", async (c) => {
  const token = c.url.searchParams.get("token");
  if (!token) return redirect(c, "/?jar=cancelled");
  await jar.finishTopUp(token);
  return redirect(c, "/?jar=done");
});
on("GET", "return/hold", "none", async (c) => {
  const token = c.url.searchParams.get("token");
  if (!token) return redirect(c, "/?hold=cancelled");
  const r = await pounce.finishWalletHold(token);
  return redirect(c, `/?plan=${r.planId}&hold=done`);
});

// ---------------------------------------------------------------- auth

on("GET", "auth/login", "none", async () => {
  const state = randomUUID();
  const to = loginUrl(`${baseUrl()}/api/auth/paypal/callback`, state);
  return new Response(null, { status: 303, headers: { location: to, "set-cookie": `${OAUTH_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600` } });
});
on("POST", "auth/logout", "none", async () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } }));

// ---------------------------------------------------------------- dev (dev key only)

on("POST", "dev/seed", "dev", async (c) => seedDemoWorld({ jarTopUpCents: parse(z.object({ jarTopUpCents: z.number().int().min(0).max(20000).optional() }), c.body).jarTopUpCents }));
on("GET", "dev/users", "dev", async () => {
  const d = await db();
  return d.query(`select u.id, u.name, u.is_demo, k.name as kitten, k.breed from users u left join kittens k on k.user_id=u.id order by u.is_demo desc, u.created_at`);
});
on("POST", "dev/savings", "dev", async (c) => {
  const b = parse(z.object({ squadId: uuid, userId: uuid, cents }), c.body);
  await seedSavings(b.squadId, b.userId, b.cents);
  return { ok: true };
});
on("POST", "dev/login-as", "dev", async (c) => {
  const b = parse(z.object({ userId: uuid }), c.body);
  const u = await users.getUser(await db(), b.userId);
  if (!u?.is_demo) throw new HttpError(403, "Only demo friends.");
  return new Response(JSON.stringify({ ok: true, name: u.name }), { headers: { "content-type": "application/json", "set-cookie": sessionCookieHeader(b.userId) } });
});
on("POST", "tick", "dev", async (c) => {
  const b = parse(z.object({ hoursAhead: z.number().min(0).max(24 * 30).optional() }), c.body);
  return runTick(new Date(Date.now() + (b.hoursAhead ?? 0) * 3600_000));
});
on("GET", "dev/routes", "dev", async () => routeList());
on("GET", "dev/demo-friends", "dev", async () => DEMO_FRIENDS.map((f) => ({ key: f.key, name: f.name, kitten: f.kitten })));

// ---------------------------------------------------------------- dispatch

function redirect(c: Ctx, to: string) {
  return Response.redirect(new URL(to, c.url.origin), 303);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function match(method: string, segs: string[]): { route: Route; params: string[] } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const parts = r.path.split("/");
    if (parts.length !== segs.length) continue;
    const params: string[] = [];
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(":")) params.push(decodeURIComponent(segs[i]));
      else if (parts[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

export async function dispatch(req: Request, segs: string[]): Promise<Response> {
  const url = new URL(req.url);
  const m = match(req.method, segs);
  if (!m) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    if (m.route.auth === "dev" && !devAllowed(req)) throw new HttpError(403, "Dev key needed.");
    if (m.params.some((p) => !UUID_RE.test(p))) throw new HttpError(404, "Not found.");
    const userId = requestUserId(req);
    if (m.route.auth === "user" && !userId) throw new HttpError(401, "Log in first.");
    let body: unknown = undefined;
    if (req.method === "POST") {
      const text = await req.text();
      if (text.length > 10_000_000) throw new HttpError(413, "Too big.");
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        throw new HttpError(400, "Send JSON.");
      }
    }
    const out = await m.route.handler({ req, url, params: m.params, userId, body });
    if (out instanceof Response) return out;
    return Response.json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError) return Response.json({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
    const msg = (e as Error).message ?? "Something went wrong";
    console.error(`[api] ${req.method} /${segs.join("/")}:`, msg);
    // Service errors are written for people ("This plan isn't open."), so they go back as 400s.
    return Response.json({ error: msg }, { status: 400 });
  }
}

export const routeList = () => routes.map((r) => `${r.method} /api/v1/${r.path}${r.auth === "dev" ? "  (dev key)" : r.auth === "none" ? "  (public)" : ""}`);
