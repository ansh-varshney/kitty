/**
 * One-at-a-time guards for money actions (edge-case pass, 8 Nov): a double tap, two job runs or two people acting
 * on the same thing at once must run in turn, so the second sees what the first did ("already paid", "already
 * pounced"). Kitty runs as ONE web instance (Render), so an in-process queue per key is enough; the ledger adds a
 * database-level check that user balances never go below $0 (ledger.ts) as the last line of defence.
 */
const queues = new Map<string, Promise<void>>();

/** Run `fn` after every earlier holder of `key` has finished. */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => mine);
  queues.set(key, tail);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (queues.get(key) === tail) queues.delete(key);
  }
}

const running = new Set<string>();

/** Run `fn` only if nobody holds `key` right now; otherwise return `busy` straight away (for scheduled jobs). */
export async function ifFree<T, B>(key: string, busy: B, fn: () => Promise<T>): Promise<T | B> {
  if (running.has(key)) return busy;
  running.add(key);
  try {
    return await fn();
  } finally {
    running.delete(key);
  }
}
