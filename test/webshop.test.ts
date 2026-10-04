import { describe, expect, it } from "vitest";
import { BUNDLE_GATEWAY_KEY, BUNDLE_TENANT_ID, OrderMonkeyClient } from "../src/index.js";
import { fakeOrderMonkey, WEBSHOP_BRANCH, WEBSHOP_ORG, WEBSHOP_SLUG } from "./ordermonkey-fake.js";
import { sent } from "./transport-fake.js";

function client(fetchImpl: typeof fetch): OrderMonkeyClient {
  return new OrderMonkeyClient({ fetchImpl });
}

describe("webshop lane", () => {
  it("resolves a slug to a venue with branch rows (duplicated names, ops-text HouseNo, cloud PSP type)", async () => {
    const transport = fakeOrderMonkey();
    const venue = await client(transport.fetchImpl).webshop(WEBSHOP_SLUG);
    expect(venue?.orgId).toBe(WEBSHOP_ORG);
    expect(venue?.branches).toHaveLength(1);
    const branch = venue?.branches[0];
    expect(branch).toMatchObject({
      branchId: WEBSHOP_BRANCH,
      name: "Synthetic Cantina - Default Branch",
      displayName: "Synthetic Cantina (inside Synthetic Waffles)",
      paymentProviderType: "cloud",
      isMainBranch: true,
      defaultLanguage: "de",
    });
    expect(branch?.address?.houseNo).toBe("BITTE BESTELLUNG AN DER SYNTHET-THEKE ABHOLEN!");
  });

  it("sends no identity headers on the slug resolve, org-only on the branch list", async () => {
    const transport = fakeOrderMonkey();
    await client(transport.fetchImpl).webshop(WEBSHOP_SLUG);
    const slugRequest = sent(transport.requests, "GetOrganizationsByShopDetails");
    expect(slugRequest?.headers["organizationid"]).toBeUndefined();
    expect(slugRequest?.headers["branchid"]).toBeUndefined();
    const branchRequest = sent(transport.requests, "GetAllBranch");
    expect(branchRequest?.headers["organizationid"]).toBe(WEBSHOP_ORG);
    expect(branchRequest?.headers["branchid"]).toBeUndefined();
  });

  it("delta 23: GetWebShopConfiguration 400s without BranchId — and the client always sends both", async () => {
    const transport = fakeOrderMonkey();
    const raw = await transport.fetchImpl(
      "https://app.ordermonkey.com/api/business-fnb-gateway/CmsGateway/Query/GetWebShopConfiguration",
      { headers: { ApiKey: BUNDLE_GATEWAY_KEY, TenantId: BUNDLE_TENANT_ID, OrganizationId: WEBSHOP_ORG } },
    );
    expect(raw.status).toBe(400);
    const c = client(transport.fetchImpl);
    const venue = await c.webshop(WEBSHOP_SLUG);
    await c.webshopBranch(venue!);
    const configRequest = transport.requests
      .filter((request) => request.url.includes("GetWebShopConfiguration") && request.headers["branchid"] !== undefined)
      .at(-1);
    expect(configRequest?.headers["organizationid"]).toBe(WEBSHOP_ORG);
    expect(configRequest?.headers["branchid"]).toBe(WEBSHOP_BRANCH);
  });

  it("classifies through the webshop's OWN config — live, 2% fee, ADYEN-ONLINE-WEBSHOP, minOrderValue carried", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const venue = await c.webshop(WEBSHOP_SLUG);
    const branch = await c.webshopBranch(venue!);
    expect(branch).toMatchObject({
      tier: "live",
      setupStatus: "Approved",
      currency: "CHF",
      paymentProviders: ["ADYEN-ONLINE-WEBSHOP"],
      transactionFeePercentage: 2,
      unavailableProductDisplayMode: "GrayedOut",
      minOrderValue: 0,
    });
    // The QR-lane probe of the SAME pair classifies it webshop-shaped —
    // the webshop lane is the authoritative probe for webshop venues.
    const viaQr = await c.branch(WEBSHOP_ORG, WEBSHOP_BRANCH);
    expect(viaQr?.tier).toBe("webshop");
    // Shared catalog surface accepts the webshop Branch unchanged.
    const menu = await c.menu(branch!, "Takeaway");
    expect(menu?.categories.length).toBeGreaterThan(0);
  });

  it("answers null for an unknown slug", async () => {
    const transport = fakeOrderMonkey();
    expect(await client(transport.fetchImpl).webshop("no-such-venue")).toBeNull();
  });
});
