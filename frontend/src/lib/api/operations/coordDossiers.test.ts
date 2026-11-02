import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request the coord-dossiers client sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchCoordDossiers } = await import("./coordDossiers");

function answer(body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
}

describe("coordDossiers", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("GETs one page with only the limit when nothing is set", async () => {
    answer({ dossiers: [] });
    await expect(fetchCoordDossiers({ limit: 50 })).resolves.toEqual({
      dossiers: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/dossiers?limit=50",
      { method: "GET", idempotent: true },
    ]);
  });

  it("sends every filter, repeated keys repeated, in a fixed order", async () => {
    answer({ dossiers: [] });
    await fetchCoordDossiers({
      limit: 50,
      readiness: ["ready_for_pvi", "none"],
      remediationState: ["none"],
      q: "sibling build",
      recurrenceMin: 0,
      recurrenceMax: 40,
      lastSeenSince: "2026-10-01",
      lastSeenUntil: "2026-10-24",
      hasOpenRemediation: false,
      sort: "recurrence_count",
      order: "asc",
      cursor: "c/1",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/operations/coord/dossiers?limit=50&readiness=ready_for_pvi&readiness=none&remediation_state=none&q=sibling+build&recurrence_min=0&recurrence_max=40&last_seen_since=2026-10-01&last_seen_until=2026-10-24&has_open_remediation=false&sort=recurrence_count&order=asc&cursor=c%2F1"
    );
  });

  it("keeps coord's 400 in the shared error shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("cursor does not match this query", { status: 400 })
    );
    await expect(
      fetchCoordDossiers({ limit: 50, cursor: "stale" })
    ).rejects.toThrow(
      "GET /api/v1/operations/coord/dossiers?limit=50&cursor=stale failed: 400 - cursor does not match this query"
    );
  });
});
