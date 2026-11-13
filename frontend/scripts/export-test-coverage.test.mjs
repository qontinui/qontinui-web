// Regression test for the coverage producer's per-file scratch dir
// (plan 2026-11-10-devops-coverage-producer-leaves-a-covprod-dir-per-test-file-in-ram-tmp):
// every `covprod-*` dir must be gone once its file is processed, also when
// processing throws.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const sandbox = mkdtempSync(join(tmpdir(), "covprod-test-sandbox-"));
const savedTmp = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
let withScratchDir;
let sweepStaleScratchDirs;

const leftovers = () => readdirSync(sandbox).filter((n) => n.startsWith("covprod-"));

describe("export-test-coverage withScratchDir", () => {
  beforeAll(async () => {
    // os.tmpdir() reads these on every call, so the helper's dirs land here.
    process.env.TMPDIR = process.env.TMP = process.env.TEMP = sandbox;
    ({ withScratchDir, sweepStaleScratchDirs } = await import("./export-test-coverage.mjs"));
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(savedTmp)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("importing the script does not run the producer", () => {
    expect(typeof withScratchDir).toBe("function");
    expect(leftovers()).toEqual([]);
  });

  it("removes the scratch dir after a successful run and returns the result", () => {
    let seen;
    const out = withScratchDir((dir) => {
      seen = dir;
      expect(dir.startsWith(join(sandbox, "covprod-"))).toBe(true);
      writeFileSync(join(dir, "coverage-final.json"), "{}");
      return { filesTouched: ["a"], junitXml: null };
    });
    expect(out).toEqual({ filesTouched: ["a"], junitXml: null });
    expect(existsSync(seen)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it("removes the scratch dir when the run throws, and the error propagates", () => {
    expect(() =>
      withScratchDir((dir) => {
        writeFileSync(join(dir, "junit.xml"), "<x/>");
        throw new Error("boom");
      }),
    ).toThrow(/boom/);
    expect(leftovers()).toEqual([]);
  });

  it("many runs leave nothing behind", () => {
    for (let i = 0; i < 25; i++) withScratchDir((dir) => writeFileSync(join(dir, "f"), "x"));
    expect(leftovers()).toEqual([]);
  });

  it("the startup sweep removes only covprod- dirs older than the threshold", () => {
    const old = join(sandbox, "covprod-killedrun");
    const fresh = join(sandbox, "covprod-inflight");
    const other = join(sandbox, "unrelated-old");
    for (const d of [old, fresh, other]) mkdirSync(d);
    writeFileSync(join(old, "junit.xml"), "<x/>");
    const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    utimesSync(old, twoHoursAgo, twoHoursAgo);
    utimesSync(other, twoHoursAgo, twoHoursAgo);
    expect(sweepStaleScratchDirs()).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
    rmSync(fresh, { recursive: true });
    rmSync(other, { recursive: true });
    expect(leftovers()).toEqual([]);
  });
});
