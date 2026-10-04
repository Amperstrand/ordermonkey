/**
 * SYNTHETIC OrderMonkey transport. Every org/branch/product/category id,
 * name, price and voucher below is invented — nothing is a captured
 * payload. The fixture mirrors the SHAPES documented in the platform
 * notes (app.ordermonkey.com Selise QR webapp; private platform-recon
 * repo, research/ordermonkey/PLATFORM.md) so the tests exercise the
 * documented quirks as behavior:
 *
 *  - Envelope everywhere: {Data, IsSuccess, StatusCode, ErrorMessage, …};
 *    not-found arrives as HTTP 404 with a "No data found" envelope.
 *  - Four load-bearing headers gate every read (ApiKey is a hard gate);
 *    the bundle constants live in src/http.ts and are public platform
 *    keys, not secrets.
 *  - Three liveness tiers: live (config 200 + SetupStatus "Approved"),
 *    tier-2 surface-dead (config 404, org/catalog rows persist), tier-3
 *    dead (every endpoint answers defaults — org name "").
 *  - Webshop-shaped branch: config answers 200 with Data null (webshop
 *    config lives in a different endpoint; QR liveness probe N/A).
 *  - Localized names are JSON-stringified 4-language maps (parse twice,
 *    en fallback; map values may be null or empty); one category uses a
 *    PLAIN string name; branch names use NameTranslations[] (a third
 *    localization shape).
 *  - Prices are JSON numbers; DiscountPrice mirrors NormalPrice when
 *    unset; a CHF 0 item rides along.
 *  - Same product listed under two categories — dedupe by ProductId.
 *  - Category ids mix dashed GUIDs and 64-hex concat shapes.
 *  - Empty categories (venue "origin declaration" sections) ride along.
 *  - Stock fields per product; UnavailableProductDisplayMode
 *    "GrayedOut" (keep + flag) vs "HideOut" (hide).
 *  - GetProductDetailsByIdV2 lives directly under
 *    /api/business-fnb-gateway/, NOT under CmsGateway/Query.
 *  - GetAllDiscounts wraps its list in a pager inside the envelope Data
 *    (Data.Data) and mixes "3.50" CHF strings with "98%" percent
 *    strings in one DiscountValue field.
 */
import { BUNDLE_GATEWAY_KEY, BUNDLE_TENANT_ID } from "../src/http.js";
import { bodyOf, headerRecord, jsonResponse, type RecordedRequest } from "./transport-fake.js";

export const LIVE_ORG = "aa11bb22-cc33-4d44-8e55-ff6677889900";
export const LIVE_BRANCH = "a0b1c2d3e4f5061728394a5b6c7d8e9f";
export const TIER2_ORG = "bb22cc33-dd44-4e55-8f66-007788990011";
export const TIER2_BRANCH = "b1c2d3e4f5061728394a5b6c7d8e9fa0";
export const TIER3_ORG = "cc33dd44-ee55-4f66-8a07-118899001122";
export const TIER3_BRANCH = "c2d3e4f5061728394a5b6c7d8e9fa0b1";
export const WEBSHOP_ORG = "dd44ee55-ff66-4007-8a18-229900112233";
export const WEBSHOP_BRANCH = "d3e4f5061728394a5b6c7d8e9fa0b1c2";
export const HIDEOUT_ORG = "ee55ff66-0011-4118-8a29-330011223344";
export const HIDEOUT_BRANCH = "e4f5061728394a5b6c7d8e9fa0b1c2d3";

export const P_PAD_THAI = "ab12cd34-ef56-4a78-8b90-12cd34ef56ab";
export const P_SPRING = "bc23de45-fa67-4b89-8c01-23de45fa67bc";
export const P_RICE = "cd34ef56-ab78-4c90-8d12-34ef56ab78cd";
export const P_TEA = "de45fa67-bc89-4d01-8e23-45fa67bc89de";
export const P_TIER2 = "fa67bc89-de01-4f23-8012-67bc89de01fa";
export const P_HIDEOUT = "ef56ab78-cd90-4e12-8f34-56ab78cd90ef";

const CAT_NOODLES = "1111111a-2222-4333-8444-55555555555a";
const CAT_SIDES = "abcdef01abcdef01abcdef01abcdef01fedcba98fedcba98fedcba98fedcba98";
const CAT_EMPTY = "2222222b-3333-4444-8555-66666666666b";
const CAT_TIER2 = "3333333c-4444-4555-8666-77777777777c";

