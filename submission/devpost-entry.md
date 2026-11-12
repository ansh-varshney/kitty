# Kitty: Devpost entry

Fields in the order Devpost asks for them. Still to fill in: the video link.

---

## Project name
Kitty

## Elevator pitch
Plans with friends, minus the chasing. Your AI kitten handles the money. You just show up!

## About the project
Paste everything under this heading into Devpost's "About the project" box. Devpost renders the Markdown and the LaTeX. In Devpost the section headings are `##` (they're one level down here only so this file reads cleanly).

### Inspiration

Every friend group has the same few moments. Someone says "we should do something!" Everyone says "I'm in." One person books it and pays for everyone, then spends weeks trying to get the money back without sounding petty. Someone else never says "that's too much for me," so they quietly overpay, or stop showing up.

I've watched this happen in my own friend groups more times than I can count. Nobody fights about money. They avoid it, and the avoiding is what slowly hurts the friendship.

It's not just us. **76%** of Gen Z who fronted money for a group were never fully paid back, and **1 in 5** have muted a chat or cancelled plans to dodge a pay-back conversation (Zelle, 2025).

The name comes from home. In India, a *kitty party* is a group of friends putting money into a shared pot every month. I wanted that warmth, without the chasing and the awkward reminders. And while everyone is getting a personal AI agent this year, most of them deal with businesses. Nobody had given each friend an agent that speaks *for them, to their friends*. So in Kitty, everyone adopts a kitten.

### What it does

Kitty helps friends plan, pay and save together, without anyone fronting money, chasing debts or overspending.

Every user adopts a **kitten**: a personal AI agent that knows their calendar, budget and limits, keeps them private, and only moves money within the rules they set.

