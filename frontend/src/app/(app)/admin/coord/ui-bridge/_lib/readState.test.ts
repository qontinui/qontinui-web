/**
 * A read's five states, derived from React Query's fields — so an unasked
 * read, a loading one, a stale one and a failed one never render alike.
 */

import { describe, expect, it } from "vitest";
import { queryView, readStateOf, UNREADABLE_ANSWER } from "./readState";

const base = {
  data: undefined as unknown,
  error: null as unknown,
  isError: false,
  isFetching: false,
  dataUpdatedAt: 0,
  fetchStatus: "idle" as const,
};

const identity = (d: unknown) => d;

describe("readStateOf", () => {
  it("is idle for a read nobody asked for", () => {
    expect(readStateOf(queryView(base), identity)).toEqual({ state: "idle" });
  });

  it("is loading while the first fetch is out", () => {
    expect(
      readStateOf(
        queryView({ ...base, isFetching: true, fetchStatus: "fetching" }),
        identity
      )
    ).toEqual({ state: "loading" });
  });

  it("is ok with the read value and its time", () => {
    expect(
      readStateOf(
        queryView({ ...base, data: { n: 1 }, dataUpdatedAt: 1000 }),
        (d) => d
      )
    ).toEqual({ state: "ok", value: { n: 1 }, stale: false, asOf: 1000 });
  });

  it("keeps a value whose latest refetch failed — and marks it stale", () => {
    const r = readStateOf(
      queryView({
        ...base,
        data: { n: 1 },
        dataUpdatedAt: 1000,
        isError: true,
        error: new Error("boom"),
      }),
      (d) => d
    );
    expect(r).toEqual({
      state: "ok",
      value: { n: 1 },
      stale: true,
      asOf: 1000,
    });
  });

  it("fails with its reason when nothing was ever read", () => {
    const r = readStateOf(
      queryView({ ...base, isError: true, error: new Error("boom") }),
      identity
    );
    expect(r).toEqual({
      state: "failed",
      issue: { kind: "failed", cause: "boom", requestId: null, quotes: true },
    });
  });

  it("fails as UNREADABLE for an answer the page cannot read", () => {
    expect(
      readStateOf(
        queryView({ ...base, data: "x", dataUpdatedAt: 5 }),
        () => null
      )
    ).toEqual({ state: "failed", issue: UNREADABLE_ANSWER });
  });
});
