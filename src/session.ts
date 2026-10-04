import { asTransportError } from "./error.js";
import { ORDERMONKEY_ORIGIN, postFormJson } from "./http.js";

const TOKEN_PATH = "/api/identity/v100/identity/token";
const REFRESH_COOKIE = "httpOnlyRefreshToken";

export interface GuestSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly refreshCookie: string;
  readonly expiresAtMs: number;
}

interface RawTokenResponse {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
  readonly ip_address?: string;
  readonly may_access?: string | readonly string[];
}

function cookieValue(cookies: readonly string[], name: string): string | null {
  for (const cookie of cookies) {
    if (cookie.startsWith(`${name}=`)) return cookie.slice(name.length + 1);
  }
  return null;
}

/**
 * Posts a token grant. The identity service hard-requires the Origin
 * header (else HTTP 400). The refresh cookie is NOT rotated on refresh —
 * the same value is re-set and stays valid for its 30-day life.
 */
async function tokenGrant(
  form: URLSearchParams,
  cookie: string | null,
  fetchImpl: typeof fetch,
  nowMs: () => number,
): Promise<GuestSession> {
  const result = await postFormJson<RawTokenResponse>(`${ORDERMONKEY_ORIGIN}${TOKEN_PATH}`, form, {
    origin: ORDERMONKEY_ORIGIN,
    ...(cookie === null ? {} : { cookie: `${REFRESH_COOKIE}=${cookie}` }),
  }, fetchImpl);
  if (!result.ok) {
    if (result.kind === "network") throw asTransportError(new Error(result.body));
    throw new Error(`identity token grant failed: HTTP ${result.status} (Origin header present?)`);
  }
  const token = result.value.access_token;
  const expiresIn = result.value.expires_in;
  if (token === undefined || token === "" || expiresIn === undefined) {
    throw new Error("identity token grant: malformed token response");
  }
  const refresh = result.value.refresh_token ?? cookieValue(result.cookies, REFRESH_COOKIE) ?? "";
  const refreshCookie = cookieValue(result.cookies, REFRESH_COOKIE) ?? cookie ?? refresh;
  return {
    accessToken: token,
    refreshToken: refresh,
    refreshCookie,
    expiresAtMs: nowMs() + expiresIn * 1000,
  };
}

/** Anonymous guest session via the custom `authenticate_site` grant (no account, role "anonymous", ~600 s). */
export async function anonymousSession(
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now,
): Promise<GuestSession> {
  return await tokenGrant(new URLSearchParams({ grant_type: "authenticate_site" }), null, fetchImpl, nowMs);
}

/** Refresh grant: new ~420 s access token, refresh cookie not rotated (same value re-set). */
export async function refreshSession(
  session: GuestSession,
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now,
): Promise<GuestSession> {
  return await tokenGrant(
    new URLSearchParams({ grant_type: "refresh_token" }),
    session.refreshCookie,
    fetchImpl,
    nowMs,
  );
}
