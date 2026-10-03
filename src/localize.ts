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

function pickFromMap(map: Record<string, unknown>): string | null {
  for (const lang of FALLBACK_ORDER) {
    const value = map[lang];
    if (typeof value === "string" && value !== "") return value;
  }
  // Last resort: any non-empty language value.
  for (const value of Object.values(map)) {
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
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
  return pickFromMap(parsed as Record<string, unknown>);
}

/** Resolves the third localization shape: NameTranslations[] arrays. */
export function translationsText(list: NameTranslations | null | undefined): string | null {
  if (list === null || list === undefined) return null;
  const byLanguage = new Map<string, string>();
  for (const entry of list) {
    if (entry.LanguageCodeType === undefined || typeof entry.Text !== "string" || entry.Text === "") continue;
    if (!byLanguage.has(entry.LanguageCodeType)) byLanguage.set(entry.LanguageCodeType, entry.Text);
  }
  for (const lang of FALLBACK_ORDER) {
    const value = byLanguage.get(lang);
    if (value !== undefined) return value;
  }
  const first = byLanguage.values().next();
  return first.done ? null : first.value;
}
