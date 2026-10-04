---
description: Write the client test suite for a venue API. Fake the transport, encode the quirks, feed the lessons back.
---

Write tests for CLIENT against PLATFORM. The suite must pass offline, prove
the wire contract, and stay leak-gate clean.

## Principles

1. **Test through the public methods.** Inject the transport (`fetchImpl`).
   Never mock client internals. If the client cannot accept an injected
   transport, that is the first finding — fix the client first.
2. **The fake is a router, not a per-test mock.** One `fake<Platform>()`
   factory that routes URLs and records every request (method, url,
   headers, body). Assertions read the request log: the wire contract is
   the thing under test. Share generic helpers (`test/transport-fake.ts`)
   across platforms.
3. **One describe per endpoint, one test per documented quirk.** The
   platform playbook's traps section IS the test list. Every trap becomes
   an `it(...)`.
4. **Encode session semantics in the fake, not the test.** If the API
   gates reads on headers, the fake enforces the gate itself — the
   ordering bug then fails the test naturally.
5. **Synthetic fixtures only.** Invented ids, prices, codes; RFC 2606
   `example` hosts; a provenance comment saying so. No captured payloads.
6. **Assert the read-only boundary.** This client has no order path at
   all; the test surface is that `branch`/`menu`/`product`/`discounts`
   never issue anything but header-auth GETs on Query routes.

## Steps

1. Read the platform notes (OrderMonkey: the private platform-recon
   repo's `research/ordermonkey/PLATFORM.md` — envelope, liveness tiers,
   localization shapes, venue reports).
2. Build `test/ordermonkey-fake.ts` with the quirks pre-installed.
3. Write `test/client.test.ts` (tiers, headers, network-vs-null),
   `test/menu.test.ts` (localization, prices, dedupe, stock, display
   modes), `test/resolve.test.ts` (welcome URL forms, table_no states),
   `test/cli.test.ts` (exit codes, no-order-by-design).
4. `npm test && npm run typecheck && npm run build && npm run gate` — all
   green.
5. **Learn:** every quirk you had to encode that is NOT in the platform
   notes gets added there AND to Lessons below. The tests and the
   playbook converge; that loop is the point.

## Scale to a new platform

- Copy the fake's shape, not its routes. Endpoints come from the platform
  notes of the new platform.
- Reuse `test/transport-fake.ts` helpers (headerRecord, bodyOf,
  jsonResponse, sent) — do not rewrite them per platform.
- Keep one fake per platform; a fake that grows conditionals for two
  platforms is two fakes.

## Lessons (append-only)

- Header-only auth with PUBLIC bundle constants: the fake enforces all
  four load-bearing headers (ApiKey hard gate) so a missing header fails
  every test, and one test fetches the fake raw/headers-less to prove the
  gate is real, not decorative.
- Liveness is a THREE-tier question, not a boolean: config 404 alone is
  tier-2 (catalog rows persist — menu still reads), and only the
  everything-defaults signature (org name "") is tier-3/absent. Encode
  all three branches as distinct fixtures plus the webshop shape (config
  Data null — a fourth answer, not a liveness verdict).
- Localized strings arrive as JSON-stringified 4-language maps INSIDE the
  JSON — parse twice; en may be empty (fallback de), map values may be
  null, and a THIRD shape (NameTranslations[] arrays) appears on branch
  objects. All three shapes need fixtures.
- An EMPTY menu is data: a takeaway-only branch serves `[]` for Dinein.
  null is reserved for "surface answered missing/failed" — the empty and
  failed answers are different tests.
- `GetProductDetailsByIdV2` sits directly under
  `/api/business-fnb-gateway/`, NOT under `CmsGateway/Query` — asserting
  the exact URL catches a route-join regression no shape test would.
- GetAllDiscounts nests the list inside a pager (envelope `Data.Data`)
  and mixes `"3.50"` CHF strings with `"98%"` percent strings in ONE
  field — parse to a discriminated union, keep zero minimums as 0 (not
  null), and assert VerifyVoucher is never called (metadata only).
- Same product under several categories: dedupe the catalog by ProductId
  but keep per-category listings — assert BOTH properties or the dedupe
  silently eats data.
