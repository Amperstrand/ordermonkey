import { branchId, orgId, type BranchId, type OrgId } from "./types.js";

/** A parsed welcome target: the (orgId, branchId) identity pair + table binding. */
export interface WelcomeTarget {
  readonly orgId: OrgId;
  readonly branchId: BranchId;
  /**
   * Table QR `?table_no=<n>`; null when absent OR EMPTY — the number is
   * filled per-table at QR-generation time and an empty table_no means
   * dine-in without table binding (spec test-vector: both states).
   */
  readonly tableNo: number | null;
}

function tableNumber(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
}

/**
 * Resolves a welcome URL into its (orgId, branchId) pair — pure string
 * parsing, no network. Accepts:
 *
 *   https://app.ordermonkey.com/welcome/<orgId>/<branchId>?table_no=7
 *   https://app.ordermonkey.com/v2/welcome/<orgId>/<branchId>   (SPA route)
 *   /welcome/<orgId>/<branchId>
 *   <orgId>/<branchId>          (bare pair, "/"-separated)
 *
 * Returns null for other hosts, other paths, or malformed ids.
 */
export function parseWelcomeTarget(input: string): WelcomeTarget | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  let path = trimmed;
  let tableNo: number | null = null;
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (!url.hostname.toLowerCase().endsWith("ordermonkey.com")) return null;
    path = url.pathname;
    tableNo = tableNumber(url.searchParams.get("table_no"));
  }
  const match =
    path.match(/^\/(?:v2\/)?welcome\/([0-9a-fA-F-]+)\/([0-9a-fA-F-]+)\/?$/) ??
    (path === trimmed && !path.startsWith("/") ? trimmed.match(/^([0-9a-fA-F-]+)\/([0-9a-fA-F-]+)\/?$/) : null);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  try {
    return { orgId: orgId(match[1]), branchId: branchId(match[2]), tableNo };
  } catch {
    return null;
  }
}
