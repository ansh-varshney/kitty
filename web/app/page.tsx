import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-6 font-sans">
      <h1 className="text-4xl font-semibold">Kitty</h1>
      <p className="mt-2 text-lg text-neutral-700">Friends talk. Kittens handle the money.</p>
      <p className="mt-6 text-sm text-neutral-500">
        Phase 0 build: the app itself arrives in Phase 3. For now, the{" "}
        <Link className="text-indigo-700 underline" href="/dev">
          dev console
        </Link>{" "}
        checks every PayPal and Gemini integration.
      </p>
    </main>
  );
}
