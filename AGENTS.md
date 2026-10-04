# AGENTS.md — contributing to ordermonkey

Read-only client for the OrderMonkey QR webapp (`app.ordermonkey.com`,
Selise): plain header-auth JSON menu API — no PoW, no login. Spec in the
private platform-recon repo (`research/ordermonkey/PLATFORM.md`).

Rules:
- READS are fully read-only: no accounts, no orders, no payments.
- The staged order lane (`src/staged-order.ts`, library-only — the CLI
  has NO order command by design) is policy-gated to test surfaces:
  vendor-demo-branch allowlist enforced before any network traffic,
  TEST-host assertion on the PSP redirect, abort-at-boundary with the
  stock hold ALWAYS released. Anonymous guest sessions only (no
  accounts). CreateSalesOrder / AuthorizePayment / SendOrderToPos stay
  documented, not implemented. Payment boundary for real orders: a
  hosted checkout a human opens (mcp-cashu-exchange docs/PAYMENT.md).
- Phase-3 staging policy (orchestrator, 2026-10-04, refined same day):
  NO real orders for now — orders go to test endpoints / test shops
  only (the demo allowlist + Saferpay TEST + abort-at-boundary). The
  noted FUTURE exception — a mechanically closed venue plus a trivial
  basket ("just a coke") — requires ALL of:
  `isClosedForOrders(availability)` true (every mode unavailable AND no
  future NextAvailableTime — a pre-order window still makes food later),
  a single drink-class item, and explicit orchestrator sign-off for that
  run. The demo-only allowlist stands until then.
- Public repo: never commit card numbers, HAR/pcap/logs, cookies, captured
  payloads, personal data, or venue keys from public bundles. Fakes are
  synthetic. Commit via `sh scripts/git-commit.sh`; CI runs the leak scan.
- Tests offline against a synthetic fake encoding the platform quirks
  (org+branch id pair, modifier endpoints, header auth). Every quirk is a
  test + a Lesson line.
