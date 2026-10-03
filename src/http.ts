import { isTransportFailure } from "./error.js";
import type { BranchId, OrgId } from "./types.js";

export const ORDERMONKEY_ORIGIN = "https://app.ordermonkey.com";
export const USER_AGENT = "ordermonkey/0.1";

/**
 * Public platform constants every app bundle ships (spec fingerprint
 * prefixes c0d8c6f8 / 8F040955 — recoverable from main.*.js on rotation).
 * Reads are gated on these, but they are platform keys, not secrets.
 */
export const BUNDLE_GATEWAY_KEY = "c0d8c6f8045c45c68e7e159de76f4067";
export const BUNDLE_TENANT_ID = "8F040955-8038-49D7-93E1-6A9C3B4F9EEC";

/** Every CmsGateway read is a GET with the same four load-bearing headers. */
export function readHeaders(org: OrgId, branch: BranchId): Record<string, string> {
  return {
    "user-agent": USER_AGENT,
    accept: "application/json",
    ApiKey: BUNDLE_GATEWAY_KEY,
    TenantId: BUNDLE_TENANT_ID,
    OrganizationId: org,
    BranchId: branch,
  };
}

export interface JsonResult<T> {
  readonly ok: true;
  readonly value: T;
}

export interface JsonFailure {
  readonly ok: false;
  /**
   * "network" = transport failure (thrown, timeout, DNS) — surfaced to the
   * caller as a thrown OrderMonkeyError by the client.
   * "http" = server answered with an error status (the 404
   * `No data found` envelope of a tier-2/tier-3 branch is one of these).
   * "parse" = 2xx body that is not JSON.
   */
  readonly kind: "http" | "network" | "parse";
  readonly status: number;
  readonly body: string;
}

export type FetchJsonResult<T> = JsonResult<T> | JsonFailure;

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchJsonResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    if (!isTransportFailure(error)) throw error;
    return {
      ok: false,
      kind: "network",
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    };
  }
  const text = await response.text();
  if (!response.ok) {
    return { ok: false, kind: "http", status: response.status, body: text.slice(0, 500) };
  }
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, kind: "parse", status: response.status, body: text.slice(0, 500) };
  }
}
