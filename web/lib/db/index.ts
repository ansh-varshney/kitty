import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../env";

/**
 * Database adapter (PRD §C4):
 * - Render Postgres in production (DATABASE_URL set)
 * - PGlite (embedded Postgres, zero setup) for local development and tests
 * Same SQL on both. `tx()` runs a function inside one transaction (money moves are all-or-nothing).
 */

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  kind: "postgres" | "pglite";
}

let dbPromise: Promise<Db> | undefined;

export function db(): Promise<Db> {
  dbPromise ??= open();
  return dbPromise;
}

/** Test helper: point the adapter at a fresh in-memory database. */
export function resetDbForTests() {
  dbPromise = undefined;
}

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  const instance = url ? await openPostgres(url) : await openPglite();
  await migrate(instance);
  return instance;
}

async function openPostgres(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const needsSsl = /render\.com|sslmode=require/.test(url);
  const pool = new Pool({ connectionString: url, max: 5, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
  return {
    kind: "postgres",
    async query(sql, params) {
      const res = await pool.query(sql, params as unknown[] | undefined);
      return res.rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn({
          async query(sql, params) {
            const res = await client.query(sql, params as unknown[] | undefined);
            return res.rows;
          },
        });
        await client.query("commit");
        return out;
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

async function openPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  // Kept OUTSIDE the project: Next's dev watcher can't ignore folders and reloads on every database write.
  const dir = process.env.PGLITE_DIR ?? path.join(os.homedir(), ".kitty-dev", "pglite");
  if (dir !== "memory") fs.mkdirSync(dir, { recursive: true });
  const pg = dir === "memory" ? new PGlite() : new PGlite(dir);
  await pg.waitReady;
  return {
    kind: "pglite",
    async query(sql, params) {
      const res = await pg.query(sql, params as unknown[] | undefined);
      return res.rows as never[];
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    async tx(fn) {
      return pg.transaction(async (t) =>
        fn({
          async query(sql, params) {
            const res = await t.query(sql, params as unknown[] | undefined);
            return res.rows as never[];
          },
        }),
      );
    },
  };
}

/** Runs db/migrations/*.sql in name order, once each. */
export async function migrate(instance: Db): Promise<string[]> {
  await instance.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort() : [];
  const done = new Set((await instance.query<{ name: string }>(`select name from schema_migrations`)).map((r) => r.name));
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    await instance.exec(fs.readFileSync(path.join(dir, file), "utf8"));
    await instance.query(`insert into schema_migrations (name) values ($1)`, [file]);
    applied.push(file);
  }
  return applied;
}
