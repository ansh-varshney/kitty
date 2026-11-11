# Kitty: Devpost entry

Fields in the order Devpost asks for them. Still to fill in: the video link and the judge login.

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
- **Your budget stays private,** and your kitten still speaks for you.
- **The money balances to the cent,** checked by more than 180 edge-case tests and end-to-end runs on the real sandbox.
- **It feels alive.** A kitten that blinks, reacts and celebrates with you.

### What we learned

- **People don't avoid money. They avoid the conversation.** So Kitty removes the conversation instead of just recording it.
- **AI for words, code for money.** It made Kitty both smarter and safer.
- **Limits can become features.** The sandbox doesn't allow saved cards, so a kitten can't charge you whenever it likes. That limit became the Treat Jar: an allowance your kitten spends within your rules, and nothing more.
- **Use your own app like a real person.** My tests passed, but using Kitty as my sandbox friends found the bugs that mattered most.

### What's next for Kitty

- **Real friend groups:** put Kitty in their hands and watch where they get stuck.
- **Bring it home:** take Kitty to India with a local payment partner.
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
Open https://kitty-web.onrender.com on a phone or laptop and tap **Log in with PayPal**. Sign in with this PayPal sandbox account: (the judge login, yours to add), or any PayPal sandbox personal account. It runs on the PayPal sandbox, so no real money moves.

---

## Longer version of the story (kept for reference)
The fuller draft of the same story, in case you want to swap any section back in.

### Inspiration

Every friend group has the same few moments.

Someone says "we should do something!" Everyone says "I'm in." One person books it and pays for all of it. Then for weeks they quietly try to get the money back without sounding petty. Someone else never says "that's too much for me," so they pay for a trip they can't really afford, or they just stop showing up.

I've watched this happen in my own friend groups more times than I can count. Nobody fights about money. They avoid it, and the avoiding is what slowly hurts the friendship.

It turns out it's not just us:

- **76%** of Gen Z who fronted money for a group were never fully paid back (Zelle, 2025).
- **82%** of group travellers would pay *more* than their share just to avoid a money argument (CIT Bank, 2026).
- **1 in 5** have muted a group chat or cancelled plans to dodge a pay-back conversation (Zelle, 2025).

The name comes from home. In India, a *kitty party* is a group of friends who put money into a shared pot every month. "Putting money in the kitty" is how friends have pooled money for generations. I wanted that same warmth, without the notebook, the chasing and the awkward reminders.

Then came the agent part. This year everyone is getting a personal AI agent, but most of them deal with businesses on your behalf. Nobody had given each friend an agent that speaks *for them, to their friends*. So in Kitty, everyone adopts a kitten.

### What it does

Kitty helps friends plan, pay and save together, without anyone fronting money, chasing debts or overspending.

Every user adopts a **kitten**: a personal AI agent that knows their calendar, their budget and their limits. It keeps all of that private, and it only moves money within the rules they set.

How a plan works:

