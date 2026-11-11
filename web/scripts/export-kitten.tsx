/**
 * Renders kittens from the code template to static SVG files, so they can be placed on the Paper canvas (PRD §D1:
 * the kitten is drawn in code and only placed in designs). Run from web/:
 *   npx tsx scripts/export-kitten.tsx <output-folder>
 */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Kitten, PROPS, type KittenProps } from "../components/kitten/Kitten";
import type { KittenLook } from "../lib/kitten/looks";

const MOCHI: KittenLook = { fur: "ginger", pattern: "tabby", accessory: "bell", eyes: "amber" };
const BISCUIT: KittenLook = { fur: "cocoa", pattern: "socks", accessory: "scarf", eyes: "green" };
const MISO: KittenLook = { fur: "midnight", pattern: "plain", accessory: "glasses", eyes: "amber" };
const PICKLES: KittenLook = { fur: "snow", pattern: "patches", accessory: "bow", eyes: "blue" };
const TOFU: KittenLook = { fur: "smoke", pattern: "tabby", accessory: "none", eyes: "green" };

const SET: Record<string, KittenProps> = {
  "mochi-letter": { look: MOCHI, view: "bust", pose: "hold", prop: PROPS.letter, mood: "happy" },
  "mochi-magnifier": { look: MOCHI, view: "bust", pose: "hold", prop: PROPS.magnifier, mood: "thinking" },
  "mochi-yarn": { look: MOCHI, view: "bust", pose: "hold", prop: PROPS.yarn, mood: "thinking" },
  "mochi-magnifier-full": { look: MOCHI, pose: "hold", prop: PROPS.magnifier, mood: "thinking" },
  "mochi-yarn-full": { look: MOCHI, pose: "hold", prop: PROPS.yarn, mood: "thinking" },
  "mochi-coin": { look: MOCHI, pose: "hold", prop: PROPS.coin, mood: "happy" },
  "mochi-sit": { look: MOCHI, mood: "neutral" },
  "mochi-wave": { look: MOCHI, pose: "wave", mood: "happy" },
  "mochi-pounce": { look: MOCHI, pose: "pounce", mood: "happy" },
  "biscuit-sit": { look: BISCUIT, mood: "happy" },
  "miso-sleep": { look: MISO, pose: "sleep" },
  "pickles-sit": { look: PICKLES, mood: "happy" },
  "tofu-sit": { look: TOFU, mood: "neutral" },
  "mochi-head-alert": { look: MOCHI, view: "head", mood: "alert" },
  "mochi-head-happy": { look: MOCHI, view: "head", mood: "happy" },
  "biscuit-head": { look: BISCUIT, view: "head", mood: "happy" },
  "miso-head": { look: MISO, view: "head", mood: "neutral" },
  "pickles-head": { look: PICKLES, view: "head", mood: "happy" },
  "tofu-head": { look: TOFU, view: "head", mood: "neutral" },
};

const out = process.argv[2];
if (!out) throw new Error("Give an output folder.");
fs.mkdirSync(out, { recursive: true });

for (const [name, props] of Object.entries(SET)) {
  let svg = renderToStaticMarkup(createElement(Kitten, { size: 480, ...props, title: name }));
  svg = svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/<title>.*?<\/title>/, "").replace(/ role="img"/, "").replace(/ aria-label="[^"]*"/, "").replace(/ class="[^"]*"/, "");
  // Each file gets its own clip-path ids, so several kittens can sit in one document.
  const tag = name.replace(/[^a-z]/g, "");
  for (const [, id] of svg.matchAll(/id="(k[hb][^"]*)"/g)) svg = svg.split(id).join(`${id.slice(0, 2)}${tag}`);
  fs.writeFileSync(path.join(out, `${name}.svg`), svg);
  console.log(name.padEnd(24), svg.length, "bytes");
}
