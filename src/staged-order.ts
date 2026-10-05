import type { Branch } from "./client.js";
import { asTransportError } from "./error.js";
import {
  BUNDLE_GATEWAY_KEY,
  BUNDLE_PAYMENT_KEY,
  BUNDLE_TENANT_ID,
  ORDERMONKEY_ORIGIN,
  postJson,
} from "./http.js";
import type { GuestSession } from "./session.js";
import { anonymousSession } from "./session.js";

/**
 * STAGED ORDER LANE — orchestrator policy (2026-10-04): test surfaces
 * ONLY. Everything in this module is built so an order can neither reach
 * a real kitchen nor complete a real payment:
 *
 *  1. A hard allowlist: staged orders run against the vendor demo
 *     branch pair below and NOTHING else — refusal happens before any
 *     network traffic.
 *  2. A TEST-host assertion on the PSP redirect: a redirect to anything
 *     but a known TEST host is a policy error (and the stock hold is
 *     released before rethrowing).
 *  3. Abort-at-boundary by construction: the flow ends at the redirect
 *     and ALWAYS releases the stock hold. AuthorizePayment,
 *     CreateSalesOrder, and SendOrderToPos are never called.
 */

export const STAGED_TEST_ORG = "6447fb68-86a5-4448-ba4f-a54c1dfd99eb";
export const STAGED_TEST_BRANCH = "7d818c40a47e4b428d566ab248b822ec";

/** Known PSP TEST hosts (the demo branch redirects to Saferpay's sandbox). */
const TEST_PSP_HOSTS: readonly string[] = ["test.saferpay.com"];

const COMMAND = "/api/business-fnb-gateway/CmsGateway/Command";
const PAYMENT = "/api/payment-service/v100/PaymentService/ExternalPaymentCommand/MakePayment";

export class OrderMonkeyPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderMonkeyPolicyError";
  }
}

export function isStagedTestSurface(orgId: string, branchId: string): boolean {
  return orgId.toLowerCase() === STAGED_TEST_ORG && branchId.toLowerCase() === STAGED_TEST_BRANCH;
}

/** Throws OrderMonkeyPolicyError unless the URL's host is a known PSP TEST host. */
export function assertTestRedirectHost(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OrderMonkeyPolicyError(`payment redirect is not a URL: ${url.slice(0, 80)}`);
  }
  if (!TEST_PSP_HOSTS.includes(parsed.hostname)) {
    throw new OrderMonkeyPolicyError(
      `payment redirect host ${parsed.hostname} is not a TEST host (${TEST_PSP_HOSTS.join(", ")}) — refusing to proceed`,
    );
  }
  return parsed;
}

