"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api, dayTime, money, toCents, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { TopBack, Bar, Btn, Card, Field, H2, Note, Paper, Scene, Sheet, Soft, Title, Waiting } from "@/components/app/ui";
import type { Mood } from "@/lib/kitten/looks";

/** A plan (PRD §B8–B10): fixed once it's made. Everyone's kitten chips in, the host Pounces, the booker books and adds the receipt. */

type Member = { id: string; name: string; kittenName: string | null; look: Record<string, unknown> | null; status: string };
type View = {
  receiptPending: boolean;
  plan: { id: string; title: string; imageUrl: string | null; place: string | null; startsAt: string | null; endsAt: string | null; priceMode: string; priceCents: number; splitMode: string; needAtLeast: number; pounceRule: string; decideBy: string; refundUntil: string | null; status: string; bookerId: string | null; hostId: string; squadId: string; withFriend: string | null; whimId: string | null; useSavings: boolean; bookerName: string | null };
  members: Member[];
  pot: { inCount: number; invited: number; filledPct: number; collectedCents: number; targetCents: number; allPaid: boolean };
  canPounce: boolean;
  myShareCents: number | null;
  myHeldCents: number;
  share: { cents: number; text: string } | null;
  mine: null | { status: string; limit_cents: number | null; pawup_need_cents: number | null; overrun_due_cents: number; overrun_paid: boolean; use_savings: boolean; paws: { id: string; kind: string; source: string; cents: number; status: string; approve_url: string | null }[] };
  pounced: { groupSize: number; totalCents: number } | null;
  tag: { asks: { id: string; name: string }[]; request: { id: string; status: string } | null; canAsk: boolean; quoteCents: number | null; joining: string[] };
  booking: { dueCents: number; paidCents: number; remainingCents: number; elsewhere: boolean } | null;
};
type Me = { user: { id: string } };

const MOOD: Record<string, Mood> = { in: "happy", thinking: "thinking", out: "sleepy" };
const WORD: Record<string, string> = { in: "In", thinking: "Hasn't answered", out: "Not this time", invited: "Hasn't answered" };

export default function Page() {
  return (
    <Suspense>
      <Plan />
    </Suspense>
  );
}

