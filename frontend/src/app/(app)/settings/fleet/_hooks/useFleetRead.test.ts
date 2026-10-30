import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFleetRead } from "./useFleetRead";

/** A read the test settles by hand, so replies can overtake each other. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const fail = (reason: string) => () => Promise.reject(new Error(reason));

describe("useFleetRead", () => {
  it("is UNKNOWN with the reason when the first read fails, and re-throws it", async () => {
    const { result } = renderHook(() => useFleetRead<number[]>([]));

    await act(async () => {
      // Re-thrown, so a caller that reports failures (fetchAll's toast) can.
      await expect(result.current.load(fail("down"))).rejects.toThrow("down");
    });

    expect(result.current).toMatchObject({
      rows: [],
      unknown: true,
      stale: false,
      failure: "down",
    });
  });

  it("keeps rows a newer read failed to replace, STALE with that read's reason", async () => {
    const { result } = renderHook(() => useFleetRead<number[]>([]));

    await act(() => result.current.load(() => Promise.resolve([1])));
    expect(result.current).toMatchObject({
      rows: [1],
      unknown: false,
      stale: false,
    });

    await act(() => result.current.load(fail("down")).catch(() => {}));
    expect(result.current).toMatchObject({
      rows: [1],
      unknown: false,
      stale: true,
      failure: "down",
    });

    // A read that delivers is current again.
    await act(() => result.current.load(() => Promise.resolve([2])));
    expect(result.current).toMatchObject({
      rows: [2],
      unknown: false,
      stale: false,
    });
  });

  it("gives the NEWEST failed read's reason when an older read fails later", async () => {
    const { result } = renderHook(() => useFleetRead<number[]>([]));
    const older = deferred<number[]>();
    const newer = deferred<number[]>();
    let olderDone!: Promise<void>;
    let newerDone!: Promise<void>;
    act(() => {
      olderDone = result.current.load(() => older.promise).catch(() => {});
      newerDone = result.current.load(() => newer.promise).catch(() => {});
    });

    await act(async () => {
      newer.reject(new Error("newer"));
      await newerDone;
    });
    await act(async () => {
      older.reject(new Error("older"));
      await olderDone;
    });

    expect(result.current).toMatchObject({ unknown: true, failure: "newer" });
  });

  it("labels an older read's rows STALE when a newer read already failed", async () => {
    const { result } = renderHook(() => useFleetRead<number[]>([]));
    const older = deferred<number[]>();
    const newer = deferred<number[]>();
    let olderDone!: Promise<void>;
    let newerDone!: Promise<void>;
    act(() => {
      olderDone = result.current.load(() => older.promise).catch(() => {});
      newerDone = result.current.load(() => newer.promise).catch(() => {});
    });

    await act(async () => {
      newer.reject(new Error("newer"));
      await newerDone;
    });
    expect(result.current).toMatchObject({ rows: [], unknown: true });

    // The older read answers after all: its rows are real, but a newer read
    // has already failed to confirm them.
    await act(async () => {
      older.resolve([1]);
      await olderDone;
    });
    expect(result.current).toMatchObject({
      rows: [1],
      unknown: false,
      stale: true,
      failure: "newer",
    });
  });
});