1. **Float a whim.** "Go-karting Saturday, $40 each, need at least 4." Type it, or share a screenshot of the group chat, and your kitten reads it.
2. **Kittens prepare answers.** Each friend's kitten checks their calendar and private budget, and suggests Yes, No or Negotiate with a one-line reason. One tap confirms.
3. **Saying yes means paying.** Your share is set aside from your **Treat Jar** (your kitten's allowance, topped up through PayPal) in the same tap. No more "I'll pay you later."
4. **Kittens negotiate for you.** Too expensive, or a bad weekend? Your kitten asks the host's kitten for another time or price. It never says why. Your budget stays yours.
5. **Pounce!** Once enough people are in, the host taps Pounce. The whole pot goes to the person booking it *before* they book. Nobody fronts a cent.
6. **After.** Add the receipt and any leftovers go back to everyone. Someone wants to join late? They tag along, and everyone else gets the difference back.

Around that:

- **Yarn** (who owes whom): the everyday "I paid for you" moments, settled in the fewest payments. The kittens do the reminding, so you never have to.
- **Kitty Party:** the squad saves a little every month for the next trip.
- **The Bowl:** shared subscriptions, collected every month.
- **Nine Lives:** a friend in a tight spot can ask privately, and friends' kittens suggest help within their owners' rules.
- **Catnip:** a secret group birthday gift that disappears after the birthday.
- **My Month:** what your friendships cost you this month, next to your own fun budget.

Everything runs on real PayPal sandbox accounts. There is no demo mode: you log in with PayPal and use it like anyone else.

### How we built it

I built Kitty alone, in about a week, with an AI coding assistant (Claude Code) as my pair.

**I wrote the spec before the code.** Kitty has a product requirements document that I kept updating the whole way through. It went from version 1.0 to 1.45. Every change I wanted while testing went into that document first, then into the app. When you're building alone, that document is what keeps the product from drifting.

**The stack**

- **App:** Next.js 16, TypeScript, React 19 and Tailwind, built mobile-first. On a laptop it shows inside a phone frame, because it should feel like an app, not a website.
- **Hosting:** Render, for the app and the Postgres database.
- **PayPal:** Log in with PayPal is the only way in. PayPal Orders handle every Treat Jar top-up. PayPal Payouts pay the booking and send money back. Every PayPal webhook is signature-verified. The Orders code uses the PayPal Server SDK, written with the APIMatic Context Plugin.
- **AI:** Groq first (`gpt-oss-20b` for text, `qwen3.8-27b` for screenshots and receipts), Gemini as a backup, and plain code as the last fallback, so the app keeps working even when a model is down.

**One rule shaped everything: AI handles words, code handles money.**

The AI reads chats, screenshots and receipts, prepares answers and writes every kitten's messages. It never decides an amount, and it never moves money. A plain piece of code I call the **referee** is the only part that sees everyone's private limits. It works out who fits, splits the money and enforces each person's rules. Each kitten's prompt only ever holds its own owner's data, so a kitten can't leak what it doesn't know.

Money is stored in whole cents in a double-entry ledger, and shares always add up exactly. For a price of \\( P \\) cents split between \\( n \\) friends:

$$\text{each share} = \left\lfloor \frac{P}{n} \right\rfloor \text{ cents, and } (P \bmod n) \text{ friends pay one cent more}$$

So $680 between 6 friends becomes two shares of $113.34 and four of $113.33. And for every single plan, the code checks:

$$\text{money collected} = \text{money paid out} + \text{money refunded}$$

to the cent.

**Design.** I wanted Kitty to feel like a game with friends, not a banking app. Finch, Duolingo and Town were my references for that feeling. The kitten is drawn entirely in code. You pick its fur, pattern, eyes and accessory, and it does the rest: it blinks, dozes, and changes its mood and pose with what's happening, like leaping when the host Pounces. Every money action plays a small moment, so you can actually *see* where your money went.

### Challenges we ran into

**1. Finding an idea worth a week.**
I spent the first two days not building at all. I explored a safety layer that stops AI agents paying the wrong person, a tool for friends racing through a concert ticket queue, an AI money manager, savings circles, and even friends clubbing food delivery orders to save on fees. Each one made sense. None of them hooked me. The ticket idea made a great demo but a thin product. The money manager was up against the biggest companies in the world. Savings circles mattered, but they didn't feel fun. What finally clicked was smaller and more personal: give every friend an agent, and let the agents deal with the money so the friends don't have to. Savings circles didn't disappear. They became Kitty Party, one tab inside the app.

**2. The idea came from India, but it can't be used there yet.**
PayPal stopped domestic payments in India in 2021, and payouts don't work from an Indian sandbox merchant account. So I built Kitty for US friend groups, set up a US sandbox business account to act as Kitty, and created a set of US sandbox friends to test with. It's a strange feeling to build something inspired by your own friends that they can't use yet.

**3. Privacy and negotiation pull in opposite directions.**
To find a plan that works for everyone, something has to know everyone's budget. But nobody should ever see anyone else's. The answer was to keep that knowledge in the referee's code, never in the AI and never on screen. Ask your kitten how much money a friend has, and their kitten will politely tell you it never shares anything about money.

**4. Stopping kittens from arguing forever.**
Two agents negotiating can go back and forth endlessly. So the rules are strict and simple: one try per person, one negotiation at a time, at most two changes, and never more than 25% off the price.

**5. The product kept changing as I used it, and that was the point.**
I tested Kitty by logging in as different friends, and some of the biggest changes came from that. Once, I joined a plan and Kitty opened a *separate* PayPal payment, even though I had money sitting in my Treat Jar. That made the jar pointless, so now every payment comes from the jar. Later I noticed plans could still change after people had paid, so I moved all the deciding into the whim: the whim decides, the plan only collects. Near the end, I made agreeing and paying a single step, because "yes, I'll pay later" is exactly the problem Kitty exists to fix.

**6. Free AI was not reliable.**
On day three, Gemini's free tier stalled for over an hour, and its Flash model allowed only 20 requests a day. I moved to Groq first, with Gemini as the backup and code as the last resort. I also learned not to trust a model with dates and money: one put "Friday 7pm" on a Wednesday. Now code reads dates and amounts, and the AI fills in the rest.

**7. Real money bugs only show up when you use it for real.**
A $50 top-up went through on PayPal but never reached the jar, because the app read the payment's tag from the wrong place. Another time a friend tagged along, $100 left his jar, and then the next step crashed: nobody got their refund, and he wasn't added. Taking the money and paying it out are now one step, so they succeed or fail together. Bugs like these became tests.

**8. Doing it all alone, against the clock.**
Product, design, backend, AI, PayPal setup, testing and this write-up, solo, in about a week. I hit usage limits in the middle of designing, and my design tool only allowed 100 AI calls a week. Deciding what *not* to build was a big part of the work. Dares, seat swaps and a few other fun ideas were cut on day two.

### Accomplishments that we're proud of

- **Nobody fronts money.** The person booking is paid before they book, every time.
- **It's real.** Real PayPal sandbox accounts, real orders, real payouts and verified webhooks. No demo mode, nothing simulated.
- **Your budget stays private, and your kitten still speaks for you.** Kittens negotiate with each other without ever revealing why.
- **The money always balances, to the cent.** More than 180 edge-case tests (double taps, people leaving mid-plan, timers firing twice, someone undoing an action after others acted), plus end-to-end tests that move real sandbox money.
- **It feels alive.** A kitten drawn in code that blinks, reacts and celebrates with you.
- **A spec that kept up.** 45 versions in a week, and the app matches the latest one.

### What we learned

- **People don't avoid money because of the money. They avoid the conversation.** So the product has to remove the conversation, not just record it. That's why the kittens do the asking and the reminding.
- **Let AI handle the words and code handle the money.** It made Kitty both smarter and safer.
- **Limits can become features.** PayPal's sandbox doesn't allow saved cards for an app like this, so a kitten can't just charge you whenever it likes. That limit became the Treat Jar: an allowance your kitten can spend within your rules, and nothing more.
- **Fast beats brilliant.** In a chat with friends, an answer in half a second matters more than a perfect one in five.
- **Use your own app like a real person.** My tests passed. Using it as my sandbox friends still found the bugs that mattered most.
- **Write it down first.** Updating the spec before every change is what let one person build something this big without losing track.

### What's next for Kitty

- **Real friend groups.** Put Kitty in the hands of a few real groups and watch where they get stuck.
- **Bring it home.** Kitty was inspired in India. I want to take it there with a local payment partner.
- **Live mode** on PayPal, with the right setup for holding group money safely.
- **Kittens where the chat already happens.** Today you share a screenshot of the group chat. Next, Kitty inside the chat itself, wherever the platforms allow it.
- **A native mobile app** with notifications, so your kitten can tap you on the shoulder.
- **Pay anywhere from the jar,** including website checkouts, so the person booking never has to move money out first.
