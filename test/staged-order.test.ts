import { describe, expect, it } from "vitest";
import {
  anonymousSession,
  BUNDLE_PAYMENT_KEY,
  isStagedTestSurface,
  OrderMonkeyClient,
  OrderMonkeyPolicyError,
  refreshSession,
  STAGED_TEST_BRANCH,
  STAGED_TEST_ORG,
} from "../src/index.js";
import {
  DEMO_BRANCH,
  DEMO_ORG,
  fakeOrderMonkey,
  LIVE_ORG,
  P_DEMO_BURGER,
} from "./ordermonkey-fake.js";
import { sent } from "./transport-fake.js";

function client(fetchImpl: typeof fetch): OrderMonkeyClient {
  return new OrderMonkeyClient({ fetchImpl });
}

async function demoBranch(fetchImpl: typeof fetch) {
  const branch = await client(fetchImpl).branch(DEMO_ORG, DEMO_BRANCH);
  expect(branch).not.toBeNull();
  return branch!;
}

describe("anonymous session", () => {
  it("grants a token via authenticate_site with the Origin header and a refresh cookie", async () => {
    const transport = fakeOrderMonkey();
    const session = await anonymousSession(transport.fetchImpl);
    expect(session.accessToken).toMatch(/^synthetic-anonymous-token-/);
    expect(session.refreshCookie).toMatch(/^synthetic-refresh-cookie-/);
    const request = sent(transport.requests, "/identity/token");
    expect(request?.headers["origin"]).toBe("https://app.ordermonkey.com");
    expect(request?.headers["content-type"]).toContain("application/x-www-form-urlencoded");
    expect(request?.body).toBe("grant_type=authenticate_site");
  });

  it("refresh answers 420 s and does NOT rotate the refresh cookie", async () => {
    const transport = fakeOrderMonkey();
    const first = await anonymousSession(transport.fetchImpl);
    const start = 1_800_000_000_000;
    const second = await refreshSession(first, transport.fetchImpl, () => start);
    expect(second.expiresAtMs).toBe(start + 420_000);
    expect(second.refreshCookie).toBe(first.refreshCookie);
    const refreshRequest = transport.requests.filter((request) => request.body === "grant_type=refresh_token")[0];
    expect(refreshRequest?.headers["cookie"]).toContain(`httpOnlyRefreshToken=${first.refreshCookie}`);
  });

  it("the identity endpoint hard-requires Origin (400 without)", async () => {
    const transport = fakeOrderMonkey();
    const response = await transport.fetchImpl("https://app.ordermonkey.com/api/identity/v100/identity/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=authenticate_site",
    });
    expect(response.status).toBe(400);
  });
});

describe("staged order lane", () => {
  it("runs hold → TEST redirect → release on the demo branch, with exact wire shapes", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const branch = await demoBranch(transport.fetchImpl);
    const result = await c.stagedOrder(branch, [{ productId: P_DEMO_BURGER, quantity: 2, unitPrice: 13 }], {
      cartId: "aa11bb22cc33-4711-8d55-feedface0d0e",
    });

    expect(result.stockHoldCreated).toBe(true);
    expect(result.released).toBe(true);
    expect(result.payment.amount).toBe(26);
    expect(result.payment.currency).toBe("CHF");
    expect(new URL(result.payment.redirectUrl).hostname).toBe("test.saferpay.com");
    expect(result.payment.paymentDetailId).not.toBeNull();

    const stock = sent(transport.requests, "CreateStock");
    expect(stock?.headers["branchid"]).toBe(DEMO_BRANCH);
    expect(stock?.headers["device-id"]).toBe("ordermonkey-staged-client");
    expect(String(stock?.headers["authorization"])).toMatch(/^Bearer synthetic/);
    expect(JSON.parse(String(stock?.body))).toEqual({
      OrganizationId: DEMO_ORG,
      BranchUUID: DEMO_BRANCH,
      ProductList: [{ ProductId: P_DEMO_BURGER, Quantity: 2 }],
      CartId: "aa11bb22cc33-4711-8d55-feedface0d0e",
      PaymentType: "online",
      StockFor: "Takeaway",
    });

    const payment = transport.requests.find((request) => request.url.includes("MakePayment"));
    expect(payment?.headers["apikey"]).toBe(BUNDLE_PAYMENT_KEY);
    expect(payment?.headers["organizationidentifier"]).toBe(DEMO_BRANCH);
    expect(JSON.parse(String(payment?.body))).toMatchObject({
      Amount: 26,
      CurrencyCode: "CHF",
      Description: "Place Order For this Order Id: aa11bb22cc33-4711-8d55-feedface0d0e",
      OrderId: "aa11bb22cc33-4711-8d55-feedface0d0e",
      Language: "de",
    });

    const release = transport.requests.find((request) => request.url.includes("DeleteStock/aa11bb22cc33-4711-8d55-feedface0d0e"));
    expect(release?.method).toBe("DELETE");
    expect(release?.headers["branchuuid"]).toBe(DEMO_BRANCH);
  });

  it("refuses non-allowlisted venues before ANY network traffic", async () => {
    const transport = fakeOrderMonkey();
    const c = client(transport.fetchImpl);
    const live = await c.branch(LIVE_ORG, "a0b1c2d3e4f5061728394a5b6c7d8e9f");
    const requestsBefore = transport.requests.length;
    await expect(
      c.stagedOrder(live!, [{ productId: P_DEMO_BURGER, quantity: 1, unitPrice: 13 }]),
    ).rejects.toBeInstanceOf(OrderMonkeyPolicyError);
    expect(transport.requests.length).toBe(requestsBefore);
  });

  it("refuses a non-TEST redirect host AND still releases the hold", async () => {
    const transport = fakeOrderMonkey({ paymentRedirectHost: "www.saferpay.com" });
    const c = client(transport.fetchImpl);
    const branch = await demoBranch(transport.fetchImpl);
    await expect(
      c.stagedOrder(branch, [{ productId: P_DEMO_BURGER, quantity: 1, unitPrice: 13 }], {
        cartId: "bb22cc33dd44-4711-8d55-feedface0d0e",
      }),
    ).rejects.toThrow(/not a TEST host/);
    expect(transport.requests.some((request) => request.url.includes("DeleteStock/bb22cc33dd44-4711-8d55-feedface0d0e"))).toBe(true);
  });

  it("empty item lists are a policy error", async () => {
    const transport = fakeOrderMonkey();
    const branch = await demoBranch(transport.fetchImpl);
    await expect(client(transport.fetchImpl).stagedOrder(branch, [])).rejects.toBeInstanceOf(OrderMonkeyPolicyError);
  });

  it("isStagedTestSurface matches the demo pair only", () => {
    expect(isStagedTestSurface(STAGED_TEST_ORG, STAGED_TEST_BRANCH)).toBe(true);
    expect(isStagedTestSurface(STAGED_TEST_ORG.toUpperCase(), STAGED_TEST_BRANCH)).toBe(true);
    expect(isStagedTestSurface(LIVE_ORG, STAGED_TEST_BRANCH)).toBe(false);
    expect(isStagedTestSurface(STAGED_TEST_ORG, "a0b1c2d3e4f5061728394a5b6c7d8e9f")).toBe(false);
  });
});
