import "./env";
import { timingSafeEqual } from "node:crypto";

/**
 * The dev console moves sandbox money and can act as anyone, so on the hosted URL it's locked behind
 * DEV_CONSOLE_KEY. Locally (no key set, not on Render) it's open. On Render with no key it's closed.
 */
export function devAllowed(req: Request): boolean {
  const key = process.env.DEV_CONSOLE_KEY;
  if (!key) return !process.env.RENDER;
  const given = req.headers.get("x-dev-key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
