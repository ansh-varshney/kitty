import "./env";
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

/**
 * PayPal refuses localhost as a login return address, so on a local dev server only, "Log in with PayPal" opens a
 * stand-in where you pick which sandbox person you are. It can never run on the hosted site.
 */
export function localLoginAllowed(req: Request): boolean {
  if (process.env.NODE_ENV === "production" || process.env.RENDER) return false;
  // The Host header, because the dev server rewrites req.url to localhost even for visits from another machine.
  const host = (req.headers.get("host") ?? "").split(":")[0];
  return host === "localhost" || host === "127.0.0.1";
}

export type LocalPerson = { name: string; email: string };

/** The sandbox personal accounts: name and email only. These files also hold passwords, which never leave here. */
export function localPeople(): LocalPerson[] {
  // Local only: the build shouldn't trace these paths (the CSVs are never deployed).
  const dirs = [path.resolve(/*turbopackIgnore: true*/ process.cwd()), path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..")];
  const cells = (line: string) => [...line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map((m) => m[2] ?? m[1]);
  const found = new Map<string, LocalPerson>();
  for (const file of ["sandbox-friends-us.csv", "sandbox-accounts-us.csv"]) {
    const at = dirs.map((d) => path.join(/*turbopackIgnore: true*/ d, file)).find((x) => fs.existsSync(x));
    if (!at) continue;
    const [head, ...rows] = fs.readFileSync(at, "utf8").split(/\r?\n/).filter(Boolean);
    const cols = cells(head);
    for (const row of rows) {
      const c = cells(row);
      const email = c[cols.indexOf("primary_email_alias")];
      if (!email || !/personal/i.test(c[cols.indexOf("account_type")] ?? "")) continue;
      found.set(email, { name: c[cols.indexOf("first_name")] || email.split("@")[0], email });
    }
  }
  return [...found.values()];
}
