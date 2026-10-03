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
