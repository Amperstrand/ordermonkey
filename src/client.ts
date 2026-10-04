import { OrderMonkeyError } from "./error.js";
import { recoverBundleConstants } from "./bundle.js";
import {
  fetchJson,
  ORDERMONKEY_ORIGIN,
  USER_AGENT,
  SHIPPED_BUNDLE_KEYS,
  type BundleKeys,
  type FetchJsonResult,
} from "./http.js";
import { translationsText, type NameTranslations } from "./localize.js";
import {
  discountsFromPayload,
  menuFromPayload,
  productDetailsFromPayload,
  type Discount,
  type Menu,
  type ProductDetails,
  type RawCategory,
  type RawDiscountPage,
  type RawEnvelope,
  type RawProductDetail,
  type UnavailableDisplayMode,
} from "./menu.js";
import { branchId as parseBranchId, orgId as parseOrgId, type BranchId, type BranchTier, type MenuType, type OrgId } from "./types.js";
import {
  orgFromSlugEnvelope,
  webshopBranches,
  type RawWebshopBranch,
  type RawWebshopOrganization,
  type WebshopBranchInfo,
  type WebshopVenue,
} from "./webshop.js";

const GATEWAY = "/api/business-fnb-gateway";
const QUERY = `${GATEWAY}/CmsGateway/Query`;
/** The product detail route deliberately sits OUTSIDE CmsGateway/Query. */
const PRODUCT_DETAILS = `${GATEWAY}/GetProductDetailsByIdV2`;

interface RawBranchConfiguration {
  readonly SetupStatus?: string | null;
  readonly PaymentProviders?: readonly string[] | null;
  readonly TransactionFeePercentage?: number | null;
  readonly TableNumbers?: readonly number[] | null;
  readonly IsTableNumberMandatory?: boolean;
  readonly UnavailableProductDisplayMode?: string | null;
  /** Webshop-config-only keys (absent from the QR-app config). */
  readonly MinimumOrderValue?: number | null;
  readonly MinimumOrderType?: string | null;
  readonly IsProductHideOnZero?: boolean;
}

interface RawOrganizationDetails {
  readonly Name?: string | null;
}

interface RawBrandInformation {
  readonly NameTranslations?: NameTranslations | null;
  readonly Currency?: string | null;
  readonly DefaultLanguage?: string | null;
}

export interface ClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

/** A resolved branch: identity + liveness classification + brand facts. */
export interface Branch {
  readonly orgId: OrgId;
  readonly branchId: BranchId;
  readonly tier: BranchTier;
  /** Config setup status ("Approved" is the live verdict); null without config. */
  readonly setupStatus: string | null;
  /** Venue name — lives on GetOrganizationDetails, not the brand record. */
  readonly name: string | null;
  /** Branch name via the NameTranslations localization shape. */
  readonly branchName: string | null;
  readonly currency: string;
  readonly defaultLanguage: string | null;
  readonly paymentProviders: readonly string[];
  readonly transactionFeePercentage: number | null;
  readonly unavailableProductDisplayMode: UnavailableDisplayMode | null;
  readonly isTableNumberMandatory: boolean;
  readonly tableNumbers: readonly number[];
  /**
   * QR-lane configs carry NO min-order field (always null here). Webshop
   * configs DO carry MinimumOrderValue — 0 means none published.
   */
  readonly minOrderValue: number | null;
}

function network(context: string, body: string): OrderMonkeyError {
  return new OrderMonkeyError("network", `${context}: ${body}`);
}

function unavailableDisplayMode(raw: string | null | undefined): UnavailableDisplayMode | null {
  return raw === "GrayedOut" || raw === "HideOut" ? raw : null;
}

