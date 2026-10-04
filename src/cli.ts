#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { OrderMonkeyClient, type Branch } from "./client.js";
import { parseWelcomeTarget } from "./resolve.js";
import { isWebshopSlug } from "./webshop.js";
import type { Menu } from "./menu.js";

/**
 * Read-only CLI: `ordermonkey menu <welcome-url-or-ids>`. Deliberately
 * NO order command — this platform's payment boundary is a hosted PSP
 * page a human opens; the client reads, a person pays.
 */
export interface CliPorts {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly fetchImpl?: typeof fetch;
}

const USAGE = `ordermonkey — read-only OrderMonkey (Selise) QR-webapp client

commands:
  menu <welcome-url-or-ids> [--type t] [--lane l]   read the branch + menu card set
                                                   --type Takeaway (default) | Dinein
                                                   --lane qr (default) | webshop
  webshop lane: <target> is a webshop slug (e.g. ryu-sushi); the venue is
  resolved via GetOrganizationsByShopDetails and classified through
  GetWebShopConfiguration (its OWN liveness probe).

<welcome-url-or-ids> is an app.ordermonkey.com/welcome/<orgId>/<branchId>
URL (optionally ?table_no=<n>) or a bare <orgId>/<branchId> pair. Reads
are plain header-auth GETs — no login, no proof-of-work, no cookies. Worked
examples: Le Thai and Crustopia Luzern welcome links (see README). An empty
Dinein read on a takeaway-only branch is data, not a dead branch — retry
with --type Takeaway. No order command exists by design.`;

function processPorts(): CliPorts {
  return {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
}

function tierNote(branch: Branch): string {
  switch (branch.tier) {
    case "live":
      return branch.setupStatus === "Approved"
        ? "live (SetupStatus Approved)"
        : `live surface, SetupStatus ${branch.setupStatus ?? "unknown"} — not Approved`;
    case "surface-dead":
      return "tier-2 surface-dead: QR-app config removed but catalog rows persist (config-404 is NOT deletion)";
    case "webshop":
      return "webshop-lane branch: GetMobileAppConfiguration is null there — QR liveness probe does not apply";
  }
}

function printBranch(branch: Branch, out: (line: string) => void): void {
  out(`branch ${branch.branchId}`);
  out(`  org:        ${branch.orgId}`);
  out(`  venue:      ${branch.name ?? "(no org name served)"}`);
  if (branch.branchName !== null) out(`  branch:     ${branch.branchName}`);
  out(`  tier:       ${tierNote(branch)}`);
  out(`  currency:   ${branch.currency}`);
  if (branch.defaultLanguage !== null) out(`  language:   ${branch.defaultLanguage}`);
  out(
    `  psps:       ${branch.paymentProviders.length === 0 ? "none published" : branch.paymentProviders.join(", ")}`
      + (branch.transactionFeePercentage === null ? "" : ` (fee ${branch.transactionFeePercentage}%)`),
  );
  out(
    `  min order:  ${
      branch.minOrderValue === null
        ? "none published (no field on the QR-lane config)"
        : branch.minOrderValue === 0
          ? "none (webshop config: 0)"
          : String(branch.minOrderValue)
    }`,
  );
}

function printMenu(menu: Menu, out: (line: string) => void): void {
  const items = menu.categories.flatMap((category) => category.products);
  out(`menu ${menu.type} — ${menu.categories.length} category(ies), ${items.length} item(s), ${menu.currency} (${menu.updatedAt})`);
  if (menu.categories.length === 0) {
    out(`  (no cards in this type — a takeaway-only branch serves no Dinein cards; try --type Takeaway)`);
    return;
  }
  for (const category of menu.categories) {
    out(category.name);
    for (const item of category.products) {
      const price = item.normalPrice.toFixed(2);
      const unavailable = item.available ? "" : "  (unavailable)";
      out(`  ${item.name}  ${price} ${menu.currency}  [${item.productId}]${unavailable}`);
    }
  }
  if (menu.hiddenItems.length > 0) {
    out(`  (${menu.hiddenItems.length} additional item(s) hidden by UnavailableProductDisplayMode HideOut)`);
  }
}

interface ParsedArgs {
  readonly command: string | undefined;
  readonly target: string | undefined;
  readonly type: "Takeaway" | "Dinein";
  readonly lane: "qr" | "webshop";
}

function parseArgs(argv: readonly string[]): ParsedArgs | null {
  let command: string | undefined;
  let target: string | undefined;
  let type: "Takeaway" | "Dinein" = "Takeaway";
  let lane: "qr" | "webshop" = "qr";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) break;
    if (arg === "--type") {
      const value = argv[i + 1];
      if (value !== "Takeaway" && value !== "Dinein") return null;
      type = value;
      i += 1;
      continue;
    }
    if (arg === "--lane") {
      const value = argv[i + 1];
      if (value !== "qr" && value !== "webshop") return null;
      lane = value;
      i += 1;
      continue;
    }
    if (command === undefined) command = arg;
    else if (target === undefined) target = arg;
    else return null;
  }
  return { command, target, type, lane };
}

