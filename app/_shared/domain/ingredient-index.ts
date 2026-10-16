/**
 * Canonical-ingredient lookup.
 *
 * Everything in the app — photos, voice, barcodes, recipes — has to land on the same
 * ingredient id, so every name the user or the model produces passes through here.
 *
 * Built once per request and reused: construction is O(total names) and each lookup
 * is O(1). Resolving a 30-line recipe against 500 canonical ingredients must never
 * become a 15,000-comparison scan, which is what a `find()` per line would cost.
 */

export type CanonicalIngredient = {
  id: string;
  name_en: string;
  name_nl: string;
  aliases: string[];
  category: string;
  is_staple: boolean;
};

export type CanonicalGear = {
  id: string;
  name_en: string;
  name_nl: string;
  aliases: string[];
  category: string;
};

/**
 * Lowercase, strip diacritics, drop punctuation, collapse whitespace.
 *
 * Deliberately NOT stemming or de-pluralising: English and Dutch plurals disagree
 * too often ("tomaten", "uien", "kruidnagels") and a wrong stem silently matches the
 * wrong ingredient. Plurals belong in the `aliases` column, where a human can see them.
 */
export function normalizeName(raw: string): string {
  return (
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Invisible formatting characters are DELETED, not turned into spaces. A soft hyphen or
      // zero-width space picked up from copied web text would otherwise split "sha-llot" into
      // "sha llot", which matches nothing — so an ingredient already in the kitchen silently
      // joins the shopping list.
      .replace(/[\p{Cf}\u00ad]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * A comparison key that stays distinct for names `normalizeName` cannot represent.
 *
 * `normalizeName` keeps only `[a-z0-9 ]`, so a name written in a non-Latin script collapses to
 * the empty string — and then every such name compares equal to every other, which is how a
 * patch comes to edit the wrong ingredient line. Falling back to the trimmed, lower-cased
 * original keeps them apart.
 */
export function nameKey(raw: string): string {
  const normalized = normalizeName(raw);
  return normalized.length > 0 ? normalized : raw.trim().toLowerCase();
}

/** True when two names refer to the same ingredient as far as a patch is concerned. */
export function sameName(left: string, right: string): boolean {
  return nameKey(left) === nameKey(right);
}


export type NameIndex<T> = {
  /** Normalized name or alias -> entry. */
  readonly byName: ReadonlyMap<string, T>;
  readonly byId: ReadonlyMap<string, T>;
};

type Named = { id: string; name_en: string; name_nl: string; aliases: string[] };

/**
 * First writer wins on a collision, so a canonical name always beats another
 * ingredient's alias. Entries are indexed in list order, which the seed data keeps
 * stable, so the resolution of an ambiguous alias does not change between runs.
 */
export function buildNameIndex<T extends Named>(entries: readonly T[]): NameIndex<T> {
  const byName = new Map<string, T>();
  const byId = new Map<string, T>();

  // Canonical names first, then aliases, so an alias can never shadow a real name.
  for (const entry of entries) {
    byId.set(entry.id, entry);
    for (const name of [entry.name_en, entry.name_nl]) {
      const key = normalizeName(name);
      if (key.length > 0 && !byName.has(key)) byName.set(key, entry);
    }
  }
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      const key = normalizeName(alias);
      if (key.length > 0 && !byName.has(key)) byName.set(key, entry);
    }
  }

  return { byName, byId };
}

/**
 * Exact match on the normalized name only.
 *
 * Fuzzy matching lives in the model, not here: the parse step asks Claude to map a
 * photo or a spoken phrase onto a canonical name, and this function decides whether
 * that name actually exists. Keeping the boundary sharp is what makes the review
 * card's confidence numbers mean anything.
 */
export function resolveName<T>(index: NameIndex<T>, raw: string): T | undefined {
  return index.byName.get(normalizeName(raw));
}
