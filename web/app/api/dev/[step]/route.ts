import { runStep, STEPS } from "@/lib/spike/steps";
import { devAllowed } from "@/lib/dev-auth";

export async function POST(req: Request, ctx: { params: Promise<{ step: string }> }) {
  if (!devAllowed(req)) return Response.json({ ok: false, summary: "Wrong or missing dev key." }, { status: 401 });
  const { step } = await ctx.params;
  if (!STEPS[step]) return Response.json({ ok: false, summary: `Unknown step: ${step}` }, { status: 404 });
  const result = await runStep(step);
  return Response.json(result);
}
