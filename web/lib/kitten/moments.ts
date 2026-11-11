import type { Mood, Pose } from "./looks";

/**
 * What the kitten looks like right now is never the owner's choice (owner, 8 Nov): the owner only picks the LOOK
 * (fur, pattern, accessory, eyes). Mood and pose follow what the kitten is doing (PRD §B22 money moments).
 * Default: neutral, sitting. No shame: misses (on ice, faded, released) stay calm, never sad.
 */

export type KittenProp = "magnifier" | "letter" | "coin" | "yarn" | "gift";
export type KittenState = { mood: Mood; pose: Pose; prop?: KittenProp };

export const CALM: KittenState = { mood: "neutral", pose: "sit" };

/** UI moments that aren't events: what the screen is doing while the owner watches. */
export const MOMENTS = {
  idle: CALM,
  reading: { mood: "thinking", pose: "hold", prop: "magnifier" }, // reading a screenshot, link or receipt
  sending: { mood: "happy", pose: "wave" }, // a whim flies to friends
  waitingFriends: CALM, // ears perk up as answers arrive
  waitingPayPal: CALM, // the paw-tap while PayPal approves
  pawIn: { mood: "happy", pose: "hold", prop: "coin" },
  pounce: { mood: "happy", pose: "pounce" },
  untangle: { mood: "thinking", pose: "hold", prop: "yarn" },
  settled: { mood: "proud", pose: "sit" },
  partySaving: { mood: "happy", pose: "hold", prop: "coin" },
  helping: { mood: "happy", pose: "hold", prop: "coin" },
  catnip: { mood: "happy", pose: "hold", prop: "gift" },
  meows: { mood: "happy", pose: "hold", prop: "letter" },
  needsYou: { mood: "alert", pose: "sit" },
  allQuiet: { mood: "sleepy", pose: "sleep" }, // nothing needs you
} satisfies Record<string, KittenState>;

export type Moment = keyof typeof MOMENTS;

/** Event types (the Kitten Diary / squad feed) → how the kitten looks on that card. Most specific rule first. */
const RULES: [RegExp, KittenState][] = [
  [/^pounce\.(charged|paid_booker)$|^tag_along\.paid$/, MOMENTS.pounce],
  [/^(plan\.settled|yarn\.(clear|settled|received)|purr\.tag|help\.(received|paid)|leftover\.refund|tag_along\.(refund|received)|payout\.sent)$/, MOMENTS.settled],
  [/^(pawup\.asked|overrun\.asked|yarn\.(confirm|pay|reminder|card_reminder|disputed)|help\.(asked|pledge_failed)|kitten\.ask_owner|plan\.(suggestion|reminder)|receipt\.reminder|party\.payment_failed|payout\.delayed|pounce\.paused)$/, MOMENTS.needsYou],
  [/^(receipt\.read|answer\.prepared|plan\.(rechecked|negotiated|no_fit))$/, MOMENTS.reading],
  [/^yarn\.untangle/, MOMENTS.untangle],
  [/^(paw\.(placed|in|up|cover|approved)|jar\.topped_up)$/, MOMENTS.pawIn],
  [/^party\.(saved|jar)$/, MOMENTS.partySaving],
  [/^help\.(pledged|given|sent|progress)$/, MOMENTS.helping],
  [/^catnip\./, MOMENTS.catnip],
  [/^whim\.floated$|^plan\.created$/, MOMENTS.sending],
  [/^kitten\.(adopted|friend_reply)$/, { mood: "happy", pose: "wave" }],
];

/** The kitten for a feed or diary item: e.g. a Pounce card shows it leaping; a paw-up ask shows it alert. */
export function kittenForEvent(type: string): KittenState {
  for (const [re, state] of RULES) if (re.test(type)) return state;
  return CALM;
}
