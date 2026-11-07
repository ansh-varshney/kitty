/** All money in Kitty is integer cents (PRD FR-SEC-2, FR-POUNCE-6). */
export type Cents = number;

export function toCents(dollars: string | number): Cents {
  const s = typeof dollars === "number" ? dollars.toFixed(2) : dollars.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Not a money amount: ${dollars}`);
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return s.startsWith("-") ? -cents : cents;
}

/** "12.34" format for PayPal APIs. */
export function toPayPalValue(cents: Cents): string {
  if (!Number.isInteger(cents)) throw new Error(`Cents must be an integer: ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function usd(cents: Cents) {
  return { currencyCode: "USD", value: toPayPalValue(cents) };
}
