/**
 * An unconfigured runner DB makes the shadow log a no-op BEFORE any side
 * effect: no SM lookup, no image write, and one warning per process naming
 * the variable to set. The warning latch is per module instance, so a
 * second unset-DSN case in this file would find it already set.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { vgaQuery, dir } = vi.hoisted(() => ({
  vgaQuery: vi.fn(),
  dir: { current: "" },
}));

vi.mock("@/lib/db/vga", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/vga")>();
  return { ...actual, vgaQuery };
});
vi.mock("@/lib/vga/corrections-dir", () => ({
  correctionsDir: () => dir.current,
  imageDir: () => dir.current,
}));

import { logShadowSample } from "./shadow-log";

const sample = {
  imageBase64: "aGVsbG8=",
  prompt: "the button",
  predictedBbox: { x: 1, y: 2, w: 3, h: 4 },
  modelUsed: "v5",
  confidence: 0.9,
  stateMachineId: "sm-1",
  targetProcess: "app.exe",
};

beforeEach(() => {
  vgaQuery.mockReset().mockResolvedValue({ rows: [] });
  dir.current = mkdtempSync(path.join(tmpdir(), "vga-shadow-"));
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  rmSync(dir.current, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("logShadowSample", () => {
  it("skips every side effect when the runner DB is unset, warning once", async () => {
    vi.stubEnv("RUNNER_DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await logShadowSample(sample);
    await logShadowSample(sample);

    expect(vgaQuery).not.toHaveBeenCalled();
    expect(readdirSync(dir.current)).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "Set RUNNER_DATABASE_URL"
    );
  });

  it("logs the sample when the runner DB is configured", async () => {
    vi.stubEnv("RUNNER_DATABASE_URL", "postgresql://u:p@db.example:5432/x");
    await logShadowSample(sample);

    expect(vgaQuery).toHaveBeenCalledTimes(2);
    expect(String(vgaQuery.mock.calls[1]?.[0])).toContain(
      "INSERT INTO vga_shadow_samples"
    );
    expect(readdirSync(dir.current)).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}\.png$/),
    ]);
  });
});
