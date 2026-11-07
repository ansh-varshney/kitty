/** Quick DB check: `PGLITE_DIR=memory npx tsx scripts/check-db.ts` — migrations apply, tx commits and rolls back. */
import { loadEnv } from "../lib/load-env";
loadEnv();

async function main() {
  console.log("opening db…");
  const { db } = await import("../lib/db");
  const d = await db();
  const t = await d.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' order by 1");
  console.log(d.kind, "tables:", t.map((r) => r.table_name).join(", "));
  const n = await d.tx(async (q) => {
    await q.query("insert into users(name) values('tx test')");
    return (await q.query<{ n: number }>("select count(*)::int n from users"))[0].n;
  });
  console.log("tx commit ok, users:", n);
  try {
    await d.tx(async (q) => {
      await q.query("insert into users(name) values('rollback me')");
      throw new Error("boom");
    });
  } catch (e) {
    console.log("rollback ok:", (e as Error).message);
  }
  console.log("users after rollback:", (await d.query<{ n: number }>("select count(*)::int n from users"))[0].n);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