export async function runCli(
  argv: readonly string[],
  ports: CliPorts = processPorts(),
): Promise<0 | 1> {
  const args = parseArgs(argv);
  if (args === null) {
    ports.err("--type must be Takeaway or Dinein; --lane must be qr or webshop");
    ports.err(USAGE);
    return 1;
  }
  const { command, target, type, lane } = args;
  if (command === undefined || command === "help" || command === "-h" || command === "--help") {
    ports.out(USAGE);
    return 0;
  }
  if (command !== "menu") {
    ports.err(`unknown command: ${command} — no order command exists by design (read-only client)`);
    ports.err(USAGE);
    return 1;
  }
  if (target === undefined) {
    ports.err("menu needs a welcome URL or <orgId>/<branchId> pair");
    return 1;
  }
  const client = new OrderMonkeyClient(ports.fetchImpl === undefined ? {} : { fetchImpl: ports.fetchImpl });
  try {
    let branch: Branch | null;
    if (lane === "webshop") {
      if (!isWebshopSlug(target)) {
        ports.err(`not a webshop slug: ${target}`);
        return 1;
      }
      const venue = await client.webshop(target);
      if (venue === null) {
        ports.err(`no webshop venue for slug ${target}`);
        return 1;
      }
      ports.out(`webshop ${venue.slug} — org ${venue.orgId} — ${venue.branches.length} branch(es)`);
      for (const row of venue.branches) {
        ports.out(`  branch ${row.branchId}  ${row.displayName ?? row.name ?? "?"}${row.isMainBranch ? " (main)" : ""}`);
        const note = row.address?.houseNo;
        if (note !== null && note !== undefined) {
          ports.out(`    pickup note (HouseNo): ${note}`);
        }
      }
      branch = await client.webshopBranch(venue);
      if (branch === null) {
        ports.err(`webshop venue ${target} has no classifiable branch`);
        return 1;
      }
    } else {
      const parsed = parseWelcomeTarget(target);
      if (parsed === null) {
        ports.err(`cannot parse welcome URL or id pair: ${target}`);
        return 1;
      }
      if (parsed.tableNo !== null) {
        ports.out(`table ${parsed.tableNo} (dine-in bound to this table)`);
      }
      branch = await client.branch(parsed.orgId, parsed.branchId);
      if (branch === null) {
        ports.err(
          `no branch for ${target} (tier-3 dead pair: every endpoint answers defaults — indistinguishable from random UUIDs)`,
        );
        return 1;
      }
    }
    printBranch(branch, ports.out);
    const menu = await client.menu(branch, type);
    if (menu === null) {
      ports.err("menu surface missing or failed (platform answered, no card set served)");
      return 1;
    }
    printMenu(menu, ports.out);
    return 0;
  } catch (error) {
    ports.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  process.exit(await runCli(process.argv.slice(2)));
}
