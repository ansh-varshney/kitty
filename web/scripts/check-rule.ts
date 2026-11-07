/** Ops: how the kitten maps a typed rule. Run: npx tsx scripts/check-rule.ts "your rule text" */
import { loadEnv } from "../lib/load-env";
loadEnv();
async function main() {
  const { mapRule } = await import("../lib/kitten/ai");
  for (const t of process.argv.slice(2)) console.log(`"${t}" -> ${JSON.stringify(await mapRule(t))}`);
}
void main();
