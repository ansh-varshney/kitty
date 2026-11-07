/**
 * Kitty's own words, from the PRD glossary (§E1). The kitten explains these from code, never from the model,
 * so "what does paw up mean?" is instant and always right (Phase 1 finding: the model made one up).
 */
export const GLOSSARY: { term: string; match: RegExp; text: string }[] = [
  { term: "Paw up", match: /paw[\s-]?up/i, text: "Paw up means raising your limit when the share goes up, for example when someone drops out. Only the people who are short get asked, privately." },
  { term: "Paw in", match: /paw[\s-]?in/i, text: 'Paw in means saying "I\'m in, up to $X". Your kitten holds that much (savings first, then your Treat Jar, then a PayPal hold). Nobody sees your number.' },
  { term: "Pounce", match: /pounce/i, text: "Pounce is the moment money moves: everyone's share is charged at once and the booker is paid first, before they book." },
  { term: "Whim", match: /whim/i, text: "A whim is an idea for a plan: what, when, up to how much, who, and how many people it needs. Kittens prepare everyone's answer; each person confirms with one tap." },
  { term: "Tag along", match: /tag[\s-]?along/i, text: "Tag along means joining after the Pounce. You pay the new share and everyone else gets the exact difference back." },
  { term: "Cover", match: /\bcover/i, text: "Cover means quietly paying part of a friend's share. It's anonymous by default." },
  { term: "Treat Jar", match: /treat\s?jar/i, text: "Your Treat Jar is your kitten's allowance: money you put in so it can pay small things for you without asking." },
  { term: "Free hand", match: /free\s?hand/i, text: "Free hand is the most your kitten may pay on its own, at a time, from your Treat Jar. It's a permission, not money." },
  { term: "Fun budget", match: /fun\s?budget/i, text: "Your fun budget is how much you want to spend on friends each month, however it's paid. It's a target, not money. Your kitten warns you before you go over." },
  { term: "House Rules", match: /house\s?rules?/i, text: "House Rules are your kitten's mandate: the basics you set at sign-up, rules you type yourself, and squad rules. Code enforces them." },
  { term: "Booker", match: /booker/i, text: "The booker is the friend who books or buys. Kitty pays them first, so nobody fronts money." },
  { term: "Pot", match: /\bpot\b/i, text: "The pot is a plan's shared money. Friends see how full it is, never who put in what." },
  { term: "Need at least", match: /need at least/i, text: "Need at least is how many people the plan needs to happen." },
  { term: "Mini-squad", match: /mini[\s-]?squad/i, text: "A mini-squad is an automatic group made when you send a whim to chosen friends. It's archived after the plan, unless you keep it." },
  { term: "Kitten Diary", match: /diary/i, text: "Your Kitten Diary lists everything your kitten did, why, and the PayPal ID for any money that moved." },
  { term: "Kitty Party", match: /kitty\s?party/i, text: "A Kitty Party is a squad's shared savings. It's used first when you paw in." },
  { term: "Referee", match: /referee/i, text: "The referee is the code that sees everyone's private limits and decides what fits. Kittens never see each other's numbers." },
];

/** "What does X mean?" / "explain X" about a Kitty word → the glossary answer, else null. */
export function explainTerm(message: string): string | null {
  if (!/\b(what|whats|what's|explain|mean|meaning|how does|how do)\b/i.test(message)) return null;
  const hit = GLOSSARY.find((g) => g.match.test(message));
  return hit ? hit.text : null;
}