1. **Float a whim.** "Go-karting Saturday, $40 each, need at least 4." Type it, or share a screenshot of the group chat.
2. **Kittens prepare answers.** Each friend's kitten checks their calendar and private budget, then suggests Yes, No or Negotiate with a one-line reason. One tap confirms.
3. **Yes means paying.** Your share comes from your **Treat Jar** (your kitten's allowance, topped up through PayPal) in the same tap. No more "I'll pay you later."
4. **Kittens negotiate for you.** Your kitten asks the host's kitten for another time or price, without ever saying why.
5. **Pounce!** Once enough people are in, the pot goes to the person booking *before* they book. Nobody fronts a cent.
6. **After.** Leftovers from the receipt go back to everyone, and late friends can tag along.

There's also **Yarn** (who owes whom, with kittens doing the reminding), **Kitty Party** (saving together), **The Bowl** (shared subscriptions), **Nine Lives** (helping a friend in a tight spot), **Catnip** (group birthday gifts) and **My Month** (what your friendships cost you, next to your fun budget).

It all runs on real PayPal sandbox accounts. There's no demo mode: you log in with PayPal and use it like anyone else.

### How we built it

I built Kitty solo in about a week, with an AI coding assistant (Claude Code) as my pair. I wrote the spec before the code and updated it before every change. It went from version 1.0 to 1.45.

- **App:** Next.js 16, TypeScript, React 19 and Tailwind. Mobile-first, and shown in a phone frame on a laptop, because it should feel like an app.
- **Hosting:** Render, for the app and its Postgres database.
- **PayPal:** Log in with PayPal, Orders for Treat Jar top-ups, Payouts for paying bookings and returning money, and signature-verified webhooks. The Orders code uses the PayPal Server SDK, written with the APIMatic Context Plugin.
- **AI:** Groq first, Gemini as a backup, and plain code as the last fallback, so Kitty keeps working when a model is down.

**One rule shaped everything: AI handles words, code handles money.** The AI reads chats, screenshots and receipts, and writes every kitten's messages. It never decides an amount and never moves money. A plain piece of code I call the **referee** is the only part that sees everyone's private limits.

Money is kept in whole cents. For a price of \\( P \\) cents split between \\( n \\) friends:

$$\text{each share} = \left\lfloor \frac{P}{n} \right\rfloor \text{ cents, and } (P \bmod n) \text{ friends pay one cent more}$$

And every plan has to pass this check, to the cent:

$$\text{money collected} = \text{money paid out} + \text{money refunded}$$

**Design.** I wanted a game with friends, not a banking app. The kitten is drawn entirely in code. It blinks, dozes and leaps when the host Pounces, and every money action plays a small moment, so you can see where your money went.

### Challenges we ran into

**Finding an idea worth a week.** I spent the first two days not building at all. A safety layer for AI payments, a concert-ticket tool, an AI money manager, savings circles: each made sense, but none of them hooked me. What clicked was smaller and more personal: give every friend an agent, and let the agents handle the money. Savings circles survived as Kitty Party.

**The idea came from India, but it can't be used there yet.** PayPal stopped domestic payments in India in 2021, so I built for US friend groups, with a US sandbox business account acting as Kitty. It's a strange feeling to build something inspired by your friends that they can't use yet.

**Privacy and negotiation pull in opposite directions.** To find a plan that fits, something has to know everyone's budget, but nobody should see anyone else's. So that knowledge lives only in the referee's code. Ask a friend's kitten about their money and it politely refuses.

**The product changed as I used it.** I tested Kitty by logging in as different friends. Once, joining a plan opened a *separate* PayPal payment even though my Treat Jar had money in it, which made the jar pointless. Now every payment comes from the jar. Near the end, I made agreeing and paying one step, because "I'll pay later" is exactly the problem Kitty exists to fix.

**Free AI wasn't reliable.** On day three, Gemini's free tier stalled for over an hour. I moved to Groq first, with fallbacks all the way down to plain code. One model also put "Friday 7pm" on a Wednesday, so now code reads dates and amounts, and the AI fills in the rest.

**Real money bugs.** A $50 top-up went through on PayPal but never reached the jar. Another time a friend tagged along, $100 left his jar, and the next step crashed before anyone got their refund. Taking money and paying it out are now one step that succeeds or fails together, and each bug became a test.

**Solo, against the clock.** Product, design, code, testing and this write-up, all alone. Deciding what *not* to build was half the work.

### Accomplishments that we're proud of

- **Nobody fronts money.** The person booking is paid before they book.
- **It's real.** Real sandbox accounts, orders, payouts and webhooks. Nothing is simulated.
- **Your budget stays private,** and your kitten still speaks for you. Only the referee's code ever sees everyone's limits.
- **It feels alive.** A kitten that blinks, reacts and celebrates with you.
- **Saying yes and paying are one step.** Your share is set aside in the same tap, so a yes can never turn into "I'll pay later".
- **The money balances to the cent.** Every amount is whole cents in a double-entry ledger that can never go negative, and every plan has to pass the check above.
- **Nothing gets charged twice.** Money actions run one at a time, and every PayPal call carries its own request ID, so a double tap, a retry or a timer firing twice can't move money twice.
- **Money moves all at once, or not at all.** When someone tags along, their share, the host's yes and everyone's refunds go through in one step.
- **Kittens answer in under a second,** with Gemini and plain code standing by when a model is down.
- **Tested like it's real money:** 197 edge-case tests, 34 end-to-end runs on the real sandbox and 104 unit tests.

### What we learned

- **People don't avoid money. They avoid the conversation.** So Kitty removes the conversation instead of just recording it.
- **AI for words, code for money.** It made Kitty both smarter and safer.
- **Limits can become features.** The sandbox doesn't allow saved cards, so a kitten can't charge you whenever it likes. That limit became the Treat Jar: an allowance your kitten spends within your rules, and nothing more.
- **Use your own app like a real person.** My tests passed, but using Kitty as my sandbox friends found the bugs that mattered most.
- **Money code has to succeed or fail as a whole.** Every bug that really hurt was a payment that got halfway: money left one jar and never reached the next. Putting each money move in a single step made those bugs impossible, not just rare.
- **A retry is only safe if it can't pay twice.** PayPal's SDK doesn't retry on its own. Turning retries on was safe only because every call has its own request ID, so PayPal sees a retry as the same payment.
- **Don't let a model do dates or sums.** Code reads amounts and dates, and the AI fills in the words.
- **Fast beats brilliant.** In a chat with friends, an answer in half a second matters more than a perfect one in five.

### What's next for Kitty

- **Real friend groups:** put Kitty in their hands and watch where they get stuck.
- **Live mode** on PayPal, with the right setup for holding group money safely.
- **Kittens inside the group chat,** wherever the platforms allow it.
- **A native mobile app** with notifications, so your kitten can tap you on the shoulder.

## Built with
PayPal, PayPal Server SDK, PayPal Payouts, Log in with PayPal, PayPal Webhooks, APIMatic, Groq, Gemini, Next.js, React, TypeScript, Tailwind CSS, PostgreSQL, Render, Claude Code

## Try it out (links)
- Live app: https://kitty-web.onrender.com
- Code: https://github.com/ansh-varshney/kitty
- Video: (yours)

## Testing notes for judges
Open https://kitty-web.onrender.com on a phone or laptop and tap **Log in with PayPal**, then sign in with this PayPal sandbox account:

- **Email:** kitty.judge@personal.example.com
- **Password:** KittyJudge

The judge account is already in a squad with friends, with entries and rules set up, so every part of the app has something to explore. It runs on the PayPal sandbox, so no real money moves.
