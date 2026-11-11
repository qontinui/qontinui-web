import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStampedFailure } from "./useStampedFailure";
import type { SubprojectReadFailure } from "./subprojectStatus";

const DOWN: SubprojectReadFailure = {
  kind: "unreachable",
  status: 502,
  detail: "",
};
const PENDING: SubprojectReadFailure = { kind: "migration_pending" };

function hook() {
  return renderHook(() => useStampedFailure<string>());
}

describe("useStampedFailure", () => {
  it("keeps a failure that an OLDER read's success arrives after", () => {
    const { result } = hook();
    act(() => result.current.fail("stalled", 2, DOWN));
    act(() => result.current.succeed("stalled", 1));
    expect(result.current.failureFor("stalled")).toBe(DOWN);
  });

  it("clears it on a success issued after it", () => {
    const { result } = hook();
    act(() => result.current.fail("stalled", 2, DOWN));
    act(() => result.current.succeed("stalled", 3));
    expect(result.current.failureFor("stalled")).toBeNull();
  });

  it("ignores a failure older than the newest success for its stamp", () => {
    const { result } = hook();
    act(() => result.current.succeed("stalled", 3));
    act(() => result.current.fail("stalled", 2, DOWN));
    expect(result.current.failureFor("stalled")).toBeNull();
  });

  it("keeps the newer of two failures for one stamp", () => {
    const { result } = hook();
    act(() => result.current.fail("stalled", 3, PENDING));
    act(() => result.current.fail("stalled", 2, DOWN));
    expect(result.current.failureFor("stalled")).toBe(PENDING);
  });

  it("keeps each stamp's failure apart: another's neither sets, clears nor replaces it", () => {
    const { result } = hook();
    act(() => result.current.fail("open", 1, DOWN));
    act(() => result.current.fail("stalled", 2, PENDING));
    expect(result.current.failureFor("open")).toBe(DOWN);
    expect(result.current.failureFor("stalled")).toBe(PENDING);
    act(() => result.current.succeed("stalled", 3));
    expect(result.current.failureFor("open")).toBe(DOWN);
    expect(result.current.failureFor("stalled")).toBeNull();
    expect(result.current.failureFor("done")).toBeNull();
  });
});
