/**
 * The stateful half of the gate-clearance surface: the CALL SEQUENCE, which is
 * where a rule edit can silently loosen who may clear a gate.
 *
 * Coord's `UpdatePolicyRequest` carries no `payload`, so changing a rule's
 * class or authority means replacing the row. The order is the safety property
 * — create the replacement first, delete the old one second — because the
 * reverse leaves an interval with NO rule for the class, and coord's no-rule
 * default for an agent-audience gate is `agent_any`, the loosest setting there
 * is. These tests pin the order and both failure arms against the calls
 * actually issued, not against a rendered string.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: vi.fn(),
  },
}));

const calls: string[] = [];
const listCoordPolicies = vi.fn(async () => {
  calls.push("list");
  return { policies: [], total: 0 };
});
const createCoordPolicy = vi.fn(async (body: unknown) => {
  calls.push("create");
  return { policy_id: "new-1", ...(body as object) };
});
const deleteCoordPolicy = vi.fn(async (id: string) => {
  calls.push(`delete:${id}`);
  return undefined;
});
const patchCoordPolicy = vi.fn(async (id: string) => {
  calls.push(`patch:${id}`);
  return undefined;
});

vi.mock("../../_shared/coordPolicyApi", () => ({
  listCoordPolicies: (...a: never[]) => listCoordPolicies(...a),
  createCoordPolicy: (b: unknown) => createCoordPolicy(b),
  deleteCoordPolicy: (id: string) => deleteCoordPolicy(id),
  patchCoordPolicy: (id: string) => patchCoordPolicy(id),
  restoreCoordPolicyDefault: vi.fn(),
  putCoordPolicySystemOverride: vi.fn(),
  deleteCoordPolicySystemOverride: vi.fn(),
}));

import { useGateClearanceRules } from "./useGateClearanceRules";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";

const PREVIOUS = {
  policy_id: "old-1",
  name: "old rule",
  payload: { gate_class: "security-surface", authority: "agent_any" },
} as unknown as CoordPolicyRow;

const INPUT = {
  name: "tightened",
  gateClass: "security-surface",
  authority: "operator_only" as const,
};

async function mountHook() {
  const view = renderHook(() => useGateClearanceRules());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  calls.length = 0;
  return view;
}

beforeEach(() => {
  calls.length = 0;
  toastError.mockReset();
  toastSuccess.mockReset();
  createCoordPolicy.mockClear();
  deleteCoordPolicy.mockClear();
  patchCoordPolicy.mockClear();
  createCoordPolicy.mockImplementation(async (body: unknown) => {
    calls.push("create");
    return { policy_id: "new-1", ...(body as object) };
  });
  deleteCoordPolicy.mockImplementation(async (id: string) => {
    calls.push(`delete:${id}`);
    return undefined;
  });
});

describe("replaceRule ordering", () => {
  it("creates the replacement BEFORE deleting the old rule", async () => {
    const { result } = await mountHook();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.replaceRule(PREVIOUS, INPUT);
    });

    expect(ok).toBe(true);
    // The order is the safety property: create, then delete, then reload.
    expect(calls).toEqual(["create", "delete:old-1", "list"]);
    // …and never a disable in between — a disabled row is not listable through
    // the web proxy, so it would be an invisible orphan on a later failure.
    expect(patchCoordPolicy).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("Clearance rule replaced");
  });

  it("sends the v2 decision-domain body coord expects, with no repo", async () => {
    const { result } = await mountHook();
    await act(async () => {
      await result.current.replaceRule(PREVIOUS, INPUT);
    });
    expect(createCoordPolicy).toHaveBeenCalledWith({
      name: "tightened",
      decision_domain: "gate_clearance",
      mode: "data_driven",
      payload: {
        gate_class: "security-surface",
        authority: "operator_only",
      },
    });
  });
});

describe("replaceRule failure arms", () => {
  it("never deletes the old rule when the create fails", async () => {
    createCoordPolicy.mockRejectedValueOnce(new Error("422 bad payload"));
    const { result } = await mountHook();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.replaceRule(PREVIOUS, INPUT);
    });

    expect(ok).toBe(false);
    expect(deleteCoordPolicy).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // The message must not assert "nothing changed" — a response-side failure
    // can leave the row written. It points at the refreshed list instead.
    const message = String(toastError.mock.calls[0][0]);
    expect(message).toContain("422 bad payload");
    expect(message).toContain("refreshed");
    expect(message).not.toContain("nothing changed");
  });

  it("reports failure — not success — when the old rule cannot be removed", async () => {
    deleteCoordPolicy.mockRejectedValueOnce(new Error("500 delete failed"));
    const { result } = await mountHook();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.replaceRule(PREVIOUS, INPUT);
    });

    // Half-applied is NOT success: both rules exist and the user must finish.
    expect(ok).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
    const message = String(toastError.mock.calls[0][0]);
    expect(message).toContain("500 delete failed");
    expect(message).toContain("delete the old one");
  });

  it("refreshes the list after every outcome, so the UI never shows a stale set", async () => {
    deleteCoordPolicy.mockRejectedValueOnce(new Error("boom"));
    const { result } = await mountHook();
    await act(async () => {
      await result.current.replaceRule(PREVIOUS, INPUT);
    });
    expect(calls[calls.length - 1]).toBe("list");
  });
});

describe("create / delete", () => {
  it("create posts the v2 body and reports success", async () => {
    const { result } = await mountHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.create({
        name: "routine",
        gateClass: "routine-review",
        authority: "agent_any",
        priority: 50,
      });
    });
    expect(ok).toBe(true);
    expect(createCoordPolicy).toHaveBeenCalledWith({
      name: "routine",
      decision_domain: "gate_clearance",
      mode: "data_driven",
      payload: { gate_class: "routine-review", authority: "agent_any" },
      priority: 50,
    });
  });

  it("delete reports success on a 204 (no response body)", async () => {
    // `HttpClient.delete` resolves to `undefined` on 204 — keying success on a
    // non-null body would report every successful delete as a failure.
    const { result } = await mountHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.deleteRule("old-1");
    });
    expect(ok).toBe(true);
    expect(toastSuccess).toHaveBeenCalledWith("Clearance rule deleted");
  });
});

describe("a failed list is UNKNOWN, not an empty rule set", () => {
  it("raises loadFailed and leaves the rules empty", async () => {
    listCoordPolicies.mockRejectedValueOnce(new Error("coord unreachable"));
    const { result } = renderHook(() => useGateClearanceRules());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.rules).toEqual([]);
  });
});
