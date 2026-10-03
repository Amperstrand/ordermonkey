export type OrgId = string & { readonly __brand: "OrgId" };
export type BranchId = string & { readonly __brand: "BranchId" };

const HEX32 = /^[0-9a-f]{32}$/;
const HEX_RANGE = /^[0-9a-f]{30,40}$/;

function hex32(value: string): string {
  const stripped = value.trim().toLowerCase().replace(/-/g, "");
  if (!HEX32.test(stripped)) {
    throw new Error(`invalid id (expected 32 hex, dashes optional): ${value}`);
  }
  return stripped;
}

/**
 * Parse an organization id. Welcome links carry a dashed hex form whose
 * TOTAL length is not guaranteed to be 32 — live links exist with 33 hex
 * (non-UUID groups), so anything from 30 to 40 hex is accepted. Dashed
 * input is preserved verbatim (lowercased); undashed input must be
 * exactly 32 hex and is re-dashed 8-4-4-4-12.
 */
export function orgId(value: string): OrgId {
  const trimmed = value.trim().toLowerCase();
  const stripped = trimmed.replace(/-/g, "");
  if (!HEX_RANGE.test(stripped)) {
    throw new Error(`invalid org id (expected dashed hex, 30-40 hex chars): ${value}`);
  }
  if (trimmed.includes("-")) return trimmed as OrgId;
  if (!HEX32.test(stripped)) {
    throw new Error(`invalid org id (undashed form must be exactly 32 hex): ${value}`);
  }
  return `${stripped.slice(0, 8)}-${stripped.slice(8, 12)}-${stripped.slice(12, 16)}-${stripped.slice(16, 20)}-${stripped.slice(20, 32)}` as OrgId;
}

/**
 * Parse a branch id. The canonical platform form is undashed 32-hex (the
 * form welcome links and salesOrderDraftV2PilotBranches use); dashed input
 * is normalized to it.
 */
export function branchId(value: string): BranchId {
  return hex32(value) as BranchId;
}

export type MenuType = "Takeaway" | "Dinein";

export function menuType(value: string): MenuType {
  if (value === "Takeaway" || value === "Dinein") return value;
  throw new Error(`invalid menu type: ${value} (Takeaway|Dinein)`);
}

/**
 * Branch liveness classification (spec: three tiers).
 *
 * - "live"          — QR-app surface exists: GetMobileAppConfiguration
 *   answers 200 with SetupStatus (live verdict is SetupStatus "Approved").
 * - "surface-dead"  — tier-2: config 404s (`No data found`) but catalog
 *   rows persist; org/brand/menu reads still return real data. Config-404
 *   alone does NOT prove deletion.
 * - "webshop"       — config answers 200 with Data null: the branch serves
 *   the webshop lane whose config lives in GetWebShopConfiguration — the
 *   QR-app liveness probe does not apply there.
 *
 * Tier-3 (every endpoint answers defaults, indistinguishable from random
 * UUIDs) is NOT a tier value: branch() returns null for it.
 */
export type BranchTier = "live" | "surface-dead" | "webshop";
