# ordermonkey

Read-only client for the OrderMonkey QR webapp (`app.ordermonkey.com`,
Selise Digital Platforms). Plain four-header GET menu reads — the easiest
platform we have mapped: no proof-of-work, no login, no cookies, no
anonymous JWT for reads. Currency is CHF everywhere. Worked examples: the
Le Thai and Crustopia Luzern welcome links below.

Read-only by design: **no accounts, no orders, no payments**. There is no
order command in this package on purpose; checkout on this platform is a
hosted PSP redirect (SIX / ADYEN-ONLINE …) a human opens. The anonymous
`authenticate_site` token grant and the `CreateSalesOrder` /
`ExternalPaymentCommand` surfaces are documented in the platform spec,
not implemented. Payment endpoints additionally swap the key
(PaymentApiKey) and rename the branch header to `OrganizationIdentifier`.

Phase-3 staging policy (orchestrator, 2026-10-04, refined same day):
**no real orders for now** — orders go to test endpoints / test shops
only (the vendor-demo allowlist above + Saferpay TEST +
abort-at-boundary). A noted *future* exception — a mechanically closed
venue plus a trivial basket ("just a coke") — requires all of:
`isClosedForOrders(availability)` verified true, a single drink-class
item, and explicit orchestrator sign-off for that run. The pre-order
trap is why the check is strict: a venue that opens (or accepts
pre-orders) tomorrow would still make the food then.

## Availability (the closed-venue fact)

`client.availability(branch)` reads `CheckBranchAvailability` — the same
probe the SPA fires on page load (empty-body POST, four read headers, no
session). Five per-mode schedule windows come back with the platform's
epoch-zero null sentinel (`IsAvailable:true` + zero times = not
hour-gated). `isClosedForOrders(availability)` is the mechanical
precondition the closed-venue exception would need: every mode
unavailable AND no future `NextAvailableTime` anywhere.

## Staged order lane (library-only, policy-gated)

`client.stagedOrder(branch, items)` implements the sanctioned test flow:
anonymous guest session (`authenticate_site` grant — Origin header
hard-required, ~600 s tokens, refresh at ~420 s with a non-rotating
refresh cookie) → `CreateStock` hold (Command headers: four + `Device-ID`
+ bearer) → `MakePayment` (payment headers: the payment lane key +
`OrganizationIdentifier` branch header) → **TEST-host assertion** on the
redirect → `DeleteStock` release (`BranchUUID` header — this platform's
third branch-header name). Three rails make it safe by construction:
a hard demo-pair allowlist refused **before any network traffic**, a
TEST-PSP-host allowlist (`test.saferpay.com`) that turns any other
redirect into a policy error (hold released before rethrowing), and
abort-at-boundary — `AuthorizePayment`, `CreateSalesOrder`, and
`SendOrderToPos` are never called. The CLI has no order command by
design.

Both guest surfaces are covered: the **QR lane**
(`app.ordermonkey.com/welcome/<orgId>/<branchId>`) and the **webshop
lane** (`webshop.ordermonkey.com/<slug>` → slug resolves to org → branch
rows → `GetWebShopConfiguration`, the webshop's OWN liveness probe —
which hard-requires BranchId).

```sh
npm install github:Amperstrand/ordermonkey
```

```ts
import { OrderMonkeyClient, parseWelcomeTarget } from "ordermonkey";

const client = new OrderMonkeyClient();
const target = parseWelcomeTarget(
  "https://app.ordermonkey.com/welcome/7c28afeb-2ce1-48a6-b5aa-bdb7e8d102c2/cb43001f858e478e9a59479e0f6c577b",
);
const branch = await client.branch(target!.orgId, target!.branchId); // identity + tier
const menu = await client.menu(branch!, "Takeaway");                 // card set, CHF
const details = await client.product(branch!, menu!.products[0]!.productId); // modifiers
```

CLI (Node 22+):

```sh
npx ordermonkey menu "https://app.ordermonkey.com/welcome/7c28afeb-2ce1-48a6-b5aa-bdb7e8d102c2/cb43001f858e478e9a59479e0f6c577b"
npx ordermonkey menu <orgId>/<branchId> --type Dinein
npx ordermonkey menu ryu-sushi --lane webshop
```

## Error semantics