function Plan() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const { act, toast } = useMoments();
  const { data, error } = useData<View>(`plans/${id}`);
  const { data: me } = useData<Me>("me");
  const [sheet, setSheet] = useState<null | "receipt" | "tag" | "cancel" | "pay" | "more">(params.get("do") === "pay" ? "pay" : params.get("do") === "receipt" ? "receipt" : null);
  const [notYet, setNotYet] = useState<string | null>(null);
  const told = useRef(false);

  useEffect(() => {
    if (told.current) return;
    const hold = params.get("hold");
    if (hold) toast(hold === "done" ? "You're in. Your spot is safe." : "Nothing was held.");
    told.current = Boolean(hold);
  }, [params, toast]);

  if (error) return <div className="p-8 text-center text-[15px]">{error.message}</div>;
  if (!data) return <Waiting />;

  const { plan, members, pot, mine, share, pounced, booking } = data;
  const allPaid = booking?.remainingCents === 0;
  const meId = me?.user.id;
  const host = plan.hostId === meId;
  const booker = plan.bookerId === meId;
  const open = plan.status === "open";
  const inNow = mine?.status === "in";
  const paid = data.myShareCents != null && data.myHeldCents >= data.myShareCents;
  const home = plan.withFriend ? `/chat/${plan.withFriend}` : `/squads/${plan.squadId}?tab=plans`;
  const hostName = members.find((m) => m.id === plan.hostId)?.name ?? "The host";
  const moodOf = (m: Member): Mood => (plan.status === "pounced" && m.status === "in" ? "happy" : (MOOD[m.status] ?? "neutral"));

  const pounce = async () => {
    const r = await act<{ status: string; why?: string }>("pounce", () => api("POST", `plans/${id}/pounce`), { done: "Pounce!", stop: (x: { status: string }) => x.status !== "pounced" });
    if (r && r.status !== "pounced") setNotYet(r.why ?? "Not yet.");
  };

  return (
    <>
      <TopBack href={home} />
      <Scene kind="tall" className="!pb-10">
        <div className="flex h-8 items-center gap-1 pl-11">
          <span className="rounded-full bg-card px-2.5 py-1 text-[12px] font-extrabold">{open ? "Collecting" : plan.status === "pounced" ? "Happening" : plan.status === "settled" ? "Done" : plan.status === "on_ice" ? "On ice" : plan.status}</span>
        </div>
        <Title className="mt-2">{plan.title}</Title>
        <p className="mt-1 text-[14px] font-semibold">{[plan.startsAt ? dayTime(plan.startsAt) : null, plan.place].filter(Boolean).join(" · ")}</p>
        <div className="mt-2 flex items-end justify-center">
          {members
            .filter((m) => m.status !== "out")
            .slice(0, 6)
            .map((m, i) => (
              <div key={m.id} className="slide-up -mx-1 text-center" style={{ ["--delay" as string]: `${i * 80}ms` }}>
                <LiveKitten look={m.look ?? undefined} mood={moodOf(m)} size={members.length > 4 ? 66 : 84} reactKey={m.status} tappable={m.id === meId} title={m.kittenName ?? m.name} />
              </div>
            ))}
        </div>
      </Scene>

      <Paper className="space-y-3">
        {plan.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={plan.imageUrl} alt="" className="h-36 w-full rounded-3xl object-cover" />
        )}

        <Card>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[24px] font-extrabold">{money(plan.priceCents)}</p>
            <Soft>{plan.priceMode === "total" ? "in total" : "each"}</Soft>
          </div>
          {share && !pounced && <Soft className="mt-0.5">{share.text}</Soft>}
          {open && (
            <div className="mt-3">
              <div className="flex justify-between text-[13px] font-bold">
                <span>
                  {pot.inCount} of {pot.invited} in
                </span>
                <span>
                  {money(pot.collectedCents)} of {money(pot.targetCents)} in
                </span>
              </div>
              <div className="mt-1">
                <Bar pct={pot.targetCents ? (pot.collectedCents / pot.targetCents) * 100 : 0} kind="leaf" />
              </div>
              <Soft className="mt-2">
                Everyone pays by {dayTime(plan.decideBy)}. Needs at least {plan.needAtLeast}.
              </Soft>
            </div>
          )}
        </Card>

        <Card delay={50}>
          <H2>Who&apos;s in</H2>
          <div className="mt-2 space-y-1.5">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <LiveKitten look={m.look ?? undefined} view="head" mood={moodOf(m)} size={34} tappable={false} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                  {m.name}
                  {m.id === plan.bookerId ? " · booking" : ""}
                  {m.id === plan.hostId ? " · host" : ""}
                </span>
                <span className="text-[13px] font-bold text-soft">{m.status !== "in" && data.tag.joining.includes(m.id) ? "Joining, once their money is in" : (WORD[m.status] ?? m.status)}</span>
              </div>
            ))}
          </div>
        </Card>

        {data.receiptPending && <Note kind="honey">The kittens are waiting on the receipt.</Note>}

        {/* Your part */}
        <div className="space-y-2">
          {open && inNow && paid && <Note>Your {money(data.myShareCents ?? 0)} is in. If this doesn&apos;t happen, it goes back.</Note>}
          {open && inNow && !paid && (
            <Card className="!bg-honey-soft">
              <p className="text-[15px] font-bold">Your share is {money(data.myShareCents ?? 0)}, and it isn&apos;t in yet.</p>
              <Btn className="mt-2" onClick={() => void act("pawIn", () => api("POST", `plans/${id}/chip-in`), { done: "You're in." })}>
                Put it in from my Treat Jar
              </Btn>
            </Card>
          )}
          {open && inNow && !host && (
            <Btn kind="plain" onClick={() => void act("released", () => api("POST", `plans/${id}/respond`, { status: "out" }), { done: "No hard feelings." })}>
              Withdraw
            </Btn>
          )}
          {data.tag.asks.map((a) => (
            <Card key={a.id} className="!bg-honey-soft">
              <p className="text-[15px] font-bold">{a.name} is asking to tag along. OK?</p>
              <div className="mt-2 flex gap-2">
                <Btn small onClick={() => void act("settled", () => api("POST", `tag-requests/${a.id}/accept`), { done: "Done." })}>
                  Yes
                </Btn>
                <Btn small kind="plain" onClick={() => void act("released", () => api("POST", `tag-requests/${a.id}/decline`), { done: "Told them no." })}>
                  No
                </Btn>
              </div>
            </Card>
          ))}
          {open && !inNow && <Btn onClick={() => setSheet("tag")}>Join</Btn>}
          {!open && !inNow && data.tag.request?.status === "asked" && <Note>You asked {hostName} if you can tag along. I&apos;ll tell you what they say.</Note>}
          {!open && !inNow && data.tag.request?.status === "declined" && <Note>{hostName} said no to this one.</Note>}
          {!open && !inNow && data.tag.request?.status === "approved" && (
            <Card className="!bg-honey-soft">
              <p className="text-[15px] font-bold">
                {hostName} said yes. Your share is {money(data.tag.quoteCents ?? 0)}.
              </p>
              <Btn className="mt-2" onClick={() => void act("pawIn", () => api("POST", `tag-requests/${data.tag.request!.id}/pay`), { done: "You're coming!" })}>
                Put it in from my Treat Jar
              </Btn>
            </Card>
          )}
          {data.tag.canAsk && <Btn onClick={() => setSheet("tag")}>Tag along</Btn>}

          {plan.status === "pounced" && !booker && <Note>{allPaid ? `${plan.bookerName ?? "The booker"} has paid for it.` : `It's final. ${plan.bookerName ?? "The booker"} is booking it now with everyone's money.`}</Note>}
          {plan.status === "pounced" && booker && (
            <Card className="!bg-honey-soft">
              <p className="text-[15px] font-bold">
                {allPaid && booking?.elsewhere ? "Payment made. You paid another way, so everyone's money is still in your Treat Jar. Add the receipt when you have it." : allPaid ? `Payment made. You paid ${money(booking?.paidCents ?? 0)} from your Treat Jar. Add the receipt when you have it.` : booking?.paidCents ? `You've paid ${money(booking.paidCents)} so far. ${money(booking.remainingCents)} is left to pay.` : `It's final. Everyone's ${money(pounced?.totalCents ?? 0)} is in your Treat Jar. Pay for the booking from it.`}
              </p>
              <div className="mt-2 space-y-2">
                {!allPaid && <Btn onClick={() => setSheet("pay")}>Pay from my Treat Jar</Btn>}
                {allPaid ? (
                  <Btn onClick={() => setSheet("receipt")}>Add the receipt</Btn>
                ) : (
                  <Btn kind="plain" onClick={() => void act("settled", () => api("POST", `plans/${id}/paid-elsewhere`), { done: "Got it." })}>
                    I paid another way
                  </Btn>
                )}
              </div>
            </Card>
          )}

          {plan.status === "pounced" && mine?.overrun_due_cents && !mine.overrun_paid ? (
            <Card className="!bg-honey-soft">
              <p className="text-[15px] font-bold">It came to a bit more. Your part is {money(mine.overrun_due_cents)}.</p>
              <Btn className="mt-2" onClick={() => void act("settled", () => api("POST", `plans/${id}/overrun/pay`), { done: "All squared." })}>
                Pay {money(mine.overrun_due_cents)}
              </Btn>
            </Card>
          ) : null}

          {pounced && (
            <Soft className="text-center">
              Pounced with {pounced.groupSize} people, {money(pounced.totalCents)} in all.
            </Soft>
          )}
          {plan.status === "cancelled" && <Note kind="honey">This plan was cancelled. Everyone&apos;s money went back.</Note>}
          {plan.status === "on_ice" && <Note kind="honey">On ice: not enough money came in by the deadline. Everyone&apos;s money went back.</Note>}
          {plan.whimId && (
            <Link href={`/whims/${plan.whimId}`} className="press block text-center text-[13px] font-extrabold underline decoration-dotted underline-offset-4">
              See how the kittens decided
            </Link>
          )}
        </div>

        {/* The host's part */}
        {host && ["open", "on_ice"].includes(plan.status) && (
          <section className="space-y-2 pt-2">
            <H2>You&apos;re the host</H2>
            {open && data.canPounce && (
              <Btn kind="ink" onClick={() => void pounce()}>
                Pounce
              </Btn>
            )}
            {open && !data.canPounce && <Soft>Pounce shows up here once {plan.needAtLeast} people are in and everyone&apos;s money has arrived.</Soft>}
            {plan.status === "on_ice" && <Btn onClick={() => setSheet("more")}>Give it more time</Btn>}
            <Btn small kind="plain" onClick={() => setSheet("cancel")}>
              Cancel plan
            </Btn>
          </section>
        )}
      </Paper>

      {sheet === "receipt" && <ReceiptSheet id={id} onClose={() => setSheet(null)} />}
      {sheet === "tag" && <TagSheet view={data} onClose={() => setSheet(null)} />}
      {sheet === "pay" && !allPaid && <PaySheet view={data} onClose={() => setSheet(null)} />}
      {sheet === "more" && <MoreTimeSheet id={id} onClose={() => setSheet(null)} />}
      {notYet && (
        <Sheet title="Not yet" onClose={() => setNotYet(null)}>
          <p className="text-[16px] leading-6">{notYet.replace(/^Not yet: /, "")}</p>
          <Btn className="mt-4" kind="plain" onClick={() => setNotYet(null)}>
            OK
          </Btn>
        </Sheet>
      )}
      {sheet === "cancel" && (
        <Sheet title="Cancel this plan?" onClose={() => setSheet(null)}>
          <Soft>Everyone&apos;s money goes back and everyone is told.</Soft>
          <div className="mt-3 space-y-2">
            <Btn
              kind="ink"
              onClick={async () => {
                setSheet(null);
                const r = await act("released", () => api("POST", `plans/${id}/cancel`), { done: "Cancelled. Money's going back." });
                if (r) router.replace(home);
              }}
            >
              Cancel the plan
            </Btn>
            <Btn kind="plain" onClick={() => setSheet(null)}>
              Keep it
            </Btn>
          </div>
        </Sheet>
      )}
    </>
  );
}

