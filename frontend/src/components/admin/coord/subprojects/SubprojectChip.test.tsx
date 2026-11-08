/**
 * The session chip's lookup (plan
 * `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * Phase 6): batches of at most 200 ids, the rows on screen first; each
 * session asked when it appears and again only when its answer comes due —
 * and every state but a membership is a dash that says which, never a guess.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import {
  SUBPROJECT_CHIP_REASK_MS,
  SUBPROJECT_CHIP_RETRY_MS,
  SubprojectChipCell,
  SubprojectChipText,
  useSubprojectsBySessions,
  type SubprojectLookup,
} from "./SubprojectChip";

const MEMBER = { id: "sp-1", title: "console work", headline: "working" };

type Body = {
  items: Record<string, typeof MEMBER>;
  missing: string[];
};

function lookupOf(answer: (ids: string[]) => Promise<Body>) {
  return vi.fn(async (ids: readonly string[]) => answer([...ids]));
}

/** Let the lookup's promises settle and React commit. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function mount(lookup: ReturnType<typeof lookupOf>, ids: Array<string | null>) {
  return renderHook(
    ({ list }: { list: Array<string | null> }) =>
      useSubprojectsBySessions(list, lookup as unknown as SubprojectLookup),
    { initialProps: { list: ids } }
  );
}

describe("useSubprojectsBySessions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-08T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks once for new sessions, and never again for a member", async () => {
    const lookup = lookupOf(async () => ({
      items: { a: MEMBER },
      missing: ["b"],
    }));
    const { result, rerender } = mount(lookup, ["b", null, "a", "b"]);
    expect(result.current.chipOf("a")).toEqual({ kind: "looking_up" });
    await settle();
    expect(result.current.chipOf("a")).toEqual({ kind: "member", ...MEMBER });
    expect(result.current.chipOf("b")).toEqual({ kind: "none" });
    expect(result.current.chipOf(null)).toEqual({ kind: "not_applicable" });
    expect(lookup).toHaveBeenCalledTimes(1);
    // In the caller's order — the rows on screen first.
    expect(lookup.mock.calls[0]?.[0]).toEqual(["b", "a"]);

    // A new list of the same sessions — the next list poll — asks nothing.
    rerender({ list: ["a", "b"] });
    await settle();
    expect(lookup).toHaveBeenCalledTimes(1);

    // A new session is asked about at once, and only it.
    rerender({ list: ["a", "b", "c"] });
    await settle();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup.mock.calls[1]?.[0]).toEqual(["c"]);
    // The known answers stay on screen meanwhile.
    expect(result.current.chipOf("a")).toEqual({ kind: "member", ...MEMBER });
  });

  it("re-asks a 'none' only once it is ~3 minutes old — a member never", async () => {
    const lookup = lookupOf(async () => ({
      items: { a: MEMBER },
      missing: ["b"],
    }));
    const { result } = mount(lookup, ["a", "b"]);
    await settle();
    expect(lookup).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUBPROJECT_CHIP_REASK_MS - 1_000);
      await result.current.recheck();
    });
    expect(lookup).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await result.current.recheck();
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup.mock.calls[1]?.[0]).toEqual(["b"]);
  });

  it("retries a failed lookup once the failure is a minute old, and says failed meanwhile", async () => {
    let fail = true;
    const lookup = lookupOf(async (ids) => {
      if (fail)
        throw new Error(
          `GET /api/v1/operations/subprojects/by-sessions?ids=${ids.join(",")} failed: 503 - {"error":"schema_migration_pending"}`
        );
      return { items: { a: MEMBER }, missing: [] };
    });
    const { result } = mount(lookup, ["a"]);
    await settle();
    expect(result.current.chipOf("a")).toEqual({
      kind: "failed",
      failure: { kind: "migration_pending" },
    });

    await act(async () => {
      await result.current.recheck();
    });
    expect(lookup).toHaveBeenCalledTimes(1);

    fail = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUBPROJECT_CHIP_RETRY_MS);
      await result.current.recheck();
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(result.current.chipOf("a")).toEqual({ kind: "member", ...MEMBER });
  });

  it("asks about every session, in batches of at most 200", async () => {
    const ids = Array.from(
      { length: 450 },
      (_, i) => `s-${String(i).padStart(3, "0")}`
    );
    const lookup = lookupOf(async (asked) => ({ items: {}, missing: asked }));
    const { result } = mount(lookup, ids);
    await settle();
    expect(lookup.mock.calls.map((c) => c[0].length)).toEqual([200, 200, 50]);
    expect(lookup.mock.calls[0]?.[0][0]).toBe("s-000");
    expect(result.current.chipOf("s-449")).toEqual({ kind: "none" });
  });

  it("calls a session coord did not name either way unanswered, not none", async () => {
    const lookup = lookupOf(async () => ({ items: {}, missing: [] }));
    const { result } = mount(lookup, ["a"]);
    await settle();
    expect(result.current.chipOf("a")).toEqual({ kind: "unanswered" });
  });

  it("asks nothing for a page with no session ids", async () => {
    const lookup = lookupOf(async () => ({ items: {}, missing: [] }));
    const { result } = mount(lookup, [null, null]);
    await settle();
    expect(lookup).not.toHaveBeenCalled();
    expect(result.current.chipOf(null)).toEqual({ kind: "not_applicable" });
  });
});

describe("the chip's accessible names are short", () => {
  it("names a member's subproject and headline on its link", () => {
    render(
      <SubprojectChipCell
        chip={{ kind: "member", ...MEMBER }}
        data-testid="chip"
      />
    );
    const link = screen.getByTestId("chip");
    expect(link).toHaveAccessibleName("subproject: console work, working");
    expect(link).toHaveAttribute("title", "Subproject: console work — Working");
  });

  it("reads a dash as a short phrase, with the full sentence on hover", () => {
    render(<SubprojectChipCell chip={{ kind: "none" }} data-testid="chip" />);
    const cell = screen.getByTestId("chip");
    expect(cell).toHaveTextContent("–subproject: none");
    expect(cell.querySelector('[aria-hidden="true"]')).toHaveTextContent("–");
    expect(cell.getAttribute("title")).toMatch(/coord lists no subproject/);
  });

  it("says the same short phrase inside a row's button", () => {
    render(
      <button type="button" data-testid="row">
        <SubprojectChipText chip={{ kind: "agent_unknown" }} />
      </button>
    );
    expect(screen.getByTestId("row")).toHaveAccessibleName(
      "subproject: unknown"
    );
  });
});
