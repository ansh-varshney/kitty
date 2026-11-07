import fs from "node:fs";
import path from "node:path";
import "../env";

/**
 * Database adapter (PRD §C4):
 * - Render Postgres in production (DATABASE_URL set)
 * - PGlite (embedded Postgres, zero setup) for local development and tests
 * Same SQL on both.
 */

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  kind: "postgres" | "pglite";
}

let dbPromise: Promise<Db> | undefined;

export function db(): Promise<Db> {
  dbPromise ??= open();
  return dbPromise;
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
  };
}

async function openPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".pglite");
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