/** Pay for the booking straight from the Treat Jar, to anyone with a PayPal account (FR-POUNCE-13). */
function PaySheet({ view, onClose }: { view: View; onClose: () => void }) {
  const { act } = useMoments();
  const [email, setEmail] = useState("");
  const left = view.booking?.remainingCents ?? view.pounced?.totalCents ?? 0;
  const [amount, setAmount] = useState(String(left / 100));
  const cents = toCents(amount);
  return (
    <Sheet title="Pay from my Treat Jar" onClose={onClose}>
      <Soft>Kitty sends it from your Treat Jar straight to their PayPal account.</Soft>
      <div className="mt-3 space-y-3">
        <Field label="Their PayPal email" type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
        <Field label="How much" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <Btn
        className="mt-3"
        disabled={!/.+@.+\..+/.test(email) || !cents || cents > left}
        onClick={() => {
          onClose();
          void act("paypal", () => api("POST", `plans/${view.plan.id}/pay-booking`, { email: email.trim(), cents }), { working: "Sending it...", done: "Paid." });
        }}
      >
        Pay {money(cents)}
      </Btn>
      <Soft className="mt-2 text-center">Paying on a website or a card machine? Withdraw to your own PayPal from your Treat Jar instead.</Soft>
    </Sheet>
  );
}