export interface FakeOrderMonkeyOptions {
  /** Serve menu reads for this branch as a failed envelope (IsSuccess false). */
  readonly menuFailsOn?: string;
  /** Keys rotated with NO literals in the bundle — recovery must fail loudly. */
  readonly rotateKeys?: boolean;
  /** Keys rotated AND served in the synthetic main.*.js — recovery succeeds. */
  readonly rotatedKeys?: { readonly gatewayKey: string; readonly tenantId: string };
}

const SYNTHETIC_MAIN = "/main.a1b2c3d4e5f60718.js";

function envelope(data: unknown): Record<string, unknown> {
  return {
    Data: data,
    IsSuccess: true,
    StatusCode: 200,
    ErrorMessage: null,
    PropertyName: null,
    ValidationErrors: null,
    NextUpdateAtUtc: null,
    NextUpdateInSeconds: null,
  };
}

function notFoundEnvelope(): Record<string, unknown> {
  return {
    Data: null,
    IsSuccess: false,
    StatusCode: 404,
    ErrorMessage: "No data found",
    PropertyName: null,
    ValidationErrors: null,
    NextUpdateAtUtc: null,
    NextUpdateInSeconds: null,
  };
}

function failedEnvelope(): Record<string, unknown> {
  return {
    Data: null,
    IsSuccess: false,
    StatusCode: 500,
    ErrorMessage: "synthetic failure",
    PropertyName: null,
    ValidationErrors: null,
    NextUpdateAtUtc: null,
    NextUpdateInSeconds: null,
  };
}

const unauthorized = (): Record<string, unknown> => ({
  Data: null,
  IsSuccess: false,
  StatusCode: 401,
  ErrorMessage: "Unauthorized",
  PropertyName: null,
  ValidationErrors: null,
  NextUpdateAtUtc: null,
  NextUpdateInSeconds: null,
});

/** JSON-stringified 4-language map — the double-parse localization shape. */
function langMap(en: string, de = "", fr = "", it = ""): string {
  return JSON.stringify({ en, de, fr, it });
}

function serving(types: readonly { readonly type: string; readonly enabled: boolean }[]): unknown[] {
  return types.map(({ type, enabled }) => ({ Type: type, IsEnabled: enabled, IsDefault: false, Price: null }));
}

const padThai = {
  ProductId: P_PAD_THAI,
  ProductName: langMap("", "Synthetisches Pad Thai"),
  Ingredients: langMap("Synthetic peanuts, synthetic lime"),
  NormalPrice: 12.5,
  DiscountPrice: 12.5,
  IsProductAvailable: true,
  IsProductAvailableForStock: true,
  IsStockEnabled: false,
  StockLimitType: null,
  StockAlertLimit: 0,
  CurrentStock: 0,
  ServingVariations: serving([
    { type: "Dinein", enabled: false },
    { type: "Takeaway", enabled: true },
    { type: "Delivery", enabled: false },
  ]),
  Taxes: [
    {
      Rate: 2.9,
      TaxType: "Takeaway",
      Name: "Take-Away",
      ThirdPartyRefId: "aa99bb88cc774d558e66ff7766889900",
      ItemId: "aa99bb88cc774d558e66ff7766889900",
      IsActive: true,
    },
  ],
};

const springRoll = {
  ProductId: P_SPRING,
  ProductName: langMap("Synthetic Spring Roll"),
  Ingredients: "",
  NormalPrice: 6,
  DiscountPrice: 6,
  IsProductAvailable: true,
  IsProductAvailableForStock: true,
  IsStockEnabled: false,
  StockLimitType: null,
  StockAlertLimit: 0,
  CurrentStock: 0,
  ServingVariations: serving([{ type: "Takeaway", enabled: true }]),
  Taxes: [],
};

const rice = {
  ProductId: P_RICE,
  // Map with null sibling values — en must still win.
  ProductName: JSON.stringify({ en: "Synthetic Rice", de: null, fr: null, it: null }),
  Ingredients: null,
  NormalPrice: 0,
  DiscountPrice: 0,
  IsProductAvailable: true,
  IsProductAvailableForStock: true,
  IsStockEnabled: true,
  StockLimitType: "DailyLimit",
  StockAlertLimit: 2,
  CurrentStock: 7,
  ServingVariations: serving([{ type: "Takeaway", enabled: true }]),
  Taxes: [],
};

