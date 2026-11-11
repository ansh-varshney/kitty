"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** The app's one way to talk to the backend, and its live data: anything on screen refreshes when an event arrives. */

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** They were asked to refill their Treat Jar and said not now. Nothing happened, so nothing needs saying. */
export class RefillDeclined extends Error {}

type RefillAsker = (ask: { shortCents: number; jarCents: number }) => Promise<boolean>;
let askRefill: RefillAsker | null = null;
export const setRefillAsker = (fn: RefillAsker | null) => {
  askRefill = fn;
};

/** Every payment in Kitty comes from the Treat Jar (FR-JAR-7). If it's short, ask here, once, for every screen, then try again. */
export async function api<T = unknown>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const out = await send<T>(method, path, body);
  const short = out as { code?: string; shortCents?: number; jarCents?: number } | null;
  if (short?.code !== "jar_short" || !askRefill) return out;
  if (!(await askRefill({ shortCents: short.shortCents ?? 0, jarCents: short.jarCents ?? 0 }))) throw new RefillDeclined();
  return send<T>(method, path, { ...(body as object | undefined), refill: true });
}

async function send<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    credentials: "same-origin",
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string })?.error ?? "That didn't work. Nothing changed.");
  return json as T;
}

// A tiny store: the current "version" of the data. Anything that changes it makes every screen reload what it shows.
let version = 0;
const listeners = new Set<() => void>();
export function refreshAll() {
  version++;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const useVersion = () => useSyncExternalStore(subscribe, () => version, () => 0);

const cache = new Map<string, unknown>();
const noSubscribe = () => () => undefined;

/** Data for a screen. Shows what it had straight away and refreshes behind it, so nothing flashes empty. */
export function useData<T>(path: string | null) {
  const v = useVersion();
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [state, setState] = useState<{ path: string | null; data?: T; error?: ApiError }>(() => ({ path, data: path ? (cache.get(path) as T | undefined) : undefined }));
  const [own, setOwn] = useState(0);

  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>("GET", path)
      .then((data) => {
        cache.set(path, data);
        if (live) setState({ path, data });
      })
      .catch((error: ApiError) => {
        if (live) setState((s) => ({ path, data: s.path === path ? s.data : undefined, error }));
      });
    return () => {
      live = false;
    };
  }, [path, v, own]);

  const reload = useCallback(() => setOwn((n) => n + 1), []);
  const current = state.path === path ? state : { path, data: path ? (cache.get(path) as T | undefined) : undefined, error: undefined };
  // The first render must match the server's empty page, even if another part of the screen already loaded this data.
  const data = hydrated ? current.data : undefined;
  return { data, error: current.error, loading: data === undefined && !current.error, reload };
}

/** Listen to the live event stream; every new event refreshes what's on screen (a light throttle keeps it calm). */
export function useLiveStream(enabled: boolean, onEvent?: (e: { type: string; payload?: { text?: string } }) => void) {
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/v1/stream");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handle = (m: MessageEvent) => {
      if (onEvent) {
        try {
          onEvent(JSON.parse(m.data));
        } catch {
          /* a keep-alive */
        }
      }
      if (!timer)
        timer = setTimeout(() => {
          timer = null;
          refreshAll();
        }, 500);
    };
    es.onmessage = handle;
    return () => {
      es.close();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, onEvent]);
}

export const money = (c: number) => `$${(c / 100).toFixed(2)}`;
export const moneyShort = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
export const toCents = (s: string) => Math.round(Number(s.replace(/[^0-9.]/g, "")) * 100);
export const dayTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
export const shortDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
