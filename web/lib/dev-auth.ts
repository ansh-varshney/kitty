import "./env";

/**
 * The dev console moves sandbox money, so on the hosted URL it's locked behind DEV_CONSOLE_KEY.
 * Locally (no key set) it's open.
 */
export function devAllowed(req: Request): boolean {
  const key = process.env.DEV_CONSOLE_KEY;
  if (!key) return true;
  return req.headers.get("x-dev-key") === key;
}
