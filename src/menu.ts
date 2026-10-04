import { localizedText } from "./localize.js";
import type { BranchId, MenuType, OrgId } from "./types.js";

/**
 * Wire shapes of the business-fnb-gateway reads. Everything is optional at
 * the boundary; the parser is total and never trusts a field's presence.
 * Quirks encoded below (each maps to a test + a Lessons line):
 *  - Envelope everywhere: {Data, IsSuccess, StatusCode, ErrorMessage, …}.
 *  - Localized names/descriptions are JSON-stringified 4-language maps
 *    inside the JSON — parse twice, en fallback.
 *  - Prices are JSON numbers; DiscountPrice mirrors NormalPrice when unset.
 *  - Category response carries NO modifiers — modifiers need the
 *    GetProductDetailsByIdV2/<ProductId> detail call (different path, not
 *    under CmsGateway/Query).
 *  - Stock: StockLimitType/CurrentStock/StockAlertLimit plus branch-level
 *    UnavailableProductDisplayMode "GrayedOut"|"HideOut".
 *  - A product can appear under several categories — dedupe by ProductId.
 *  - Id spaces are heterogeneous (dashed GUIDs, undashed 32-hex, 64-hex
 *    concat) — treat every id as an opaque string.
 *  - Empty categories ride along (venue "origin declaration" sections with
 *    zero products) — dropped from the guest-visible card set.
 */
export interface RawEnvelope<T> {
  readonly Data?: T | null;
  readonly IsSuccess?: boolean;
  readonly StatusCode?: number;
  readonly ErrorMessage?: string | null;
}

export interface RawMedia {
  readonly FileId?: string;
  readonly FileUrl?: string | null;
  readonly MediaType?: string | null;
}

export interface RawServingVariation {
  readonly Type?: string | null;
  readonly IsEnabled?: boolean;
  readonly IsDefault?: boolean;
  readonly Price?: number | null;
}

export interface RawTax {
  readonly Rate?: number | null;
  readonly TaxType?: string | null;
  readonly Name?: string | null;
  readonly ThirdPartyRefId?: string | null;
}

export interface RawProduct {
  readonly ProductId?: string;
  readonly ProductName?: string | null;
  readonly Ingredients?: string | null;
  readonly NormalPrice?: number | null;
  readonly DiscountPrice?: number | null;
  readonly IsProductAvailable?: boolean;
  readonly IsProductAvailableForStock?: boolean;
  readonly IsStockEnabled?: boolean;
  readonly StockLimitType?: string | null;
  readonly StockAlertLimit?: number | null;
  readonly CurrentStock?: number | null;
  readonly ServingVariations?: readonly RawServingVariation[] | null;
  readonly Taxes?: readonly RawTax[] | null;
}

export interface RawCategory {
  readonly CategoryId?: string;
  readonly CategoryName?: string | null;
  readonly CategoryDescription?: string | null;
  readonly CategorySortOrder?: number | null;
  readonly CategoryProducts?: readonly RawProduct[] | null;
  readonly IsForQrCodeProduct?: boolean;
  readonly CategoryMedias?: readonly RawMedia[] | null;
}

export interface RawModifier {
  readonly Name?: string | null;
  readonly Description?: string | null;
  readonly Price?: number | null;
  readonly IsDefault?: boolean;
  readonly IsActive?: boolean;
  readonly SortOrder?: number | null;
}

export interface RawModifierGroup {
  readonly Name?: string | null;
  readonly Description?: string | null;
  readonly ThirdPartyRefId?: string | null;
  readonly MinModifierSelection?: number | null;
  readonly MaxModifierSelection?: number | null;
  readonly PricingMethod?: string | null;
  readonly ProductModifiers?: readonly RawModifier[] | null;
  readonly IsSizeModifier?: boolean;
}

export interface RawProductDetail {
  readonly Name?: string | null;
  readonly Description?: string | null;
  readonly NormalPrice?: number | null;
  readonly DiscountPrice?: number | null;
  readonly ModifierGroups?: readonly RawModifierGroup[] | null;
  readonly UpsellProductIds?: readonly string[] | null;
  readonly CategoryIds?: readonly string[] | null;
  readonly ThirdPartyRefId?: string | null;
  readonly IsCombo?: boolean;
  readonly ComboItems?: readonly unknown[] | null;
  readonly Taxes?: readonly RawTax[] | null;
}

export interface RawDiscount {
  readonly DiscountItemId?: string;
  readonly DiscountName?: string | null;
  readonly DiscountType?: string | null;
  readonly DiscountValue?: string | null;
  readonly MinAmountToApplyDiscount?: number | null;
  readonly IsApplicableOnFullMenu?: boolean;
}

