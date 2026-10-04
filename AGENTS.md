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
- Phase-3 staging policy (orchestrator, 2026-10-04): test surfaces ONLY —
  the vendor demo branch ("Website Demo" 6447fb68…, no real kitchen, PSP
  redirect goes to Saferpay TEST) and abort-at-boundary orders. NEVER
  pay-at-counter/cash orders at real venues: a real kitchen would make
  real food.
- Public repo: never commit card numbers, HAR/pcap/logs, cookies, captured
  payloads, personal data, or venue keys from public bundles. Fakes are
  synthetic. Commit via `sh scripts/git-commit.sh`; CI runs the leak scan.
- Tests offline against a synthetic fake encoding the platform quirks
  (org+branch id pair, modifier endpoints, header auth). Every quirk is a
  test + a Lesson line.