export interface StagedItem {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

export interface StagedOrderOptions {
  readonly customerName?: string;
  readonly customerEmail?: string;
  readonly customerPhone?: string;
  readonly device?: string;
  readonly cartId?: string;
  readonly session?: GuestSession;
}

export interface StagedOrderResult {
  readonly cartId: string;
  readonly stockHoldCreated: boolean;
  readonly payment: {
    readonly provider: string;
    readonly amount: number;
    readonly currency: string;
    readonly redirectUrl: string;
    readonly paymentDetailId: string | null;
    readonly token: string | null;
    readonly expiresAt: string | null;
  };
  /** Always true on success: the hold is released before returning (abort-at-boundary). */
  readonly released: boolean;
}

interface RawCommandResult {
  readonly StatusCode?: number;
  readonly ErrorMessage?: string | null;
  readonly Errors?: { readonly IsValid?: boolean };
}

interface RawMakePaymentResult {
  readonly RedirectUrl?: string;
  readonly Token?: string | null;
  readonly Expiration?: string | null;
  readonly PaymentDetailId?: string | null;
  readonly StatusCode?: number;
  readonly ErrorMessage?: string | null;
}

function commandHeaders(
  branch: Branch,
  session: GuestSession,
  device: string,
  branchHeader: "BranchId" | "BranchUUID",
): Record<string, string> {
  return {
    "user-agent": "ordermonkey/0.2",
    accept: "application/json",
    "content-type": "application/json",
    ApiKey: BUNDLE_GATEWAY_KEY,
    TenantId: BUNDLE_TENANT_ID,
    OrganizationId: branch.orgId,
    [branchHeader]: branch.branchId,
    "Device-ID": device,
    authorization: `Bearer ${session.accessToken}`,
  };
}

function paymentHeaders(branch: Branch): Record<string, string> {
  return {
    "content-type": "application/json",
    ApiKey: BUNDLE_PAYMENT_KEY,
    TenantId: BUNDLE_TENANT_ID,
    OrganizationId: branch.orgId,
    // Payment endpoints rename the branch header AND swap the key.
    OrganizationIdentifier: branch.branchId,
  };
}

function refused(context: string, failure: { readonly status: number; readonly body: string }): Error {
  return failure.status === 0
    ? asTransportError(new Error(`${context}: ${failure.body}`))
    : new Error(`${context}: HTTP ${failure.status}`);
}

async function releaseStockHold(
  branch: Branch,
  session: GuestSession,
  device: string,
  cartId: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      `${ORDERMONKEY_ORIGIN}${COMMAND}/DeleteStock/${encodeURIComponent(cartId)}`,
      {
        method: "DELETE",
        // Third header-name variant: stock release keys the branch as
        // BranchUUID, not BranchId.
        headers: commandHeaders(branch, session, device, "BranchUUID"),
        signal: AbortSignal.timeout(20_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

function totalAmount(items: readonly StagedItem[]): number {
  return Math.round(items.reduce((total, item) => total + item.unitPrice * item.quantity, 0) * 100) / 100;
}

/**
 * Runs the staged order flow against the vendor demo branch and ABORTS
 * at the PSP boundary: anonymous session → CreateStock hold →
 * MakePayment (test redirect obtained, never opened) → DeleteStock
 * release. Throws OrderMonkeyPolicyError for any non-allowlisted venue
 * or non-TEST redirect host. AuthorizePayment / CreateSalesOrder /
 * SendOrderToPos are never part of this flow.
 */
export async function stagedOrder(
  branch: Branch,
  items: readonly StagedItem[],
  options: StagedOrderOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<StagedOrderResult> {
  if (!isStagedTestSurface(branch.orgId, branch.branchId)) {
    throw new OrderMonkeyPolicyError(
      "staged orders run on the vendor demo branch only (policy: test surfaces — a real kitchen would make real food)",
    );
  }
  if (items.length === 0) throw new OrderMonkeyPolicyError("staged order needs at least one item");
  const session = options.session ?? await anonymousSession(fetchImpl);
  const device = options.device ?? "ordermonkey-staged-client";
  const cartId = options.cartId ?? crypto.randomUUID();

  const stock = await postJson<RawCommandResult>(
    `${ORDERMONKEY_ORIGIN}${COMMAND}/CreateStock`,
    {
      OrganizationId: branch.orgId,
      BranchUUID: branch.branchId,
      ProductList: items.map((item) => ({ ProductId: item.productId, Quantity: item.quantity })),
      CartId: cartId,
      PaymentType: "online",
      StockFor: "Takeaway",
    },
    commandHeaders(branch, session, device, "BranchId"),
    fetchImpl,
  );
  if (!stock.ok || stock.value.Errors?.IsValid !== true) {
    throw stock.ok
      ? new Error(`CreateStock refused: StatusCode ${stock.value.StatusCode ?? "?"}`)
      : refused("CreateStock failed", stock);
  }

  let payment: RawMakePaymentResult;
  try {
    const result = await postJson<RawMakePaymentResult>(
      `${ORDERMONKEY_ORIGIN}${PAYMENT}`,
      {
        ProviderName: branch.paymentProviders[0] ?? "SIX",
        Amount: totalAmount(items),
        CurrencyCode: branch.currency,
        Description: `Place Order For this Order Id: ${cartId}`,
        OrderId: cartId,
        Language: branch.defaultLanguage ?? "en",
        CustomerName: options.customerName ?? "OrderMonkey Staged Test",
        CustomerEmail: options.customerEmail ?? "",
        CustomerPhone: options.customerPhone ?? "",
      },
      paymentHeaders(branch),
      fetchImpl,
    );
    if (!result.ok) throw refused("MakePayment failed", result);
    if (result.value.RedirectUrl === undefined || result.value.RedirectUrl === "") {
      throw new Error("MakePayment answered without a redirect URL");
    }
    assertTestRedirectHost(result.value.RedirectUrl);
    payment = result.value;
  } catch (error) {
    await releaseStockHold(branch, session, device, cartId, fetchImpl);
    throw error;
  }

  const released = await releaseStockHold(branch, session, device, cartId, fetchImpl);
  if (!released) {
    throw new Error(`staged order ${cartId}: PSP boundary reached but the stock hold could not be released — investigate`);
  }
  return {
    cartId,
    stockHoldCreated: true,
    payment: {
      provider: branch.paymentProviders[0] ?? "SIX",
      amount: totalAmount(items),
      currency: branch.currency,
      redirectUrl: payment.RedirectUrl ?? "",
      paymentDetailId: payment.PaymentDetailId ?? null,
      token: payment.Token ?? null,
      expiresAt: payment.Expiration ?? null,
    },
    released,
  };
}