A thrown `OrderMonkeyError` (reason `"network"`) means the platform was
unreachable. A `null` return always means the platform answered and the
thing is absent — a tier-3 dead pair, an unknown product id, a failed
menu surface. An **empty** menu is data, not absence: a takeaway-only
branch serves no Dinein cards (retry with `--type Takeaway`).

## Liveness: three tiers, one null

`branch()` classifies the (orgId, branchId) pair:

- **live** — `GetMobileAppConfiguration` answers 200,
  `SetupStatus:"Approved"` (a non-Approved setup status is surfaced on
  the branch object).
- **surface-dead (tier-2)** — config 404s (`No data found`) but the
  organization name and catalog rows persist: the mobile-app surface was
  removed, the data was not. Menus still read.
- **webshop** — config answers 200 with `Data:null`: webshop-lane
  branch; webshop config lives in `GetWebShopConfiguration` and the
  QR-app liveness probe does not apply there.
- **null (tier-3)** — every endpoint answers defaults (empty org name):
  indistinguishable from random UUIDs. Dead or never-provisioned.

## What the client encodes

- The four load-bearing read headers (ApiKey, TenantId, OrganizationId,
  BranchId) with the public bundle constants — platform keys shipped in
  every page load; on a 401 the client re-derives them once from the
  app bundle (index → `main.<hash>.js`, `recoverBundleConstants`) and
  retries the refused read — ambiguous or missing literals throw
  instead of guessing, and a 401 that survives recovery surfaces as an
  error (one bundle fetch per client, never a loop).
- The response envelope (`{Data, IsSuccess, StatusCode, ErrorMessage, …}`)
  and its not-found form (HTTP 404 `No data found`).
- Three localization shapes: JSON-stringified 4-language maps (parse
  twice, `en` fallback, null/empty values tolerated), plain strings, and
  `NameTranslations[]` arrays on branch objects.
- Numeric prices with `DiscountPrice` mirroring `NormalPrice` when unset;
  CHF 0 items ride along as data.
- Modifier reads need the per-product detail call
  (`GetProductDetailsByIdV2/<id>` — a route that sits directly under
  `business-fnb-gateway`, not under `CmsGateway/Query`); categories carry
  no modifiers. Detail payloads carry **per-serving-variation taxes**
  (one Margherita serves takeaway 2.6% vs dine-in 8.1%), `IsCombo` —
  which does NOT imply `ComboItems` content —, per-modifier `IsActive`
  and group `PricingMethod`; all carried, nothing inferred.
- Product dedupe by ProductId across categories; heterogeneous id shapes
  (dashed GUIDs, 64-hex concat, POS `ThirdPartyRefId`, blob-path ids in
  media URLs — three-plus id spaces, all opaque strings).
- Stock semantics (`StockLimitType`/`CurrentStock`/`StockAlertLimit`) and
  `UnavailableProductDisplayMode` `"GrayedOut"` (kept, flagged) vs
  `"HideOut"` (hidden from cards, kept in `menu.hiddenItems`).
- Empty categories dropped (venue origin-declaration sections with zero
  products).
- Welcome-URL resolution (`/welcome/<orgId>/<branchId>` and the
  `/v2/` SPA route, bare id pairs) including the table QR `?table_no=`
  states: a number binds dine-in to a table; an EMPTY `table_no` means
  dine-in without table binding (both are test vectors). Org ids are
  accepted at 30–40 hex total — 33-hex non-UUID live links exist.
- Public voucher metadata (`GetAllDiscounts`): names, per-voucher
  `MinAmountToApplyDiscount`, and the two `DiscountValue` formats ("3.50"
  CHF strings and "98%" percent strings in one field). Codes are never
  listed and `VerifyVoucher` is never called.
- Deliberate absence, lane-scoped: the **QR-lane config has NO
  min-order-value field** (`branch.minOrderValue` is null there); the
  **webshop config DOES carry `MinimumOrderValue`** (0 = none published)
  plus `IsProductHideOnZero` — the quirk is lane-specific, and the type
  makes the gap visible instead of inventing a value.
- Webshop lane: slug → org via `GetOrganizationsByShopDetails` (no
  identity headers), branch rows via `GetAllBranch?IsWebshopRequest=true`
  (OrganizationId header only) — rows duplicate `BranchName`/`Name` and
  carry `NameTranslations` (the venue-facing name), ops text can ride in
  `Address.HouseNo` (passed through verbatim), and the branch row's
  `PaymentProviderType` ("cloud") differs from the config's
  `PaymentProviders`. `GetWebShopConfiguration` hard-requires BranchId
  (org-only → HTTP 400) and answers on BOTH origins.

