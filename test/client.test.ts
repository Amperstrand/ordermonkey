import { describe, expect, it } from "vitest";
import { BUNDLE_GATEWAY_KEY, BUNDLE_TENANT_ID, OrderMonkeyClient, OrderMonkeyError } from "../src/index.js";
import {
  fakeOrderMonkey,
  HIDEOUT_ORG,
  LIVE_BRANCH,
  LIVE_ORG,
  P_PAD_THAI,
  TIER2_BRANCH,
  TIER2_ORG,
  TIER3_BRANCH,
  TIER3_ORG,
  WEBSHOP_BRANCH,
  WEBSHOP_ORG,
} from "./ordermonkey-fake.js";
import { jsonResponse, sent } from "./transport-fake.js";

function client(fetchImpl: typeof fetch): OrderMonkeyClient {
  return new OrderMonkeyClient({ fetchImpl });
}

describe("branch", () => {
  it("sends the four load-bearing headers on every Query read", async () => {
    const transport = fakeOrderMonkey();
    await client(transport.fetchImpl).branch(LIVE_ORG, LIVE_BRANCH);
    expect(transport.requests.length).toBeGreaterThanOrEqual(3);
    for (const request of transport.requests) {
      expect(request.headers["apikey"]).toBe(BUNDLE_GATEWAY_KEY);
      expect(request.headers["tenantid"]).toBe(BUNDLE_TENANT_ID);
      expect(request.headers["organizationid"]).toBe(LIVE_ORG);
      expect(request.headers["branchid"]).toBe(LIVE_BRANCH);
    }
  });

  it("classifies a live branch: SetupStatus Approved, venue name, CHF, providers, fee", async () => {
    const transport = fakeOrderMonkey();
    const branch = await client(transport.fetchImpl).branch(LIVE_ORG, LIVE_BRANCH);
    expect(branch).toMatchObject({
      tier: "live",
      setupStatus: "Approved",
      name: "Synthetic Noodle Bar",
      branchName: "Synthetic Noodle Bar Branch",
      currency: "CHF",
      defaultLanguage: "fr",
      paymentProviders: ["SIX"],
      transactionFeePercentage: 1.2,
      unavailableProductDisplayMode: "GrayedOut",
    });
  });

  it("tier-2 surface-dead: config 404 but org name real — config-404 is NOT deletion", async () => {
    const transport = fakeOrderMonkey();
    const branch = await client(transport.fetchImpl).branch(TIER2_ORG, TIER2_BRANCH);
    expect(branch).toMatchObject({ tier: "surface-dead", name: "Synthetic Alt Kitchen", setupStatus: null });
    const config = sent(transport.requests, "GetMobileAppConfiguration");
    expect(config).toBeDefined();
  });

  it("tier-2 catalog rows persist: menu() still returns real cards", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const branch = await c.branch(TIER2_ORG, TIER2_BRANCH);
    const menu = await c.menu(branch!, "Takeaway");
    expect(menu?.categories.map((category) => category.name)).toEqual(["Synthetic Legacy Cards"]);
  });

  it("tier-3 dead pair returns null — every endpoint answers defaults, like random UUIDs", async () => {
    const transport = fakeOrderMonkey();
    expect(await client(transport.fetchImpl).branch(TIER3_ORG, TIER3_BRANCH)).toBeNull();
    // The platform still answered: config + org reads happened.
    expect(sent(transport.requests, "GetMobileAppConfiguration")).toBeDefined();
    expect(sent(transport.requests, "GetOrganizationDetails")).toBeDefined();
  });

  it("webshop-shaped branch: config Data null → webshop tier, menu still readable", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const branch = await c.branch(WEBSHOP_ORG, WEBSHOP_BRANCH);
    expect(branch).toMatchObject({ tier: "webshop", name: "Synthetic Webshop Cantina" });
    const menu = await c.menu(branch!, "Takeaway");
    expect(menu?.categories.length).toBeGreaterThan(0);
  });

  it("accepts dashed and undashed id inputs (normalized on the wire)", async () => {
    const transport = fakeOrderMonkey();
    const undashedOrg = LIVE_ORG.replace(/-/g, "");
    const dashedBranch = `${LIVE_BRANCH.slice(0, 8)}-${LIVE_BRANCH.slice(8, 12)}-${LIVE_BRANCH.slice(12, 16)}-${LIVE_BRANCH.slice(16, 20)}-${LIVE_BRANCH.slice(20)}`;
    const branch = await client(transport.fetchImpl).branch(undashedOrg, dashedBranch);
    expect(branch?.orgId).toBe(LIVE_ORG);
    expect(branch?.branchId).toBe(LIVE_BRANCH);
    expect(transport.requests[0]?.headers["organizationid"]).toBe(LIVE_ORG);
    expect(transport.requests[0]?.headers["branchid"]).toBe(LIVE_BRANCH);
  });

  it("rejects malformed ids before any network read", async () => {
    const transport = fakeOrderMonkey();
    await expect(client(transport.fetchImpl).branch("zzzz", LIVE_BRANCH)).rejects.toThrow(/invalid org id/);
    expect(transport.requests).toHaveLength(0);
  });

  it("minOrderValue is typed null — no such field exists on this platform", async () => {
    const transport = fakeOrderMonkey();
    const branch = await client(transport.fetchImpl).branch(LIVE_ORG, LIVE_BRANCH);
    expect(branch!.minOrderValue).toBeNull();
  });

  it("throws a typed network error when the transport dies", async () => {
    const dead: typeof fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(client(dead).branch(LIVE_ORG, LIVE_BRANCH)).rejects.toMatchObject({
      name: "OrderMonkeyError",
      reason: "network",
    });
  });

  it("surfaces a rotation the bundle cannot resolve loudly instead of guessing", async () => {
    const transport = fakeOrderMonkey({ rotateKeys: true });
    await expect(client(transport.fetchImpl).branch(LIVE_ORG, LIVE_BRANCH)).rejects.toThrow(/bundle recovery/);
  });

  it("the read gate is real: a headerless fetch is 401-unauthorized", async () => {
    const transport = fakeOrderMonkey();
    const response = await transport.fetchImpl(
      "https://app.ordermonkey.com/api/business-fnb-gateway/CmsGateway/Query/GetMobileAppConfiguration",
    );
    expect(response.status).toBe(401);
  });

  it("read-only boundary: every request of a full session is a GET on read routes only", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const branch = await c.branch(LIVE_ORG, LIVE_BRANCH);
    await c.menu(branch!, "Takeaway");
    await c.product(branch!, P_PAD_THAI);
    await c.discounts(branch!);
    for (const request of transport.requests) {
      expect(request.method).toBe("GET");
      expect(request.url).not.toMatch(/Command|Payment|VerifyVoucher|identity\/v100|token/);
    }
  });
});