- Category ids are heterogeneous (dashed GUIDs, 64-hex concat) — treat
  ids as opaque strings; a UUID-validated parser drops real branches.
- The leak gate trips on `apikey`-shaped key/value literals: name the
  public constants after their lane (e.g. gateway/tenant), reference the
  spec's fingerprint prefixes in comments without quotes, and keep the
  literal values only in src/http.ts.
- Org ids are NOT strict UUIDs: the run-1 dead target carries 33 hex
  total (a 5-hex group) — naive 32-hex validation rejects a REAL link
  (found live, not in the notes). Accept ~30–40 hex, preserve the dashed
  form verbatim, re-dash only exactly-32 undashed input.
- A webshop-only branch read through the QR host answers config 404 —
  indistinguishable from tier-2, catalog still readable (RYU pair,
  97 items). The notes' `Data:null` shape is a webshop-origin answer;
  classify by answer shape and let the smoke watch for flips.
- Dead pairs are canaries, menus are live data: the smoke asserts the
  dead pair STAYS null (a resolve = drift worth an issue) and asserts
  menu counts as floors, never exact numbers (Crustopia moved 21→17
  items within a single day).
- Webshop lanes are a SECOND identity system, not a URL variant: slug →
  org needs NO identity headers, branch rows need org ONLY, and the
  webshop's own config hard-requires BranchId (org-only → 400 — encode
  the 400 in the fake and assert the client never sends that shape).
  Classify webshop venues through THEIR config, never the QR probe: the
  same pair reads surface-dead via the QR host and live via the webshop
  lane — assert BOTH readings. And lane-scope your "field does not
  exist" lessons: the QR config lacks MinimumOrderValue, the webshop
  config carries it (0 = none) — a typed-null quirk went stale the
  moment the second lane arrived.
- "Closed" is a five-window AND with a trap: a venue can be closed for
  dine-in AND takeaway right now yet still accept preorders — food gets
  made at the next window (live proof: Crustopia at night, stale
  2024-dated NextAvailableTime and all). Encode isClosedForOrders as
  every-mode-unavailable AND no-future-window; assert the
  closed-with-preorder fixture answers FALSE.
- Copied invocation guards drift: the `argv[1] vs import.meta.url`
  compare came from gastronovi's pre-fix CLI and silently no-opped the
  bin through npm .bin symlinks here too (realpath before compare is
  the fix; regression-test by spawning the BUILT dist through a
  symlink, and verify consumer-grade with a tarball install in a clean
  dir). When a sibling package fixes a shared pattern, grep every
  package that copied it — jamezz still carries this one.
- Order-lane safety is a choreography, not a flag: assert the exact
  request sequence from the log (token POST with Origin + form body,
  CreateStock with BranchId/Device-ID/bearer, MakePayment with the
  payment key + OrganizationIdentifier, DeleteStock with the BranchUUID
  header — the platform's THIRD branch-header name), and make each
  refusal path prove its side effect (venue refusal → zero requests;
  non-TEST host → policy error AND release happened). The live one-shot
  against the demo pair is the only network the lane ever needs.
- Declared-but-unparsed wire fields are drift debt: the detail parser
  originally typed `Taxes` without parsing them — a parallel prototype's
  run-8 deltas (per-serving-variation tax rates, IsCombo with zero
  ComboItems, modifier IsActive, PricingMethod) forced the sync. When a
  second source encodes a field you only typed, sync parser + fixture +
  test in one pass; live data (takeaway 2.6% vs dine-in 8.1% on ONE
  product) is the assertion that matters.
- Key rotation is a READ failure, so recovery belongs in the transport
  layer: on 401 fetch the app index → main.<hash>.js, require exactly
  ONE distinct literal per constant (ambiguity throws — never guess),
  retry the refused read once, and cache both the keys and the
  recovery-attempt flag so a hard rotation costs one bundle fetch, not
  one per call. The fake needs three bundle flavors: current constants,
  rotated-with-literals (rescue succeeds), rotated-sans-literals
  (rescue fails loudly). Verify the extractor LIVE by re-deriving the
  shipped constants from the real app.