/** GetAllDiscounts wraps the list in a pager inside the envelope Data. */
export interface RawDiscountPage {
  readonly PageNumber?: number;
  readonly PageSize?: number;
  readonly TotalData?: number;
  readonly Data?: readonly RawDiscount[] | null;
}

export interface ServingVariation {
  readonly type: string;
  readonly enabled: boolean;
  readonly isDefault: boolean;
  readonly price: number | null;
}

export interface TaxInfo {
  readonly rate: number;
  readonly type: string;
  readonly name: string | null;
  /** POS id space — a different space from ProductId/CategoryId GUIDs. */
  readonly thirdPartyRefId: string | null;
}

export interface StockInfo {
  readonly limitType: string | null;
  readonly current: number;
  readonly alertLimit: number | null;
}

export interface MenuItem {
  readonly productId: string;
  readonly name: string;
  readonly description: string | null;
  readonly normalPrice: number;
  /** Mirrors normalPrice when no discount is set (wire quirk). */
  readonly discountPrice: number;
  readonly available: boolean;
  /** Present only when the product carries stock data (IsStockEnabled). */
  readonly stock: StockInfo | null;
  readonly serving: readonly ServingVariation[];
  readonly taxes: readonly TaxInfo[];
}

export interface MenuCategory {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly products: readonly MenuItem[];
}

export interface Menu {
  readonly orgId: OrgId;
  readonly branchId: BranchId;
  readonly type: MenuType;
  readonly currency: string;
  /** Guest-visible card set; empty sections dropped, HideOut items hidden. */
  readonly categories: readonly MenuCategory[];
  /** Deduped by ProductId across all categories (relisted products). */
  readonly products: readonly MenuItem[];
  /** Unavailable items dropped per UnavailableProductDisplayMode "HideOut". */
  readonly hiddenItems: readonly MenuItem[];
  readonly updatedAt: string;
}

export interface Modifier {
  readonly name: string;
  readonly price: number;
  readonly isDefault: boolean;
  /** Wire marks inactive modifiers explicitly; carried, never filtered. */
  readonly isActive: boolean;
  readonly sortOrder: number;
}

export interface ModifierGroup {
  readonly name: string;
  readonly description: string | null;
  readonly thirdPartyRefId: string | null;
  readonly minSelection: number;
  readonly maxSelection: number;
  readonly pricingMethod: string | null;
  readonly modifiers: readonly Modifier[];
  readonly isSizeModifier: boolean;
}

export interface ProductDetails {
  readonly productId: string;
  readonly name: string;
  readonly description: string | null;
  readonly normalPrice: number;
  readonly discountPrice: number;
  readonly modifierGroups: readonly ModifierGroup[];
  readonly upsellProductIds: readonly string[];
  readonly categoryIds: readonly string[];
  readonly thirdPartyRefId: string | null;
  /** IsCombo true does NOT imply combo content — ComboItems can be []. */
  readonly isCombo: boolean;
  readonly comboItemCount: number;
  /** Per serving variation — takeaway and dine-in rates differ in one payload. */
  readonly taxes: readonly TaxInfo[];
}

export type DiscountValue =
  | { readonly kind: "amount"; readonly amount: number }
  | { readonly kind: "percent"; readonly percent: number }
  | { readonly kind: "unparsed"; readonly raw: string };

export interface Discount {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly value: DiscountValue;
  /** Per-voucher minimum; NO platform-level min-order field exists (spec). */
  readonly minAmountToApply: number | null;
}

/**
 * DiscountValue mixes two formats in one field: CHF strings ("3.50") and
 * percent strings ("98%"). Metadata only — voucher codes are never listed
 * by this endpoint and VerifyVoucher is never called by this client.
 */
export function parseDiscountValue(raw: string | null | undefined): DiscountValue | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw.endsWith("%")) {
    const percent = Number.parseFloat(raw.slice(0, -1));
    return Number.isNaN(percent) ? { kind: "unparsed", raw } : { kind: "percent", percent };
  }
  const amount = Number.parseFloat(raw);
  return Number.isNaN(amount) ? { kind: "unparsed", raw } : { kind: "amount", amount };
}

function servingOf(raw: RawServingVariation): ServingVariation {
  return {
    type: raw.Type ?? "",
    enabled: raw.IsEnabled === true,
    isDefault: raw.IsDefault === true,
    price: raw.Price ?? null,
  };
}

function taxOf(raw: RawTax): TaxInfo {
  return {
    rate: raw.Rate ?? 0,
    type: raw.TaxType ?? "",
    name: raw.Name ?? null,
    thirdPartyRefId: raw.ThirdPartyRefId ?? null,
  };
}

