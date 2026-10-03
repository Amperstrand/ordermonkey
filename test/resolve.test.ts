import { describe, expect, it } from "vitest";
import { parseWelcomeTarget } from "../src/index.js";

const ORG = "aa11bb22-cc33-4d44-8e55-ff6677889900";
const BRANCH = "a0b1c2d3e4f5061728394a5b6c7d8e9f";

describe("parseWelcomeTarget", () => {
  it("resolves a full welcome URL into its (orgId, branchId) pair", () => {
    const target = parseWelcomeTarget(`https://app.ordermonkey.com/welcome/${ORG}/${BRANCH}`);
    expect(target).toEqual({ orgId: ORG, branchId: BRANCH, tableNo: null });
  });

  it("accepts the /v2/welcome SPA route form", () => {
    const target = parseWelcomeTarget(`https://app.ordermonkey.com/v2/welcome/${ORG}/${BRANCH}`);
    expect(target).toEqual({ orgId: ORG, branchId: BRANCH, tableNo: null });
  });

  it("accepts a bare path form and a bare <orgId>/<branchId> pair", () => {
    expect(parseWelcomeTarget(`/welcome/${ORG}/${BRANCH}`)).toEqual({ orgId: ORG, branchId: BRANCH, tableNo: null });
    expect(parseWelcomeTarget(`${ORG}/${BRANCH}`)).toEqual({ orgId: ORG, branchId: BRANCH, tableNo: null });
  });

  it("normalizes id shapes: org to dashed, branch to undashed 32-hex", () => {
    const orgUndashed = ORG.replace(/-/g, "");
    const branchDashed = `${BRANCH.slice(0, 8)}-${BRANCH.slice(8, 12)}-${BRANCH.slice(12, 16)}-${BRANCH.slice(16, 20)}-${BRANCH.slice(20)}`;
    const target = parseWelcomeTarget(`${orgUndashed}/${branchDashed}`);
    expect(target?.orgId).toBe(ORG);
    expect(target?.branchId).toBe(BRANCH);
  });

  it("binds table_no when set; empty table_no means dine-in without table binding", () => {
    // Spec test-vector: BOTH states — wayback captures carry ?table_no= EMPTY.
    expect(parseWelcomeTarget(`https://app.ordermonkey.com/welcome/${ORG}/${BRANCH}?table_no=7`)?.tableNo).toBe(7);
    expect(parseWelcomeTarget(`https://app.ordermonkey.com/welcome/${ORG}/${BRANCH}?table_no=`)?.tableNo).toBeNull();
    expect(parseWelcomeTarget(`https://app.ordermonkey.com/welcome/${ORG}/${BRANCH}`)?.tableNo).toBeNull();
    expect(parseWelcomeTarget(`https://app.ordermonkey.com/welcome/${ORG}/${BRANCH}?table_no=abc`)?.tableNo).toBeNull();
  });

  it("accepts non-UUID org ids (33-hex totals exist on live links)", () => {
    // Live-verified shape: the run-1 dead pair carries a 5-hex group.
    const org = "a5910451-76e8-4bb4a-b72f-adfcbe736fb4";
    const target = parseWelcomeTarget(`https://app.ordermonkey.com/welcome/${org}/${BRANCH}`);
    expect(target?.orgId).toBe(org);
    // Undashed 33-hex cannot be reliably re-dashed — rejected, not mangled.
    expect(parseWelcomeTarget(`${org.replace(/-/g, "")}/${BRANCH}`)).toBeNull();
  });

  it("rejects foreign hosts, foreign paths, malformed ids and extra segments", () => {
    expect(parseWelcomeTarget("https://example.test/welcome/aa/bb")).toBeNull();
    expect(parseWelcomeTarget("https://app.ordermonkey.com/other/aa/bb")).toBeNull();
    expect(parseWelcomeTarget(`https://app.ordermonkey.com/welcome/${ORG}`)).toBeNull();
    expect(parseWelcomeTarget(`https://app.ordermonkey.com/welcome/${ORG}/${BRANCH}/extra`)).toBeNull();
    expect(parseWelcomeTarget("not-a-url!")).toBeNull();
    expect(parseWelcomeTarget("zzzz/www")).toBeNull();
    expect(parseWelcomeTarget("")).toBeNull();
  });
});
