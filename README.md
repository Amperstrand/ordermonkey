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
  every page load, recoverable from `main.*.js` on rotation; a non-404
  config failure is surfaced loudly as the rotation signal.
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
  no modifiers.
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
- Deliberate absence: **no min-order-value field exists** on this
  platform's public config — `branch.minOrderValue` is typed `null` so
  the gap is visible, not invented.

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
- **dead pair a5910451** (run-1 target, 33-hex org id) — `branch()`
  returns null: the tier-3 everything-defaults signature, live-confirmed.
- **RYU Sushi webshop pair via the QR host** (`fd75c12c…/cba95fa1…`) —
  classified `surface-dead` (config 404 on app.ordermonkey.com) with the
  full catalog still readable: 13 categories / 97 items. Spec nuance:
  the spec's "webshop venues answer config null" is not observable
  through the QR host — a webshop-only branch 404s there exactly like a
  tier-2 pair; the `webshop` tier remains the defensive classification
  for a genuine Data:null answer.

## Repo rules

Public repo — never commit card numbers, HAR/pcap/log files, cookies,
session dumps, or captured payloads; fakes are synthetic with provenance
comments. Commit via `sh scripts/git-commit.sh`; CI runs the leak scan
plus typecheck, build, and the offline test suite. Test-writing thinking
and the quirk→lesson log live in [prompts/write-tests.md](prompts/write-tests.md).

Platform spec: private platform-recon repo,
`research/ordermonkey/PLATFORM.md`.