const icedTea = {
  ProductId: P_TEA,
  ProductName: langMap("Synthetic Iced Tea"),
  Ingredients: null,
  NormalPrice: 3.5,
  DiscountPrice: 3.5,
  IsProductAvailable: false,
  IsProductAvailableForStock: true,
  IsStockEnabled: false,
  StockLimitType: null,
  StockAlertLimit: 0,
  CurrentStock: 0,
  ServingVariations: serving([{ type: "Takeaway", enabled: true }]),
  Taxes: [],
};

function liveTakeawayMenu(): unknown[] {
  return [
    {
      CategoryId: CAT_NOODLES,
      CategoryName: langMap("Synthetic Noodles", "Synthetische Nudeln"),
      CategoryDescription: "",
      CategorySortOrder: 1,
      IsForQrCodeProduct: true,
      CategoryProducts: [padThai, springRoll],
      CategoryMedias: [],
    },
    {
      // 64-hex concat id shape + PLAIN-string category name.
      CategoryId: CAT_SIDES,
      CategoryName: "Synthetic Sides",
      CategoryDescription: null,
      CategorySortOrder: 2,
      IsForQrCodeProduct: false,
      CategoryProducts: [springRoll, rice, icedTea],
      CategoryMedias: [],
    },
    {
      CategoryId: CAT_EMPTY,
      CategoryName: langMap("Synthetic Empty Section"),
      CategoryDescription: null,
      CategorySortOrder: 3,
      IsForQrCodeProduct: false,
      CategoryProducts: [],
      CategoryMedias: [],
    },
  ];
}

const padThaiDetail = {
  Name: langMap("Synthetic Pad Thai", "Synthetisches Pad Thai"),
  Description: langMap("Synthetic noodles, synthetic tamarind"),
  NormalPrice: 12.5,
  DiscountPrice: 12.5,
  IsCombo: true,
  ComboItems: [],
  Taxes: [
    { Rate: 2.9, TaxType: "Takeaway", Name: "Take-Away", ThirdPartyRefId: "aa99bb88cc774d558e66ff7766889900", IsActive: true },
    { Rate: 2.6, TaxType: "Dinein", Name: "Dine-in", ThirdPartyRefId: "aa99bb88cc774d558e66ff7766889900", IsActive: true },
  ],
  ModifierGroups: [
    {
      Name: langMap("Synthetic Spice Level"),
      Description: null,
      ThirdPartyRefId: "bb88cc99dd004e668f7700118899001122334455",
      MinModifierSelection: 0,
      MaxModifierSelection: 2,
      PricingMethod: "IndividualCharge",
      IsSizeModifier: false,
      ProductModifiers: [
        { Name: langMap("Mild"), Price: 0, IsDefault: true, IsActive: true, SortOrder: 0 },
        { Name: langMap("Hot"), Price: 0.5, IsDefault: false, IsActive: true, SortOrder: 1 },
        { Name: langMap("Volcanic"), Price: 1, IsDefault: false, IsActive: false, SortOrder: 2 },
      ],
    },
    {
      Name: langMap("Synthetic Size"),
      Description: null,
      ThirdPartyRefId: null,
      MinModifierSelection: 1,
      MaxModifierSelection: 1,
      PricingMethod: "IndividualCharge",
      IsSizeModifier: true,
      ProductModifiers: [
        { Name: langMap("Small"), Price: 0, IsDefault: true, IsActive: true, SortOrder: 0 },
        { Name: langMap("Large"), Price: 1.5, IsDefault: false, IsActive: true, SortOrder: 1 },
      ],
    },
  ],
  UpsellProductIds: [P_RICE, P_TEA],
  CategoryIds: [CAT_NOODLES, CAT_SIDES],
  ThirdPartyRefId: null,
};

const liveDiscounts = {
  PageNumber: 0,
  PageSize: 10,
  TotalData: 2,
  TotalUnreadData: 0,
  Data: [
    {
      DiscountItemId: "cc99dd00ee114f7780082299aa0011223344",
      DiscountName: "Synthetic Crew",
      DiscountType: "Voucher",
      DiscountValue: "3.50",
      IsApplicableOnFullMenu: true,
      MinAmountToApplyDiscount: 8,
      ApplicableCategories: [],
      EnableSizeBasedDiscounts: false,
      SizeBasedDiscounts: [],
    },
    {
      DiscountItemId: "dd00ee11ff225588911933aabb1122334455",
      DiscountName: "Synthetic Family",
      DiscountType: "Voucher",
      DiscountValue: "98%",
      IsApplicableOnFullMenu: false,
      MinAmountToApplyDiscount: 0,
      ApplicableCategories: [],
      EnableSizeBasedDiscounts: false,
      SizeBasedDiscounts: [],
    },
  ],
};

