import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins every `coordGates.ts` request: the RELATIVE URL (plan D6, literal
 * here) with the gate id encoded, the method, the body, and the retry policy
 * — every write `idempotent: false`, so a 5xx after the verb may have landed
 * is never re-sent.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const gates = await import("./coordGates");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordGates client", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchGatesList GETs /gates/list, keeping the caller's retry budget", async () => {
    fetchMock.mockResolvedValueOnce(json({ gates: [] }));
    await expect(gates.fetchGatesList({ maxRetries: 0 })).resolves.toEqual({
      gates: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/gates/list",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it.each([
    ["approveGate", () => gates.approveGate("g/1"), "approve", "POST", {}],
    ["rejectGate", () => gates.rejectGate("g/1"), "reject", "POST", {}],
    [
      "rejectGate (reason)",
      () => gates.rejectGate("g/1", { reason: "no" }),
      "reject",
      "POST",
      { reason: "no" },
    ],
    ["reopenGate", () => gates.reopenGate("g/1"), "reopen", "POST", {}],
    ["muteGate", () => gates.muteGate("g/1"), "mute", "POST", {}],
    ["unmuteGate", () => gates.unmuteGate("g/1"), "unmute", "POST", {}],
    [
      "snoozeGate",
      () => gates.snoozeGate("g/1", "2026-10-10T00:00:00.000Z"),
      "snooze",
      "POST",
      { until: "2026-10-10T00:00:00.000Z" },
    ],
    [
      "forceClearGate",
      () => gates.forceClearGate("g/1", "stuck"),
      "force-clear",
      "POST",
      { reason: "stuck" },
    ],
    [
      "cancelGateContinuation",
      () =>
        gates.cancelGateContinuation("g/1", {
          cancelled_by: "operator-console",
          reason: "r",
        }),
      "continuation-cancel",
      "POST",
      { cancelled_by: "operator-console", reason: "r" },
    ],
    [
      "setGateAudience",
      () => gates.setGateAudience("g/1", "agent"),
      "audience",
      "PATCH",
      { audience: "agent" },
    ],
  ] as const)(
    "%s sends %s /gates/{id}/<verb> once, never re-sent",
    async (_name, call, verb, method, body) => {
      fetchMock.mockResolvedValueOnce(json({ ok: true }));
      await expect(call()).resolves.toEqual({ ok: true });
      expect(fetchMock.mock.calls[0]).toEqual([
        `/api/v1/operations/gates/g%2F1/${verb}`,
        { method, body: JSON.stringify(body), idempotent: false },
      ]);
    }
  );

  it("a write's 2xx with no parseable body is still a success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(gates.muteGate("g1")).resolves.toBeNull();
  });

  it("a write's non-2xx rejects with coord's body readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not an approval gate", { status: 409 }));
    const err = await gates.approveGate("g1").catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "POST /api/v1/operations/gates/g1/approve failed: 409 - not an approval gate"
    );
    expect(httpStatusOf(err)).toBe(409);
    expect(httpBodyOf(err)).toBe("not an approval gate");
  });
});
