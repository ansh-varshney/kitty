/**
 * The kitten template's options (PRD §B1 page 3, §B22): every user's kitten is the same drawing with a few choices.
 * 6 fur colours × 4 patterns × 5 accessories × 3 eye colours = 360 looks, so kittens in a squad look different.
 * Stored on kittens.look as { fur, pattern, accessory, eyes }.
 */

export const FURS = ["ginger", "cocoa", "smoke", "midnight", "snow", "honey"] as const;
export const PATTERNS = ["plain", "tabby", "patches", "socks"] as const;
export const ACCESSORIES = ["none", "bell", "bow", "scarf", "glasses"] as const;
export const EYES = ["amber", "green", "blue"] as const;
export const MOODS = ["neutral", "happy", "thinking", "alert", "sleepy", "proud"] as const;
export const POSES = ["sit", "wave", "hold", "sleep", "pounce"] as const;

export type Fur = (typeof FURS)[number];
export type Pattern = (typeof PATTERNS)[number];
export type Accessory = (typeof ACCESSORIES)[number];
export type EyeColour = (typeof EYES)[number];
export type Mood = (typeof MOODS)[number];
export type Pose = (typeof POSES)[number];
export type KittenLook = { fur: Fur; pattern: Pattern; accessory: Accessory; eyes: EyeColour };

/**
 * Personality, picked at adoption (§B1 page 3). Stored as the "breed"; it sets only the kitten's tone of voice,
 * never its look or its money rules. Shown to the owner as the personality, with the breed as a small note.
 */
export const PERSONALITIES = [
  { breed: "siamese", label: "Chatty", note: "Siamese", sample: "Ooh, a cabin trip! I asked everyone, three are in already!" },
  { breed: "persian", label: "Polite", note: "Persian", sample: "Good news: three friends would like to join the cabin trip." },
  { breed: "tabby", label: "Chill", note: "Tabby", sample: "Cabin trip? Three are in. Easy." },
  { breed: "bengal", label: "Hype", note: "Bengal", sample: "THREE friends in for the cabin! Let's goooo!" },
  { breed: "ragdoll", label: "Warm", note: "Ragdoll", sample: "Three of your friends are in for the cabin. This'll be lovely." },
  { breed: "shorthair", label: "Formal", note: "British Shorthair", sample: "Update: three members have confirmed the cabin trip." },
] as const;

/** Plain-word labels for the adoption screen (FR-UX-2). */
export const LABELS: Record<string, string> = {
  ginger: "Ginger",
  cocoa: "Cocoa",
  smoke: "Smoke grey",
  midnight: "Midnight",
  snow: "Snow",
  honey: "Honey",
  plain: "Plain",
  tabby: "Tabby stripes",
  patches: "Patches",
  socks: "White socks",
  none: "Nothing",
  bell: "Bell collar",
  bow: "Bow",
  scarf: "Scarf",
  glasses: "Round glasses",
  amber: "Amber",
  green: "Green",
  blue: "Blue",
};

/** Each fur: main colour, a darker shade (stripes, outline), a light tone (belly, muzzle), patches, and the ink for the face. */
export type Palette = { base: string; shade: string; light: string; patch: string; outline: string; ink: string; innerEar: string };

export const PALETTES: Record<Fur, Palette> = {
  ginger: { base: "#F2A65A", shade: "#D9813A", light: "#FDE6CA", patch: "#8E5A3C", outline: "#9A5424", ink: "#3A2440", innerEar: "#F6B7B9" },
  cocoa: { base: "#A2725A", shade: "#7E5240", light: "#EBD3C2", patch: "#F3E6D6", outline: "#5A3626", ink: "#2E1E2A", innerEar: "#E7A9A6" },
  smoke: { base: "#A9AFC4", shade: "#8389A3", light: "#E9EBF3", patch: "#6C7290", outline: "#545A75", ink: "#2A2245", innerEar: "#EDB3C0" },
  midnight: { base: "#3D3856", shade: "#2B2742", light: "#67618A", patch: "#F4ECDF", outline: "#1C1830", ink: "#F4ECDF", innerEar: "#C98A9E" },
  snow: { base: "#FBF7F0", shade: "#E7DDCD", light: "#FFFFFF", patch: "#F2A65A", outline: "#B4A58F", ink: "#3A2440", innerEar: "#F7B9C4" },
  honey: { base: "#ECC66E", shade: "#D2A44C", light: "#FBEDC8", patch: "#B9793A", outline: "#99722A", ink: "#3A2440", innerEar: "#F2B2AE" },
};

export const EYE_COLOURS: Record<EyeColour, string> = { amber: "#E8A33D", green: "#55B87A", blue: "#64A6E8" };

/** Shared art colours (PRD palette: indigo night, lamplight amber, cream paper, mint for money moved). */
export const ART = {
  nose: "#E9798F",
  blush: "#F39AAE",
  mouth: "#7A2F48",
  tongue: "#F27C94",
  white: "#FFFDF8",
  collar: "#E25C6B",
  bell: "#F2C14E",
  bellShade: "#B8892A",
  bow: "#E86A86",
  bowShade: "#B9445F",
  scarf: "#5FC4A0",
  scarfShade: "#3E9A7C",
  glasses: "#2A2245",
};

export const DEFAULT_LOOK: KittenLook = { fur: "ginger", pattern: "tabby", accessory: "bell", eyes: "amber" };

/** Accept whatever is stored (older rows have fur names like "ginger" and no eyes) and fill gaps with defaults. */
export function normalizeLook(raw: Partial<Record<keyof KittenLook, unknown>> | null | undefined): KittenLook {
  const pick = <T extends string>(list: readonly T[], v: unknown, d: T): T => (list.includes(v as T) ? (v as T) : d);
  return {
    fur: pick(FURS, raw?.fur, DEFAULT_LOOK.fur),
    pattern: pick(PATTERNS, raw?.pattern, DEFAULT_LOOK.pattern),
    accessory: pick(ACCESSORIES, raw?.accessory, DEFAULT_LOOK.accessory),
    eyes: pick(EYES, raw?.eyes, DEFAULT_LOOK.eyes),
  };
}

export function randomLook(seed = Math.random()): KittenLook {
  const at = <T>(list: readonly T[], n: number) => list[Math.floor(n * list.length) % list.length];
  // A well-spread hash of (seed, k) in [0, 1): different seeds give different furs, not mostly one colour.
  const r = (k: number) => {
    const x = Math.sin((seed + 1) * 12.9898 + (k + 1) * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { fur: at(FURS, r(1)), pattern: at(PATTERNS, r(2)), accessory: at(ACCESSORIES, r(3)), eyes: at(EYES, r(4)) };
}
