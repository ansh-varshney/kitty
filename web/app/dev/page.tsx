import { Suspense } from "react";
import DevConsole from "./dev-console";

export const metadata = { title: "Kitty · Dev console" };

export default function DevPage() {
  return (
    <main className="mx-auto max-w-3xl p-6 font-sans">
      <h1 className="text-2xl font-semibold">Kitty dev console</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Phase 0: proves every integration works against the PayPal sandbox and Gemini. Sandbox money only.
      </p>
      <Suspense fallback={<p className="mt-6">Loading…</p>}>
        <DevConsole />
      </Suspense>
    </main>
  );
}
