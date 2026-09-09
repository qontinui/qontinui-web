/**
 * The Phase 6 gate of `2026-08-31-runner-publishes-embedded-command-defaults`:
 * **the unavailable state renders when no baseline exists** — and, because
 * "no baseline" is three different facts, each of them renders as itself and
 * none of them renders an empty diff. Plus the available arm's one wording
 * rule: the left side is "published by runner vX.Y.Z", never "the default".
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AgentTextUnitDefault } from "@/lib/api/agent-text-units";
import { BaselineDiff } from "./BaselineDiff";

const SHIPPED: AgentTextUnitDefault = {
  kind: "command",
  name: "vet-plan",
  files: { "vet-plan.md": "# vet-plan\nshipped line\n" },
  checksum: "sha256-shipped",
  published_by_version: "0.4.12",
  published_at: "2026-09-05T08:00:00Z",
};

function renderPanel(
  overrides: Partial<Parameters<typeof BaselineDiff>[0]> = {}
) {
  return render(
    <BaselineDiff
      unitName="vet-plan"
      singular="command"
      baseline={null}
      rosterVersion={null}
      baselineError={null}
      currentLabel="account override v3"
      currentFiles={{ "vet-plan.md": "# vet-plan\nmy line\n" }}
      currentChecksum="sha256-mine"
      {...overrides}
    />
  );
}

describe("<BaselineDiff> — the unavailable arm stays", () => {
  it("renders unavailable when no runner has published to this account", () => {
    renderPanel({ baseline: null, rosterVersion: null });
    const arm = screen.getByTestId("unit-baseline-unavailable");
    expect(arm).toHaveAttribute("data-reason", "none-published");
    expect(arm.textContent).toMatch(/No runner has published/);
    // Nothing fabricated on the left: no diff, no file picker.
    expect(screen.queryByTestId("unit-diff")).toBeNull();
    expect(screen.queryByTestId("unit-diff-identical")).toBeNull();
    expect(screen.queryByTestId("unit-baseline-file")).toBeNull();
  });

  it("renders UNKNOWN, not absent, when the defaults read failed", () => {
    renderPanel({ baselineError: "HTTP 503" });
    const arm = screen.getByTestId("unit-baseline-unavailable");
    expect(arm).toHaveAttribute("data-reason", "unknown");
    expect(arm.textContent).toMatch(/unknown from here/);
    expect(arm.textContent).toContain("HTTP 503");
    expect(screen.queryByTestId("unit-diff")).toBeNull();
  });

  it("says so when a roster exists but does not carry this unit", () => {
    renderPanel({ baseline: null, rosterVersion: "0.4.12" });
    const arm = screen.getByTestId("unit-baseline-unavailable");
    expect(arm).toHaveAttribute("data-reason", "not-in-roster");
    expect(arm.textContent).toMatch(
      /runner v0\.4\.12 does not include vet-plan/
    );
    expect(screen.queryByTestId("unit-diff")).toBeNull();
  });
});

describe("<BaselineDiff> — the available arm", () => {
  it("labels the left side by the publishing runner version, never 'the default'", () => {
    renderPanel({ baseline: SHIPPED, rosterVersion: "0.4.12" });
    expect(screen.queryByTestId("unit-baseline-unavailable")).toBeNull();
    const diff = screen.getByTestId("unit-diff");
    expect(diff.textContent).toContain("published by runner v0.4.12");
    expect(diff.textContent).toContain("account override v3");
    expect(diff.textContent).toContain("shipped line");
    expect(diff.textContent).toContain("my line");
    // The panel never calls the baseline "the default".
    expect(screen.getByTestId("unit-baseline").textContent).not.toMatch(
      /\bthe default\b/i
    );
    // And it states the guard's limits rather than implying authority.
    expect(screen.getByTestId("unit-baseline-caveat").textContent).toMatch(
      /not an authoritative default/
    );
  });

  it("reports byte-identity from the canonical checksum, not from text", () => {
    renderPanel({
      baseline: SHIPPED,
      rosterVersion: "0.4.12",
      currentFiles: { ...SHIPPED.files },
      currentChecksum: SHIPPED.checksum,
    });
    expect(screen.getByTestId("unit-baseline-identical").textContent).toMatch(
      /byte-identical to the copy published by runner v0\.4\.12/
    );
    expect(screen.getByTestId("unit-diff-identical")).toBeInTheDocument();
  });

  it("treats a null stored checksum as unknown, never as identical", () => {
    renderPanel({
      baseline: SHIPPED,
      rosterVersion: "0.4.12",
      currentFiles: { ...SHIPPED.files },
      currentChecksum: null,
    });
    expect(screen.queryByTestId("unit-baseline-identical")).toBeNull();
  });
});
