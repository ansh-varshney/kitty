export const metadata = { title: "Kitty · Privacy" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl p-6 font-sans leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <p className="mt-2 text-sm text-neutral-500">Kitty is a hackathon prototype running on the PayPal sandbox. No real money moves.</p>
      <ul className="mt-4 list-disc space-y-2 pl-5">
        <li>When you log in with PayPal, Kitty receives your name, PayPal account ID and email, and uses the email only to send you sandbox payouts.</li>
        <li>Your budget, limits and reasons for saying no are never shown to other users.</li>
        <li>Kitty does not sell or share your data. Text you send to your kitten is processed by Google Gemini to understand it.</li>
        <li>You can ask for your data to be deleted at any time.</li>
      </ul>
    </main>
  );
}
