import { Suspense } from "react";
import Playground from "./playground";

export const metadata = { title: "Kitty · Phase 1 playground" };

export default function PlayPage() {
  return (
    <main className="mx-auto max-w-5xl p-6 font-sans">
      <h1 className="text-2xl font-semibold">Kitty playground (Phase 1 backend)</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Drive the real backend as any demo friend: float whims, confirm answers, paw in, Pounce, receipts. Sandbox money only. The real app
        screens come in Phase 3.
      </p>
      <Suspense fallback={<p className="mt-6">Loading…</p>}>
        <Playground />
      </Suspense>
    </main>
  );
}