describe("product", () => {
  it("reads GetProductDetailsByIdV2 directly under business-fnb-gateway, NOT under CmsGateway/Query", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const branch = await c.branch(LIVE_ORG, LIVE_BRANCH);
    const details = await c.product(branch!, P_PAD_THAI);
    expect(details).not.toBeNull();
    const request = sent(transport.requests, "GetProductDetailsByIdV2");
    expect(request?.url).toContain(`/api/business-fnb-gateway/GetProductDetailsByIdV2/${P_PAD_THAI}`);
    expect(request?.url).not.toContain("CmsGateway");
  });

  it("parses modifier groups, upsell ids, category membership and localized names", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const branch = await c.branch(LIVE_ORG, LIVE_BRANCH);
    const details = await c.product(branch!, P_PAD_THAI);
    expect(details?.name).toBe("Synthetic Pad Thai");
    expect(details?.upsellProductIds.length).toBe(2);
    expect(details?.categoryIds.length).toBe(2);
    expect(details?.thirdPartyRefId).toBeNull();
    const spice = details?.modifierGroups[0];
    expect(spice).toMatchObject({ name: "Synthetic Spice Level", minSelection: 0, maxSelection: 2 });
    expect(spice?.modifiers.map((modifier) => `${modifier.name}:${modifier.price}:${modifier.isDefault ? "def" : ""}`))
      .toEqual(["Mild:0:def", "Hot:0.5:", "Volcanic:1:"]);
    expect(details?.modifierGroups[1]?.isSizeModifier).toBe(true);
  });

  it("returns null for an unknown product id", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const branch = await c.branch(LIVE_ORG, LIVE_BRANCH);
    expect(await c.product(branch!, "00000000-0000-4000-8000-00000000000a")).toBeNull();
  });
});

describe("discounts", () => {
  it("parses the two DiscountValue formats in one field: CHF strings and percent strings", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const branch = await c.branch(LIVE_ORG, LIVE_BRANCH);
    const discounts = await c.discounts(branch!);
    expect(discounts.map((discount) => [discount.name, discount.value])).toEqual([
      ["Synthetic Crew", { kind: "amount", amount: 3.5 }],
      ["Synthetic Family", { kind: "percent", percent: 98 }],
    ]);
  });

  it("carries the per-voucher minimum (MinAmountToApplyDiscount), including zero", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const branch = await c.branch(LIVE_ORG, LIVE_BRANCH);
    const discounts = await c.discounts(branch!);
    expect(discounts.map((discount) => discount.minAmountToApply)).toEqual([8, 0]);
  });

  it("never touches VerifyVoucher — metadata only, codes are not listed", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const branch = await c.branch(LIVE_ORG, LIVE_BRANCH);
    await c.discounts(branch!);
    expect(transport.requests.some((request) => request.url.includes("VerifyVoucher"))).toBe(false);
  });

  it("answers [] when the discount surface is absent", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const branch = await c.branch(WEBSHOP_ORG, WEBSHOP_BRANCH);
    expect(await c.discounts(branch!)).toEqual([]);
  });
});

