/**
 * Channel3 product search (sponsor; PRD §B14 FR-NIP-4). POST https://api.trychannel3.com/v1/search with x-api-key.
 * Prices in the request and response are dollars. Free key at trychannel3.com (code PAYPAL-HACKATHON-2026).
 */

export type GiftProduct = { title: string; priceCents: number | null; url: string | null; imageUrl: string | null; brand: string | null };

type C3Product = {
  title?: string;
  brands?: { name?: string }[];
  images?: { url?: string; cleaned_url?: string }[];
  offers?: { url?: string; price?: { price?: number; currency?: string } }[];
};

export function channel3Configured() {
  return Boolean(process.env.CHANNEL3_API_KEY);
}

export async function searchProducts(opts: { query: string; maxDollars: number; gender?: "male" | "female" | null; limit?: number }): Promise<GiftProduct[]> {
  const key = process.env.CHANNEL3_API_KEY;
  if (!key) throw new Error("CHANNEL3_API_KEY is not set");
  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: opts.query.slice(0, 200),
      limit: Math.min(opts.limit ?? 8, 30),
      filters: { price: { min_price: 5, max_price: Math.max(5, Math.floor(opts.maxDollars)) }, ...(opts.gender ? { gender: opts.gender } : {}) },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Channel3 ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = (await res.json()) as { products?: C3Product[] };
  return (body.products ?? []).map((p) => {
    const offer = p.offers?.find((o) => o.price?.price != null) ?? p.offers?.[0];
    return {
      title: (p.title ?? "Gift idea").slice(0, 120),
      priceCents: offer?.price?.price != null ? Math.round(offer.price.price * 100) : null,
      url: offer?.url ?? null,
      imageUrl: p.images?.[0]?.cleaned_url ?? p.images?.[0]?.url ?? null,
      brand: p.brands?.[0]?.name ?? null,
    };
  });
}
