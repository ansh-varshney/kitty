import { connection } from "next/server";
import { dispatch } from "@/lib/api/router";

/** All of /api/v1/* goes through one route table (lib/api/router.ts). */
type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: Ctx) {
  await connection();
  return dispatch(req, (await ctx.params).path);
}
export async function POST(req: Request, ctx: Ctx) {
  return dispatch(req, (await ctx.params).path);
}
export async function DELETE(req: Request, ctx: Ctx) {
  return dispatch(req, (await ctx.params).path);
}
