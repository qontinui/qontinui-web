import { describe, expect, it } from "vitest";
import { parseDeepLink, resolveDeepLink } from "./deepLink";
import type { PromptDocumentSummary } from "../types";

const doc = {
  id: "d1",
  kind: "success_metric",
  name: "merge-train-throughput-2026-10",
} as PromptDocumentSummary;

const list = (over: Partial<Parameters<typeof resolveDeepLink>[1]> = {}) => ({
  documents: [doc],
  loading: false,
  error: null,
  degraded: null,
  ...over,
});

const link = { kind: "success_metric", name: "merge-train-throughput-2026-10" };

describe("resolveDeepLink — failure arms first", () => {
  it("never says 'no such document' when the list could not be read", () => {
    expect(
      resolveDeepLink(link, list({ documents: [], error: "HTTP 502" }))
    ).toEqual({ state: "unknown", link, reason: "HTTP 502" });
    expect(
      resolveDeepLink(link, list({ documents: [], degraded: "unprovisioned" }))
    ).toEqual({ state: "unknown", link, reason: "unprovisioned" });
  });

  it("waits while the list is loading", () => {
    expect(
      resolveDeepLink(link, list({ documents: [], loading: true }))
    ).toEqual({
      state: "pending",
    });
  });

  it("says no such document for an unknown pair, an unknown kind, or half a pair", () => {
    const other = { kind: "success_metric", name: "nope" };
    expect(resolveDeepLink(other, list())).toEqual({
      state: "missing",
      link: other,
    });
    const badKind = { kind: "nonsense", name: "x" };
    expect(resolveDeepLink(badKind, list({ loading: true }))).toEqual({
      state: "missing",
      link: badKind,
    });
    const half = { kind: "success_metric", name: "" };
    expect(resolveDeepLink(half, list())).toEqual({
      state: "missing",
      link: half,
    });
  });

  it("finds the document", () => {
    expect(resolveDeepLink(link, list())).toEqual({ state: "found", doc });
  });
});

describe("parseDeepLink", () => {
  it("is null when the URL names nothing", () => {
    expect(parseDeepLink(new URLSearchParams(""))).toBe(null);
  });
  it("reads the pair", () => {
    expect(
      parseDeepLink(new URLSearchParams("kind=success_metric&name=x"))
    ).toEqual({ kind: "success_metric", name: "x" });
  });
});