const tier2Menu = [
  {
    CategoryId: CAT_TIER2,
    CategoryName: langMap("Synthetic Legacy Cards"),
    CategoryDescription: null,
    CategorySortOrder: 1,
    IsForQrCodeProduct: false,
    CategoryProducts: [
      {
        ProductId: P_TIER2,
        ProductName: langMap("Synthetic Legacy Dish"),
        Ingredients: null,
        NormalPrice: 9.5,
        DiscountPrice: 9.5,
        IsProductAvailable: true,
        IsProductAvailableForStock: true,
        IsStockEnabled: false,
        ServingVariations: serving([{ type: "Takeaway", enabled: true }]),
        Taxes: [],
      },
    ],
    CategoryMedias: [],
  },
];

const hideoutMenu = [
  {
    CategoryId: CAT_NOODLES,
    CategoryName: langMap("Synthetic Noodles"),
    CategoryDescription: null,
    CategorySortOrder: 1,
    IsForQrCodeProduct: false,
    CategoryProducts: [
      padThai,
      {
        ProductId: P_HIDEOUT,
        ProductName: langMap("Synthetic Sold Out Noodles"),
        Ingredients: null,
        NormalPrice: 14,
        DiscountPrice: 14,
        IsProductAvailable: false,
        IsProductAvailableForStock: false,
        IsStockEnabled: false,
        ServingVariations: serving([{ type: "Takeaway", enabled: true }]),
        Taxes: [],
      },
    ],
    CategoryMedias: [],
  },
];

type BranchFixture = {
  readonly org: string;
  readonly branch: string;
  readonly config: "approved" | "grayed" | "hideout" | "missing" | "null" | "defaults";
  readonly orgName: string;
  readonly menu: unknown[] | undefined;
};

const BRANCHES: readonly BranchFixture[] = [
  { org: LIVE_ORG, branch: LIVE_BRANCH, config: "grayed", orgName: "Synthetic Noodle Bar", menu: liveTakeawayMenu() },
  { org: TIER2_ORG, branch: TIER2_BRANCH, config: "missing", orgName: "Synthetic Alt Kitchen", menu: tier2Menu },
  { org: TIER3_ORG, branch: TIER3_BRANCH, config: "missing", orgName: "", menu: [] },
  { org: WEBSHOP_ORG, branch: WEBSHOP_BRANCH, config: "null", orgName: "Synthetic Webshop Cantina", menu: tier2Menu },
  { org: HIDEOUT_ORG, branch: HIDEOUT_BRANCH, config: "hideout", orgName: "Synthetic Hideout Grill", menu: hideoutMenu },
];

function configBody(kind: BranchFixture["config"]): { readonly status: number; readonly body: Record<string, unknown> } {
  switch (kind) {
    case "approved":
    case "grayed":
    case "hideout":
      return {
        status: 200,
        body: envelope({
          SetupStatus: "Approved",
          PaymentProviders: kind === "hideout" ? ["ADYEN-ONLINE"] : ["SIX"],
          TransactionFeePercentage: kind === "hideout" ? 1 : 1.2,
          TableNumbers: [],
          TableIds: [],
          IsTableNumberMandatory: false,
          UnavailableProductDisplayMode: kind === "grayed" ? "GrayedOut" : kind === "hideout" ? "HideOut" : null,
        }),
      };
    case "null":
      return { status: 200, body: envelope(null) };
    case "missing":
      return { status: 404, body: notFoundEnvelope() };
    case "defaults":
      return { status: 404, body: notFoundEnvelope() };
  }
}

function brandBody(fixture: BranchFixture): Record<string, unknown> {
  const defaults = fixture.config === "defaults" || fixture.orgName === "";
  // The LIVE branch keys its translations by a full language name — the
  // alias-normalization wire shape.
  const code = fixture.config === "grayed" ? "ENGLISH" : "en";
  return envelope({
    OrganizationId: defaults ? "" : fixture.org,
    BranchUUID: defaults ? "" : fixture.branch,
    NameTranslations: defaults ? [] : [{ LanguageCodeType: code, Text: `${fixture.orgName} Branch` }],
    Currency: "CHF",
    DefaultLanguage: "fr",
    LanguageList: [],
    Address: { Country: "CH", City: "Synth City", ZipCode: "0000", StreetNo: "1", HouseNo: "-" },
    VatUUID: "-",
    TimeZoneId: "Central European Standard Time",
  });
}