/**
 * Read-only OrderMonkey client. Reads are plain GETs with four
 * load-bearing headers (ApiKey/TenantId from the public bundle +
 * OrganizationId/BranchId of the venue pair) — no login, no anonymous
 * JWT, no cookies. The identity service's authenticate_site grant and
 * the CreateSalesOrder / hosted-payment surfaces are phase-3+ and NOT
 * implemented; payment endpoints additionally swap the key and rename
 * the branch header to OrganizationIdentifier (documented, not used).
 *
 * Error semantics: a thrown OrderMonkeyError (reason "network") means
 * the platform was unreachable. A null return always means the platform
 * answered and the thing is absent — a tier-3 dead pair (every endpoint
 * answers defaults, indistinguishable from random UUIDs), an unknown
 * product id, a failed menu surface. An EMPTY menu is data, not
 * absence: a takeaway-only branch serves no Dinein cards.
 *
 * Key rotation: a 401 triggers exactly ONE per-client recovery — the
 * public constants are re-derived from the app bundle (index →
 * main.<hash>.js, `recoverBundleConstants`) — and the refused read is
 * retried once. A 401 that survives recovery surfaces as an error.
 */
export class OrderMonkeyClient {
  private bundleKeys: BundleKeys = SHIPPED_BUNDLE_KEYS;
  private recoveryAttempted = false;

