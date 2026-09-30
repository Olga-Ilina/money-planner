// Amounts in cents: the one rounding the whole app uses (the screens' formatMoney shows it too).

/**
 * Rounded to cents, half away from zero, the same for negative amounts (-12.345 → -12.35). The
 * amount is read as the decimal it was meant to be (12.345 is stored as 12.3449999…), and -0 or a
 * tiny negative becomes 0, so it never shows as «-0,00 €». What is not a finite number stays as it is.
 */
export function roundCents(n: number): number {
  if (!Number.isFinite(n)) return n;
  const scaled = Number((Math.abs(n) * 100).toPrecision(15));
  const r = (Math.sign(n) * Math.round(scaled)) / 100;
  return r === 0 ? 0 : r;
}
