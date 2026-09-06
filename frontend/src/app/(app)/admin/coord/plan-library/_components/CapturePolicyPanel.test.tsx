/**
 * CapturePolicyPanel — the no-row copy says what devices ACTUALLY resolve.
 *
 * A tenant with no `plan_capture` row resolves coord's per-domain default,
 * which is `record` (amendment A2 of
 * `2026-09-03-plan-library-write-door-nonce-authorized-and-body-sync-on-by-default`).
 * The panel used to say `off` — true when the poller's fail-safe was the only
 * thing answering, and false from the moment coord served a default. Copy that
 * names the wrong level tells the operator the fleet is NOT capturing when it
 * is, and nothing else on the page contradicts it; so the sentence is pinned
 * here, and pinned to the level the hook reports rather than to a literal.
 *
 * The hook is mocked: this file is about the panel's rendering of a resolved
 * policy, and the hook's own honesty properties (read-back UNKNOWN, resolved
 * vs written) are covered in `../_hooks/usePlanCapturePolicy.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useCapturePolicyMock = vi.fn();
vi.mock("../_hooks/usePlanCapturePolicy", () => ({
  usePlanCapturePolicy: () => useCapturePolicyMock(),
}));

import { CapturePolicyPanel } from "./CapturePolicyPanel";

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

const RECORD_NO_ROW = {
  domain: "plan_capture",
  effective_level: "record",
  master_enabled: true,
  resolved_scope: "none",
  can_edit: true,
  keys_not_shown: ["controls", "drain"],
  keys_not_shown_source: "fleet_resources_row",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CapturePolicyPanel — the no-row copy", () => {
  it("says devices fall back to `record`, coord's default, when no row exists", () => {
    useCapturePolicyMock.mockReturnValue(hookState(RECORD_NO_ROW));
    render(<CapturePolicyPanel />);

    const copy = screen.getByTestId("plan-capture-no-row");
    expect(copy.textContent).toContain(
      "No policy row exists for this tenant yet"
    );
    // The load-bearing half: the level named is the one devices resolve.
    expect(copy.querySelector("code")?.textContent).toBe("record");
    expect(copy.textContent).toContain("per-domain default");
    // The retired sentence — `off` as "the poller's fail-safe" — must not
    // survive in any spelling.
    expect(copy.textContent).not.toMatch(/fail-safe/i);
    expect(copy.querySelector("code")?.textContent).not.toBe("off");

    // The badges agree with the sentence: record, from no band at all.
    expect(screen.getByTestId("plan-capture-effective").textContent).toBe(
      "record"
    );
    expect(screen.getByTestId("plan-capture-scope").textContent).toBe("none");
  });

  it("does not render the no-row copy once a real band answers", () => {
    useCapturePolicyMock.mockReturnValue(
      hookState({ ...RECORD_NO_ROW, resolved_scope: "tenant" })
    );
    render(<CapturePolicyPanel />);

    expect(screen.queryByTestId("plan-capture-no-row")).toBeNull();
    expect(screen.getByTestId("plan-capture-scope").textContent).toBe("tenant");
  });

  it("does not render the no-row copy while the policy is unknown", () => {
    // A failed read is UNKNOWN: neither "no row" nor any level may be claimed.
    useCapturePolicyMock.mockReturnValue(
      hookState(null, { error: "coord is not reachable" })
    );
    render(<CapturePolicyPanel />);

    expect(screen.queryByTestId("plan-capture-no-row")).toBeNull();
    expect(screen.getByTestId("plan-capture-effective").textContent).toBe(
      "unknown"
    );
  });
});
