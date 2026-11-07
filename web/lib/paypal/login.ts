import { env, PAYPAL_API_BASE, PAYPAL_WEB_BASE } from "../env";

/**
 * Log in with PayPal (OpenID Connect), PRD FR-ONB-1. Gives us the user's name and verified
 * PayPal email, which becomes their payout address.
 * Needs "Log in with PayPal" enabled on the sandbox app, with this app's return URL listed.
 */

export function loginUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    flowEntry: "static",
    client_id: env().PAYPAL_CLIENT_ID,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri,
    state,
  });
  return `${PAYPAL_WEB_BASE}/signin/authorize?${p.toString()}`;
}

export type PayPalUser = { payerId: string; name?: string; email?: string; emailVerified?: boolean };

export async function exchangeCode(code: string): Promise<PayPalUser> {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = env();
  const tokenRes = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`Log in with PayPal: code exchange failed (${tokenRes.status})`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const infoRes = await fetch(`${PAYPAL_API_BASE}/v1/identity/openidconnect/userinfo?schema=openid`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!infoRes.ok) throw new Error(`Log in with PayPal: userinfo failed (${infoRes.status})`);
  const info = (await infoRes.json()) as { user_id?: string; payer_id?: string; name?: string; email?: string; email_verified?: boolean };
  return {
    payerId: info.payer_id ?? info.user_id ?? "",
    name: info.name,
    email: info.email,
    emailVerified: info.email_verified,
  };
}
