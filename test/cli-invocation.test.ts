import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Regression tests for the bin no-op bug (inherited from the pre-fix
 * gastronovi invocation guard): npm installs the bin as a .bin symlink
 * while Node realpaths the ESM entry, so a naive argv[1] vs
 * import.meta.url compare made the CLI exit 0 with no output for real
 * consumers. These tests invoke the BUILT dist/cli.js the way a
 * consumer does — once through a symlink, once directly — and require
 * runCli to actually run. Requires `npm run build` (CI order and the
 * install-time `prepare` script both guarantee dist/).
 */
const cliJs = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const binDir = mkdtempSync(join(tmpdir(), "ordermonkey-bin-"));
const binLink = join(binDir, "ordermonkey");
symlinkSync(cliJs, binLink);

afterAll(() => {
  rmSync(binDir, { recursive: true, force: true });
});

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

function runBin(bin: string, args: readonly string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [bin, ...args], (error, stdout, stderr) => {
      if (error !== null && error.code === undefined) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr, code: error === null ? 0 : error.code ?? null });
    });
  });
}

describe("bin invocation", () => {
  it("runs through a symlink like an npm .bin install (regression: silent no-op)", async () => {
    const result = await runBin(binLink, ["help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("ordermonkey — read-only");
    expect(result.stdout).toContain("menu <welcome-url-or-ids>");
  });

  it("runs directly from dist and refuses orders by design", async () => {
    const result = await runBin(cliJs, ["order", "whatever"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no order command exists by design");
  });

  it("symlink invocation still validates args (runCli really ran)", async () => {
    const result = await runBin(binLink, ["--lane", "kiosk", "menu", "x"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--lane must be qr or webshop");
  });
});