/** A plan on ice gets one thing changed: a new deadline. Everyone's kitten then collects again. */
function MoreTimeSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { act } = useMoments();
  const [when, setWhen] = useState("");
  return (
    <Sheet title="Give it more time" onClose={onClose}>
      <Field label="New deadline" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      <Btn
        className="mt-3"
        disabled={!when}
        onClick={() => {
          onClose();
          void act("sending", () => api("POST", `plans/${id}/edit`, { decideBy: new Date(when).toISOString() }), { done: "Back on. The kittens are collecting again." });
        }}
      >
        Save
      </Btn>
    </Sheet>
  );
}

function ReceiptSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { act } = useMoments();
  const file = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<null | { receiptId: string; extractedCents: number | null; merchant: string | null }>(null);
  const [amount, setAmount] = useState("");

  const read = async (body: Record<string, unknown>) => {
    const r = await act<{ receiptId: string; extractedCents: number | null; merchant: string | null }>("reading", () => api("POST", `plans/${id}/receipt`, body), { working: "Reading the receipt...", done: "Got it.", minMs: 1300 });
    if (r) {
      setFound(r);
      setAmount(r.extractedCents != null ? String(r.extractedCents / 100) : "");
    }
  };
  const pick = (f?: File) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => void read({ imageBase64: String(r.result).split(",")[1], mimeType: f.type });
    r.readAsDataURL(f);
  };
  const confirm = () => {
    if (!found) return;
    onClose();
    void act("leftovers", () => api("POST", `receipts/${found.receiptId}/confirm`, { cents: toCents(amount) }), { working: "Doing the sums...", done: "All squared up." });
  };

  if (found)
    return (
      <Sheet title="Is this the total?" onClose={onClose}>
        {found.merchant && <Soft className="mb-2">{found.merchant}</Soft>}
        <Field label="Total paid" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Soft className="mt-2">If it&apos;s less than the pot, everyone gets the difference back. If it&apos;s more, your kitten asks them for the rest.</Soft>
        <Btn className="mt-3" disabled={!toCents(amount)} onClick={confirm}>
          Yes, that&apos;s it
        </Btn>
      </Sheet>
    );
  return (
    <Sheet title="Add the receipt" onClose={onClose}>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <Btn onClick={() => file.current?.click()}>Choose a photo</Btn>
      <Soft className="my-3 text-center">Or just type the total</Soft>
      <div className="flex gap-2">
        <Field inputMode="decimal" placeholder="$182.40" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Btn small disabled={!toCents(amount)} onClick={() => void read({ cents: toCents(amount) })}>
          Next
        </Btn>
      </div>
    </Sheet>
  );
}

function TagSheet({ view, onClose }: { view: View; onClose: () => void }) {
  const { act } = useMoments();
  const open = view.plan.status === "open";
  const each = open ? (view.share?.cents ?? 0) : (view.tag.quoteCents ?? 0);
  const host = view.members.find((m) => m.id === view.plan.hostId)?.name ?? "the host";
  return (
    <Sheet title={open ? `Join ${view.plan.title}` : `Tag along on ${view.plan.title}`} onClose={onClose}>
      <p className="text-[16px] leading-6">{open ? `Your share is about ${money(each)}, from your Treat Jar. Everyone else's share comes down.` : `It's final, so I'll ask ${host}. If they say yes, about ${money(each)} comes from your Treat Jar and everyone else gets a little back.`}</p>
      <Btn
        className="mt-3"
        onClick={() => {
          onClose();
          void act("pawIn", () => api("POST", `plans/${view.plan.id}/tag-along`), { done: open ? "You're coming!" : "Asked." });
        }}
      >
        {open ? "Join" : `Ask ${host}`}
      </Btn>
    </Sheet>
  );
}
