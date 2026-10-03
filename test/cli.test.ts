import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { fakeOrderMonkey, LIVE_BRANCH, LIVE_ORG, TIER3_BRANCH, TIER3_ORG } from "./ordermonkey-fake.js";

function ports(lines: string[], errors: string[]) {
  return {
    out: (line: string) => lines.push(line),
    err: (line: string) => errors.push(line),
  };
}

const WELCOME = `https://app.ordermonkey.com/welcome/${LIVE_ORG}/${LIVE_BRANCH}`;

describe("runCli", () => {
  it("reads a menu from a welcome URL and prints venue, tier and CHF prices", async () => {
    const transport = fakeOrderMonkey();
    const lines: string[] = [];
    const code = await runCli(["menu", WELCOME], { ...ports(lines, []), fetchImpl: transport.fetchImpl });
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("venue:      Synthetic Noodle Bar");
    expect(text).toContain("live (SetupStatus Approved)");
    expect(text).toContain("Synthetic Noodles");
    expect(text).toContain("Synthetisches Pad Thai  12.50 CHF");
    expect(text).toContain("(unavailable)");
    expect(text).not.toContain("Synthetic Empty Section");
  });

  it("prints the table binding when the welcome URL carries table_no", async () => {
    const transport = fakeOrderMonkey();
    const lines: string[] = [];
    const code = await runCli(["menu", `${WELCOME}?table_no=4`], { ...ports(lines, []), fetchImpl: transport.fetchImpl });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("table 4");
  });

  it("defaults to Takeaway and reports an empty Dinein read as data (exit 0)", async () => {
    const transport = fakeOrderMonkey();
    const defaultLines: string[] = [];
    expect(await runCli(["menu", WELCOME], { ...ports(defaultLines, []), fetchImpl: transport.fetchImpl })).toBe(0);
    expect(defaultLines.join("\n")).toContain("menu Takeaway");

    const dineinLines: string[] = [];
    expect(await runCli(["menu", WELCOME, "--type", "Dinein"], { ...ports(dineinLines, []), fetchImpl: transport.fetchImpl })).toBe(0);
    expect(dineinLines.join("\n")).toContain("no cards in this type");
    expect(dineinLines.join("\n")).toContain("--type Takeaway");
  });

  it("accepts a bare <orgId>/<branchId> pair", async () => {
    const transport = fakeOrderMonkey();
    const lines: string[] = [];
    const code = await runCli(["menu", `${LIVE_ORG}/${LIVE_BRANCH}`], { ...ports(lines, []), fetchImpl: transport.fetchImpl });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("Synthetic Noodle Bar");
  });

  it("prints the tier-2 caveat that config-404 is NOT deletion", async () => {
    const transport = fakeOrderMonkey();
    const lines: string[] = [];
    const code = await runCli(["menu", `https://app.ordermonkey.com/welcome/bb22cc33-dd44-4e55-8f66-007788990011/b1c2d3e4f5061728394a5b6c7d8e9fa0`], {
      ...ports(lines, []),
      fetchImpl: transport.fetchImpl,
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("catalog rows persist");
    expect(lines.join("\n")).toContain("Synthetic Legacy Cards");
  });

  it("exits 1 with the tier-3 explanation on a dead pair", async () => {
    const transport = fakeOrderMonkey();
    const errors: string[] = [];
    const code = await runCli(["menu", `https://app.ordermonkey.com/welcome/${TIER3_ORG}/${TIER3_BRANCH}`], {
      ...ports([], errors),
      fetchImpl: transport.fetchImpl,
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("tier-3 dead pair");
  });

  it("rejects an order command by design, bad types, bad targets and transport death", async () => {
    const transport = fakeOrderMonkey();
    const orderErrors: string[] = [];
    expect(await runCli(["order", WELCOME], ports([], orderErrors))).toBe(1);
    expect(orderErrors[0]).toContain("no order command exists by design");

    const typeErrors: string[] = [];
    expect(await runCli(["menu", WELCOME, "--type", "Delivery"], ports([], typeErrors))).toBe(1);
    expect(typeErrors[0]).toContain("--type must be Takeaway or Dinein");

    const targetErrors: string[] = [];
    expect(await runCli(["menu", "garbage!"], ports([], targetErrors))).toBe(1);
    expect(targetErrors[0]).toContain("cannot parse");

    const dead: typeof fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const netErrors: string[] = [];
    expect(await runCli(["menu", WELCOME], { ...ports([], netErrors), fetchImpl: dead })).toBe(1);
    expect(netErrors[0]).toContain("fetch failed");
  });

  it("prints usage on help and on no arguments", async () => {
    const lines: string[] = [];
    expect(await runCli([], ports(lines, []))).toBe(0);
    expect(lines.join("\n")).toContain("ordermonkey — read-only");
    expect(lines.join("\n")).toContain("No order command exists by design");
  });
});
