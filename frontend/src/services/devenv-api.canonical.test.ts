/**
 * Wire-shape tests for the canonical-designation client calls.
 *
 * These two functions decide what actually goes over the wire — the audit
 * note's blank-is-null rule and the history's paging query — and component
 * tests mock this module away, so without this file both are untested.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import {
  CANONICAL_HISTORY_PAGE_SIZE,
  getCanonicalHistory,
  setCanonicalMachine,
} from "./devenv-api";

/** The `Response` shape `request()` needs: ok + json(). */
function ok(body: unknown = {}) {
  return { ok: true, status: 200, json: async () => body };
}

/** URL and parsed JSON body of the single call made. */
function lastCall(): { url: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, body: init.body ? JSON.parse(init.body as string) : undefined };
}

describe("setCanonicalMachine", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(ok());
  });

  it("sends a trimmed note", async () => {
    await setCanonicalMachine("env-1", "m-b", "  rebuilt the box  ");
    expect(lastCall().body).toEqual({
      machine_id: "m-b",
      note: "rebuilt the box",
    });
  });

  it.each([
    ["omitted", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["null", null],
  ])("sends note: null when the note is %s", async (_label, note) => {
    await setCanonicalMachine("env-1", "m-b", note);
    // Never `""`: readers test the note for truthiness, so an empty string
    // would be a third state that means nothing.
    expect(lastCall().body).toEqual({ machine_id: "m-b", note: null });
  });

  it("encodes the environment id into the path", async () => {
    await setCanonicalMachine("env/1", "m-b");
    expect(lastCall().url).toContain("/environments/env%2F1/canonical");
  });
});

describe("getCanonicalHistory", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(ok([]));
  });

  it("requests the first page by default", async () => {
    await getCanonicalHistory("env-1");
    expect(lastCall().url).toContain(
      `/environments/env-1/canonical-history?limit=${CANONICAL_HISTORY_PAGE_SIZE}&offset=0`
    );
  });

  it("passes an explicit page window through", async () => {
    await getCanonicalHistory("env-1", 10, 20);
    expect(lastCall().url).toContain("canonical-history?limit=10&offset=20");
  });
});
