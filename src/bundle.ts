import { fetchText, ORDERMONKEY_ORIGIN, type BundleKeys } from "./http.js";

const MAIN_SCRIPT = /src=["']([^"']*main\.[0-9a-f]+\.js)["']/;
const GATEWAY_LITERAL = /apiKey\s*[:=]\s*"([0-9a-f]{32})"/g;
const TENANT_LITERAL = /tenantId\s*[:=]\s*"([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})"/g;

function distinctLiterals(text: string, pattern: RegExp, what: string): string {
  const values = [...new Set(text.match(pattern) ?? [])].map((match) =>
    match.slice(match.indexOf('"') + 1, -1),
  );
  if (values.length !== 1) {
    throw new Error(`bundle recovery: ${what} literal ambiguous or missing (${values.length} distinct)`);
  }
  return values[0] ?? "";
}

/**
 * Re-derives the public bundle constants (ApiKey/TenantId lane names in
 * the app bundle: `apiKey:"…"` / `tenantId:"…"`) by fetching the SPA
 * index, locating main.<hash>.js, and extracting the literals. Exactly
 * one distinct value per literal is required — ambiguity throws instead
 * of guessing. Used by the client's one-shot 401 rescue and by
 * operators after a key rotation.
 */
export async function recoverBundleConstants(
  fetchImpl: typeof fetch = fetch,
  origin: string = ORDERMONKEY_ORIGIN,
): Promise<BundleKeys> {
  const index = await fetchText(`${origin}/`, {
    headers: { accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(20_000),
  }, fetchImpl);
  if (!index.ok) throw new Error(`bundle recovery: index fetch failed (${index.kind === "http" ? `HTTP ${index.status}` : index.body})`);
  const script = index.text.match(MAIN_SCRIPT)?.[1];
  if (script === undefined) throw new Error("bundle recovery: no main.*.js script in app index");
  const bundleUrl = new URL(script, origin).toString();
  const bundle = await fetchText(bundleUrl, {
    headers: { accept: "application/javascript,*/*" },
    signal: AbortSignal.timeout(20_000),
  }, fetchImpl);
  if (!bundle.ok) throw new Error(`bundle recovery: bundle fetch failed (${bundle.kind === "http" ? `HTTP ${bundle.status}` : bundle.body})`);
  return {
    gatewayKey: distinctLiterals(bundle.text, GATEWAY_LITERAL, "gateway"),
    tenantId: distinctLiterals(bundle.text, TENANT_LITERAL, "tenant"),
  };
}