function itemOf(raw: RawProduct): MenuItem {
  const stockEnabled = raw.IsStockEnabled === true;
  const stock: StockInfo | null = stockEnabled
    ? {
        limitType: raw.StockLimitType ?? null,
        current: raw.CurrentStock ?? 0,
        alertLimit: raw.StockAlertLimit ?? null,
      }
    : null;
  const stockAvailable = raw.IsProductAvailableForStock !== false;
  return {
    productId: raw.ProductId ?? "",
    name: localizedText(raw.ProductName) ?? raw.ProductId ?? "",
    description: localizedText(raw.Ingredients),
    normalPrice: raw.NormalPrice ?? 0,
    discountPrice: raw.DiscountPrice ?? raw.NormalPrice ?? 0,
    available: raw.IsProductAvailable !== false && (!stockEnabled || stockAvailable),
    stock,
    serving: (raw.ServingVariations ?? []).map(servingOf),
    taxes: (raw.Taxes ?? []).map(taxOf),
  };
}

/** Branch-level unavailable-display mode from GetMobileAppConfiguration. */
export type UnavailableDisplayMode = "GrayedOut" | "HideOut";

export function menuFromPayload(
  org: OrgId,
  branch: BranchId,
  type: MenuType,
  currency: string,
  displayMode: UnavailableDisplayMode | null,
  payload: RawEnvelope<readonly RawCategory[]>,
  now: Date,
): Menu {
  const byId = new Map<string, MenuItem>();
  const categories: MenuCategory[] = [];
  const hidden: MenuItem[] = [];
  for (const raw of payload.Data ?? []) {
    const items: MenuItem[] = [];
    for (const rawProduct of raw.CategoryProducts ?? []) {
      const item = itemOf(rawProduct);
      if (item.productId !== "" && !byId.has(item.productId)) byId.set(item.productId, item);
      // GrayedOut keeps unavailable items visible-but-flagged; HideOut
      // removes them from the card set entirely (kept in hiddenItems).
      if (!item.available && displayMode === "HideOut") {
        if (!hidden.some((existing) => existing.productId === item.productId)) hidden.push(item);
        continue;
      }
      if (!items.some((existing) => existing.productId === item.productId)) items.push(item);
    }
    if (items.length === 0) continue; // empty sections never render (venue quirk)
    categories.push({
      id: raw.CategoryId ?? "",
      name: localizedText(raw.CategoryName) ?? raw.CategoryId ?? "",
      description: localizedText(raw.CategoryDescription),
      products: items,
    });
  }
  return {
    orgId: org,
    branchId: branch,
    type,
    currency,
    categories,
    products: [...byId.values()],
    hiddenItems: hidden,
    updatedAt: now.toISOString(),
  };
}

export function productDetailsFromPayload(productId: string, payload: RawEnvelope<RawProductDetail>): ProductDetails {
  const data = payload.Data;
  return {
    productId,
    name: localizedText(data?.Name) ?? productId,
    description: localizedText(data?.Description),
    normalPrice: data?.NormalPrice ?? 0,
    discountPrice: data?.DiscountPrice ?? data?.NormalPrice ?? 0,
    modifierGroups: (data?.ModifierGroups ?? []).map((group) => ({
      name: localizedText(group.Name) ?? "",
      description: localizedText(group.Description),
      thirdPartyRefId: group.ThirdPartyRefId ?? null,
      minSelection: group.MinModifierSelection ?? 0,
      maxSelection: group.MaxModifierSelection ?? 0,
      pricingMethod: group.PricingMethod ?? null,
      modifiers: (group.ProductModifiers ?? []).map((modifier) => ({
        name: localizedText(modifier.Name) ?? "",
        price: modifier.Price ?? 0,
        isDefault: modifier.IsDefault === true,
        isActive: modifier.IsActive !== false,
        sortOrder: modifier.SortOrder ?? 0,
      })),
      isSizeModifier: group.IsSizeModifier === true,
    })),
    upsellProductIds: [...(data?.UpsellProductIds ?? [])],
    categoryIds: [...(data?.CategoryIds ?? [])],
    thirdPartyRefId: data?.ThirdPartyRefId ?? null,
    isCombo: data?.IsCombo === true,
    comboItemCount: data?.ComboItems?.length ?? 0,
    taxes: (data?.Taxes ?? []).map(taxOf),
  };
}

export function discountsFromPayload(payload: RawEnvelope<RawDiscountPage>): readonly Discount[] {
  return (payload.Data?.Data ?? []).flatMap((raw) => {
    const value = parseDiscountValue(raw.DiscountValue);
    if (raw.DiscountItemId === undefined || value === null) return [];
    return [
      {
        id: raw.DiscountItemId,
        name: raw.DiscountName ?? "",
        type: raw.DiscountType ?? "",
        value,
        minAmountToApply: raw.MinAmountToApplyDiscount ?? null,
      },
    ];
  });
}
