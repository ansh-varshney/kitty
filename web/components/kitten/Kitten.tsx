"use client";

import { useId, type ReactNode } from "react";
import { ART, EYE_COLOURS, PALETTES, normalizeLook, type KittenLook, type Mood, type Pose } from "@/lib/kitten/looks";

/**
 * Kitty's one in-house kitten (PRD §B22): a single SVG template drawn in code. Fur, pattern, accessory and eye
 * colour come from the owner's choices; mood changes only the face; pose changes the body and paws. The same
 * drawing is the chat avatar (view="head"), the greeting (view="bust") and the rooftop / money-moment kitten
 * (view="full"). No emojis, no bitmaps (FR-UX-3).
 */

export type KittenProps = {
  look?: Partial<KittenLook> | null;
  mood?: Mood;
  pose?: Pose;
  view?: "head" | "bust" | "full";
  size?: number;
  /** Gentle idle motion (tail sway, blink, breathing). Off when the user prefers reduced motion (FR-UX-5). */
  animate?: boolean;
  /** Something held in the "hold" pose: a magnifying glass, letter, coin, yarn… drawn centred at the paws. */
  prop?: ReactNode;
  title?: string;
  className?: string;
};

const VIEWBOX = { head: "34 6 132 132", bust: "18 0 164 164", full: "0 0 200 200" } as const;

const HEAD = "M48 80 C 46 50, 70 34, 100 34 C 130 34, 154 50, 152 80 C 152 104, 130 118, 100 118 C 70 118, 48 104, 48 80 Z";
const BODY_SIT = "M66 176 C 60 140, 74 112, 100 112 C 126 112, 140 140, 134 176 Q 100 184 66 176 Z";
const BODY_LOAF = "M40 180 C 36 146, 64 126, 102 126 C 142 126, 166 148, 162 180 Q 100 188 40 180 Z";
const EAR_L = "M56 64 L 57 22 Q 58 15 65 18 L 92 40 Z";
const EAR_R = "M144 64 L 143 22 Q 142 15 135 18 L 108 40 Z";
const EAR_L_IN = "M63 54 L 63.5 29 L 83 42 Z";
const EAR_R_IN = "M137 54 L 136.5 29 L 117 42 Z";
const TAIL = {
  sit: "M128 170 C 162 172, 174 146, 162 124 C 158 116, 151 117, 152 124",
  sleep: "M52 180 C 78 194, 132 194, 160 172",
  pounce: "M128 150 C 150 140, 160 118, 156 92",
};

/** A limb or tail: a thick rounded line with an outline (outline drawn first, slightly wider). */
function Tube({ d, w, fill, outline, cls }: { d: string; w: number; fill: string; outline: string; cls?: string }) {
  return (
    <g className={cls}>
      <path d={d} fill="none" stroke={outline} strokeWidth={w + 5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={fill} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function Paw({ cx, cy, rx = 11, ry = 7, fill, outline }: { cx: number; cy: number; rx?: number; ry?: number; fill: string; outline: string }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={fill} stroke={outline} strokeWidth={3} />
      <path d={`M${cx - 3.5} ${cy + ry - 4} l0 3 M${cx + 3.5} ${cy + ry - 4} l0 3`} stroke={outline} strokeWidth={1.6} strokeLinecap="round" opacity={0.6} />
    </g>
  );
}

function Eyes({ mood, iris, ink }: { mood: Mood; iris: string; ink: string }) {
  const at = [78, 122];
  const y = 80;
  const open = (className: string, big = false, look = { dx: 0, dy: 0.8 }) => (
    <g className={className}>
      {at.map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={y} rx={big ? 9.6 : 8} ry={big ? 11 : 9.5} fill={iris} stroke="#1E1830" strokeWidth={1.4} />
          <g className="kt-look">
            <ellipse cx={x + look.dx} cy={y + look.dy} rx={big ? 3.8 : 4.8} ry={big ? 5.2 : 6.8} fill="#1E1830" />
            <circle cx={x - 2.6 + look.dx} cy={y - 3.4 + look.dy} r={2.6} fill="#fff" />
            <circle cx={x + 2.4 + look.dx} cy={y + 3.2 + look.dy} r={1.1} fill="#fff" opacity={0.85} />
          </g>
        </g>
      ))}
    </g>
  );
  // Closed eyes can't blink, so these moods open theirs now and then (globals.css). Without animation only the closed eyes show.
  const closed = (kind: "smile" | "nap", curve: (x: number) => string, strokeWidth: number) => (
    <>
      <g className={`kt-${kind}-closed`} fill="none" stroke={ink} strokeWidth={strokeWidth} strokeLinecap="round">
        {at.map((x) => (
          <path key={x} d={curve(x)} />
        ))}
      </g>
      <g className={`kt-${kind}-open`}>{open(`kt-${kind}-blink`)}</g>
    </>
  );
  if (mood === "happy" || mood === "proud") return closed("smile", (x) => `M${x - 8} ${y + 2} Q ${x} ${y - 8} ${x + 8} ${y + 2}`, 3.4);
  if (mood === "sleepy") return closed("nap", (x) => `M${x - 8} ${y + 1} Q ${x} ${y + 6} ${x + 8} ${y + 1}`, 3.2);
  return open("kt-blink", mood === "alert", mood === "thinking" ? { dx: 2.4, dy: -2.4 } : { dx: 0, dy: 0.8 });
}

