/**
 * CitationBackfillPolicyPanel — renders the RESOLVED
 * `citation_scope_backfill_write` level, and never a guessed one.
 *
 * The hook is mocked: its honesty properties are covered in
 * `../_hooks/useCitationScopeBackfillPolicy.test.ts`. What is pinned here is
 * the panel's reading of a resolved policy: the no-row default is `dry_run`; a
 * no-row answer of anything else is flagged as a coord build that predates
 * the dial; a failed read is UNKNOWN, not `off`; and the copy says the dial
 * governs the AGENT door only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useBackfillPolicyMock = vi.fn();
vi.mock("../_hooks/useCitationScopeBackfillPolicy", () => ({
  useCitationScopeBackfillPolicy: () => useBackfillPolicyMock(),
}));

import { CitationBackfillPolicyPanel } from "./CitationBackfillPolicyPanel";

function hookState(
  policy: Record<string, unknown> | null,
  overrides: Record<string, unknown> = {}
) {
  return {
    policy,
    loading: false,
    saving: false,
    error: null,
    readbackError: null,
    lastWrite: null,
    reload: vi.fn(),
    setLevel: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const DRY_RUN_NO_ROW = {
  domain: "citation_scope_backfill_write",
  effective_level: "dry_run",
  master_enabled: true,
  resolved_scope: "none",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CitationBackfillPolicyPanel", () => {
  it("offers all three levels and says it governs the agent door only", () => {
    useBackfillPolicyMock.mockReturnValue(hookState(DRY_RUN_NO_ROW));
    render(<CitationBackfillPolicyPanel />);

    for (const level of ["off", "dry_run", "live"]) {
      expect(
        screen.getByTestId(`citation-backfill-level-${level}`)
      ).toBeTruthy();
    }
    const section = screen.getByTestId("citation-backfill-policy");
    expect(section.textContent).toContain("agent door only");
    expect(section.textContent).toContain("operator backfill is unaffected");
  });

  it("names `dry_run` as coord's no-row default", () => {
    useBackfillPolicyMock.mockReturnValue(hookState(DRY_RUN_NO_ROW));
    render(<CitationBackfillPolicyPanel />);

    const copy = screen.getByTestId("citation-backfill-no-row");
    expect(copy.querySelector("code")?.textContent).toBe("dry_run");
    expect(copy.textContent).toContain("per-domain default");
    expect(screen.getByTestId("citation-backfill-effective").textContent).toBe(
      "dry_run"
    );
    expect(screen.getByTestId("citation-backfill-scope").textContent).toBe(
      "none"
    );
    expect(
      screen.queryByTestId("citation-backfill-no-row-unrecognised")
    ).toBeNull();
  });

  it("flags a no-row `off` as a coord build that predates the dial", () => {
    // An unregistered domain resolves `off` with no row. Calling that
    // "coord's default" would be false; it is an undeployed dial.
    useBackfillPolicyMock.mockReturnValue(
      hookState({ ...DRY_RUN_NO_ROW, effective_level: "off" })
    );
    render(<CitationBackfillPolicyPanel />);

    expect(screen.queryByTestId("citation-backfill-no-row")).toBeNull();
    const warn = screen.getByTestId("citation-backfill-no-row-unrecognised");
    expect(warn.textContent).toContain("predates the dial");
  });

  it("shows a failed read as unknown, never as off", () => {
    useBackfillPolicyMock.mockReturnValue(
      hookState(null, { error: "coord is not reachable" })
    );
    render(<CitationBackfillPolicyPanel />);

    expect(screen.getByTestId("citation-backfill-effective").textContent).toBe(
      "unknown"
    );
    expect(screen.queryByTestId("citation-backfill-no-row")).toBeNull();
    expect(screen.getByTestId("citation-backfill-blurb").textContent).toContain(
      "unknown"
    );
    expect(screen.getByTestId("citation-backfill-error").textContent).toContain(
      "The current level is unknown"
    );
    // Role is unknown too, so the write buttons are disabled with that reason.
    expect(
      screen.getByTestId("citation-backfill-readonly").textContent
    ).toContain("could not be read");
  });

  it("warns when a write's read-back failed instead of painting the written level", () => {
    useBackfillPolicyMock.mockReturnValue(
      hookState(DRY_RUN_NO_ROW, {
        readbackError: "read-back failed: coord returned 502",
        lastWrite: { written_level: "live" },
      })
    );
    render(<CitationBackfillPolicyPanel />);

    const banner = screen.getByTestId("citation-backfill-readback-error");
    expect(banner.textContent).toContain("live");
    expect(banner.textContent).toContain("502");
    expect(screen.getByTestId("citation-backfill-effective").textContent).toBe(
      "dry_run"
    );
  });
});