  constructor(private readonly options: ClientOptions = {}) {}

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private async get<T>(
    path: string,
    org: OrgId | null,
    branch: BranchId | null,
  ): Promise<FetchJsonResult<T>> {
    const url = `${ORDERMONKEY_ORIGIN}${path}`;
    const init = (keys: BundleKeys): RequestInit => ({
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/json",
        ApiKey: keys.gatewayKey,
        TenantId: keys.tenantId,
        ...(org === null ? {} : { OrganizationId: org }),
        ...(branch === null ? {} : { BranchId: branch }),
      },
      signal: AbortSignal.timeout(20_000),
    });
    let result = await fetchJson<T>(url, init(this.bundleKeys), this.options.fetchImpl);
    if (!result.ok && result.kind === "http" && result.status === 401) {
      result = await fetchJson<T>(url, init(await this.recoverBundleKeys()), this.options.fetchImpl);
    }
    return result;
  }

  private async recoverBundleKeys(): Promise<BundleKeys> {
    if (this.recoveryAttempted) {
      throw new Error("read refused: HTTP 401 after bundle key recovery — constants rotated again?");
    }
    this.recoveryAttempted = true;
    this.bundleKeys = await recoverBundleConstants(this.options.fetchImpl ?? fetch);
    return this.bundleKeys;
  }

  /**
   * Shared liveness classification behind both lanes: config answer →
   * tier decision → org read (venue name decides tier-3 null) → brand
   * read. `nullDataTier` fixes the ONE semantic difference between the
   * lanes: a config answering `Data:null` means "webshop-shaped branch"
   * on the QR probe but "missing" on the webshop probe.
   */
  private async classifyBranch(
    config: FetchJsonResult<RawEnvelope<RawBranchConfiguration>>,
    org: OrgId,
    branch: BranchId,
    identity: { readonly branchName: string | null; readonly defaultLanguage: string | null },
    nullDataTier: "webshop" | "missing",
  ): Promise<Branch | null> {
    if (!config.ok) {
      if (config.kind === "network") throw network("config read failed", config.body);
      if (config.kind === "parse") throw new Error(`config read failed: unparsable body (${config.body.slice(0, 80)})`);
      if (config.status !== 404) {
        // Non-404 HTTP failures usually mean the public bundle constants
        // rotated (spec-listed risk) — surface, never swallow.
        throw new Error(`config read failed: HTTP ${config.status} (bundle constants rotated?)`);
      }
    }
    // Three config answer shapes: not-found (HTTP 404, or a 200 envelope
    // with StatusCode 404 / IsSuccess false — "No data found"), Data
    // null, or a real configuration.
    const nullShaped = config.ok && config.value.Data === null && config.value.IsSuccess !== false;
    const notFound = !nullShaped && (!config.ok || (config.ok && (config.value.IsSuccess === false || config.value.Data === undefined)));
    const missing = notFound || (nullDataTier === "missing" && nullShaped);

    const orgResult = await this.get<RawEnvelope<RawOrganizationDetails>>(`${QUERY}/GetOrganizationDetails`, org, branch);
    if (!orgResult.ok && orgResult.kind === "network") throw network("organization read failed", orgResult.body);
    const venueName = orgResult.ok ? orgResult.value.Data?.Name ?? null : null;
    if (missing && (venueName === null || venueName === "")) return null;

    const brand = await this.get<RawEnvelope<RawBrandInformation>>(`${QUERY}/GetBrandInformation`, org, branch);
    if (!brand.ok && brand.kind === "network") throw network("brand read failed", brand.body);
    const brandData = brand.ok ? brand.value.Data : undefined;
    const configData = config.ok ? config.value.Data : undefined;

    return {
      orgId: org,
      branchId: branch,
      tier: missing ? "surface-dead" : nullShaped ? "webshop" : "live",
      setupStatus: configData?.SetupStatus ?? null,
      name: venueName !== null && venueName !== "" ? venueName : null,
      branchName: identity.branchName ?? translationsText(brandData?.NameTranslations),
      currency: brandData?.Currency ?? "CHF",
      defaultLanguage: identity.defaultLanguage ?? brandData?.DefaultLanguage ?? null,
      paymentProviders: [...(configData?.PaymentProviders ?? [])],
      transactionFeePercentage: configData?.TransactionFeePercentage ?? null,
      unavailableProductDisplayMode: unavailableDisplayMode(configData?.UnavailableProductDisplayMode),
      isTableNumberMandatory: configData?.IsTableNumberMandatory === true,
      tableNumbers: [...(configData?.TableNumbers ?? [])],
      minOrderValue: configData?.MinimumOrderValue ?? null,
    };
  }

  /**
   * Reads identity + liveness for an (orgId, branchId) pair via the
   * QR-app probe: GetMobileAppConfiguration (liveness),
   * GetOrganizationDetails (venue name), GetBrandInformation (currency,
   * languages, branch name). Returns null for a tier-3 dead pair —
   * config not-found AND an empty organization name is the
   * indistinguishable-from-random-UUIDs signature. A config 404 with a
   * real org name is tier-2 ("surface-dead"): the mobile-app surface
   * was removed but catalog rows persist — config-404 alone does NOT
   * prove deletion.
   */
  async branch(orgIdInput: string | OrgId, branchIdInput: string | BranchId): Promise<Branch | null> {
    const org = parseOrgId(orgIdInput);
    const branch = parseBranchId(branchIdInput);
    const config = await this.get<RawEnvelope<RawBranchConfiguration>>(`${QUERY}/GetMobileAppConfiguration`, org, branch);
    return await this.classifyBranch(config, org, branch, { branchName: null, defaultLanguage: null }, "webshop");
  }

  /**
   * Resolves a webshop lane (`webshop.ordermonkey.com/<slug>`): slug →
   * organization id (GetOrganizationsByShopDetails, no identity headers)
   * → branch rows (GetAllBranch?IsWebshopRequest=true — OrganizationId
   * header only). Returns null for an unknown slug; an empty branch
   * list is data, not absence.
   */
  async webshop(slug: string): Promise<WebshopVenue | null> {
    const orgResult = await this.get<RawEnvelope<RawWebshopOrganization>>(
      `${QUERY}/GetOrganizationsByShopDetails?UniqueUrlIdentifier=${encodeURIComponent(slug)}`,
      null,
      null,
    );
    if (!orgResult.ok && orgResult.kind === "network") throw network("webshop slug resolve failed", orgResult.body);
    if (!orgResult.ok) return null;
    const org = orgFromSlugEnvelope(orgResult.value);
    if (org === null) return null;
    const branchResult = await this.get<RawEnvelope<readonly RawWebshopBranch[]>>(
      `${QUERY}/GetAllBranch?IsWebshopRequest=true`,
      org,
      null,
    );
    if (!branchResult.ok && branchResult.kind === "network") throw network("webshop branches read failed", branchResult.body);
    if (!branchResult.ok) return { slug, orgId: org, branches: [] };
    return { slug, orgId: org, branches: webshopBranches(branchResult.value) };
  }

  /**
   * Classifies a webshop branch through ITS OWN config
   * (GetWebShopConfiguration — hard-requires BranchId, a 400 without it)
   * via the shared classifier, yielding a Branch the shared menu()/
   * product()/discounts() surface accepts. Defaults to the venue's
   * first branch.
   */
  async webshopBranch(
    venue: WebshopVenue,
    branch: WebshopBranchInfo | undefined = venue.branches[0],
  ): Promise<Branch | null> {
    if (branch === undefined) return null;
    const config = await this.get<RawEnvelope<RawBranchConfiguration>>(`${QUERY}/GetWebShopConfiguration`, venue.orgId, branch.branchId);
    return await this.classifyBranch(
      config,
      venue.orgId,
      branch.branchId,
      { branchName: branch.displayName ?? branch.name, defaultLanguage: branch.defaultLanguage },
      "missing",
    );
  }

  /**
   * Reads the card set: GetAllCategoryWithProduct?Type=Takeaway|Dinein.
   * Categories carry NO modifiers — call product() per ProductId for
   * those. Returns null when the platform answers the surface missing
   * or failed; an empty menu (zero categories) is valid data — a
   * takeaway-only branch has no Dinein cards.
   */
  async menu(target: Branch, type: MenuType = "Takeaway"): Promise<Menu | null> {
    const result = await this.get<RawEnvelope<readonly RawCategory[]>>(
      `${QUERY}/GetAllCategoryWithProduct?Type=${encodeURIComponent(type)}`,
      target.orgId,
      target.branchId,
    );
    if (!result.ok) {
      if (result.kind === "network") throw network("menu read failed", result.body);
      return null;
    }
    if (result.value.IsSuccess === false) return null;
    return menuFromPayload(
      target.orgId,
      target.branchId,
      type,
      target.currency,
      target.unavailableProductDisplayMode,
      result.value,
      this.now(),
    );
  }

  /**
   * Reads one product's detail (modifiers, upsell, taxes, category
   * membership) from GetProductDetailsByIdV2/<ProductId> — the route
   * sits directly under business-fnb-gateway, NOT under
   * CmsGateway/Query. Returns null for an unknown product id.
   */
  async product(target: Branch, productId: string): Promise<ProductDetails | null> {
    const result = await this.get<RawEnvelope<RawProductDetail>>(
      `${PRODUCT_DETAILS}/${encodeURIComponent(productId)}`,
      target.orgId,
      target.branchId,
    );
    if (!result.ok) {
      if (result.kind === "network") throw network("product read failed", result.body);
      return null;
    }
    if (result.value.IsSuccess === false || result.value.Data === null || result.value.Data === undefined) return null;
    return productDetailsFromPayload(productId, result.value);
  }

  /**
   * Reads public voucher METADATA (GetAllDiscounts): names, values
   * ("3.50" CHF strings mixed with "98%" percent strings), per-voucher
   * minimums. Codes themselves are not listed by this endpoint and
   * VerifyVoucher is never called — read-only scope discipline.
   */
  async discounts(target: Branch): Promise<readonly Discount[]> {
    const result = await this.get<RawEnvelope<RawDiscountPage>>(`${QUERY}/GetAllDiscounts/?pageSize=10`, target.orgId, target.branchId);
    if (!result.ok) {
      if (result.kind === "network") throw network("discounts read failed", result.body);
      return [];
    }
    if (result.value.IsSuccess === false) return [];
    return discountsFromPayload(result.value);
  }
}