export function fakeOrderMonkey(options: FakeOrderMonkeyOptions = {}): {
  readonly fetchImpl: typeof fetch;
  readonly requests: readonly RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headerRecord(init);
    const body = bodyOf(init);
    requests.push({ method, url: `${url.origin}${url.pathname}${url.search === "" ? "" : `?${url.searchParams.toString()}`}`, headers, body });

    if (method !== "GET") {
      return jsonResponse(envelope(null), {}, 405);
    }
    if (url.pathname === "/") {
      return new Response(
        `<!doctype html><html><body><app-root></app-root><script src="main.a1b2c3d4e5f60718.js" type="module"></script></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    if (url.pathname === SYNTHETIC_MAIN) {
      const keys = options.rotatedKeys ?? { gatewayKey: BUNDLE_GATEWAY_KEY, tenantId: BUNDLE_TENANT_ID };
      const body = options.rotateKeys === true
        ? "var config={themeName:'synthetic',paymentApiKey:'not-the-lane-you-want'};"
        : `var config={apiKey:"${keys.gatewayKey}",tenantId:"${keys.tenantId}",paymentApiKey:'nope'};`;
      return new Response(body, { status: 200, headers: { "content-type": "application/javascript" } });
    }
    // The read gate: four load-bearing headers, ApiKey is the hard one.
    const expected = options.rotatedKeys ??
      (options.rotateKeys === true
        ? { gatewayKey: "00000000feedface0badc0ffee000000", tenantId: "aaaa1111-bb22-4cc3-8dd4-eeeeffff0000" }
        : { gatewayKey: BUNDLE_GATEWAY_KEY, tenantId: BUNDLE_TENANT_ID });
    if (headers["apikey"] !== expected.gatewayKey || headers["tenantid"] !== expected.tenantId) {
      return jsonResponse(unauthorized(), {}, 401);
    }
    const fixture = BRANCHES.find((candidate) => candidate.branch === headers["branchid"]);
    if (fixture === undefined || headers["organizationid"] !== fixture.org) {
      // Unknown pair: the platform answers tier-3-style defaults —
      // indistinguishable from random UUIDs (spec).
      const tier3 = BRANCHES.find((candidate) => candidate.orgName === "");
      if (url.pathname.endsWith("GetOrganizationDetails")) return jsonResponse(envelope({ Name: "" }));
      if (url.pathname.endsWith("GetBrandInformation")) return jsonResponse(brandBody(tier3 ?? BRANCHES[2]!));
      if (url.pathname.endsWith("GetAllCategoryWithProduct")) return jsonResponse(envelope([]));
      const missing = configBody("missing");
      return jsonResponse(missing.body, {}, missing.status);
    }

    const path = url.pathname;
    if (path.endsWith("/CmsGateway/Query/GetMobileAppConfiguration")) {
      const config = configBody(fixture.config);
      return jsonResponse(config.body, {}, config.status);
    }
    if (path.endsWith("/CmsGateway/Query/GetOrganizationDetails")) {
      return jsonResponse(envelope({ Name: fixture.orgName, RestaurantLogo: null, Schedule: [] }));
    }
    if (path.endsWith("/CmsGateway/Query/GetBrandInformation")) {
      return jsonResponse(brandBody(fixture));
    }
    if (path.endsWith("/CmsGateway/Query/GetAllCategoryWithProduct")) {
      if (options.menuFailsOn === fixture.branch) return jsonResponse(failedEnvelope());
      const type = url.searchParams.get("Type");
      // Takeaway-only branch: Dinein asks answer an empty-but-valid card set.
      const menu = type === "Dinein" && fixture.config === "grayed" ? [] : fixture.menu;
      return jsonResponse(envelope(menu ?? []));
    }
    if (path.endsWith("/CmsGateway/Query/GetAllDiscounts") || path.endsWith("/CmsGateway/Query/GetAllDiscounts/")) {
      return jsonResponse(envelope(fixture.org === LIVE_ORG ? liveDiscounts : { PageNumber: 0, PageSize: 10, TotalData: 0, Data: [] }));
    }
    const detail = path.match(/\/api\/business-fnb-gateway\/GetProductDetailsByIdV2\/([^/]+)$/);
    if (detail?.[1] !== undefined) {
      if (detail[1] === P_PAD_THAI && fixture.org === LIVE_ORG) return jsonResponse(envelope(padThaiDetail));
      return jsonResponse(notFoundEnvelope(), {}, 404);
    }
    return jsonResponse(failedEnvelope(), {}, 404);
  };
  return { fetchImpl, requests };
}
