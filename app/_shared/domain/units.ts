/**
 * Metric-only measurement units. The cooking prompt guarantees metric output, so
 * there is deliberately no imperial member here — an imperial amount from the model
 * is a schema violation we want to see, not silently accept.
 *
 * Adding a unit: append to UNITS and give it a Dutch label in UNIT_LABELS_NL.
 * Nothing else switches on this list.
 */
export const UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'tsp',
  'tbsp',
  'piece',
  'clove',
  'bunch',
  'handful',
  'pinch',
  'slice',
  'can',
  'pack',
  'to_taste',
] as const;

export type Unit = (typeof UNITS)[number];

/** Dutch labels, for the Ingredients tab's Dutch column. */
export const UNIT_LABELS_NL: Record<Unit, string> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  tsp: 'tl',
  tbsp: 'el',
  piece: 'stuk',
  clove: 'teen',
  bunch: 'bosje',
  handful: 'handvol',
  pinch: 'snufje',
  slice: 'schijf',
  can: 'blik',
  pack: 'pak',
  to_taste: 'naar smaak',
};

/** Units that carry no number, so the UI omits the amount entirely. */
const UNITLESS: ReadonlySet<Unit> = new Set<Unit>(['to_taste']);

/** Units written flush against the number: "200g", not "200 g". */
const FLUSH_WITH_NUMBER: ReadonlySet<Unit> = new Set<Unit>(['g', 'kg', 'ml', 'l']);

/**
 * One decimal place at most. A cook screen is read at arm's length, so "1.5 tbsp"
 * is useful and "1.5000000000000002 tbsp" is not.
 */
function formatNumber(amount: number): string {
  const rounded = Math.round(amount * 10) / 10;

  // A positive amount must never render as "0" — "0g" reads as "use none of this". Anything
  // that rounds away at one decimal place keeps a single significant digit instead.
  if (rounded === 0 && amount > 0) {
    return String(Number(amount.toPrecision(1)));
  }
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatAmount(amount: number, unit: Unit, locale: 'en' | 'nl'): string {
  const label = locale === 'nl' ? UNIT_LABELS_NL[unit] : unit;

  if (UNITLESS.has(unit)) {
    return label;
  }

  const number = formatNumber(amount);
  const separator = FLUSH_WITH_NUMBER.has(unit) ? '' : ' ';
  return `${number}${separator}${label}`;
}