const ROTATED_KEYS = {
  gatewayKey: "feedface00112233445566778899a0b1",
  tenantId: "cafebeef-0011-4223-8445-66778899a0ab",
};

describe("bundle key rotation", () => {
  it("recovers rotated constants from the app bundle and retries the refused read", async () => {
    const transport = fakeOrderMonkey({ rotatedKeys: ROTATED_KEYS });
    const branch = await client(transport.fetchImpl).branch(LIVE_ORG, LIVE_BRANCH);
    expect(branch).toMatchObject({ tier: "live", name: "Synthetic Noodle Bar" });
    const configReads = transport.requests.filter((request) => request.url.includes("GetMobileAppConfiguration"));
    expect(configReads).toHaveLength(2);
    expect(configReads[0]?.headers["apikey"]).toBe(BUNDLE_GATEWAY_KEY);
    expect(configReads[1]?.headers["apikey"]).toBe(ROTATED_KEYS.gatewayKey);
    expect(configReads[1]?.headers["tenantid"]).toBe(ROTATED_KEYS.tenantId);
    expect(transport.requests.some((request) => request.url === "https://app.ordermonkey.com/")).toBe(true);
    expect(transport.requests.some((request) => request.url.includes("main.a1b2c3d4e5f60718.js"))).toBe(true);
  });

  it("caches recovered keys across reads — one bundle fetch per client", async () => {
    const transport = fakeOrderMonkey({ rotatedKeys: ROTATED_KEYS });
    const c = client(transport.fetchImpl);
    const branch = await c.branch(LIVE_ORG, LIVE_BRANCH);
    const menu = await c.menu(branch!, "Takeaway");
    expect(menu?.categories.length).toBeGreaterThan(0);
    expect(transport.requests.filter((request) => request.url.includes("main."))).toHaveLength(1);
    const apiReads = transport.requests.filter((request) => request.url.includes("/api/"));
    for (const request of apiReads.slice(1)) {
      expect(request.headers["apikey"]).toBe(ROTATED_KEYS.gatewayKey);
    }
  });

  it("a 401 that survives recovery surfaces once, then refuses to re-fetch the bundle", async () => {
    const bundleServing = fakeOrderMonkey({ rotatedKeys: ROTATED_KEYS });
    const always401: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/api/")) {
        return jsonResponse({ Data: null, IsSuccess: false, StatusCode: 401, ErrorMessage: "Unauthorized" }, {}, 401);
      }
      return await bundleServing.fetchImpl(input, init);
    };
    const c = client(always401);
    await expect(c.branch(LIVE_ORG, LIVE_BRANCH)).rejects.toThrow(/rotated/);
    await expect(c.branch(LIVE_ORG, LIVE_BRANCH)).rejects.toThrow(/rotated again/);
    expect(bundleServing.requests.filter((request) => request.url.includes("main."))).toHaveLength(1);
  });
});

describe("network errors vs null-absent (all read surfaces)", () => {
  it("menu rejects with OrderMonkeyError when the transport dies", async () => {
    const dead: typeof fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const branch = await new OrderMonkeyClient({ fetchImpl: fakeOrderMonkey().fetchImpl }).branch(LIVE_ORG, LIVE_BRANCH);
    await expect(client(dead).menu(branch!, "Takeaway")).rejects.toBeInstanceOf(OrderMonkeyError);
  });

  it("menu returns null when the platform answers the surface failed", async () => {
    const transport = fakeOrderMonkey({ menuFailsOn: TIER2_BRANCH });
    const c = client(transport.fetchImpl);
    const branch = await c.branch(TIER2_ORG, TIER2_BRANCH);
    expect(await c.menu(branch!, "Takeaway")).toBeNull();
  });

  it("hideout display mode is carried on the branch for the menu parser", async () => {
    const transport = fakeOrderMonkey();
    const branch = await client(transport.fetchImpl).branch(HIDEOUT_ORG, "e4f5061728394a5b6c7d8e9fa0b1c2d3");
    expect(branch).toMatchObject({ tier: "live", unavailableProductDisplayMode: "HideOut", paymentProviders: ["ADYEN-ONLINE"] });
  });
});
