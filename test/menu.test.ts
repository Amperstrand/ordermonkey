import { describe, expect, it } from "vitest";
import { OrderMonkeyClient } from "../src/index.js";
import {
  fakeOrderMonkey,
  HIDEOUT_BRANCH,
  HIDEOUT_ORG,
  LIVE_BRANCH,
  LIVE_ORG,
  P_PAD_THAI,
  P_RICE,
  P_SPRING,
  P_TEA,
} from "./ordermonkey-fake.js";

const CLOCK = new Date("2026-10-03T12:00:00Z");

async function liveMenu(): Promise<ReturnType<OrderMonkeyClient["menu"]>> {
  const transport = fakeOrderMonkey();
  const c = new OrderMonkeyClient({ fetchImpl: transport.fetchImpl, now: () => CLOCK });
  const branch = await c.branch(LIVE_ORG, LIVE_BRANCH);
  return await c.menu(branch!, "Takeaway");
}

describe("menu localization", () => {
  it("double-parses JSON-stringified 4-language maps", async () => {
    const menu = await liveMenu();
    expect(menu?.categories.map((category) => category.name)).toEqual(["Synthetic Noodles", "Synthetic Sides"]);
  });

  it("falls back past an empty en value (en → de)", async () => {
    const menu = await liveMenu();
    const padThai = menu?.products.find((item) => item.productId === P_PAD_THAI);
    expect(padThai?.name).toBe("Synthetisches Pad Thai");
  });

  it("passes plain-string names through untouched", async () => {
    const menu = await liveMenu();
    expect(menu?.categories[1]?.name).toBe("Synthetic Sides");
  });

  it("tolerates null map values (en wins anyway)", async () => {
    const menu = await liveMenu();
    expect(menu?.products.find((item) => item.productId === P_RICE)?.name).toBe("Synthetic Rice");
  });
});

describe("menu data quirks", () => {
  it("parses numeric prices including a CHF 0 item; DiscountPrice mirrors NormalPrice when unset", async () => {
    const menu = await liveMenu();
    const byId = new Map(menu?.products.map((item) => [item.productId, item]));
    expect(byId.get(P_PAD_THAI)).toMatchObject({ normalPrice: 12.5, discountPrice: 12.5 });
    expect(byId.get(P_RICE)).toMatchObject({ normalPrice: 0, discountPrice: 0 });
    expect(menu?.currency).toBe("CHF");
  });

  it("dedupes a product relisted across categories by ProductId", async () => {
    const menu = await liveMenu();
    const springListings = menu?.categories.flatMap((category) =>
      category.products.filter((item) => item.productId === P_SPRING),
    );
    // Listed under BOTH cards…
    expect(springListings?.length).toBe(2);
    // …but exactly one row in the deduped product set.
    expect(menu?.products.filter((item) => item.productId === P_SPRING)).toHaveLength(1);
  });

  it("drops empty categories (venue origin-declaration sections)", async () => {
    const menu = await liveMenu();
    expect(menu?.categories.some((category) => category.name === "Synthetic Empty Section")).toBe(false);
  });

  it("keeps an unavailable product flagged under GrayedOut", async () => {
    const menu = await liveMenu();
    const tea = menu?.categories.flatMap((category) => category.products).find((item) => item.productId === P_TEA);
    expect(tea).toMatchObject({ name: "Synthetic Iced Tea", available: false });
    expect(menu?.hiddenItems).toEqual([]);
  });

  it("moves an unavailable product to hiddenItems under HideOut, keeping it in the catalog", async () => {
    const transport = fakeOrderMonkey();
    const c = new OrderMonkeyClient({ fetchImpl: transport.fetchImpl });
    const branch = await c.branch(HIDEOUT_ORG, HIDEOUT_BRANCH);
    const menu = await c.menu(branch!, "Takeaway");
    const listed = menu?.categories.flatMap((category) => category.products) ?? [];
    expect(listed.some((item) => item.name === "Synthetic Sold Out Noodles")).toBe(false);
    expect(menu?.hiddenItems.map((item) => item.name)).toEqual(["Synthetic Sold Out Noodles"]);
    expect(menu?.products.some((item) => item.name === "Synthetic Sold Out Noodles")).toBe(true);
  });

  it("serves an EMPTY Dinein card set as data, not null (takeaway-only branch)", async () => {
    const transport = fakeOrderMonkey();
    const c = new OrderMonkeyClient({ fetchImpl: transport.fetchImpl });
    const branch = await c.branch(LIVE_ORG, LIVE_BRANCH);
    const menu = await c.menu(branch!, "Dinein");
    expect(menu).not.toBeNull();
    expect(menu?.type).toBe("Dinein");
    expect(menu?.categories).toEqual([]);
  });

  it("carries per-product serving variations (Dinein disabled, Takeaway enabled)", async () => {
    const menu = await liveMenu();
    const padThai = menu?.products.find((item) => item.productId === P_PAD_THAI);
    const dinein = padThai?.serving.find((variation) => variation.type === "Dinein");
    const takeaway = padThai?.serving.find((variation) => variation.type === "Takeaway");
    expect(dinein).toMatchObject({ enabled: false });
    expect(takeaway).toMatchObject({ enabled: true });
  });

  it("parses stock info only for stock-enabled products", async () => {
    const menu = await liveMenu();
    const rice = menu?.products.find((item) => item.productId === P_RICE);
    const padThai = menu?.products.find((item) => item.productId === P_PAD_THAI);
    expect(rice?.stock).toEqual({ limitType: "DailyLimit", current: 7, alertLimit: 2 });
    expect(padThai?.stock).toBeNull();
  });

  it("carries taxes with the POS ThirdPartyRefId id space", async () => {
    const menu = await liveMenu();
    const padThai = menu?.products.find((item) => item.productId === P_PAD_THAI);
    expect(padThai?.taxes).toEqual([
      {
        rate: 2.9,
        type: "Takeaway",
        name: "Take-Away",
        thirdPartyRefId: "aa99bb88cc774d558e66ff7766889900",
      },
    ]);
  });

  it("keeps heterogeneous category id shapes (dashed GUID and 64-hex concat)", async () => {
    const menu = await liveMenu();
    expect(menu?.categories[0]?.id).toBe("1111111a-2222-4333-8444-55555555555a");
    expect(menu?.categories[1]?.id).toBe(
      "abcdef01abcdef01abcdef01abcdef01fedcba98fedcba98fedcba98fedcba98",
    );
  });
});
