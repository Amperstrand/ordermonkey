/**
 * The platform serves THREE localization shapes (spec quirk):
 *
 *  1. JSON-stringified 4-language maps riding as STRING fields inside the
 *     JSON response — `CategoryName: "{\"en\":\"…\",\"de\":\"…\",…}"`.
 *     Parse twice; `en` fallback needed. Map values may be null or empty.
 *  2. Plain strings (`GetOrganizationDetails.Name`).
 *  3. `NameTranslations[]` arrays of `{LanguageCodeType, Text}` on branch
 *     objects (`GetBrandInformation`).
 */

export type NameTranslations = readonly {
  readonly LanguageCodeType?: string;
  readonly Text?: string | null;
}[];

const FALLBACK_ORDER = ["en", "de", "fr", "it"] as const;

/** Some venues key NameTranslations by full language names ("ENGLISH"). */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  english: "en",
  german: "de",
  french: "fr",
  italian: "it",
};

function normalizeLanguage(key: string): string {
  const lowered = key.trim().toLowerCase();
  return LANGUAGE_ALIASES[lowered] ?? lowered;
}

function pickFromMap(map: Map<string, string>): string | null {
  for (const lang of FALLBACK_ORDER) {
    const value = map.get(lang);
    if (value !== undefined) return value;
  }
  const first = map.values().next();
  return first.done ? null : first.value;
}

/**
 * Resolves a localized string field: double-parses JSON-stringified
 * language maps (en → de → fr → it → any non-empty), passes plain strings
 * through, maps empty/absent input to null.
 */
export function localizedText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw === "" ? null : raw;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return raw === "" ? null : raw;
  }
  const map = new Map<string, string>();
  for (const [language, value] of Object.entries(parsed)) {
    if (typeof value === "string" && value !== "") map.set(normalizeLanguage(language), value);
  }
  return pickFromMap(map);
}

/** Resolves the third localization shape: NameTranslations[] arrays. */
export function translationsText(list: NameTranslations | null | undefined): string | null {
  if (list === null || list === undefined) return null;
  const byLanguage = new Map<string, string>();
  for (const entry of list) {
    if (entry.LanguageCodeType === undefined || typeof entry.Text !== "string" || entry.Text === "") continue;
    const key = normalizeLanguage(entry.LanguageCodeType);
    if (!byLanguage.has(key)) byLanguage.set(key, entry.Text);
  }
  return pickFromMap(byLanguage);
}