## Verification (live, 2026-10-03)

- **Le Thai** (`welcome/7c28afeb-2ce1-48a6-b5aa-bdb7e8d102c2/cb43001f858e478e9a59479e0f6c577b`)
  — `ordermonkey menu <url>`: tier live, SetupStatus Approved, venue
  "Le Thai", SIX / 1.2% fee, default language fr, GrayedOut display
  mode; Takeaway card set **13 categories / 64 items**, CHF (Steamed
  Rice 3.00, Pad Thai side 8.00). Dinein on the same pair answers an
  EMPTY-but-valid card set — the takeaway gate is data, not death.
- **Crustopia Luzern** (`welcome/83930a21-48d8-485c-9bcd-6f18b28806c6/c7011d48887d44948fd973e7bf119e71`)
  — `ordermonkey menu <url>`: tier live, venue "Crustopia Luzern",
  branch "Crustopia KLG", ADYEN-ONLINE / 1% fee; Takeaway **3
  categories / 17 items** incl. "Pizza - Ø32cm"; Margherita CHF 18.50
  with two modifier groups via GetProductDetailsByIdV2 (Flavor Options,
  4 modifiers, max 3; Extras, 18 modifiers, max 5) + 3 upsell ids.
  GetAllDiscounts live: empty for this venue ([] — the surface answers,
  no public vouchers).
- **bundle-key recovery (extractor live check)** —
  `recoverBundleConstants()` against the live app re-derived exactly the
  shipped constants (prefixes c0d8c6f8 / 8F040955) from the served
  index + `main.<hash>.js`; the rotation rescue is exercised offline
  against a synthetic rotated bundle (56 tests).
- **RYU Sushi webshop lane** (`--lane webshop ryu-sushi`, 2026-10-04) —
  slug → org `fd75c12c…` → 1 branch (`cba95fa1…`, main, de), ops-text
  pickup note in `HouseNo`, classified **live** through
  `GetWebShopConfiguration` (SetupStatus Approved, ADYEN-ONLINE-WEBSHOP,
  2% fee, MinimumOrderValue 0 — the field the QR config lacks); full
  catalog through the shared menu read: 13 categories / 97 items.
- **dead pair a5910451** (run-1 target, 33-hex org id) — `branch()`
  returns null: the tier-3 everything-defaults signature, live-confirmed.
- **RYU Sushi webshop pair via the QR host** (`fd75c12c…/cba95fa1…`) —
  classified `surface-dead` (config 404 on app.ordermonkey.com) with the
  full catalog still readable: 13 categories / 97 items. Spec nuance:
  the spec's "webshop venues answer config null" is not observable
  through the QR host — a webshop-only branch 404s there exactly like a
  tier-2 pair; the `webshop` tier remains the defensive classification
  for a genuine Data:null answer.

- **staged order lane, live (2026-10-04)** — `stagedOrder()` on the
  Website Demo branch (Coca-Cola, CHF 4): anonymous session granted,
  stock hold created, `MakePayment` answered a
  **test.saferpay.com** redirect (SIX, PaymentDetailId issued, ~55 min
  expiration), redirect never opened, hold **released**. Zero real food,
  zero charge, zero persistent order (the recon's boundary proof:
  aborted PSP redirects leave no retrievable sales order and never fire
  `SendOrderToPos`).

- **availability, live (2026-10-04, ~01:30 CET)** — Website Demo and Le
  Thai read fully available (not hour-gated); Crustopia Luzern reads
  dine-in/takeaway CLOSED for the night with a next-window scheduled —
  and `isClosedForOrders` correctly answers **false** (preorder still
  accepted ⇒ food would be made later). Their `NextAvailableTime` even
  carries a stale 2024 date — more reason the closed-venue check must be
  conservative, not presence-based.

## Repo rules

Public repo — never commit card numbers, HAR/pcap/log files, cookies,
session dumps, or captured payloads; fakes are synthetic with provenance
comments. Commit via `sh scripts/git-commit.sh`; CI runs the leak scan
plus typecheck, build, and the offline test suite. Test-writing thinking
and the quirk→lesson log live in [prompts/write-tests.md](prompts/write-tests.md).

Platform spec: private platform-recon repo,
`research/ordermonkey/PLATFORM.md`.