function Brows({ mood, ink }: { mood: Mood; ink: string }) {
  if (mood === "alert")
    return (
      <g fill="none" stroke={ink} strokeWidth={2.6} strokeLinecap="round">
        <path d="M70 64 Q 78 59 86 63" />
        <path d="M114 63 Q 122 59 130 64" />
      </g>
    );
  if (mood === "thinking")
    return (
      <g fill="none" stroke={ink} strokeWidth={2.6} strokeLinecap="round">
        <path d="M71 66 L 85 66" />
        <path d="M114 63 Q 122 57 130 62" />
      </g>
    );
  return null;
}

function Mouth({ mood, ink }: { mood: Mood; ink: string }) {
  const s = { fill: "none", stroke: ink, strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (mood) {
    case "happy":
      return (
        <g>
          <path d="M92 96 Q 100 108 108 96 Z" fill={ART.mouth} stroke={ink} strokeWidth={2} strokeLinejoin="round" />
          <path d="M96 101.5 Q 100 106 104 101.5 Q 100 99.5 96 101.5 Z" fill={ART.tongue} />
        </g>
      );
    case "proud":
      return <path d="M89 95 Q 95 102 100 96 Q 105 102 111 95" {...s} />;
    case "alert":
      return <ellipse cx={100} cy={100} rx={3} ry={3.8} fill={ART.mouth} stroke={ink} strokeWidth={1.6} />;
    case "sleepy":
      return <path d="M96 98 Q 100 100 104 98" {...s} />;
    case "thinking":
      return <path d="M94 98 Q 100 96 106 99" {...s} />;
    default:
      return <path d="M92 96 Q 96 100.5 100 96 Q 104 100.5 108 96" {...s} />;
  }
}

export function Kitten({ look: raw, mood = "neutral", pose = "sit", view = "full", size = 160, animate = false, prop, title, className }: KittenProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const look = normalizeLook(raw);
  const p = PALETTES[look.fur];
  const iris = EYE_COLOURS[look.eyes];
  const effPose: Pose = view === "head" ? "sit" : pose;
  const sleep = effPose === "sleep";
  const pounce = effPose === "pounce";
  const socks = look.pattern === "socks";
  const pawFill = socks ? ART.white : p.base;
  const muzzle = socks ? ART.white : p.light;
  const faceMood: Mood = sleep ? "sleepy" : mood;
  const headT = sleep ? "translate(-14 38) rotate(-8 100 78)" : undefined;
  const lift = pounce ? "translate(0 -16)" : undefined;
  const bodyPath = sleep ? BODY_LOAF : BODY_SIT;
  const tailPath = sleep ? TAIL.sleep : pounce ? TAIL.pounce : TAIL.sit;
  const clipHead = `kh${uid}`;
  const clipBody = `kb${uid}`;
  const label = title ?? "A kitten";

  const tail = (
    <g className="kt-tail">
      <Tube d={tailPath} w={13} fill={p.base} outline={p.outline} />
      {look.pattern === "tabby" && <path d={tailPath} fill="none" stroke={p.shade} strokeWidth={13} strokeDasharray="5 9" strokeLinecap="butt" />}
      {socks && !sleep && <circle cx={pounce ? 156 : 152} cy={pounce ? 94 : 124} r={6.3} fill={ART.white} />}
    </g>
  );

  return (
    <svg
      viewBox={VIEWBOX[view]}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={`${animate ? "kt-anim" : ""} ${className ?? ""}`}
      // Every kitten keeps its own rhythm, so a rooftop of them doesn't blink in unison.
      style={{ ["--kt-d" as string]: `-${(uid.charCodeAt(uid.length - 1) * 37) % 5}.${uid.charCodeAt(0) % 9}s` }}
    >
      <title>{label}</title>
      <defs>
        <clipPath id={clipHead}>
          <path d={HEAD} />
        </clipPath>
        <clipPath id={clipBody}>
          <path d={bodyPath} />
        </clipPath>
      </defs>

      {view === "full" && <ellipse cx={100} cy={pounce ? 192 : 186} rx={pounce ? 34 : sleep ? 66 : 50} ry={pounce ? 4 : 6} fill="#1E1830" opacity={0.14} />}

      <g transform={lift}>
        <g className="kt-breathe">
          {!sleep && view !== "head" && tail}

          {/* Body */}
          <path d={bodyPath} fill={p.base} stroke={p.outline} strokeWidth={3} strokeLinejoin="round" />
          <g clipPath={`url(#${clipBody})`}>
            {!sleep && <path d="M84 177 C 82 152, 90 134, 100 134 C 110 134, 118 152, 116 177 Z" fill={socks ? ART.white : p.light} />}
            {look.pattern === "tabby" && (
              <g fill="none" stroke={p.shade} strokeWidth={4.5} strokeLinecap="round">
                <path d={sleep ? "M120 136 Q 124 146 120 154 M136 140 Q 141 150 138 160" : "M66 146 Q 75 148 80 143 M65 158 Q 75 161 80 156 M134 146 Q 125 148 120 143 M135 158 Q 125 161 120 156"} />
              </g>
            )}
            {look.pattern === "patches" && <path d={sleep ? "M120 128 C 146 126, 166 150, 160 178 C 140 172, 118 152, 120 128 Z" : "M112 124 C 132 122, 142 146, 138 172 C 122 168, 108 148, 112 124 Z"} fill={p.patch} />}
          </g>
          {/* Redraw the body outline over the clipped fills so edges stay crisp. */}
          <path d={bodyPath} fill="none" stroke={p.outline} strokeWidth={3} strokeLinejoin="round" />

          {sleep && tail}

          {/* Legs and paws by pose */}
          {effPose === "sit" && (
            <>
              <Paw cx={88} cy={177} fill={pawFill} outline={p.outline} />
              <Paw cx={112} cy={177} fill={pawFill} outline={p.outline} />
            </>
          )}
          {effPose === "wave" && <Paw cx={88} cy={177} fill={pawFill} outline={p.outline} />}
          {effPose === "hold" && (
            <>
              <Paw cx={86} cy={178} rx={10} ry={6.5} fill={pawFill} outline={p.outline} />
              <Paw cx={114} cy={178} rx={10} ry={6.5} fill={pawFill} outline={p.outline} />
            </>
          )}
          {sleep && (
            <>
              <Paw cx={66} cy={181} rx={10} ry={6} fill={pawFill} outline={p.outline} />
              <Paw cx={86} cy={183} rx={10} ry={6} fill={pawFill} outline={p.outline} />
            </>
          )}
          {pounce && (
            <>
              {/* Back legs stretched out: a leap */}
              <Tube d="M86 168 L 72 192" w={12} fill={pawFill} outline={p.outline} />
              <Tube d="M114 168 L 128 192" w={12} fill={pawFill} outline={p.outline} />
            </>
          )}

          {/* Neck accessories sit under the chin */}
          {look.accessory === "bell" && (
            <g>
              <path d="M72 117 Q 100 131 128 117" fill="none" stroke={ART.collar} strokeWidth={6} strokeLinecap="round" />
              <circle cx={100} cy={130} r={6.5} fill={ART.bell} stroke={ART.bellShade} strokeWidth={1.6} />
              <path d="M97 132 L 103 132" stroke={ART.bellShade} strokeWidth={1.4} strokeLinecap="round" />
            </g>
          )}
          {look.accessory === "scarf" && (
            <g stroke={ART.scarfShade} strokeWidth={2} strokeLinejoin="round">
              <path d="M116 122 L 125 148 Q 119 152 112 150 L 105 127 Z" fill={ART.scarf} />
              <path d="M110 137 L 120 134 M112 144 L 122 141" stroke="#fff" strokeOpacity={0.6} strokeWidth={2.2} strokeLinecap="round" />
              <path d="M67 110 Q 100 126 133 110 L 135 120 Q 100 137 65 120 Z" fill={ART.scarf} />
            </g>
          )}
        </g>

        {/* Head */}
        <g transform={headT}>
          <g className="kt-head">
          <g className="kt-ear-l">
            <path d={EAR_L} fill={look.pattern === "patches" ? p.patch : p.base} stroke={p.outline} strokeWidth={3} strokeLinejoin="round" />
            <path d={EAR_L_IN} fill={p.innerEar} />
          </g>
          <g className="kt-ear-r">
            <path d={EAR_R} fill={p.base} stroke={p.outline} strokeWidth={3} strokeLinejoin="round" />
            <path d={EAR_R_IN} fill={p.innerEar} />
          </g>
          <path d={HEAD} fill={p.base} />
          <g clipPath={`url(#${clipHead})`}>
            {look.pattern === "tabby" && (
              <g fill="none" stroke={p.shade} strokeWidth={4.5} strokeLinecap="round">
                <path d="M100 37 L 100 52 M89 39 Q 90 46 92 51 M111 39 Q 110 46 108 51" />
                <path d="M46 74 L 60 77 M47 85 L 59 86 M154 74 L 140 77 M153 85 L 141 86" />
              </g>
            )}
            {look.pattern === "patches" && <path d="M40 60 C 50 34, 74 28, 86 40 C 92 56, 90 78, 80 90 C 64 96, 46 86, 40 60 Z" fill={p.patch} />}
            {socks && <path d="M100 52 C 95 64, 92 78, 89 92 L 111 92 C 108 78, 105 64, 100 52 Z" fill={ART.white} />}
            <ellipse cx={91} cy={97} rx={11.5} ry={8.5} fill={muzzle} />
            <ellipse cx={109} cy={97} rx={11.5} ry={8.5} fill={muzzle} />
          </g>
          <path d={HEAD} fill="none" stroke={p.outline} strokeWidth={3} strokeLinejoin="round" />

          {/* Face */}
          <circle cx={63} cy={96} r={6.5} fill={ART.blush} opacity={0.5} />
          <circle cx={137} cy={96} r={6.5} fill={ART.blush} opacity={0.5} />
          <g className="kt-whisk" stroke={p.ink} strokeWidth={1.6} strokeLinecap="round" opacity={0.45}>
            <path d="M58 93 L 44 90 M58 98 L 44 100 M142 93 L 156 90 M142 98 L 156 100" />
          </g>
          <Brows mood={faceMood} ink={p.ink} />
          <Eyes mood={faceMood} iris={iris} ink={p.ink} />
          <path d="M95.5 90 Q 100 87.5 104.5 90 Q 100 95 95.5 90 Z" fill={ART.nose} />
          <Mouth mood={faceMood} ink={p.ink} />

          {look.accessory === "bow" && (
            <g stroke={ART.bowShade} strokeWidth={1.8} strokeLinejoin="round">
              <path d="M126 40 L 108 28 Q 103 40 108 51 Z" fill={ART.bow} />
              <path d="M126 40 L 144 28 Q 149 40 144 51 Z" fill={ART.bow} />
              <circle cx={126} cy={40} r={5} fill={ART.bowShade} />
            </g>
          )}
          {look.accessory === "glasses" && (
            <g fill="#ffffff" fillOpacity={0.14} stroke={ART.glasses} strokeWidth={2.8} strokeLinecap="round">
              <circle cx={78} cy={80} r={13} />
              <circle cx={122} cy={80} r={13} />
              <path d="M91 79 Q 100 74 109 79 M65 78 L 51 73 M135 78 L 149 73" fill="none" />
            </g>
          )}
          {faceMood === "sleepy" && (
            <g fill="none" stroke={p.ink === "#F4ECDF" ? "#F4ECDF" : "#6E6A9E"} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M140 30 L 150 30 L 140 40 L 150 40" />
              <path d="M152 14 L 159 14 L 152 21 L 159 21" />
            </g>
          )}
          {faceMood === "proud" && <path d="M148 30 L 151 38 L 159 41 L 151 44 L 148 52 L 145 44 L 137 41 L 145 38 Z" fill={ART.bell} />}
          </g>
        </g>

        {/* Arms in front: waving, cheering on a leap, or holding something up to show */}
        {effPose === "wave" && (
          <g className="kt-wave">
            <Tube d="M126 140 L 156 98" w={13} fill={p.base} outline={p.outline} />
            <circle cx={158} cy={93} r={10} fill={pawFill} stroke={p.outline} strokeWidth={3} />
          </g>
        )}
        {pounce && (
          <g className="kt-pounce">
            <Tube d="M78 136 L 52 106" w={13} fill={p.base} outline={p.outline} />
            <Tube d="M122 136 L 148 106" w={13} fill={p.base} outline={p.outline} />
            <circle cx={50} cy={102} r={10} fill={pawFill} stroke={p.outline} strokeWidth={3} />
            <circle cx={150} cy={102} r={10} fill={pawFill} stroke={p.outline} strokeWidth={3} />
          </g>
        )}
        {effPose === "hold" && (
          <g className="kt-hold">
            <Tube d="M74 128 L 74 146" w={12} fill={p.base} outline={p.outline} />
            <Tube d="M126 128 L 126 146" w={12} fill={p.base} outline={p.outline} />
            {prop && <g transform="translate(100 134) scale(1.35)">{prop}</g>}
            <circle cx={75} cy={148} r={8.5} fill={pawFill} stroke={p.outline} strokeWidth={3} />
            <circle cx={125} cy={148} r={8.5} fill={pawFill} stroke={p.outline} strokeWidth={3} />
          </g>
        )}
      </g>
    </svg>
  );
}

/** Small props the kitten can hold in money moments (§B22): drawn around (0,0), roughly 40 × 40. */
export const PROPS = {
  magnifier: (
    <g stroke="#2A2245" strokeWidth={3} strokeLinecap="round">
      <path d="M8 4 L 22 -14" strokeWidth={6} stroke="#8E5A3C" />
      <circle cx={-4} cy={18} r={14} fill="#DDEFF7" fillOpacity={0.85} />
      <path d="M-11 12 Q -7 7 -1 8" stroke="#fff" strokeWidth={2.4} fill="none" />
    </g>
  ),
  letter: (
    <g stroke="#2A2245" strokeWidth={2.4} strokeLinejoin="round">
      <rect x={-20} y={-6} width={40} height={28} rx={3} fill="#FFF7E6" />
      <path d="M-20 -5 L 0 10 L 20 -5" fill="none" />
      <circle cx={0} cy={10} r={4} fill="#E25C6B" stroke="none" />
    </g>
  ),
  coin: (
    <g stroke="#B8892A" strokeWidth={2.4}>
      <circle cx={0} cy={6} r={15} fill="#F2C14E" />
      <circle cx={0} cy={6} r={10.5} fill="none" strokeOpacity={0.7} />
      {/* A paw print: Kitty's coin */}
      <g fill="#B8892A" stroke="none">
        <ellipse cx={0} cy={9} rx={4.2} ry={3.4} />
        <circle cx={-4.6} cy={3.6} r={1.8} />
        <circle cx={0} cy={1.8} r={1.8} />
        <circle cx={4.6} cy={3.6} r={1.8} />
      </g>
    </g>
  ),
  yarn: (
    <g strokeLinecap="round">
      <circle cx={0} cy={6} r={16} fill="#E86A86" stroke="#B9445F" strokeWidth={2.4} />
      <path d="M-12 -2 Q 0 6 12 -4 M-15 8 Q 0 16 15 6 M-8 18 Q 2 10 10 -8" stroke="#B9445F" strokeWidth={2} fill="none" />
      <path d="M16 10 Q 30 14 26 26" stroke="#E86A86" strokeWidth={2.4} fill="none" />
    </g>
  ),
  gift: (
    <g stroke="#2A2245" strokeWidth={2.4} strokeLinejoin="round">
      <rect x={-17} y={-4} width={34} height={28} rx={3} fill="#7C6CF2" />
      <rect x={-19} y={-10} width={38} height={9} rx={2} fill="#9B8CFF" />
      <path d="M0 -10 L 0 24" stroke="#F2C14E" strokeWidth={5} />
      <path d="M0 -10 Q -12 -22 -8 -12 Z M0 -10 Q 12 -22 8 -12 Z" fill="#F2C14E" stroke="#B8892A" strokeWidth={1.8} />
    </g>
  ),
};
