import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRAIN_WINDOW_ID,
  DRAIN_WINDOWS,
  MAX_DRAIN_DAYS,
  describeDrainResult,
  drainConfirmText,
  drainScopeSentences,
  drainUntilIso,
  reasonRefusal,
  resolveDrainWindow,
  undrainConfirmText,
  type DrainResponse,
} from "./coordDrain";

/**
 * The pure half of the "Pause coord dispatch" control — plan
 * `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 1.
 *
 * The tests that matter here are the HONESTY ones. The plan's Phase 1 gate has
 * a negative half — "with the host drained, a `[self-hosted, qontinui]` job
 * still routes to it and a session can still be spawned into it; the control's
 * copy must already say both" — and a phase whose whole risk is a mislabelled
 * control should be able to fail on that, not only on arithmetic.
 */

const RESPONSE: DrainResponse = {
  device_id: "d-1",
  drained: true,
  until: "2026-09-01T12:00:00Z",
  reason: "clippy failing 2/2",
  drained_by: "operator@example.com",
  drained_at: "2026-08-31T12:00:00Z",
  version: 17,
  changed: true,
};

describe("expiry windows", () => {
  it("offers no open-ended option", () => {
    // Coord's `until` is non-`Option` for exactly this reason: a pause with no
    // deadline is a permanent removal nobody remembers making.
    for (const w of DRAIN_WINDOWS) {
      expect(w.hours).toBeGreaterThan(0);
      expect(Number.isFinite(w.hours)).toBe(true);
    }
  });

  it("never offers longer than coord's own ceiling", () => {
    const maxHours = Math.max(...DRAIN_WINDOWS.map((w) => w.hours));
    expect(maxHours).toBeLessThanOrEqual(MAX_DRAIN_DAYS * 24);
  });

  it("has a default that is one of the offered windows", () => {
    expect(DRAIN_WINDOWS.map((w) => w.id)).toContain(DEFAULT_DRAIN_WINDOW_ID);
  });

  it("resolves an unknown id to the SHORTEST window, never the longest", () => {
    // A stale id can only ever shorten the pause the operator asked for.
    const fallback = resolveDrainWindow("not-a-window");
    const shortest = Math.min(...DRAIN_WINDOWS.map((w) => w.hours));
    expect(fallback.hours).toBe(shortest);
  });

  it("resolves a known id exactly", () => {
    expect(resolveDrainWindow("24h").hours).toBe(24);
  });
});

describe("drainUntilIso", () => {
  it("emits an RFC 3339 instant with an explicit UTC offset", () => {
    const iso = drainUntilIso(Date.parse("2026-08-31T12:00:00Z"), 4);
    expect(iso).toBe("2026-08-31T16:00:00.000Z");
  });

  it("is always in the future of the instant it was computed from", () => {
    const now = Date.parse("2026-08-31T12:00:00Z");
    for (const w of DRAIN_WINDOWS) {
      expect(Date.parse(drainUntilIso(now, w.hours))).toBeGreaterThan(now);
    }
  });
});

describe("scope copy — the honesty gate", () => {
  const sentences = drainScopeSentences("msi-wsl").join(" ");

  it("names the host it actually affects", () => {
    expect(sentences).toContain("msi-wsl");
  });

  it("says GitHub Actions routing is UNCHANGED", () => {
    expect(sentences).toMatch(/GitHub Actions routing is UNCHANGED/);
    expect(sentences).toContain("[self-hosted, qontinui]");
  });

  it("says sessions can still be spawned into the host", () => {
    expect(sentences).toMatch(/sessions can still be spawned/i);
  });

  it("says the slot cap still counts it", () => {
    expect(sentences).toMatch(/slot cap/i);
  });

  it("never calls the action a disable", () => {
    // The word is reserved for the label lever (Phase 4), which really does
    // take the host out of GitHub's routing. Using it here would be the exact
    // over-claim the plan's Phase 1 warning exists to prevent.
    expect(sentences.toLowerCase()).not.toContain("disable");
  });
});

describe("confirm text", () => {
  it("carries the blast radius AND the expiry", () => {
    const text = drainConfirmText("msi-wsl", "2026-09-01T12:00:00Z");
    expect(text).toContain("msi-wsl");
    // Every scope sentence is repeated verbatim in the confirm — one source.
    for (const s of drainScopeSentences("msi-wsl")) {
      expect(text).toContain(s);
    }
    expect(text).toMatch(/expires by itself/);
  });

  it("falls back to the raw string when the expiry does not parse", () => {
    expect(drainConfirmText("msi-wsl", "not-a-date")).toContain("not-a-date");
  });

  it("warns that resuming lets work flow again immediately", () => {
    expect(undrainConfirmText("msi-wsl")).toMatch(/immediately/);
  });
});

describe("describeDrainResult", () => {
  it("reports a pause with its expiry and the acting operator", () => {
    const out = describeDrainResult(RESPONSE);
    expect(out).toMatch(/^Paused\./);
    expect(out).toContain("operator@example.com");
    expect(out).toContain("17");
  });

  it("reports a release", () => {
    expect(
      describeDrainResult({ ...RESPONSE, drained: false, until: null })
    ).toMatch(/^Released\./);
  });

  it("does NOT dress a no-op release up as a release", () => {
    // Coord writes no audit side effects when nothing changed, so the console
    // must not claim it released something it did not hold.
    const out = describeDrainResult({
      ...RESPONSE,
      drained: false,
      until: null,
      changed: false,
    });
    expect(out).toMatch(/No change/);
    expect(out).toMatch(/nothing to release/);
    expect(out).not.toMatch(/^Released/);
  });

  it("distinguishes a no-op pause from a no-op release", () => {
    const out = describeDrainResult({ ...RESPONSE, changed: false });
    expect(out).toMatch(/already paused/);
  });
});

describe("reasonRefusal", () => {
  it("refuses blank and whitespace-only reasons", () => {
    expect(reasonRefusal("")).toBe("Reason is required.");
    expect(reasonRefusal("   \t ")).toBe("Reason is required.");
  });

  it("accepts a real reason", () => {
    expect(reasonRefusal("clippy failing 2/2")).toBeNull();
  });
});
