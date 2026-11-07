export const metadata = { title: "Kitty · Terms" };

export default function Terms() {
  return (
    <main className="mx-auto max-w-2xl p-6 font-sans leading-relaxed">
      <h1 className="text-2xl font-semibold">Terms of use</h1>
      <p className="mt-2 text-sm text-neutral-500">Kitty is a hackathon prototype running on the PayPal sandbox.</p>
      <ul className="mt-4 list-disc space-y-2 pl-5">
        <li>All payments are PayPal sandbox test transactions. No real money is involved.</li>
        <li>The app is provided as is, without any warranty, for demonstration and judging.</li>
        <li>Your kitten only acts within the rules you set, and asks you before anything else.</li>
      </ul>
    </main>
  );
}
