#!/usr/bin/env node
/**
 * Weekly smoke: read-only venue check for every worked example. Plain
 * header-auth GETs only — never logs in, never places orders, never
 * touches voucher or payment surfaces. Exit 1 on drift or transport
 * failure. Item counts are asserted as FLOORS, not exact numbers —
 * venue menus drift live (Crustopia moved 21→17 items within one day).
 */
import { OrderMonkeyClient } from "../dist/index.js";

const WORKED_EXAMPLES = [
  {
    name: "Le Thai",
    orgId: "7c28afeb-2ce1-48a6-b5aa-bdb7e8d102c2",
    branchId: "cb43001f858e478e9a59479e0f6c577b",
    tier: "live",
    minItems: 40,
  },
  {
    name: "Crustopia Luzern",
    orgId: "83930a21-48d8-485c-9bcd-6f18b28806c6",
    branchId: "c7011d48887d44948fd973e7bf119e71",
    tier: "live",
    minItems: 10,
  },
  {
    name: "RYU Sushi (webshop pair via QR host)",
    orgId: "fd75c12c-f080-4970-bf3e-6b1f5383e86b",
    branchId: "cba95fa108b84b969d7b11be5c9cc2b2",
    tier: "surface-dead",
    minItems: 50,
  },
];

const DEAD_PAIR = {
  name: "run-1 target (tier-3)",
  orgId: "a5910451-76e8-4bb4a-b72f-adfcbe736fb4",
  branchId: "5c54cc427e5049e4adf364029ce2f51c",
};

const client = new OrderMonkeyClient();
let failed = false;

for (const unit of WORKED_EXAMPLES) {
  try {
    const branch = await client.branch(unit.orgId, unit.branchId);
    if (branch === null) {
      console.error(`smoke fail ${unit.name}: branch() null (was ${unit.tier})`);
      failed = true;
      continue;
    }
    if (branch.tier !== unit.tier) {
      console.error(`smoke fail ${unit.name}: tier ${branch.tier} (was ${unit.tier}) — platform drift, update PLATFORM.md + README`);
      failed = true;
      continue;
    }
    if (branch.currency !== "CHF") {
      console.error(`smoke fail ${unit.name}: currency ${branch.currency} (was CHF)`);
      failed = true;
      continue;
    }
    const menu = await client.menu(branch, "Takeaway");
    const items = menu?.categories.reduce((total, category) => total + category.products.length, 0) ?? 0;
    if (menu === null || items < unit.minItems) {
      console.error(`smoke fail ${unit.name} menu: ${menu === null ? "null (surface failed)" : `${items} items (< ${unit.minItems})`}`);
      failed = true;
    } else {
      console.log(`smoke pass ${unit.name}: ${branch.tier}, ${menu.categories.length} categories / ${items} items, ${branch.currency}`);
    }
  } catch (error) {
    console.error(`smoke fail ${unit.name}: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  }
}

try {
  const branch = await client.branch(DEAD_PAIR.orgId, DEAD_PAIR.branchId);
  if (branch !== null) {
    console.error(`smoke fail ${DEAD_PAIR.name}: no longer dead (tier ${branch.tier}, name ${branch.name}) — update PLATFORM.md + README`);
    failed = true;
  } else {
    console.log(`smoke pass ${DEAD_PAIR.name}: still tier-3 null`);
  }
} catch (error) {
  console.error(`smoke fail ${DEAD_PAIR.name}: ${error instanceof Error ? error.message : String(error)}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
